//! The live subtitle translator: one worker thread that owns the model.
//! The line on screen always goes first; upcoming lines fill the idle time,
//! so by the time a line appears its Persian is usually already waiting.
use crate::mt::Model;
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::mpsc::{Receiver, Sender, channel};

enum Job {
    Now(String),
    Ahead(Vec<String>),
    Forget,
}

pub enum Reply {
    Ready,
    Done(String, String),
    Failed(String),
}

pub struct Translator {
    tx: Sender<Job>,
}

impl Translator {
    /// `reply` runs on the worker thread.
    pub fn start(dir: PathBuf, reply: impl Fn(Reply) + Send + 'static) -> Self {
        let (tx, rx) = channel();
        std::thread::Builder::new()
            .name("unison-translator".into())
            .spawn(move || work(dir, rx, reply))
            .expect("translator thread");
        Translator { tx }
    }

    pub fn now(&self, text: String) {
        let _ = self.tx.send(Job::Now(text));
    }

    pub fn ahead(&self, texts: Vec<String>) {
        if !texts.is_empty() {
            let _ = self.tx.send(Job::Ahead(texts));
        }
    }

    /// Drop look-ahead work, e.g. after a seek or a track change.
    pub fn forget(&self) {
        let _ = self.tx.send(Job::Forget);
    }
}

fn work(dir: PathBuf, rx: Receiver<Job>, reply: impl Fn(Reply)) {
    let model = match Model::load(&dir) {
        Ok(m) => m,
        Err(e) => {
            reply(Reply::Failed(format!("The Persian model could not be loaded: {e:#}")));
            return;
        }
    };
    reply(Reply::Ready);
    let mut cache: HashMap<String, String> = HashMap::new();
    let mut urgent: VecDeque<String> = VecDeque::new();
    let mut ahead: VecDeque<String> = VecDeque::new();
    let mut queued: HashSet<String> = HashSet::new();
    loop {
        if urgent.is_empty() && ahead.is_empty() {
            match rx.recv() {
                Ok(job) => take(job, &mut urgent, &mut ahead, &mut queued, &cache),
                Err(_) => return,
            }
        }
        while let Ok(job) = rx.try_recv() {
            take(job, &mut urgent, &mut ahead, &mut queued, &cache);
        }
        let Some(text) = urgent.pop_front().or_else(|| ahead.pop_front()) else { continue };
        queued.remove(&text);
        let fa = match cache.get(&text) {
            Some(fa) => fa.clone(),
            None => {
                let fa = model.translate(&text);
                if cache.len() > 20_000 {
                    cache.clear();
                }
                cache.insert(text.clone(), fa.clone());
                fa
            }
        };
        reply(Reply::Done(text, fa));
    }
}

fn take(
    job: Job,
    urgent: &mut VecDeque<String>,
    ahead: &mut VecDeque<String>,
    queued: &mut HashSet<String>,
    cache: &HashMap<String, String>,
) {
    match job {
        Job::Now(t) => {
            // Only the newest few matter: older lines have already left the screen.
            urgent.retain(|u| u != &t);
            urgent.push_front(t);
            urgent.truncate(3);
        }
        Job::Ahead(list) => {
            for t in list {
                if !cache.contains_key(&t) && queued.insert(t.clone()) {
                    ahead.push_back(t);
                }
            }
            while ahead.len() > 600 {
                if let Some(t) = ahead.pop_back() {
                    queued.remove(&t);
                }
            }
        }
        Job::Forget => {
            ahead.clear();
            queued.clear();
        }
    }
}
