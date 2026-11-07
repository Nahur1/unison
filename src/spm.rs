//! A SentencePiece unigram tokenizer, enough for Marian / Firefox Translations
//! vocabularies: the precompiled NFKC normalizer, Viterbi segmentation and byte fallback.
use anyhow::{Context, Result, bail, ensure};
use std::collections::HashMap;

const SPACE: &str = "\u{2581}";

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Normal,
    Unknown,
    Control,
    User,
    Unused,
    Byte,
}

pub struct Spm {
    pieces: Vec<(String, Kind)>,
    lookup: HashMap<String, (u32, f32)>,
    max_piece: usize,
    unk: u32,
    unk_score: f32,
    bytes: [u32; 256],
    trie: Vec<u32>,
    normalized: Vec<u8>,
    dummy_prefix: bool,
    trim_spaces: bool,
}

struct Wire<'a> {
    b: &'a [u8],
    o: usize,
}

enum Value<'a> {
    Int(u64),
    Bytes(&'a [u8]),
    F32(f32),
}

impl<'a> Wire<'a> {
    fn varint(&mut self) -> Result<u64> {
        let mut v = 0u64;
        for shift in (0..64).step_by(7) {
            let c = *self.b.get(self.o).context("Truncated vocabulary")?;
            self.o += 1;
            v |= u64::from(c & 0x7f) << shift;
            if c < 0x80 {
                return Ok(v);
            }
        }
        bail!("Invalid vocabulary varint")
    }
    fn next(&mut self) -> Result<Option<(u64, Value<'a>)>> {
        if self.o >= self.b.len() {
            return Ok(None);
        }
        let key = self.varint()?;
        let value = match key & 7 {
            0 => Value::Int(self.varint()?),
            1 => {
                self.o += 8;
                Value::Int(0)
            }
            2 => {
                let len = self.varint()? as usize;
                let s = self.b.get(self.o..self.o + len).context("Truncated vocabulary")?;
                self.o += len;
                Value::Bytes(s)
            }
            5 => {
                let s = self.b.get(self.o..self.o + 4).context("Truncated vocabulary")?;
                self.o += 4;
                Value::F32(f32::from_le_bytes(s.try_into().unwrap()))
            }
            t => bail!("Unsupported vocabulary field type {t}"),
        };
        ensure!(self.o <= self.b.len(), "Truncated vocabulary");
        Ok(Some((key >> 3, value)))
    }
}

impl Spm {
    pub fn load(data: &[u8]) -> Result<Self> {
        let mut pieces = Vec::new();
        let mut scores = Vec::new();
        let (mut charsmap, mut dummy_prefix, mut trim_spaces) = (&[][..], true, true);
        let mut model = Wire { b: data, o: 0 };
        while let Some((field, value)) = model.next()? {
            match (field, value) {
                (1, Value::Bytes(b)) => {
                    let (mut piece, mut score, mut kind) = (String::new(), 0.0, 1);
                    let mut w = Wire { b, o: 0 };
                    while let Some(f) = w.next()? {
                        match f {
                            (1, Value::Bytes(s)) => piece = String::from_utf8_lossy(s).into_owned(),
                            (2, Value::F32(v)) => score = v,
                            (3, Value::Int(v)) => kind = v,
                            _ => {}
                        }
                    }
                    let kind = match kind {
                        2 => Kind::Unknown,
                        3 => Kind::Control,
                        4 => Kind::User,
                        5 => Kind::Unused,
                        6 => Kind::Byte,
                        _ => Kind::Normal,
                    };
                    pieces.push((piece, kind));
                    scores.push(score);
                }
                (3, Value::Bytes(b)) => {
                    let mut w = Wire { b, o: 0 };
                    while let Some(f) = w.next()? {
                        match f {
                            (2, Value::Bytes(s)) => charsmap = s,
                            (3, Value::Int(v)) => dummy_prefix = v != 0,
                            (4, Value::Int(v)) => trim_spaces = v != 0,
                            _ => {}
                        }
                    }
                }
                _ => {}
            }
        }
        ensure!(pieces.len() > 300, "The subtitle vocabulary is empty");
        let mut lookup = HashMap::new();
        let (mut max_piece, mut min_score, mut unk) = (1, f32::MAX, None);
        let mut bytes = [u32::MAX; 256];
        for (i, ((p, kind), score)) in pieces.iter().zip(&scores).enumerate() {
            match kind {
                Kind::Normal | Kind::User => {
                    if *kind == Kind::Normal {
                        min_score = min_score.min(*score);
                    }
                    max_piece = max_piece.max(p.len());
                    lookup.insert(p.clone(), (i as u32, *score));
                }
                Kind::Unknown => unk = Some(i as u32),
                Kind::Byte => {
                    if let Some(hex) = p.strip_prefix("<0x").and_then(|s| s.strip_suffix('>')) {
                        if let Ok(b) = u8::from_str_radix(hex, 16) {
                            bytes[b as usize] = i as u32;
                        }
                    }
                }
                Kind::Control | Kind::Unused => {}
            }
        }
        let (trie, normalized) = if charsmap.len() >= 4 {
            let n = u32::from_le_bytes(charsmap[..4].try_into().unwrap()) as usize;
            ensure!(n % 4 == 0 && 4 + n <= charsmap.len(), "Invalid vocabulary normalizer");
            let trie = charsmap[4..4 + n]
                .chunks_exact(4)
                .map(|c| u32::from_le_bytes(c.try_into().unwrap()))
                .collect();
            (trie, charsmap[4 + n..].to_vec())
        } else {
            (Vec::new(), Vec::new())
        };
        Ok(Spm {
            pieces,
            lookup,
            max_piece,
            unk: unk.context("The vocabulary has no unknown token")?,
            unk_score: min_score - 10.0,
            bytes,
            trie,
            normalized,
            dummy_prefix,
            trim_spaces,
        })
    }

    pub fn len(&self) -> usize {
        self.pieces.len()
    }

    /// Longest normalizer rule at the start of `input`: (replacement, bytes consumed).
    fn normalize_prefix<'a>(&'a self, input: &'a str) -> (&'a str, usize) {
        let key = input.as_bytes();
        let (mut best_len, mut best_value) = (0, 0usize);
        if !self.trie.is_empty() {
            // darts-clone common prefix search.
            let unit = |i: usize| self.trie.get(i).copied().unwrap_or(0);
            let offset = |u: u32| ((u >> 10) << ((u & (1 << 9)) >> 6)) as usize;
            let mut node = offset(unit(0));
            for (i, &c) in key.iter().enumerate() {
                node ^= c as usize;
                let u = unit(node);
                if u & ((1 << 31) | 0xff) != c as u32 {
                    break;
                }
                node ^= offset(u);
                if (u >> 8) & 1 == 1 {
                    best_len = i + 1;
                    best_value = (unit(node) & ((1 << 31) - 1)) as usize;
                }
            }
        }
        if best_len > 0 && input.is_char_boundary(best_len) {
            if let Some(rest) = self.normalized.get(best_value..) {
                let end = rest.iter().position(|&b| b == 0).unwrap_or(rest.len());
                if let Ok(s) = std::str::from_utf8(&rest[..end]) {
                    return (s, best_len);
                }
            }
        }
        let n = input.chars().next().map_or(1, char::len_utf8);
        (&input[..n], n)
    }

    pub fn normalize(&self, input: &str) -> String {
        let mut input = input;
        if self.trim_spaces {
            while !input.is_empty() {
                let (s, n) = self.normalize_prefix(input);
                if s != " " {
                    break;
                }
                input = &input[n..];
            }
        }
        let mut out = String::with_capacity(input.len() + 8);
        if input.is_empty() {
            return out;
        }
        if self.dummy_prefix {
            out.push_str(SPACE);
        }
        let mut prev_space = self.trim_spaces;
        while !input.is_empty() {
            let (mut s, n) = self.normalize_prefix(input);
            while prev_space && s.starts_with(' ') {
                s = &s[1..];
            }
            if !s.is_empty() {
                for c in s.chars() {
                    if c == ' ' {
                        out.push_str(SPACE);
                    } else {
                        out.push(c);
                    }
                }
                prev_space = s.ends_with(' ');
            }
            input = &input[n..];
        }
        if self.trim_spaces {
            while out.ends_with(SPACE) {
                out.truncate(out.len() - SPACE.len());
            }
        }
        out
    }

    /// Text to token ids (without the end-of-sentence token).
    pub fn encode(&self, text: &str) -> Vec<u32> {
        let s = self.normalize(text);
        let bounds: Vec<usize> = s.char_indices().map(|(i, _)| i).chain([s.len()]).collect();
        let n = bounds.len() - 1;
        // Viterbi over character positions: (best score, back pointer, piece id or unknown).
        let mut best = vec![(f32::NEG_INFINITY, 0usize, u32::MAX); n + 1];
        best[0].0 = 0.0;
        for i in 0..n {
            let base = best[i].0;
            if base == f32::NEG_INFINITY {
                continue;
            }
            let mut single = false;
            let mut j = i + 1;
            while j <= n && bounds[j] - bounds[i] <= self.max_piece {
                if let Some(&(id, score)) = self.lookup.get(&s[bounds[i]..bounds[j]]) {
                    single |= j == i + 1;
                    if base + score > best[j].0 {
                        best[j] = (base + score, i, id);
                    }
                }
                j += 1;
            }
            if !single && base + self.unk_score > best[i + 1].0 {
                best[i + 1] = (base + self.unk_score, i, self.unk);
            }
        }
        let mut path = Vec::new();
        let mut j = n;
        while j > 0 {
            let (_, i, id) = best[j];
            path.push((i, j, id));
            j = i;
        }
        let mut ids = Vec::with_capacity(path.len());
        for &(i, j, id) in path.iter().rev() {
            if id == self.unk && self.bytes[0] != u32::MAX {
                ids.extend(s[bounds[i]..bounds[j]].bytes().map(|b| self.bytes[b as usize]));
            } else {
                ids.push(id);
            }
        }
        ids
    }

    pub fn decode(&self, ids: &[u32]) -> String {
        let mut raw = Vec::new();
        for &id in ids {
            let Some((piece, kind)) = self.pieces.get(id as usize) else { continue };
            match kind {
                Kind::Byte => {
                    if let Some(b) = piece
                        .strip_prefix("<0x")
                        .and_then(|s| s.strip_suffix('>'))
                        .and_then(|h| u8::from_str_radix(h, 16).ok())
                    {
                        raw.push(b);
                    }
                }
                Kind::Normal | Kind::User => raw.extend_from_slice(piece.as_bytes()),
                Kind::Unknown => raw.extend_from_slice(" \u{2047} ".as_bytes()),
                Kind::Control | Kind::Unused => {}
            }
        }
        let text = String::from_utf8_lossy(&raw).replace(SPACE, " ");
        text.trim().to_owned()
    }
}
