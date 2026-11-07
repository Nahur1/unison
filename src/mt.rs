//! Offline English → Persian machine translation.
//!
//! Runs Mozilla's Firefox Translations "tiny" Marian model (a 6-layer transformer
//! encoder with an SSRU decoder, ~17 MB) directly in Rust: no server, no extra
//! runtime. A subtitle line takes a few milliseconds on an ordinary CPU, so the
//! player can translate each line the moment it appears.
use crate::spm::Spm;
use anyhow::{Context, Result, bail, ensure};
use std::collections::HashMap;
use std::path::Path;

pub const MODEL_FILE: &str = "model.enfa.intgemm.alphas.bin";
pub const VOCAB_FILE: &str = "vocab.enfa.spm";
pub const LEX_FILE: &str = "lex.50.50.enfa.s2t.bin";

const EOS: u32 = 0;
const MAX_TOKENS: usize = 160;

/// y = x·W + b, with W stored as [in][out].
struct Linear {
    w: Vec<f32>,
    b: Vec<f32>,
    n_in: usize,
    n_out: usize,
}

struct Norm {
    scale: Vec<f32>,
    bias: Vec<f32>,
}

struct Attention {
    q: Linear,
    k: Linear,
    v: Linear,
    o: Linear,
    norm: Norm,
}

struct Ffn {
    w1: Linear,
    w2: Linear,
    norm: Norm,
}

struct EncoderLayer {
    attention: Attention,
    ffn: Ffn,
}

struct DecoderLayer {
    rnn_w: Linear,
    rnn_f: Linear,
    rnn_norm: Norm,
    context: Attention,
    ffn: Ffn,
}

struct Shortlist {
    first: usize,
    offsets: Vec<u64>,
    words: Vec<u32>,
}

pub struct Model {
    vocab: Spm,
    shortlist: Option<Shortlist>,
    /// Tied embeddings and output projection: [vocab][dim].
    emb: Vec<f32>,
    out_b: Vec<f32>,
    encoder: Vec<EncoderLayer>,
    decoder: Vec<DecoderLayer>,
    dim: usize,
    heads: usize,
    beam: usize,
}

struct Tensors<'a> {
    items: HashMap<String, (u64, Vec<usize>, &'a [u8])>,
}

impl<'a> Tensors<'a> {
    /// Marian's binary model format: headers, names, shapes, then 256-byte-aligned data.
    fn parse(b: &'a [u8]) -> Result<Self> {
        let mut o = 0usize;
        let u64_at = |o: &mut usize| -> Result<u64> {
            let v = b.get(*o..*o + 8).context("Truncated translation model")?;
            *o += 8;
            Ok(u64::from_le_bytes(v.try_into().unwrap()))
        };
        ensure!(u64_at(&mut o)? == 1, "Unsupported translation model version");
        let count = u64_at(&mut o)? as usize;
        ensure!(count > 0 && count < 10_000, "Invalid translation model");
        let mut headers = Vec::with_capacity(count);
        for _ in 0..count {
            let h = [u64_at(&mut o)?, u64_at(&mut o)?, u64_at(&mut o)?, u64_at(&mut o)?];
            headers.push(h);
        }
        let mut names = Vec::with_capacity(count);
        for h in &headers {
            let raw = b.get(o..o + h[0] as usize).context("Truncated translation model")?;
            o += h[0] as usize;
            names.push(String::from_utf8_lossy(raw).trim_end_matches('\0').to_owned());
        }
        let mut shapes = Vec::with_capacity(count);
        for h in &headers {
            let mut shape = Vec::new();
            for _ in 0..h[2] {
                let v = b.get(o..o + 4).context("Truncated translation model")?;
                o += 4;
                shape.push(i32::from_le_bytes(v.try_into().unwrap()).max(0) as usize);
            }
            shapes.push(shape);
        }
        let skip = u64_at(&mut o)? as usize;
        o += skip;
        let mut items = HashMap::new();
        for ((h, name), shape) in headers.iter().zip(names).zip(shapes) {
            let data = b.get(o..o + h[3] as usize).context("Truncated translation model")?;
            o += h[3] as usize;
            items.insert(name, (h[1], shape, data));
        }
        Ok(Tensors { items })
    }

    /// A tensor as float32, dequantising intgemm8. Matrices come back as [rows][cols].
    fn get(&self, name: &str) -> Result<(Vec<f32>, usize, usize)> {
        let (kind, shape, data) = self.items.get(name).with_context(|| format!("Translation model is missing {name}"))?;
        let cols = *shape.last().unwrap_or(&1);
        let rows = shape.iter().product::<usize>() / cols.max(1);
        let n = rows * cols;
        let values = match *kind {
            0x404 => {
                ensure!(data.len() >= n * 4, "Invalid tensor {name}");
                data[..n * 4].chunks_exact(4).map(|c| f32::from_le_bytes(c.try_into().unwrap())).collect()
            }
            0x4101 => {
                ensure!(data.len() >= n + 4, "Invalid tensor {name}");
                let mult = f32::from_le_bytes(data[n..n + 4].try_into().unwrap());
                ensure!(mult.is_finite() && mult > 0.0, "Invalid quantisation in {name}");
                let inv = 1.0 / mult;
                let q = |i: usize| data[i] as i8 as f32 * inv;
                if name == "Wemb" {
                    (0..n).map(q).collect()
                } else {
                    // Stored transposed ([cols][rows]) for intgemm; turn it back.
                    let mut out = vec![0.0; n];
                    for c in 0..cols {
                        for r in 0..rows {
                            out[r * cols + c] = q(c * rows + r);
                        }
                    }
                    out
                }
            }
            k => bail!("Unsupported tensor type {k:#x} for {name}"),
        };
        Ok((values, rows, cols))
    }

    fn linear(&self, w: &str, b: Option<&str>) -> Result<Linear> {
        let (w, n_in, n_out) = self.get(w)?;
        let b = match b {
            Some(b) => self.get(b)?.0,
            None => vec![0.0; n_out],
        };
        ensure!(b.len() == n_out, "Translation model bias size mismatch");
        Ok(Linear { w, b, n_in, n_out })
    }

    fn norm(&self, prefix: &str) -> Result<Norm> {
        Ok(Norm { scale: self.get(&format!("{prefix}_ln_scale"))?.0, bias: self.get(&format!("{prefix}_ln_bias"))?.0 })
    }

    fn attention(&self, p: &str) -> Result<Attention> {
        Ok(Attention {
            q: self.linear(&format!("{p}_Wq"), Some(&format!("{p}_bq")))?,
            k: self.linear(&format!("{p}_Wk"), Some(&format!("{p}_bk")))?,
            v: self.linear(&format!("{p}_Wv"), Some(&format!("{p}_bv")))?,
            o: self.linear(&format!("{p}_Wo"), Some(&format!("{p}_bo")))?,
            norm: self.norm(&format!("{p}_Wo"))?,
        })
    }

    fn ffn(&self, p: &str) -> Result<Ffn> {
        Ok(Ffn {
            w1: self.linear(&format!("{p}_W1"), Some(&format!("{p}_b1")))?,
            w2: self.linear(&format!("{p}_W2"), Some(&format!("{p}_b2")))?,
            norm: self.norm(&format!("{p}_ffn"))?,
        })
    }
}

fn parse_shortlist(b: &[u8], vocab: usize) -> Result<Shortlist> {
    let word = |i: usize| -> Result<u64> {
        Ok(u64::from_le_bytes(b.get(i * 8..i * 8 + 8).context("Truncated shortlist")?.try_into().unwrap()))
    };
    ensure!(word(0)? == 0xF11A48D5013417F5, "Invalid translation shortlist");
    let first = word(2)? as usize;
    let n_offsets = word(4)? as usize;
    let n_words = word(5)? as usize;
    let start = 48;
    ensure!(b.len() >= start + n_offsets * 8 + n_words * 4, "Truncated shortlist");
    let offsets: Vec<u64> =
        b[start..start + n_offsets * 8].chunks_exact(8).map(|c| u64::from_le_bytes(c.try_into().unwrap())).collect();
    let w0 = start + n_offsets * 8;
    let words: Vec<u32> =
        b[w0..w0 + n_words * 4].chunks_exact(4).map(|c| u32::from_le_bytes(c.try_into().unwrap())).collect();
    ensure!(
        offsets.windows(2).all(|w| w[0] <= w[1])
            && offsets.last().is_some_and(|&l| l as usize == words.len())
            && words.iter().all(|&w| (w as usize) < vocab),
        "Invalid translation shortlist"
    );
    Ok(Shortlist { first, offsets, words })
}

// ---------- maths ----------

#[inline(always)]
fn matmul_generic(x: &[f32], n: usize, l: &Linear, y: &mut [f32]) {
    let (k, m) = (l.n_in, l.n_out);
    for t0 in (0..n).step_by(4) {
        let tn = (n - t0).min(4);
        for t in 0..tn {
            y[(t0 + t) * m..(t0 + t + 1) * m].copy_from_slice(&l.b);
        }
        for i in 0..k {
            let w = &l.w[i * m..(i + 1) * m];
            for t in 0..tn {
                let a = x[(t0 + t) * k + i];
                if a == 0.0 {
                    continue;
                }
                let row = &mut y[(t0 + t) * m..(t0 + t + 1) * m];
                for (r, &wv) in row.iter_mut().zip(w) {
                    *r += a * wv;
                }
            }
        }
    }
}

#[inline(always)]
fn dot_generic(a: &[f32], b: &[f32]) -> f32 {
    let mut acc = [0.0f32; 16];
    let chunks = a.len() / 16;
    for c in 0..chunks {
        let (pa, pb) = (&a[c * 16..c * 16 + 16], &b[c * 16..c * 16 + 16]);
        for i in 0..16 {
            acc[i] += pa[i] * pb[i];
        }
    }
    let mut s: f32 = acc.iter().sum();
    for i in chunks * 16..a.len() {
        s += a[i] * b[i];
    }
    s
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2,fma")]
unsafe fn matmul_avx2(x: &[f32], n: usize, l: &Linear, y: &mut [f32]) {
    matmul_generic(x, n, l, y)
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2,fma")]
unsafe fn dot_avx2(a: &[f32], b: &[f32]) -> f32 {
    dot_generic(a, b)
}

fn has_avx2() -> bool {
    #[cfg(target_arch = "x86_64")]
    {
        static AVX2: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
        *AVX2.get_or_init(|| is_x86_feature_detected!("avx2") && is_x86_feature_detected!("fma"))
    }
    #[cfg(not(target_arch = "x86_64"))]
    false
}

fn matmul(x: &[f32], n: usize, l: &Linear) -> Vec<f32> {
    debug_assert_eq!(x.len(), n * l.n_in);
    let mut y = vec![0.0; n * l.n_out];
    #[cfg(target_arch = "x86_64")]
    if has_avx2() {
        unsafe { matmul_avx2(x, n, l, &mut y) };
        return y;
    }
    matmul_generic(x, n, l, &mut y);
    y
}

fn dot(a: &[f32], b: &[f32]) -> f32 {
    #[cfg(target_arch = "x86_64")]
    if has_avx2() {
        return unsafe { dot_avx2(a, b) };
    }
    dot_generic(a, b)
}

/// x = LayerNorm(x + r), row by row.
fn add_norm(x: &mut [f32], r: &[f32], norm: &Norm, dim: usize) {
    for (row, res) in x.chunks_exact_mut(dim).zip(r.chunks_exact(dim)) {
        for (a, b) in row.iter_mut().zip(res) {
            *a += b;
        }
        let mean = row.iter().sum::<f32>() / dim as f32;
        let var = row.iter().map(|v| (v - mean) * (v - mean)).sum::<f32>() / dim as f32;
        let inv = 1.0 / (var + 1e-6).sqrt();
        for ((v, s), b) in row.iter_mut().zip(&norm.scale).zip(&norm.bias) {
            *v = (*v - mean) * inv * s + b;
        }
    }
}

fn softmax(v: &mut [f32]) {
    let max = v.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let mut sum = 0.0;
    for x in v.iter_mut() {
        *x = (*x - max).exp();
        sum += *x;
    }
    for x in v.iter_mut() {
        *x /= sum;
    }
}

/// Multi-head attention of `nq` queries over `nk` keys/values (all already projected).
fn attend(q: &[f32], nq: usize, k: &[f32], v: &[f32], nk: usize, dim: usize, heads: usize) -> Vec<f32> {
    let dh = dim / heads;
    let scale = 1.0 / (dh as f32).sqrt();
    let mut out = vec![0.0; nq * dim];
    let mut scores = vec![0.0; nk];
    for t in 0..nq {
        for h in 0..heads {
            let qh = &q[t * dim + h * dh..t * dim + (h + 1) * dh];
            for (s, score) in scores.iter_mut().enumerate() {
                *score = dot(qh, &k[s * dim + h * dh..s * dim + (h + 1) * dh]) * scale;
            }
            softmax(&mut scores);
            let o = &mut out[t * dim + h * dh..t * dim + (h + 1) * dh];
            for (s, &p) in scores.iter().enumerate() {
                for (a, b) in o.iter_mut().zip(&v[s * dim + h * dh..s * dim + (h + 1) * dh]) {
                    *a += p * b;
                }
            }
        }
    }
    out
}

fn ffn(x: &mut Vec<f32>, n: usize, f: &Ffn, dim: usize) {
    let mut h = matmul(x, n, &f.w1);
    for v in h.iter_mut() {
        *v = v.max(0.0);
    }
    let out = matmul(&h, n, &f.w2);
    add_norm(x, &out, &f.norm, dim);
}

fn positions(start: usize, n: usize, dim: usize, out: &mut [f32]) {
    let half = dim / 2;
    let inc = (10000f32).ln() / (half as f32 - 1.0);
    for p in 0..n {
        let pos = (start + p) as f32;
        for i in 0..half {
            let v = pos * (i as f32 * -inc).exp();
            out[p * dim + i] += v.sin();
            out[p * dim + half + i] += v.cos();
        }
    }
}

struct Hyp {
    tokens: Vec<u32>,
    score: f32,
    /// SSRU cell state for each decoder layer.
    cells: Vec<Vec<f32>>,
}

impl Model {
    pub fn load(dir: &Path) -> Result<Self> {
        let read = |name: &str| std::fs::read(dir.join(name)).with_context(|| format!("Cannot read {name}"));
        let bytes = read(MODEL_FILE)?;
        let vocabulary = read(VOCAB_FILE)?;
        let shortlist = std::fs::read(dir.join(LEX_FILE)).ok();
        Self::from_bytes(&bytes, &vocabulary, shortlist.as_deref())
    }

    /// Shared in-memory loader for the mobile/WebAssembly worker. The model,
    /// tokenizer and inference algorithm are identical to the desktop player.
    pub fn from_bytes(bytes: &[u8], vocabulary: &[u8], shortlist: Option<&[u8]>) -> Result<Self> {
        let vocab = Spm::load(vocabulary)?;
        let t = Tensors::parse(bytes)?;
        let (emb, n_vocab, dim) = t.get("Wemb")?;
        ensure!(n_vocab == vocab.len(), "The vocabulary does not match the translation model");
        ensure!(dim % 8 == 0 && dim >= 64, "Unexpected translation model width");
        let out_b = t.get("decoder_ff_logit_out_b")?.0;
        ensure!(out_b.len() == n_vocab, "Unexpected translation output layer");
        let mut encoder = Vec::new();
        for l in 1.. {
            let p = format!("encoder_l{l}");
            if !t.items.contains_key(&format!("{p}_self_Wq")) {
                break;
            }
            encoder.push(EncoderLayer { attention: t.attention(&format!("{p}_self"))?, ffn: t.ffn(&format!("{p}_ffn"))? });
        }
        let mut decoder = Vec::new();
        for l in 1.. {
            let p = format!("decoder_l{l}");
            if !t.items.contains_key(&format!("{p}_rnn_W")) {
                break;
            }
            decoder.push(DecoderLayer {
                rnn_w: t.linear(&format!("{p}_rnn_W"), None)?,
                rnn_f: t.linear(&format!("{p}_rnn_Wf"), Some(&format!("{p}_rnn_bf")))?,
                rnn_norm: t.norm(&format!("{p}_rnn_ffn"))?,
                context: t.attention(&format!("{p}_context"))?,
                ffn: t.ffn(&format!("{p}_ffn"))?,
            });
        }
        ensure!(!encoder.is_empty() && !decoder.is_empty(), "This is not a supported Marian translation model");
        let shortlist = shortlist.map(|b| parse_shortlist(b, n_vocab)).transpose()?;
        Ok(Model { vocab, shortlist, emb, out_b, encoder, decoder, dim, heads: 8, beam: 4 })
    }

    fn embed(&self, ids: &[u32], start: usize) -> Vec<f32> {
        let d = self.dim;
        let scale = (d as f32).sqrt();
        let mut x = vec![0.0; ids.len() * d];
        for (t, &id) in ids.iter().enumerate() {
            for (o, e) in x[t * d..(t + 1) * d].iter_mut().zip(&self.emb[id as usize * d..(id as usize + 1) * d]) {
                *o = e * scale;
            }
        }
        positions(start, ids.len(), d, &mut x);
        x
    }

    fn encode(&self, src: &[u32]) -> Vec<f32> {
        let (n, d) = (src.len(), self.dim);
        let mut x = self.embed(src, 0);
        for layer in &self.encoder {
            let a = &layer.attention;
            let (q, k, v) = (matmul(&x, n, &a.q), matmul(&x, n, &a.k), matmul(&x, n, &a.v));
            let ctx = attend(&q, n, &k, &v, n, d, self.heads);
            let o = matmul(&ctx, n, &a.o);
            add_norm(&mut x, &o, &a.norm, d);
            ffn(&mut x, n, &layer.ffn, d);
        }
        x
    }

    /// Target words worth scoring for this sentence.
    fn candidates(&self, src: &[u32]) -> Vec<u32> {
        let n_vocab = self.out_b.len();
        let Some(sl) = &self.shortlist else { return (0..n_vocab as u32).collect() };
        let mut keep = vec![false; n_vocab];
        for k in keep.iter_mut().take(sl.first) {
            *k = true;
        }
        for &s in src {
            let s = s as usize;
            keep[s] = true; // names and numbers can be copied
            if s + 1 < sl.offsets.len() {
                for &w in &sl.words[sl.offsets[s] as usize..sl.offsets[s + 1] as usize] {
                    keep[w as usize] = true;
                }
            }
        }
        keep[EOS as usize] = true;
        keep.iter().enumerate().filter(|(_, k)| **k).map(|(i, _)| i as u32).collect()
    }

    /// Translate one sentence with beam search.
    fn translate_sentence(&self, text: &str) -> String {
        let mut src = self.vocab.encode(text);
        if src.is_empty() {
            return String::new();
        }
        src.truncate(MAX_TOKENS - 1);
        src.push(EOS);
        let (n, d) = (src.len(), self.dim);
        let enc = self.encode(&src);
        // Cross-attention keys and values are the same for every step.
        let memory: Vec<(Vec<f32>, Vec<f32>)> = self
            .decoder
            .iter()
            .map(|l| (matmul(&enc, n, &l.context.k), matmul(&enc, n, &l.context.v)))
            .collect();
        let words = self.candidates(&src);
        let max_len = (n * 2 + 8).min(MAX_TOKENS);
        let mut live = vec![Hyp { tokens: Vec::new(), score: 0.0, cells: vec![vec![0.0; d]; self.decoder.len()] }];
        let mut done: Vec<(f32, Vec<u32>)> = Vec::new();
        let mut logits = vec![0.0f32; words.len()];
        for step in 0..max_len {
            let b = live.len();
            let mut x = vec![0.0; b * d];
            for (i, h) in live.iter().enumerate() {
                if let Some(&w) = h.tokens.last() {
                    let scale = (d as f32).sqrt();
                    for (o, e) in x[i * d..(i + 1) * d].iter_mut().zip(&self.emb[w as usize * d..(w as usize + 1) * d]) {
                        *o = e * scale;
                    }
                }
                positions(step, 1, d, &mut x[i * d..(i + 1) * d]);
            }
            let mut cells: Vec<Vec<Vec<f32>>> = vec![Vec::with_capacity(self.decoder.len()); b];
            for (li, layer) in self.decoder.iter().enumerate() {
                // SSRU: c = f·c' + (1-f)·xW, out = relu(c)
                let xw = matmul(&x, b, &layer.rnn_w);
                let fx = matmul(&x, b, &layer.rnn_f);
                let mut out = vec![0.0; b * d];
                for (i, h) in live.iter().enumerate() {
                    let prev = &h.cells[li];
                    let mut c = vec![0.0; d];
                    for j in 0..d {
                        let f = 1.0 / (1.0 + (-fx[i * d + j]).exp());
                        c[j] = f * prev[j] + (1.0 - f) * xw[i * d + j];
                        out[i * d + j] = c[j].max(0.0);
                    }
                    cells[i].push(c);
                }
                add_norm(&mut x, &out, &layer.rnn_norm, d);
                let a = &layer.context;
                let q = matmul(&x, b, &a.q);
                let (k, v) = &memory[li];
                let ctx = attend(&q, b, k, v, n, d, self.heads);
                let o = matmul(&ctx, b, &a.o);
                add_norm(&mut x, &o, &a.norm, d);
                ffn(&mut x, b, &layer.ffn, d);
            }
            let mut next: Vec<(f32, usize, u32)> = Vec::new();
            for i in 0..b {
                let h = &x[i * d..(i + 1) * d];
                for (l, &w) in logits.iter_mut().zip(&words) {
                    *l = dot(h, &self.emb[w as usize * d..(w as usize + 1) * d]) + self.out_b[w as usize];
                }
                let max = logits.iter().copied().fold(f32::NEG_INFINITY, f32::max);
                let lse = max + logits.iter().map(|l| (l - max).exp()).sum::<f32>().ln();
                // Only the best few per hypothesis can survive the beam.
                let mut top: Vec<(f32, u32)> = logits.iter().zip(&words).map(|(&l, &w)| (l - lse, w)).collect();
                let keep = self.beam.min(top.len());
                top.select_nth_unstable_by(keep - 1, |a, b| b.0.total_cmp(&a.0));
                for &(lp, w) in &top[..keep] {
                    next.push((live[i].score + lp, i, w));
                }
            }
            next.sort_by(|a, b| b.0.total_cmp(&a.0));
            let width = self.beam - done.len().min(self.beam - 1);
            let mut new_live = Vec::new();
            for (score, i, w) in next {
                if new_live.len() >= width {
                    break;
                }
                let mut tokens = live[i].tokens.clone();
                if w == EOS || step + 1 == max_len {
                    if w != EOS {
                        tokens.push(w);
                    }
                    // Length-normalised, as Marian does with --normalize 1.
                    done.push((score / (tokens.len() + 1) as f32, tokens));
                    if done.len() >= self.beam {
                        break;
                    }
                    continue;
                }
                tokens.push(w);
                new_live.push(Hyp { tokens, score, cells: cells[i].clone() });
            }
            if done.len() >= self.beam || new_live.is_empty() {
                break;
            }
            live = new_live;
        }
        let best = done.into_iter().max_by(|a, b| a.0.total_cmp(&b.0)).map(|d| d.1).unwrap_or_default();
        self.vocab.decode(&best)
    }

    /// Translate a subtitle cue: dialogue turns and sentences are translated separately.
    pub fn translate(&self, text: &str) -> String {
        let mut lines: Vec<String> = Vec::new();
        for turn in split_turns(text) {
            let (dash, body) = match turn.strip_prefix(['-', '–', '—']) {
                Some(rest) => (true, rest.trim().to_owned()),
                None => (false, turn),
            };
            let body = plain_english(&sentence_case(&body));
            let mut out = Vec::new();
            for sentence in split_sentences(&body) {
                let fa = match plain_reply(&sentence) {
                    Some(reply) => reply.to_owned(),
                    None => self.translate_sentence(&sentence),
                };
                if !fa.is_empty() {
                    out.push(fa);
                }
            }
            let fa = persian_text(&out.join(" "));
            if !fa.is_empty() {
                lines.push(if dash { format!("- {fa}") } else { fa });
            }
        }
        lines.join("\n")
    }
}

/// Lines of one speaker are joined; a leading dash starts a new speaker.
fn split_turns(text: &str) -> Vec<String> {
    let mut turns: Vec<String> = Vec::new();
    for line in text.lines().map(str::trim).filter(|l| !l.is_empty()) {
        let new_turn = line.starts_with(['-', '–', '—']);
        match turns.last_mut() {
            Some(t) if !new_turn => {
                t.push(' ');
                t.push_str(line);
            }
            _ => turns.push(line.to_owned()),
        }
    }
    turns
}

fn split_sentences(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let chars: Vec<char> = text.chars().collect();
    for (i, &c) in chars.iter().enumerate() {
        cur.push(c);
        let end = matches!(c, '.' | '!' | '?' | '…');
        let next_space = chars.get(i + 1).is_some_and(|n| n.is_whitespace());
        let next_upper = chars.get(i + 2).is_some_and(|n| n.is_uppercase() || matches!(n, '"' | '“' | '\'' | '¿' | '¡'));
        // "Mr. Smith" and "e.g. this" stay together.
        let abbreviation = c == '.' && {
            let word: String = cur.trim_end_matches('.').chars().rev().take_while(|c| c.is_alphabetic()).collect();
            matches!(word.as_str(), "rM" | "srM" | "sM" | "rD" | "tS" | "rJ" | "rS" | "tL" | "tpaC" | "loC" | "neG" | "forP" | "sv")
                || word.chars().count() == 1
        };
        if end && next_space && next_upper && !abbreviation && cur.trim().chars().count() > 1 {
            out.push(cur.trim().to_owned());
            cur.clear();
        }
    }
    if !cur.trim().is_empty() {
        out.push(cur.trim().to_owned());
    }
    out
}

/// SHOUTED CAPTIONS translate poorly; give them ordinary sentence case.
fn sentence_case(text: &str) -> String {
    let letters: Vec<char> = text.chars().filter(|c| c.is_alphabetic()).collect();
    if letters.len() < 4 || letters.iter().any(|c| c.is_lowercase()) {
        return text.to_owned();
    }
    let mut out = String::with_capacity(text.len());
    let mut start = true;
    for c in text.chars() {
        if c.is_alphabetic() {
            if start {
                out.extend(c.to_uppercase());
            } else {
                out.extend(c.to_lowercase());
            }
            start = false;
        } else {
            if matches!(c, '.' | '!' | '?') {
                start = true;
            }
            out.push(c);
        }
    }
    // "i" on its own is still "I".
    out.split(' ').map(|w| if w == "i" { "I" } else { w }).collect::<Vec<_>>().join(" ")
}

/// Common idioms and spoken contractions, said plainly. The model is small and
/// literal-minded: "you're pulling my leg" would otherwise become a leg.
const PLAIN: &[(&str, &str)] = &[
    ("you're pulling my leg", "you're joking with me"),
    ("pulling my leg", "joking with me"),
    ("pull my leg", "joke with me"),
    ("pulling your leg", "joking with you"),
    ("got cold feet", "got scared"),
    ("getting cold feet", "getting scared"),
    ("get cold feet", "get scared"),
    ("i've got your back", "I will support you"),
    ("i got your back", "I will support you"),
    ("i have your back", "I will support you"),
    ("have your back", "support you"),
    ("break a leg", "good luck"),
    ("piece of cake", "very easy"),
    ("hit the sack", "go to sleep"),
    ("hit the hay", "go to sleep"),
    ("under the weather", "sick"),
    ("spill the beans", "reveal the secret"),
    ("let the cat out of the bag", "reveal the secret"),
    ("costs an arm and a leg", "costs a lot of money"),
    ("cost an arm and a leg", "cost a lot of money"),
    ("once in a blue moon", "very rarely"),
    ("beat around the bush", "avoid saying it directly"),
    ("beating around the bush", "avoiding saying it directly"),
    ("call it a day", "stop for today"),
    ("it's not rocket science", "it's not complicated"),
    ("on the same page", "in agreement"),
    ("the ball is in your court", "the decision is yours"),
    ("my bad", "my mistake"),
    ("hang in there", "don't give up"),
    ("don't leave me hanging", "don't leave me waiting"),
    ("i'm all ears", "I'm listening"),
    ("cut it out", "stop it"),
    ("knock it off", "stop it"),
    ("out of the blue", "unexpectedly"),
    ("in hot water", "in trouble"),
    ("kicked the bucket", "died"),
    ("kick the bucket", "die"),
    ("throw in the towel", "give up"),
    ("threw in the towel", "gave up"),
    ("sleep on it", "think about it until tomorrow"),
    ("bite the bullet", "accept the hard thing"),
    ("see eye to eye", "agree"),
    ("over the moon", "very happy"),
    ("speak of the devil", "we were just talking about you"),
    ("get your act together", "get yourself organised"),
    ("freaking out", "panicking"),
    ("freaked out", "panicked"),
    ("freak out", "panic"),
    ("hang on a second", "wait a second"),
    ("hold on a second", "wait a second"),
    ("for real", "really"),
    ("no big deal", "not important"),
    ("gonna", "going to"),
    ("wanna", "want to"),
    ("gotta", "have to"),
    ("kinda", "kind of"),
    ("sorta", "sort of"),
    ("dunno", "don't know"),
    ("lemme", "let me"),
    ("gimme", "give me"),
    ("y'all", "you all"),
    ("ya know", "you know"),
    ("'cause", "because"),
    ("cuz", "because"),
    ("ain't", "isn't"),
    ("outta", "out of"),
    ("lotta", "lot of"),
    ("c'mon", "come on"),
    ("nope", "no"),
    ("yep", "yes"),
    ("yeah", "yes"),
];

fn plain_english(text: &str) -> String {
    let mut s = text.replace(['’', '‘'], "'");
    for (from, to) in PLAIN {
        let mut start = 0;
        loop {
            let lower = s.to_ascii_lowercase();
            let Some(pos) = lower[start..].find(from).map(|p| p + start) else { break };
            let end = pos + from.len();
            let word = |c: Option<char>| c.is_some_and(|c| c.is_alphanumeric() || c == '\'');
            if word(s[..pos].chars().next_back()) || word(s[end..].chars().next()) {
                start = end;
                continue;
            }
            let mut to = to.to_string();
            if s[pos..].starts_with(|c: char| c.is_uppercase()) {
                to = to[..1].to_uppercase() + &to[1..];
            }
            s.replace_range(pos..end, &to);
            start = pos + to.len();
        }
    }
    s
}

/// Persian letters (not Arabic look-alikes), half-spaces and tidy spacing.
pub fn persian_text(s: &str) -> String {
    let s = s.replace('ي', "ی").replace('ك', "ک").replace(" ،", "،").replace(" ؟", "؟").replace(" .", ".");
    let persian = |w: &str| w.chars().next().is_some_and(|c| ('\u{0600}'..='\u{06ff}').contains(&c));
    let words: Vec<&str> = s.split_whitespace().collect();
    let mut out = String::with_capacity(s.len());
    for (i, w) in words.iter().enumerate() {
        if i > 0 {
            let prev = words[i - 1];
            // "می کنم" → "می‌کنم", "کتاب ها" → "کتاب‌ها"
            let joined = (matches!(prev, "می" | "نمی") && persian(w))
                || (persian(prev) && matches!(*w, "ها" | "های" | "هایی" | "هایم" | "هایت" | "هایش" | "هایمان" | "هایشان"));
            out.push(if joined { '\u{200c}' } else { ' ' });
        }
        out.push_str(&verb_prefix(w));
    }
    out
}

/// Spoken verbs written solid: "نمیدونم" → "نمی‌دونم", "میتونیم" → "می‌تونیم".
/// Only common verb stems, so words like "میز" or "میان" stay untouched.
fn verb_prefix(w: &str) -> String {
    const STEMS: [&str; 24] = [
        "تون", "خوا", "دون", "رس", "کن", "شه", "شن", "شم", "شی", "گم", "گی", "گه", "گن", "رم", "ری", "ره", "ریم", "بین",
        "زن", "گیر", "ذار", "فهم", "پرس", "خور",
    ];
    for prefix in ["نمی", "می"] {
        if let Some(rest) = w.strip_prefix(prefix) {
            if rest.chars().count() >= 2 && STEMS.iter().any(|s| rest.starts_with(s)) {
                return format!("{prefix}\u{200c}{rest}");
            }
        }
    }
    w.to_owned()
}

/// Short replies that the model would take literally ("Deal." → a business deal).
fn plain_reply(sentence: &str) -> Option<&'static str> {
    let key: String = sentence.trim().trim_end_matches(['.', '!', '?']).to_ascii_lowercase();
    Some(match key.as_str() {
        "deal" | "it's a deal" => "قبوله.",
        "got it" | "gotcha" => "فهمیدم.",
        "no worries" | "no problem" => "مشکلی نیست.",
        "you bet" | "sure thing" => "حتماً.",
        "cheers" => "ممنون.",
        "my bad" => "تقصیر من بود.",
        "come on" => "بی‌خیال!",
        "shut up" => "ساکت شو!",
        "oh my god" | "oh my gosh" | "omg" => "خدای من!",
        "never mind" => "بی‌خیال.",
        "excuse me" => "ببخشید.",
        "what's up" => "چه خبر؟",
        "okay" | "ok" => "باشه.",
        "fine" => "باشه.",
        "really" => "واقعاً؟",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn splits_dialogue_and_sentences() {
        assert_eq!(split_turns("- Hi.\n- Hello there,\nfriend."), vec!["- Hi.", "- Hello there, friend."]);
        assert_eq!(split_sentences("Wait. Mr. Smith is here! Go."), vec!["Wait.", "Mr. Smith is here!", "Go."]);
        assert_eq!(sentence_case("I SAID GET OUT. NOW!"), "I said get out. Now!");
        assert_eq!(sentence_case("FBI"), "FBI");
        assert_eq!(plain_english("You’re pulling my leg, I'm gonna go."), "You're joking with me, I'm going to go.");
        assert_eq!(plain_english("Yeah. Mygonna stays."), "Yes. Mygonna stays.");
        assert_eq!(persian_text("نمیدونم میتونیم میز"), "نمی\u{200c}دونم می\u{200c}تونیم میز");
        assert_eq!(plain_reply("Deal."), Some("قبوله."));
        assert_eq!(persian_text("من نمی دانم کتاب ها كجا هستند ."), "من نمی\u{200c}دانم کتاب\u{200c}ها کجا هستند.");
    }

    #[test]
    #[ignore = "Needs the downloaded translation model in models/enfa"]
    fn real_model_translates() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("models/enfa");
        let t = std::time::Instant::now();
        let m = Model::load(&dir).unwrap();
        eprintln!("load {:?}", t.elapsed());
        for s in [
            "Hello, how are you?",
            "You're pulling my leg.",
            "I got cold feet at the last minute.",
            "Don't worry, I've got your back.",
            "- Where were you last night?\n- I was at home, watching TV.",
            "WE NEED TO LEAVE RIGHT NOW!",
            "The meeting has been moved to Thursday afternoon.",
        ] {
            let t = std::time::Instant::now();
            let fa = m.translate(s);
            eprintln!("{s:?} → {fa} ({:?})", t.elapsed());
            assert!(fa.chars().any(|c| ('\u{0600}'..='\u{06ff}').contains(&c)));
        }
    }
}
