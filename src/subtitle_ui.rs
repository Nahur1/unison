//! Live Persian subtitles: the line mpv is showing is translated on the spot
//! (upcoming lines are prepared ahead) and drawn together with the original,
//! in sync, through mpv's own subtitle renderer (libass shapes Persian properly).
use crate::subtitles::{self, Cue};
use crate::translator::{Reply, Translator};
use crate::Player;
use slint::{ComponentHandle, Timer, TimerMode};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

/// What the viewer sees.
pub const MODE_ORIGINAL: i32 = 0;
pub const MODE_DUAL: i32 = 1;
pub const MODE_PERSIAN: i32 = 2;

fn with(f: impl FnOnce(&mut Player)) {
    crate::with(f);
}

const OVERLAY: &str = "47";
const BITMAP_CODECS: [&str; 4] = ["hdmv_pgs_subtitle", "dvd_subtitle", "dvb_subtitle", "xsub"];

/// A sentence that may run over a few cues: (first cue, last cue, text).
struct Group {
    first: usize,
    last: usize,
    text: String,
}

#[derive(Default)]
pub struct LiveSubs {
    translator: Option<Translator>,
    model_ready: bool,
    pub mode: i32,
    persian_top: bool,
    size: i32,
    cache: HashMap<String, String>,
    /// The original line on screen, and the text translated for it.
    line: String,
    key: String,
    cues: Vec<Cue>,
    groups: Vec<Group>,
    group_of: Vec<usize>,
    by_text: HashMap<String, Vec<usize>>,
    last_group: Option<usize>,
    /// Which (video, track) the cues belong to.
    cues_for: Option<(PathBuf, String)>,
    cue_gen: u64,
    sid: String,
    /// Why this track is shown as it is instead of translated.
    blocked: Option<String>,
    overlay_shown: bool,
    wait: Option<Timer>,
    /// When the current line arrived from mpv (for UNISON_SUBS_LOG).
    line_at: Option<std::time::Instant>,
    last_sync: Option<std::time::Instant>,
    job: Option<Arc<AtomicBool>>,
    job_gen: u64,
}

impl Drop for LiveSubs {
    fn drop(&mut self) {
        if let Some(c) = &self.job {
            c.store(true, Ordering::Relaxed);
        }
    }
}

struct Track {
    id: String,
    lang: String,
    codec: String,
    external: String,
    ff_index: String,
    title: String,
}

fn squash(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

fn mostly_persian(s: &str) -> bool {
    let fa = s.chars().filter(|c| ('\u{0600}'..='\u{06ff}').contains(c)).count();
    let latin = s.chars().filter(|c| c.is_ascii_alphabetic()).count();
    fa > 0 && fa >= latin
}

/// Does `b` carry on the sentence `a` left open?
fn continues(a: &Cue, b: &Cue) -> bool {
    let (at, bt) = (a.text.trim(), b.text.trim());
    if b.start < a.start || b.start.saturating_sub(a.end) > 1200 || at.starts_with('-') || bt.starts_with(['-', '–', '[', '(', '♪']) {
        return false;
    }
    let first_letter = bt.chars().find(|c| c.is_alphabetic());
    if at.ends_with("...") || at.ends_with('…') {
        return bt.starts_with("...") || bt.starts_with('…');
    }
    if at.ends_with(',') {
        return true;
    }
    let open = at.chars().last().is_some_and(|c| c.is_alphanumeric());
    open && first_letter.is_some_and(|c| c.is_lowercase())
}

fn sentence_groups(cues: &[Cue]) -> (Vec<Group>, Vec<usize>) {
    let mut groups = Vec::new();
    let mut group_of = vec![0; cues.len()];
    let mut i = 0;
    while i < cues.len() {
        let mut j = i;
        let mut text = cues[i].text.clone();
        while j + 1 < cues.len() && j - i < 2 && text.len() < 220 && continues(&cues[j], &cues[j + 1]) {
            j += 1;
            text.push('\n');
            text.push_str(&cues[j].text);
        }
        for g in &mut group_of[i..=j] {
            *g = groups.len();
        }
        groups.push(Group { first: i, last: j, text });
        i = j + 1;
    }
    (groups, group_of)
}

/// Balanced line breaks, so a long line becomes two even ones.
fn wrap(text: &str, max: usize) -> Vec<String> {
    let mut out = Vec::new();
    for line in text.lines().map(str::trim).filter(|l| !l.is_empty()) {
        let len = line.chars().count();
        if len <= max {
            out.push(line.to_owned());
            continue;
        }
        let parts = len.div_ceil(max);
        let target = len.div_ceil(parts);
        let mut cur = String::new();
        for word in line.split(' ') {
            let cur_len = cur.chars().count();
            let next = cur_len + 1 + word.chars().count();
            // Break where the line ends closest to the even length.
            if cur_len > 0 && (next > max + max / 6 || (next > target && next - target > target.saturating_sub(cur_len))) {
                out.push(std::mem::take(&mut cur));
            }
            if !cur.is_empty() {
                cur.push(' ');
            }
            cur.push_str(word);
        }
        if !cur.is_empty() {
            out.push(cur);
        }
    }
    out
}

/// Subtitle text is shown as text, never as ASS markup.
fn ass_escape(s: &str) -> String {
    s.replace('\\', "\u{29f5}").replace('{', "(").replace('}', ")")
}

fn ffmpeg() -> Option<PathBuf> {
    let bundled = subtitles::asset(if cfg!(windows) { "runtime/ffmpeg.exe" } else { "runtime/ffmpeg" });
    if bundled.is_file() {
        return Some(bundled);
    }
    let name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    std::env::var_os("PATH")
        .and_then(|paths| std::env::split_paths(&paths).map(|d| d.join(name)).find(|p| p.is_file()))
}

impl Player {
    // ---------- setup and settings ----------

    pub fn init_live_subs(&mut self) {
        let s = &mut self.subs;
        s.mode = self.store.setting("subs_mode").and_then(|v| v.parse().ok()).unwrap_or(MODE_DUAL).clamp(0, 2);
        s.persian_top = self.store.setting("subs_persian_top").as_deref() == Some("1");
        s.size = self.store.setting("subs_size").and_then(|v| v.parse().ok()).unwrap_or(1).clamp(0, 2);
        s.model_ready = subtitles::model_dir().is_some();
        let ui = self.ui();
        ui.set_subs_mode(self.subs.mode);
        ui.set_subs_persian_top(self.subs.persian_top);
        ui.set_subs_size(self.subs.size);
        ui.set_subs_model_ready(self.subs.model_ready);
        ui.set_subs_download_size(format!("{:.0} MB", subtitles::model_bytes() as f64 / 1e6).into());
        self.subs_status();
    }

    fn subs_active(&self) -> bool {
        self.is_video && self.subs.mode != MODE_ORIGINAL && self.subs.model_ready && self.subs.blocked.is_none()
    }

    pub fn set_subs_mode(&mut self, mode: i32) {
        self.subs.mode = mode.clamp(0, 2);
        self.store.set_setting("subs_mode", &self.subs.mode.to_string());
        self.ui().set_subs_mode(self.subs.mode);
        if self.subs.mode != MODE_ORIGINAL && self.is_video && self.subs.sid == "no" {
            self.pick_source_track();
        }
        self.apply_subs();
    }

    /// The T key: original → English + Persian → Persian only.
    pub fn cycle_subs_mode(&mut self) {
        self.set_subs_mode((self.subs.mode + 1) % 3);
        self.show_note(
            match self.subs.mode {
                MODE_DUAL => "Subtitles: English + فارسی",
                MODE_PERSIAN => "Subtitles: فارسی",
                _ => "Subtitles: original",
            }
            .into(),
        );
    }

    pub fn set_subs_order(&mut self, persian_top: bool) {
        self.subs.persian_top = persian_top;
        self.store.set_setting("subs_persian_top", if persian_top { "1" } else { "0" });
        self.ui().set_subs_persian_top(persian_top);
        self.render_subs();
    }

    pub fn set_subs_size(&mut self, size: i32) {
        self.subs.size = size.clamp(0, 2);
        self.store.set_setting("subs_size", &self.subs.size.to_string());
        self.ui().set_subs_size(self.subs.size);
        self.render_subs();
    }

    fn subs_status(&self) {
        let s = &self.subs;
        let ui = self.ui();
        let status = if !s.model_ready {
            "The Persian model is not on this computer yet.".to_string()
        } else if let Some(why) = &s.blocked {
            why.clone()
        } else if s.mode == MODE_ORIGINAL {
            "Original subtitles only. Pick a mode to see Persian live.".into()
        } else if !self.is_video {
            "Open a film: its English subtitles are translated as they play.".into()
        } else if s.sid == "no" || s.sid.is_empty() {
            "No subtitle track. Open an English SRT, VTT or ASS file.".into()
        } else if s.translator.is_none() {
            "Starting the translator…".into()
        } else if !s.cues.is_empty() {
            format!("Live · {} lines, prepared ahead · offline", s.cues.len())
        } else {
            "Live · each line is translated as it appears · offline".into()
        };
        ui.set_subs_status(status.into());
        ui.set_subs_can_export(!s.cues.is_empty() && s.model_ready && s.blocked.is_none());
        let track = self.selected_sub_track();
        ui.set_subs_source(
            match &track {
                Some(t) if !t.external.is_empty() => {
                    Path::new(&t.external).file_name().unwrap_or_default().to_string_lossy().into_owned()
                }
                Some(t) => {
                    let name = crate::language_name(&t.lang);
                    let name = if name.is_empty() { format!("Track {}", t.id) } else { name };
                    if t.title.is_empty() { name } else { format!("{name} · {}", t.title) }
                }
                None => "No subtitle track".into(),
            }
            .into(),
        );
    }

    fn ensure_translator(&mut self) {
        if self.subs.translator.is_some() || !self.subs.model_ready {
            return;
        }
        let Some(dir) = subtitles::model_dir() else {
            self.subs.model_ready = false;
            self.ui().set_subs_model_ready(false);
            return;
        };
        self.subs.translator = Some(Translator::start(dir, |reply| {
            let _ = slint::invoke_from_event_loop(move || {
                with(|p| p.on_translation(reply));
            });
        }));
    }

    fn on_translation(&mut self, reply: Reply) {
        match reply {
            Reply::Ready => self.subs_status(),
            Reply::Failed(e) => {
                self.subs.translator = None;
                self.subs.model_ready = false;
                self.ui().set_subs_model_ready(false);
                self.ui().set_subs_status(e.into());
            }
            Reply::Done(src, fa) => {
                let current = src == self.subs.key;
                self.subs.cache.insert(src, fa);
                if current {
                    self.subs.wait = None;
                    self.render_subs();
                }
            }
        }
    }

    // ---------- tracks ----------

    fn selected_sub_track(&self) -> Option<Track> {
        let count: usize = self.mpv.get_string("track-list/count").and_then(|v| v.parse().ok()).unwrap_or(0);
        (0..count).find_map(|i| {
            let get = |f: &str| self.mpv.get_string(&format!("track-list/{i}/{f}")).unwrap_or_default();
            (get("type") == "sub" && get("selected") == "yes").then(|| Track {
                id: get("id"),
                lang: get("lang").to_ascii_lowercase(),
                codec: get("codec"),
                external: get("external-filename"),
                ff_index: get("ff-index"),
                title: get("title"),
            })
        })
    }

    /// With Persian on and no subtitles chosen, choose an English text track.
    fn pick_source_track(&mut self) {
        let count: usize = self.mpv.get_string("track-list/count").and_then(|v| v.parse().ok()).unwrap_or(0);
        let mut best: Option<(i32, String)> = None;
        for i in 0..count {
            let get = |f: &str| self.mpv.get_string(&format!("track-list/{i}/{f}")).unwrap_or_default();
            if get("type") != "sub" || BITMAP_CODECS.contains(&get("codec").as_str()) {
                continue;
            }
            let lang = get("lang").to_ascii_lowercase();
            let title = get("title").to_ascii_lowercase();
            let mut score = if lang.starts_with("en") || title.contains("english") {
                3
            } else if lang.is_empty() || lang == "und" {
                1
            } else {
                continue;
            };
            // Full dialogue beats "forced" signs-only tracks; SDH is fine.
            if title.contains("forced") || get("forced") == "yes" {
                score -= 2;
            }
            if best.as_ref().is_none_or(|b| score > b.0) {
                best = Some((score, get("id")));
            }
        }
        if let Some((_, id)) = best {
            self.mpv.set_string("sid", &id);
        }
    }

    pub fn subs_file_loaded(&mut self) {
        self.subs.line.clear();
        self.subs.key.clear();
        self.subs.wait = None;
        self.remove_overlay();
        self.subs.cues_for = None;
        if self.subs.mode != MODE_ORIGINAL && self.is_video {
            let sid = self.mpv.get_string("sid").unwrap_or_default();
            let persian = self.selected_sub_track().is_some_and(|t| ["fa", "fas", "per"].contains(&t.lang.as_str()));
            if sid == "no" || sid.is_empty() || persian {
                self.pick_source_track();
            }
        }
        self.on_sub_track(self.mpv.get_string("sid").unwrap_or_else(|| "no".into()));
    }

    pub fn on_sub_track(&mut self, sid: String) {
        if self.subs.sid != sid {
            self.subs.line.clear();
            self.subs.key.clear();
            self.subs.wait = None;
            self.remove_overlay();
        }
        self.subs.sid = sid;
        self.subs.blocked = None;
        let track = if self.is_video { self.selected_sub_track() } else { None };
        if let Some(t) = &track {
            let lang = t.lang.as_str();
            if BITMAP_CODECS.contains(&t.codec.as_str()) {
                self.subs.blocked = Some("This track is made of images (PGS/DVD), so it can't be read. Choose a text track or open an SRT file.".into());
            } else if ["fa", "fas", "per"].contains(&lang) {
                self.subs.blocked = Some("This subtitle track is already Persian.".into());
            } else if !(lang.is_empty() || lang == "und" || lang.starts_with("en")) {
                let name = crate::language_name(lang);
                self.subs.blocked = Some(format!("This track is {name}. Live translation reads English subtitles; choose an English track."));
            }
        }
        if let (Some(t), Some(video)) = (&track, self.current_path.clone()) {
            let wanted = (video.clone(), t.id.clone());
            if self.subs.cues_for.as_ref() != Some(&wanted) {
                self.subs.cues_for = Some(wanted);
                self.set_cues(Vec::new());
                if self.subs.blocked.is_none() {
                    self.load_cues(video, t);
                }
            }
        } else {
            self.subs.cues_for = None;
            self.set_cues(Vec::new());
        }
        self.apply_subs();
    }

    /// Read the whole track, so lines can be translated before they're shown.
    fn load_cues(&mut self, video: PathBuf, t: &Track) {
        self.subs.cue_gen += 1;
        let generation = self.subs.cue_gen;
        let external = (!t.external.is_empty()).then(|| PathBuf::from(&t.external)).filter(|p| p.is_file());
        let index = t.ff_index.clone();
        if external.is_none() && (index.is_empty() || crate::library::is_link(&video)) {
            return; // live line by line only
        }
        std::thread::spawn(move || {
            let result = match external {
                Some(file) => std::fs::read(&file).map_err(anyhow::Error::from).and_then(|b| subtitles::parse(&b)),
                None => extract_track(&video, &index).and_then(|f| subtitles::parse(&std::fs::read(f)?)),
            };
            let _ = slint::invoke_from_event_loop(move || {
                with(|p| {
                    if p.subs.cue_gen == generation {
                        if let Ok(cues) = result {
                            p.set_cues(cues);
                        }
                        p.subs_status();
                    }
                })
            });
        });
    }

    fn set_cues(&mut self, cues: Vec<Cue>) {
        // Also invalidate extraction work when the track is turned off or reset.
        self.subs.cue_gen += 1;
        let (groups, group_of) = sentence_groups(&cues);
        let mut by_text: HashMap<String, Vec<usize>> = HashMap::new();
        for (i, c) in cues.iter().enumerate() {
            by_text.entry(squash(&c.text)).or_default().push(i);
        }
        let s = &mut self.subs;
        s.cues = cues;
        s.groups = groups;
        s.group_of = group_of;
        s.by_text = by_text;
        s.last_group = None;
        if let Some(t) = &s.translator {
            t.forget();
        }
        if !self.subs.cues.is_empty() && self.subs_active() {
            // Start with what's about to play.
            let now = (self.position * 1000.0) as u64;
            let first = self.subs.cues.partition_point(|c| c.end < now);
            if let Some(&g) = self.subs.group_of.get(first) {
                self.prepare_from(g);
            }
            // The line already on screen may belong to a longer sentence.
            let line = self.subs.line.clone();
            self.on_sub_text(line);
        }
    }

    fn prepare_from(&mut self, g: usize) {
        let s = &self.subs;
        let Some(t) = &s.translator else { return };
        let todo: Vec<String> = s.groups[g.min(s.groups.len())..]
            .iter()
            .take(24)
            .map(|g| g.text.clone())
            .filter(|t| !s.cache.contains_key(t))
            .collect();
        t.ahead(todo);
    }

    // ---------- the line on screen ----------

    fn current_sub_line(&self, text: String) -> String {
        if !text.trim().is_empty() || !self.subs_active() || self.subs.sid == "no" || self.subs.sid.is_empty() {
            return text;
        }
        // Property-change events can briefly report an empty line at a cue
        // boundary, or arrive after the next line has already started.
        if let Some(current) = self.mpv.get_string("sub-text").filter(|t| !t.trim().is_empty()) {
            return current;
        }
        let position = self.mpv.get_double("time-pos").unwrap_or(self.position);
        let delay = self.mpv.get_double("sub-delay").unwrap_or(0.0);
        let speed = self.mpv.get_double("sub-speed").unwrap_or(1.0);
        subtitle_time_ms(position, delay, speed)
            .and_then(|now| self.subs.timed_line(now))
            .unwrap_or_default()
            .to_owned()
    }

    /// Recover from missed/coalesced property notifications without redrawing
    /// every video frame. Cue timing still clears real gaps and seeks.
    pub fn sync_live_subs(&mut self) {
        if !self.subs_active() || !self.loaded {
            return;
        }
        let now = std::time::Instant::now();
        if self.subs.last_sync.is_some_and(|last| now.duration_since(last) < Duration::from_millis(100)) {
            return;
        }
        self.subs.last_sync = Some(now);
        let line = self.current_sub_line(self.mpv.get_string("sub-text").unwrap_or_default());
        if line.trim() != self.subs.line {
            self.on_sub_text(line);
        }
    }

    pub fn on_sub_text(&mut self, text: String) {
        let text = self.current_sub_line(text);
        self.subs.line = text.trim().to_owned();
        self.subs.line_at = Some(std::time::Instant::now());
        if !self.subs_active() {
            self.subs.key.clear();
            self.remove_overlay();
            return;
        }
        self.ensure_translator();
        let line = self.subs.line.clone();
        if line.is_empty() {
            self.subs.key.clear();
            self.subs.wait = None;
            self.render_subs();
            return;
        }
        // Find the cue, and with it the whole sentence.
        let mut key = line.clone();
        if let Some(found) = self.subs.by_text.get(&squash(&line)) {
            let at = self.mpv.get_double("sub-start").or_else(|| self.mpv.get_double("time-pos")).unwrap_or(self.position) * 1000.0;
            if let Some(&i) = found.iter().min_by_key(|&&i| (self.subs.cues[i].start as f64 - at).abs() as u64) {
                let g = self.subs.group_of[i];
                key = self.subs.groups[g].text.clone();
                let jumped = self.subs.last_group.is_none_or(|last| g < last || g > last + 2);
                if jumped {
                    if let Some(t) = &self.subs.translator {
                        t.forget();
                    }
                }
                if jumped || self.subs.last_group != Some(g) {
                    self.prepare_from(g + 1);
                }
                self.subs.last_group = Some(g);
            }
        }
        if mostly_persian(&line) {
            self.subs.cache.insert(key.clone(), line.clone());
        }
        self.subs.key = key.clone();
        if self.subs.cache.contains_key(&key) {
            self.subs.wait = None;
            self.render_subs();
            return;
        }
        if let Some(t) = &self.subs.translator {
            t.now(key);
        }
        // Keep the source readable while translation is pending. In particular,
        // moving the mouse must not clear both lines during this short wait.
        let timer = Timer::default();
        timer.start(TimerMode::SingleShot, Duration::from_millis(220), || {
            with(|p| {
                p.subs.wait = None;
                p.render_subs();
            });
        });
        self.subs.wait = Some(timer);
        self.render_subs();
    }

    /// mpv draws its own subtitles unless we're showing the pair.
    pub fn apply_subs(&mut self) {
        let active = self.subs_active();
        self.mpv.set_flag("sub-visibility", !active);
        if active {
            self.ensure_translator();
            let line = self.subs.line.clone();
            self.on_sub_text(line);
        } else {
            self.remove_overlay();
        }
        self.subs_status();
    }

    fn remove_overlay(&mut self) {
        if self.subs.overlay_shown {
            let _ = self.mpv.command(&["osd-overlay", OVERLAY, "none", ""]);
            self.subs.overlay_shown = false;
        }
    }

    /// Draw the original and Persian lines together.
    pub fn render_subs(&mut self) {
        if !self.subs_active() {
            self.remove_overlay();
            return;
        }
        let s = &self.subs;
        let english = if s.mostly_english() { s.line.clone() } else { String::new() };
        let persian = s.cache.get(&s.key).cloned().unwrap_or_default();
        let (en, fa) = display_lines(s.mode, &english, &persian, s.wait.is_some());
        if en.is_empty() && fa.is_empty() {
            self.remove_overlay();
            return;
        }
        // Lay out in a 720-line space with the window's shape, like mpv's own subtitles.
        let ui = self.ui();
        let window = ui.window();
        let (w, h) = if ui.get_video_browse() && !self.mini {
            (960.0, 540.0)
        } else {
            let size = window.size();
            (size.width.max(1) as f32, size.height.max(1) as f32)
        };
        let res_y = 720.0f32;
        let res_x = (res_y * w / h).round().max(320.0);
        let logical_h = h / window.scale_factor().max(0.5);
        let lift = !self.mini && !ui.get_video_browse() && (ui.get_controls_visible() || !self.playing);
        let y = if lift {
            ((logical_h - 136.0).max(logical_h * 0.6) / logical_h) * res_y
        } else if self.mini && (ui.get_controls_visible() || !self.playing) {
            // Leave room for PiP's mute/volume strip as well as subtitles.
            ((logical_h - 46.0).max(logical_h * 0.55) / logical_h) * res_y
        } else if self.mini {
            res_y - 14.0
        } else {
            res_y - 30.0
        };
        let event = overlay_event(&en, &fa, self.subs.persian_top, self.subs.size, res_x, y);
        let res_x = format!("{res_x:.0}");
        if self.mpv.command(&["osd-overlay", OVERLAY, "ass-events", &event, &res_x, "720", "0"]).is_ok() {
            self.subs.overlay_shown = true;
            if std::env::var_os("UNISON_SUBS_LOG").is_some() {
                let ms = self.subs.line_at.map_or(0.0, |t| t.elapsed().as_secs_f64() * 1000.0);
                eprintln!("subs +{ms:.1} ms · {:?} → {:?}", self.subs.line, self.subs.cache.get(&self.subs.key));
            }
        }
    }

    // ---------- model download ----------

    fn begin_job(&mut self) -> (u64, Arc<AtomicBool>) {
        self.subs.job_gen += 1;
        let cancel = Arc::new(AtomicBool::new(false));
        self.subs.job = Some(cancel.clone());
        let ui = self.ui();
        ui.set_subs_busy(true);
        ui.set_subs_progress(0.0);
        (self.subs.job_gen, cancel)
    }

    fn end_job(&mut self, generation: u64) -> bool {
        if self.subs.job_gen != generation {
            return false;
        }
        self.subs.job = None;
        self.ui().set_subs_busy(false);
        true
    }

    pub fn cancel_subs_job(&mut self) {
        if let Some(c) = &self.subs.job {
            c.store(true, Ordering::Relaxed);
        }
    }

    pub fn download_subs_model(&mut self) {
        if self.subs.job.is_some() {
            return;
        }
        let (generation, cancel) = self.begin_job();
        self.ui().set_subs_status("Connecting…".into());
        std::thread::spawn(move || {
            let result = subtitles::download_model(&cancel, &|value, status| {
                let _ = slint::invoke_from_event_loop(move || {
                    with(|p| {
                        if p.subs.job_gen == generation {
                            p.ui().set_subs_progress(value);
                            p.ui().set_subs_status(status.into());
                        }
                    })
                });
            });
            let _ = slint::invoke_from_event_loop(move || {
                with(|p| {
                    if !p.end_job(generation) {
                        return;
                    }
                    match result {
                        Ok(_) => {
                            p.subs.model_ready = subtitles::model_dir().is_some();
                            p.ui().set_subs_model_ready(p.subs.model_ready);
                            p.apply_subs();
                        }
                        Err(e) => p.ui().set_subs_status(
                            if cancel.load(Ordering::Relaxed) { "Download stopped.".to_string() } else { format!("{e:#}") }.into(),
                        ),
                    }
                })
            });
        });
    }

    // ---------- files ----------

    /// Add an SRT / VTT / ASS file to the film and translate from it.
    pub fn open_subtitle_file(&mut self) {
        if !self.is_video {
            return;
        }
        let target = self.current_path.clone();
        let _ = slint::spawn_local(async move {
            let picked = rfd::AsyncFileDialog::new()
                .set_title("Open subtitles")
                .add_filter("Subtitles", &["srt", "vtt", "ass", "ssa"])
                .pick_file()
                .await;
            let Some(file) = picked else { return };
            with(|p| {
                if p.current_path != target {
                    return;
                }
                let path = file.path().to_string_lossy().into_owned();
                if let Err(e) = p.mpv.command(&["sub-add", &path, "select"]) {
                    p.ui().set_subs_status(e.to_string().into());
                    return;
                }
                Timer::single_shot(Duration::from_millis(150), || {
                    with(|p| p.refresh_tracks());
                });
            });
        });
    }

    /// Save the whole film's Persian subtitles as an SRT file.
    pub fn export_persian_subtitles(&mut self) {
        if self.subs.job.is_some() || self.subs.cues.is_empty() {
            return;
        }
        let Some(dir) = subtitles::model_dir() else { return };
        let stem = self.current_path.as_ref().and_then(|p| p.file_stem()).unwrap_or_default().to_string_lossy().into_owned();
        let start_dir = self.current_path.as_ref().and_then(|p| p.parent()).map(Path::to_owned);
        let groups: Vec<(u64, u64, String)> = self
            .subs
            .groups
            .iter()
            .map(|g| (self.subs.cues[g.first].start, self.subs.cues[g.last].end, g.text.clone()))
            .collect();
        let cache = self.subs.cache.clone();
        let source = self.selected_sub_track().map(|t| t.external).filter(|e| !e.is_empty()).map(PathBuf::from);
        let (generation, cancel) = self.begin_job();
        self.ui().set_subs_status("Choose where to save…".into());
        std::thread::spawn(move || {
            let mut dialog = rfd::FileDialog::new()
                .set_title("Save Persian subtitles")
                .set_file_name(format!("{stem}.fa.srt"))
                .add_filter("SubRip", &["srt"]);
            if let Some(d) = &start_dir {
                dialog = dialog.set_directory(d);
            }
            let result = match dialog.save_file() {
                None => Ok(None),
                Some(path) => export(&dir, &groups, &cache, &path, source.as_deref(), &cancel, generation).map(Some),
            };
            let _ = slint::invoke_from_event_loop(move || {
                with(|p| {
                    if !p.end_job(generation) {
                        return;
                    }
                    match result {
                        Ok(Some(path)) => p.ui().set_subs_status(format!("Saved · {}", path.display()).into()),
                        Ok(None) => p.subs_status(),
                        Err(e) => p.ui().set_subs_status(
                            if cancel.load(Ordering::Relaxed) { "Export stopped.".to_string() } else { format!("{e:#}") }.into(),
                        ),
                    }
                })
            });
        });
    }
}

/// One ASS event with both lines, in a `res_x` × 720 space, bottom-centred at `y`.
pub fn overlay_event(en: &str, fa: &str, persian_top: bool, size: i32, res_x: f32, y: f32) -> String {
    let scale = [0.82, 1.0, 1.2][size.clamp(0, 2) as usize];
    // Vazirmatn reads smaller than Inter at the same size; balance them.
    let fa_size = 50.0 * scale;
    let en_size = 33.0 * scale;
    let max_chars = |fs: f32, glyph: f32| ((res_x * 0.86) / (fs * glyph)) as usize;
    // A right-to-left embedding keeps Persian punctuation on the correct side.
    let fa_lines: Vec<String> =
        wrap(fa, max_chars(fa_size, 0.3).clamp(16, 90)).iter().map(|l| format!("\u{202b}{}\u{202c}", ass_escape(l))).collect();
    let en_lines: Vec<String> = wrap(en, max_chars(en_size, 0.5).clamp(16, 100)).iter().map(|l| ass_escape(l)).collect();
    let border = format!("\\bord{:.1}\\shad1\\3c&H000000&\\4c&H000000&\\4a&H70&", 2.6 * scale);
    let fa_block = (!fa_lines.is_empty())
        .then(|| format!("{{\\fnVazirmatn\\b0\\fs{fa_size:.0}\\c&HFFFFFF&{border}}}{}", fa_lines.join("\\N")));
    let en_block = (!en_lines.is_empty())
        .then(|| format!("{{\\fnInter Medium\\b0\\fs{en_size:.0}\\c&HDCDCDC&{border}}}{}", en_lines.join("\\N")));
    let blocks: Vec<String> =
        if persian_top { [fa_block, en_block] } else { [en_block, fa_block] }.into_iter().flatten().collect();
    format!("{{\\an2\\q2\\pos({:.0},{y:.0})}}{}", res_x / 2.0, blocks.join("\\N"))
}

impl LiveSubs {
    /// Keep a translated sentence through the small gaps between its own cues,
    /// but never extend it past that sentence or into an unrelated silent gap.
    fn timed_line(&self, now: u64) -> Option<&str> {
        let i = self.cues.partition_point(|c| c.start <= now).checked_sub(1)?;
        let cue = &self.cues[i];
        if now < cue.end {
            return Some(&cue.text);
        }
        let next = self.cues.get(i + 1)?;
        let same_sentence = self.group_of.get(i).zip(self.group_of.get(i + 1)).is_some_and(|(a, b)| a == b);
        (same_sentence && now < next.start).then_some(cue.text.as_str())
    }

    fn mostly_english(&self) -> bool {
        !mostly_persian(&self.line)
    }
}

fn subtitle_time_ms(position: f64, delay: f64, speed: f64) -> Option<u64> {
    let time = (position - delay) / speed;
    (speed.is_finite() && speed > 0.0 && time.is_finite() && time >= 0.0).then_some((time * 1000.0) as u64)
}

fn display_lines(mode: i32, english: &str, persian: &str, waiting: bool) -> (String, String) {
    let ready = !waiting && !persian.trim().is_empty();
    (
        if mode == MODE_DUAL || !ready { english.to_owned() } else { String::new() },
        if ready { persian.to_owned() } else { String::new() },
    )
}

fn export(
    dir: &Path,
    groups: &[(u64, u64, String)],
    cache: &HashMap<String, String>,
    path: &Path,
    source: Option<&Path>,
    cancel: &AtomicBool,
    generation: u64,
) -> anyhow::Result<PathBuf> {
    if let Some(src) = source {
        anyhow::ensure!(
            path.canonicalize().ok() != src.canonicalize().ok() || !path.exists(),
            "Choose a different file name to keep the original subtitles"
        );
    }
    let model = crate::mt::Model::load(dir)?;
    let mut cues = Vec::with_capacity(groups.len());
    let mut lines = Vec::with_capacity(groups.len());
    let mut last = std::time::Instant::now();
    for (i, (start, end, text)) in groups.iter().enumerate() {
        subtitles::check_cancel(cancel)?;
        let fa = cache.get(text).cloned().unwrap_or_else(|| model.translate(text));
        if fa.trim().is_empty() {
            continue;
        }
        cues.push(Cue { start: *start, end: *end, text: text.clone() });
        lines.push(fa);
        if last.elapsed() > Duration::from_millis(120) {
            last = std::time::Instant::now();
            let (value, status) = ((i + 1) as f32 / groups.len() as f32, format!("Translating {} / {} lines…", i + 1, groups.len()));
            let _ = slint::invoke_from_event_loop(move || {
                with(|p| {
                    if p.subs.job_gen == generation {
                        p.ui().set_subs_progress(value);
                        p.ui().set_subs_status(status.into());
                    }
                })
            });
        }
    }
    subtitles::atomic_write(path, subtitles::srt(&cues, &lines)?.as_bytes())?;
    Ok(path.to_owned())
}

/// Copy an embedded text track out with FFmpeg (when available), cached per file.
fn extract_track(video: &Path, index: &str) -> anyhow::Result<PathBuf> {
    let ffmpeg = ffmpeg().ok_or_else(|| anyhow::anyhow!("FFmpeg is not available"))?;
    let meta = std::fs::metadata(video)?;
    let stamp = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs());
    let key = format!("{}|{}|{}|{index}", video.display(), meta.len(), stamp);
    let mut hash = 0xcbf29ce484222325u64;
    for b in key.bytes() {
        hash = (hash ^ b as u64).wrapping_mul(0x100000001b3);
    }
    let dir = subtitles::data_dir().join("tracks");
    std::fs::create_dir_all(&dir)?;
    let out = dir.join(format!("{hash:016x}.srt"));
    if out.is_file() {
        return Ok(out);
    }
    let part = out.with_extension("part.srt");
    let mut cmd = std::process::Command::new(ffmpeg);
    cmd.args(["-nostdin", "-v", "error", "-y", "-i"])
        .arg(video)
        .args(["-map", &format!("0:{index}"), "-c:s", "srt", "-f", "srt"])
        .arg(&part)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    let mut child = subtitles::hidden(&mut cmd).spawn()?;
    let deadline = std::time::Instant::now() + Duration::from_secs(300);
    loop {
        if let Some(status) = child.try_wait()? {
            anyhow::ensure!(status.success(), "This track cannot be read as text");
            break;
        }
        if std::time::Instant::now() > deadline {
            let _ = child.kill();
            let _ = child.wait();
            anyhow::bail!("Reading the subtitle track took too long");
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    std::fs::rename(&part, &out)?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn cue(start: u64, end: u64, text: &str) -> Cue {
        Cue { start, end, text: text.into() }
    }
    #[test]
    fn sentences_across_cues() {
        let cues = [
            cue(0, 1000, "I don't know if"),
            cue(1100, 2000, "we can make it."),
            cue(2100, 3000, "Run!"),
            cue(9000, 9500, "Wait,"),
            cue(9600, 9900, "- Who?"),
        ];
        let (groups, of) = sentence_groups(&cues);
        assert_eq!(groups[0].text, "I don't know if\nwe can make it.");
        assert_eq!(of, vec![0, 0, 1, 2, 3]);
    }

    fn timeline(cues: Vec<Cue>) -> LiveSubs {
        let (groups, group_of) = sentence_groups(&cues);
        let mut s = LiveSubs::default();
        s.cues = cues;
        s.groups = groups;
        s.group_of = group_of;
        s
    }

    #[test]
    fn sentence_translation_survives_short_cue_gaps_but_clears_on_seek() {
        // The reported course has 10 ms gaps around 03:48, inside one sentence.
        let s = timeline(vec![
            cue(223970, 228360, "For this example,"),
            cue(228370, 234280, "we use the next feature,"),
            cue(234290, 240060, "and compare the results."),
            cue(240530, 248100, "A different sentence."),
        ]);
        assert_eq!(s.timed_line(228365), Some("For this example,"));
        assert_eq!(s.timed_line(234285), Some("we use the next feature,"));
        assert_eq!(s.timed_line(228370), Some("we use the next feature,"));
        assert_eq!(s.timed_line(240200), None);
        assert_eq!(s.timed_line(210000), None);
        assert_eq!(s.timed_line(260000), None);
        assert_eq!(s.timed_line(224000), Some("For this example,"));
    }

    #[test]
    fn unrelated_cues_and_disabled_track_do_not_leave_stale_lines() {
        let s = timeline(vec![cue(1000, 2000, "Hello."), cue(2010, 3000, "Goodbye.")]);
        assert_eq!(s.timed_line(2005), None);
        assert_eq!(LiveSubs::default().timed_line(1500), None);
        assert_eq!(subtitle_time_ms(3.0, 1.0, 2.0), Some(1000));
        assert_eq!(subtitle_time_ms(0.0, 1.0, 1.0), None);
        assert_eq!(subtitle_time_ms(1.0, 0.0, 0.0), None);
    }

    #[test]
    fn controls_redraw_keeps_source_visible_while_translation_is_pending() {
        for mode in [MODE_DUAL, MODE_PERSIAN] {
            assert_eq!(display_lines(mode, "A new line", "", true), ("A new line".into(), String::new()));
        }
        assert_eq!(display_lines(MODE_PERSIAN, "Hello", "سلام", false), (String::new(), "سلام".into()));
        assert_eq!(display_lines(MODE_DUAL, "Hello", "سلام", false), ("Hello".into(), "سلام".into()));
        assert_eq!(display_lines(MODE_PERSIAN, "Hello", "", false), ("Hello".into(), String::new()));
    }

    #[test]
    #[ignore = "Needs a local subtitle folder in UNISON_SUBS_TEST_DIR"]
    fn course_cue_continuity() {
        fn visit(path: &Path, checked: &mut (usize, usize)) {
            for entry in std::fs::read_dir(path).unwrap().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    visit(&path, checked);
                } else if path.extension().is_some_and(|e| e == "srt") {
                    let s = timeline(subtitles::parse(&std::fs::read(&path).unwrap()).unwrap());
                    checked.0 += 1;
                    for (i, pair) in s.cues.windows(2).enumerate() {
                        if pair[0].end < pair[1].start && s.group_of[i] == s.group_of[i + 1] {
                            let time = pair[0].end + (pair[1].start - pair[0].end) / 2;
                            assert!(s.timed_line(time).is_some(), "{} at {time}", path.display());
                            checked.1 += 1;
                        }
                    }
                    if let Some(last) = s.cues.last() {
                        assert!(s.timed_line(last.end + 1000).is_none());
                    }
                }
            }
        }
        let mut checked = (0, 0);
        visit(Path::new(&std::env::var("UNISON_SUBS_TEST_DIR").unwrap()), &mut checked);
        assert!(checked.0 > 0 && checked.1 > 0);
        eprintln!("Checked {} subtitle files and {} sentence gaps", checked.0, checked.1);
    }
    /// Shows the fixture in a short-lived mpv window and saves window screenshots
    /// (video + subtitles + overlay), for checking the real libass rendering.
    #[test]
    #[ignore = "Opens a window; needs libmpv, the model and test-results/live-demo.mkv"]
    fn render_overlay_frames() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let video = std::env::var_os("UNISON_SUBS_TEST_VIDEO").map(PathBuf::from)
            .unwrap_or_else(|| root.join("test-results/live-demo.mkv"));
        let model = crate::mt::Model::load(&root.join("models/enfa")).unwrap();
        let out = root.join("test-results/frames");
        std::fs::create_dir_all(&out).unwrap();
        let mpv = crate::mpv::Mpv::new().unwrap();
        for (k, v) in [("ao", "null"), ("vo", "gpu"), ("geometry", "1280x720"), ("pause", "yes"), ("sub-visibility", "no")] {
            mpv.set_string(k, v);
        }
        mpv.load(&video.to_string_lossy(), 2.0).unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(20);
        while std::time::Instant::now() < deadline {
            if let Some(crate::mpv::Event::FileLoaded) = mpv.wait_event(1.0) {
                break;
            }
        }
        let cases: Vec<(String, bool, i32, f64)> = if std::env::var_os("UNISON_SUBS_TEST_VIDEO").is_some() {
            let cues = subtitles::parse(&std::fs::read(video.with_extension("srt")).unwrap()).unwrap();
            [0, cues.len() / 2, cues.len() - 1].into_iter().enumerate()
                .map(|(i, n)| (cues[n].text.clone(), i == 1, if i == 2 { 2 } else { 1 }, cues[n].start as f64 / 1000.0 + 0.05))
                .collect()
        } else {
            vec![
                ("You're pulling my leg, aren't you?".into(), false, 1, 2.0),
                ("- Where were you last night?\n- I was at home, watching TV.".into(), true, 1, 2.0),
                ("Look, we don't have to see eye to eye on everything, but when things fall apart, I've got your back.".into(), false, 2, 2.0),
            ]
        };
        for (i, (en, top, size, position)) in cases.iter().enumerate() {
            mpv.seek_absolute(*position);
            let fa = model.translate(en);
            eprintln!("{en} → {fa}");
            let event = overlay_event(en, &fa, *top, *size, 1280.0, 690.0);
            mpv.command(&["osd-overlay", OVERLAY, "ass-events", &event, "1280", "720", "0"]).unwrap();
            std::thread::sleep(Duration::from_millis(800));
            let file = out.join(format!("case{i}.png"));
            mpv.command(&["screenshot-to-file", &file.to_string_lossy(), "window"]).unwrap();
            std::thread::sleep(Duration::from_millis(400));
        }
        let _ = mpv.command(&["quit"]);
    }
    #[test]
    fn wraps_evenly_and_escapes() {
        assert_eq!(wrap("one two three four five six", 15), vec!["one two three", "four five six"]);
        assert_eq!(ass_escape("{\\b1}x"), "(\u{29f5}b1)x");
    }
}
