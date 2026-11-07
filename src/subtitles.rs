//! Subtitles: reading SRT / WebVTT / ASS, writing SRT, and the offline
//! English → Persian model files. Only the one-time model download uses the Internet.
use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

/// Mozilla's Firefox Translations en→fa model (MPL-2.0), pinned by checksum.
const MODEL_CDN: &str = "https://firefox-settings-attachments.cdn.mozilla.net/main-workspace/translations-models/";
pub const MODEL_FILES: [(&str, &str, &str, u64); 3] = [
    (crate::mt::MODEL_FILE, "8e412aee-68b4-46cd-aa00-1e7357db24c1.bin", "456ad3952bcc59d208c76baba4dcef340ee4239416bd760d6fec27f9a16228f8", 17_141_051),
    (crate::mt::VOCAB_FILE, "203a10f4-6885-49c2-89e3-e7a4f3e3e738.spm", "6435d3d9d766159fe192ab90892540b438ad7adb7ab4ea4049f68d0b4cdea3bd", 843_133),
    (crate::mt::LEX_FILE, "8ec72d9b-f5b6-40bd-a23d-cedb2c757e92.bin", "8542e7fb2bfa3a11b89f8392b8adb0dbbf863cd34569488b7c4535a91c3ae6b4", 3_631_332),
];

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Cue {
    pub start: u64,
    pub end: u64,
    pub text: String,
}

pub fn data_dir() -> PathBuf {
    crate::profile::local_data_dir().join("translation")
}

/// A bundled file: next to the executable, in the source tree, or downloaded.
pub fn asset(name: &str) -> PathBuf {
    let exe = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_owned));
    // Native macOS bundles keep data in Contents/Resources, separate from code.
    let bundle = if cfg!(target_os = "macos") {
        exe.as_ref().map(|dir| dir.join("../Resources"))
    } else {
        None
    };
    for root in exe
        .into_iter()
        .chain(bundle)
        .chain([PathBuf::from(env!("CARGO_MANIFEST_DIR")), data_dir()])
    {
        let p = root.join(name);
        if p.is_file() {
            return p;
        }
    }
    data_dir().join(name)
}

/// The folder with the translation model, if all its files are present.
pub fn model_dir() -> Option<PathBuf> {
    let dir = asset(&format!("models/enfa/{}", crate::mt::MODEL_FILE)).parent()?.to_owned();
    MODEL_FILES.iter().all(|f| dir.join(f.0).is_file()).then_some(dir)
}

pub fn model_bytes() -> u64 {
    MODEL_FILES.iter().map(|f| f.3).sum()
}

/// Fetch the model once (about 22 MB), verifying every file.
pub fn download_model(cancel: &AtomicBool, progress: &dyn Fn(f32, String)) -> Result<PathBuf> {
    let dir = data_dir().join("models").join("enfa");
    let total = model_bytes() as f32;
    let mut before = 0u64;
    for (name, id, sha, bytes) in MODEL_FILES {
        let base = before as f32;
        download(&format!("{MODEL_CDN}{id}"), &dir.join(name), sha, cancel, &|p, _| {
            progress((base + p * bytes as f32) / total, format!("Downloading the Persian model · {:.0} / {:.0} MB", (base + p * bytes as f32) / 1e6, total / 1e6))
        })?;
        before += bytes;
    }
    Ok(dir)
}

pub fn hidden(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}

pub fn check_cancel(cancel: &AtomicBool) -> Result<()> {
    ensure!(!cancel.load(Ordering::Relaxed), "Cancelled");
    Ok(())
}

fn timestamp(raw: &str) -> Result<u64> {
    let normalized = raw.trim().replace(',', ".");
    let parts: Vec<_> = normalized.split(':').collect();
    ensure!(
        parts.len() == 2 || parts.len() == 3,
        "Invalid subtitle time: {raw}"
    );
    let (h, m, s) = if parts.len() == 3 {
        (parts[0].parse::<u64>()?, parts[1], parts[2])
    } else {
        (0, parts[0], parts[1])
    };
    let m: u64 = m.parse()?;
    // "01,500", "01.5" and plain "01" all occur in the wild.
    let (sec, frac) = s.split_once('.').unwrap_or((s, "0"));
    ensure!(
        !frac.is_empty() && frac.len() <= 3 && frac.bytes().all(|c| c.is_ascii_digit()),
        "Invalid milliseconds: {raw}"
    );
    let ms: u64 = format!("{frac:0<3}").parse()?;
    let sec: u64 = sec.parse()?;
    ensure!(
        m < 60 && sec < 60 && h < 1000,
        "Invalid subtitle time: {raw}"
    );
    Ok(((h * 60 + m) * 60 + sec) * 1000 + ms)
}

fn plain_text(s: &str) -> String {
    let mut out = String::new();
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        // <i>, </font …> and {\an8} are markup; "I <3 you" is not.
        let closing = match c {
            '<' if chars.get(i + 1).is_some_and(|n| n.is_ascii_alphabetic() || *n == '/') => Some('>'),
            '{' => Some('}'),
            _ => None,
        };
        if let Some(end) = closing {
            if let Some(j) = chars[i + 1..].iter().position(|&x| x == end) {
                i += j + 2;
                continue;
            }
        }
        out.push(c);
        i += 1;
    }
    let out = out
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("\\N", "\n");
    out.lines().map(str::trim).filter(|l| !l.is_empty()).collect::<Vec<_>>().join("\n")
}

pub fn parse(bytes: &[u8]) -> Result<Vec<Cue>> {
    ensure!(
        bytes.len() <= 20 * 1024 * 1024,
        "Subtitle is larger than 20 MB"
    );
    let decoded = if bytes.starts_with(&[0xff, 0xfe]) {
        encoding_rs::UTF_16LE.decode(&bytes[2..]).0.into_owned()
    } else if bytes.starts_with(&[0xfe, 0xff]) {
        encoding_rs::UTF_16BE.decode(&bytes[2..]).0.into_owned()
    } else {
        String::from_utf8(bytes.to_vec())
            .unwrap_or_else(|_| encoding_rs::WINDOWS_1256.decode(bytes).0.into_owned())
    };
    let normalized = decoded
        .trim_start_matches('\u{feff}')
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    if normalized.lines().any(|l| l.trim().eq_ignore_ascii_case("[events]")) {
        let cues = parse_ass(&normalized);
        ensure!(!cues.is_empty(), "This ASS/SSA file has no dialogue text.");
        return Ok(cues);
    }
    // Line by line: real files have stray spaces on "blank" lines, missing
    // numbers and the odd broken timing, which costs that cue only.
    let mut cues = Vec::new();
    let mut current: Option<(u64, u64, Vec<&str>)> = None;
    let flush = |c: Option<(u64, u64, Vec<&str>)>, cues: &mut Vec<Cue>| {
        if let Some((start, end, lines)) = c {
            let text = plain_text(&lines.join("\n"));
            if end > start && !text.is_empty() {
                cues.push(Cue { start, end, text });
            }
        }
    };
    let mut skipping = false;
    for line in normalized.lines() {
        let trimmed = line.trim();
        if let Some((a, b)) = trimmed.split_once("-->") {
            flush(current.take(), &mut cues);
            skipping = false;
            let end = b.split_whitespace().next().unwrap_or("");
            current = match (timestamp(a), timestamp(end)) {
                (Ok(start), Ok(end)) => Some((start, end, Vec::new())),
                _ => None,
            };
            continue;
        }
        if trimmed.is_empty() {
            flush(current.take(), &mut cues);
            continue;
        }
        if current.is_none() && ["NOTE", "STYLE", "REGION"].iter().any(|k| trimmed.starts_with(k)) {
            skipping = true;
        }
        if let (Some((_, _, lines)), false) = (current.as_mut(), skipping) {
            lines.push(trimmed);
        }
    }
    flush(current.take(), &mut cues);
    ensure!(
        !cues.is_empty(),
        "No text subtitles found. Choose an SRT, WebVTT or ASS file. Image subtitles need OCR first."
    );
    ensure!(cues.len() <= 30000, "Too many subtitle cues");
    cues.sort_by_key(|c| c.start);
    Ok(cues)
}

/// "0:01:02.35" → milliseconds.
fn ass_time(raw: &str) -> Option<u64> {
    let mut it = raw.trim().split(':');
    let (h, m, s) = (it.next()?.parse::<u64>().ok()?, it.next()?.parse::<u64>().ok()?, it.next()?);
    let (sec, frac) = s.split_once('.').unwrap_or((s, "0"));
    let frac: String = frac.chars().chain("000".chars()).take(3).collect();
    Some(((h * 60 + m) * 60 + sec.parse::<u64>().ok()?) * 1000 + frac.parse::<u64>().ok()?)
}

/// Dialogue from an ASS/SSA script, without styling or vector drawings.
fn parse_ass(text: &str) -> Vec<Cue> {
    let mut fields: Vec<String> = Vec::new();
    let mut in_events = false;
    let mut cues = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_events = line.eq_ignore_ascii_case("[events]");
            continue;
        }
        if !in_events {
            continue;
        }
        if let Some(f) = line.strip_prefix("Format:") {
            fields = f.split(',').map(|s| s.trim().to_ascii_lowercase()).collect();
            continue;
        }
        let Some(body) = line.strip_prefix("Dialogue:") else { continue };
        if fields.is_empty() {
            fields = ["layer", "start", "end", "style", "name", "marginl", "marginr", "marginv", "effect", "text"]
                .map(String::from)
                .to_vec();
        }
        let parts: Vec<&str> = body.splitn(fields.len(), ',').collect();
        let get = |name: &str| fields.iter().position(|f| f == name).and_then(|i| parts.get(i)).copied();
        let (Some(start), Some(end), Some(raw)) = (get("start").and_then(ass_time), get("end").and_then(ass_time), get("text")) else {
            continue;
        };
        // {\p1} starts a vector drawing, not words.
        if end <= start || raw.contains("\\p1") || raw.contains("\\p2") || raw.contains("\\p4") {
            continue;
        }
        let text = plain_text(&raw.replace("\\n", "\\N").replace("\\h", " "));
        if !text.is_empty() {
            cues.push(Cue { start, end, text });
        }
    }
    cues.sort_by_key(|c| c.start);
    // Karaoke and typesetting often repeat one line in several layers.
    cues.dedup_by(|b, a| a.start == b.start && a.text == b.text);
    cues.truncate(30000);
    cues
}

fn time_string(ms: u64) -> String {
    format!(
        "{:02}:{:02}:{:02},{:03}",
        ms / 3600000,
        ms / 60000 % 60,
        ms / 1000 % 60,
        ms % 1000
    )
}
pub fn srt(cues: &[Cue], translated: &[String]) -> Result<String> {
    ensure!(
        cues.len() == translated.len(),
        "Translation cue count does not match"
    );
    let mut out = String::new();
    for (i, (cue, text)) in cues.iter().zip(translated).enumerate() {
        ensure!(
            !text.trim().is_empty(),
            "Empty translation at cue {}",
            i + 1
        );
        out.push_str(&format!(
            "{}\n{} --> {}\n{}\n\n",
            i + 1,
            time_string(cue.start),
            time_string(cue.end),
            text.trim()
        ));
    }
    Ok(out)
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let temp = path.with_extension("tmp");
    {
        let mut f = fs::File::create(&temp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    fs::rename(&temp, path).context("Could not save translation")
}

fn sha_file(path: &Path, cancel: &AtomicBool) -> Result<String> {
    let mut f = fs::File::open(path)?;
    let mut hash = Sha256::new();
    let mut buf = [0; 1024 * 1024];
    loop {
        check_cancel(cancel)?;
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hash.update(&buf[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

pub(crate) fn download(
    url: &str,
    dest: &Path,
    sha: &str,
    cancel: &AtomicBool,
    progress: &dyn Fn(f32, String),
) -> Result<()> {
    fs::create_dir_all(dest.parent().unwrap())?;
    if dest.exists() && sha_file(dest, cancel)? == sha {
        return Ok(());
    }
    let part = dest.with_extension("part");
    let offset = fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(7200))
        .build()?;
    let mut req = client.get(url);
    if offset > 0 {
        req = req.header("Range", format!("bytes={offset}-"));
    }
    let mut response = req.send()?.error_for_status()?;
    let append = response.status() == reqwest::StatusCode::PARTIAL_CONTENT && offset > 0;
    let mut done = if append { offset } else { 0 };
    let total = response.content_length().unwrap_or(0) + done;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(!append)
        .append(append)
        .open(&part)?;
    let mut buf = [0; 256 * 1024];
    let mut last = std::time::Instant::now() - Duration::from_secs(1);
    loop {
        check_cancel(cancel)?;
        let n = response.read(&mut buf)?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n])?;
        done += n as u64;
        if last.elapsed() > Duration::from_millis(250) {
            progress(
                if total > 0 {
                    done as f32 / total as f32
                } else {
                    0.0
                },
                format!(
                    "Downloading offline assets · {} / {} MB",
                    done / 1000000,
                    total / 1000000
                ),
            );
            last = std::time::Instant::now();
        }
    }
    drop(file);
    progress(1.0, "Verifying downloaded files…".into());
    if sha_file(&part, cancel)? != sha {
        fs::remove_file(&part)?;
        bail!("Download checksum mismatch. Please retry setup.");
    }
    fs::rename(part, dest)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn srt_preserves_times_and_multiline() {
        let c = parse(
            b"\xef\xbb\xbf1\r\n00:00:01,020 --> 00:00:04,900\r\n<i>Don't</i>\r\ngive up.\r\n\r\n",
        )
        .unwrap();
        assert_eq!(
            c[0],
            Cue {
                start: 1020,
                end: 4900,
                text: "Don't\ngive up.".into()
            }
        );
        let out = srt(&c, &["ناامید نشو.".into()]).unwrap();
        assert_eq!(parse(out.as_bytes()).unwrap()[0].end, 4900);
        assert!(out.contains("00:00:01,020 --> 00:00:04,900"));
    }
    #[test]
    fn webvtt_settings_and_notes() {
        let c = parse(b"WEBVTT\n\nNOTE ignore\nA note\n\ncue-id\n00:01.000 --> 00:02.500 align:start\n<v Ann>Hello &amp; goodbye</v>\n\n").unwrap();
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].text, "Hello & goodbye");
        assert_eq!(c[0].start, 1000);
    }
    #[test]
    fn reject_bad_timing_and_empty() {
        for s in [
            "",
            "1\n00:00:04,000 --> 00:00:01,000\nOops",
            "1\n00:70:00,000 --> 00:71:01,000\nOops",
        ] {
            assert!(parse(s.as_bytes()).is_err());
        }
        assert!(
            srt(
                &[Cue {
                    start: 0,
                    end: 1,
                    text: "hi".into()
                }],
                &[]
            )
            .is_err()
        );
    }
    #[test]
    fn tolerant_srt_and_markup() {
        let c = parse(b"1\n00:00:01,5 --> 00:00:02,000\nI <3 you\n \n2\n00:00:03,000 --> 00:00:03,000\nBroken\n\n00:00:04,000 --> 00:00:05,000\n{\\an8}<font color=\"red\">Top</font>\n").unwrap();
        assert_eq!(c.len(), 2);
        assert_eq!((c[0].start, c[0].text.as_str()), (1500, "I <3 you"));
        assert_eq!(c[1].text, "Top");
    }
    #[test]
    fn ass_dialogue_without_styling() {
        let script = "[Script Info]\nTitle: x\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.50,0:00:03.00,Default,,0,0,0,,{\\i1}Hello,\\Nworld{\\i0}\nDialogue: 0,0:00:02.00,0:00:04.00,Sign,,0,0,0,,{\\p1}m 0 0 l 10 10{\\p0}\n";
        let c = parse(script.as_bytes()).unwrap();
        assert_eq!(c, vec![Cue { start: 1500, end: 3000, text: "Hello,\nworld".into() }]);
    }
    #[test]
    fn utf16_persian() {
        let s = "1\n00:00:00,000 --> 00:00:01,000\nسلام";
        let b: Vec<u8> = [0xff, 0xfe]
            .into_iter()
            .chain(s.encode_utf16().flat_map(u16::to_le_bytes))
            .collect();
        assert_eq!(parse(&b).unwrap()[0].text, "سلام");
    }
}
