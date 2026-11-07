//! Optional isolated profile for native UI/exit tests and diagnostics.
//! Normal launches keep the existing Windows/Linux data locations.
use std::path::PathBuf;

pub fn root() -> Option<PathBuf> {
    std::env::var_os("UNISON_PROFILE_DIR").filter(|v| !v.is_empty()).map(PathBuf::from)
}

pub fn data_dir() -> PathBuf {
    root().unwrap_or_else(|| dirs::data_dir().unwrap_or_else(std::env::temp_dir).join("unison"))
}

pub fn local_data_dir() -> PathBuf {
    root().map(|p| p.join("local"))
        .unwrap_or_else(|| dirs::data_local_dir().unwrap_or_else(std::env::temp_dir).join("unison"))
}

pub fn cache_dir() -> PathBuf {
    root().map(|p| p.join("cache"))
        .unwrap_or_else(|| dirs::cache_dir().unwrap_or_else(std::env::temp_dir).join("unison"))
}
