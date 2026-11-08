//! Version, links and automatic updates (see updater.rs).
use crate::{Player, updater};
use slint::{Timer, TimerMode};
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::AtomicBool;
use std::time::Duration;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const GITHUB_URL: &str = "https://github.com/Nahur1/unison";
/// The authors' GitHub profiles, shown in About.
pub const REZA_URL: &str = "https://github.com/reza-hashemian";
pub const NAHUR1_URL: &str = "https://github.com/Nahur1";
pub const RELEASES_URL: &str = "https://github.com/Nahur1/unison/releases/latest";

/// An installer to run once the event loop has ended: (file, open Unison again).
pub static INSTALL_ON_EXIT: Mutex<Option<(PathBuf, bool)>> = Mutex::new(None);

pub fn open_url(url: &str) {
    #[cfg(target_os = "windows")]
    { let _ = crate::subtitles::hidden(std::process::Command::new("rundll32.exe").arg("url.dll,FileProtocolHandler").arg(url)).spawn(); }
    #[cfg(target_os = "macos")]
    { let _ = std::process::Command::new("open").arg(url).spawn(); }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    { let _ = std::process::Command::new("xdg-open").arg(url).spawn(); }
}

fn with(f: impl FnOnce(&mut Player)) {
    crate::with(f);
}

impl Player {
    pub(crate) fn start_community(&mut self, _relaunched: bool) {
        let ui = self.ui();
        ui.set_app_version(VERSION.into());
        if let Some((version, file)) = updater::pending() {
            self.update_ready(version, file);
        }
        // Check a little after start, then every six hours while running.
        Timer::single_shot(Duration::from_secs(20), || with(|p| p.check_updates(false)));
        self.update_timer.start(TimerMode::Repeated, Duration::from_secs(6 * 3600), || {
            with(|p| p.check_updates(false))
        });
    }

    pub(crate) fn check_updates(&mut self, manual: bool) {
        if manual {
            self.ui().set_show_update_sheet(true);
        }
        if self.update_checking || self.update_file.is_some() {
            return;
        }
        self.update_checking = true;
        if manual {
            self.ui().set_update_status("checking".into());
        }
        std::thread::spawn(move || {
            let result = updater::check(&AtomicBool::new(false));
            let _ = slint::invoke_from_event_loop(move || {
                with(|p| {
                    p.update_checking = false;
                    match result {
                        Ok(updater::Found::Ready(version, file)) => p.update_ready(version, file),
                        Ok(updater::Found::Available(version)) => p.update_available(version),
                        Ok(updater::Found::Latest) => p.ui().set_update_status("latest".into()),
                        Err(e) => {
                            eprintln!("unison: update check: {e:#}");
                            p.ui().set_update_status(if manual { "failed" } else { "" }.into());
                        }
                    }
                })
            });
        });
    }

    fn update_ready(&mut self, version: String, file: PathBuf) {
        let first = self.update_file.is_none();
        self.update_file = Some(file);
        let ui = self.ui();
        ui.set_update_latest(version.clone().into());
        ui.set_update_status("ready".into());
        if first {
            self.show_note(format!("Unison {version} is ready · it installs when you close the app"));
        }
    }

    /// A newer version to download by hand (Linux, macOS, portable Windows).
    fn update_available(&mut self, version: String) {
        let ui = self.ui();
        let first = ui.get_update_latest() != version.as_str();
        ui.set_update_latest(version.clone().into());
        ui.set_update_status("available".into());
        if first {
            self.show_note(format!("Unison {version} is available · download it from Releases"));
        }
    }

    /// "Restart and update" in the About sheet.
    pub(crate) fn install_update_now(&mut self) {
        if let Some(file) = self.update_file.clone() {
            self.save();
            *INSTALL_ON_EXIT.lock().unwrap() = Some((file, true));
            crate::quit();
        }
    }

    /// Closing with an update waiting installs it after the player exits.
    pub(crate) fn install_update_on_close(&mut self) -> bool {
        let Some(file) = self.update_file.clone() else { return false };
        *INSTALL_ON_EXIT.lock().unwrap() = Some((file, false));
        true
    }
}
