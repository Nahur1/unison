fn main() {
    if let Ok(dir) = std::env::var("MPV_LIB_DIR") {
        println!("cargo:rustc-link-search=native={dir}");
    }
    println!("cargo:rerun-if-env-changed=MPV_LIB_DIR");
    let config = slint_build::CompilerConfiguration::new().with_style("cupertino".into());
    slint_build::compile_with_config("ui/app.slint", config).expect("Slint build failed");

    // Windows: give unison.exe its icon and version info.
    #[cfg(windows)]
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let mut res = winresource::WindowsResource::new();
        if let Ok(path) = std::env::var("UNISON_RC_DIR") { res.set_toolkit_path(&path); }
        res.set_icon("packaging/windows/unison.ico");
        res.set("ProductName", "Unison Player");
        res.set("CompanyName", "Mohammad Fakhari (Nahur1)");
        res.set("LegalCopyright", "Copyright (c) 2026 Mohammad Fakhari (Nahur1). See LICENSE for scope and third-party terms.");
        res.set("FileDescription", "Unison Player · Offline Persian Subtitles");
        res.compile().expect("Windows resources failed");
    }
}
