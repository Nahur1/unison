//! Automatic updates for the installed app. New versions are published as
//! GitHub Releases with a small `latest.json`; the new installer is downloaded
//! and checksum-verified in the background, then installed silently when
//! Unison closes (or right away, with "Restart and update"). Other copies
//! (Linux, macOS, portable Windows) only learn that a new version exists.
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

pub const REPO: &str = "Nahur1/unison";
const MANIFEST: &str = "https://github.com/Nahur1/unison/releases/latest/download/latest.json";

#[derive(Serialize, Deserialize, Clone)]
pub struct Manifest {
    pub version: String,
    pub url: String,
    pub sha256: String,
}

pub enum Found {
    Latest,
    /// Newer, but this copy can't install it itself: download from Releases.
    Available(String),
    Ready(String, PathBuf),
}

/// Only an installed copy updates itself (portable and development builds don't).
pub fn installed() -> bool {
    std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.join("unins000.exe").is_file())).unwrap_or(false)
}

fn parts(v: &str) -> Vec<u64> {
    v.trim().trim_start_matches('v').split(['.', '-']).map(|p| p.parse().unwrap_or(0)).collect()
}

pub fn newer(candidate: &str, current: &str) -> bool {
    let (a, b) = (parts(candidate), parts(current));
    for i in 0..a.len().max(b.len()) {
        let (x, y) = (a.get(i).copied().unwrap_or(0), b.get(i).copied().unwrap_or(0));
        if x != y {
            return x > y;
        }
    }
    false
}

fn dir() -> PathBuf {
    crate::profile::local_data_dir().join("updates")
}

/// A downloaded, verified installer newer than this version, if there is one.
pub fn pending() -> Option<(String, PathBuf)> {
    let m: Manifest = serde_json::from_slice(&std::fs::read(dir().join("ready.json")).ok()?).ok()?;
    let file = dir().join(installer_name(&m.version));
    (newer(&m.version, crate::community::VERSION) && file.is_file()).then_some((m.version, file))
}

fn installer_name(version: &str) -> String {
    format!("unison-setup-{version}.exe")
}

/// Look for a new release and fetch it. Runs on a worker thread.
pub fn check(cancel: &AtomicBool) -> Result<Found> {
    let client = reqwest::blocking::Client::builder()
        .user_agent(concat!("Unison/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(20))
        .build()?;
    let m: Manifest = client.get(MANIFEST).send()?.error_for_status()?.json().context("Invalid update information")?;
    if !newer(&m.version, crate::community::VERSION) {
        return Ok(Found::Latest);
    }
    if !installed() {
        return Ok(Found::Available(m.version));
    }
    ensure!(
        m.url.starts_with(&format!("https://github.com/{REPO}/releases/download/")) && m.sha256.len() == 64,
        "Unexpected update location"
    );
    if let Some((v, file)) = pending() {
        if v == m.version {
            return Ok(Found::Ready(v, file));
        }
    }
    std::fs::create_dir_all(dir())?;
    let file = dir().join(installer_name(&m.version));
    crate::subtitles::download(&m.url, &file, &m.sha256, cancel, &|_, _| {})?;
    // Older downloads are no longer needed.
    if let Ok(entries) = std::fs::read_dir(dir()) {
        for e in entries.flatten() {
            if e.path() != file && e.path().extension().is_some_and(|x| x == "exe") {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    crate::subtitles::atomic_write(&dir().join("ready.json"), &serde_json::to_vec(&m)?)?;
    Ok(Found::Ready(m.version, file))
}

/// Start the silent installer. It closes Unison if needed and, with
/// `relaunch`, opens it again when done.
pub fn install(file: &Path, relaunch: bool) -> Result<()> {
    let mut cmd = std::process::Command::new(file);
    cmd.args(["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS"]);
    if relaunch {
        cmd.arg("/RELAUNCH=1");
    }
    cmd.spawn().context("Could not start the update installer")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn versions_compare() {
        assert!(super::newer("0.3.1", "0.3.0"));
        assert!(super::newer("v0.10.0", "0.9.9"));
        assert!(!super::newer("0.3.0", "0.3.0"));
        assert!(!super::newer("0.2.9", "0.3.0"));
    }
}
