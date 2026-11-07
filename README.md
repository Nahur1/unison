# Unison

**Unison Player** is the application: music, video and offline Persian subtitles in an Apple-inspired desktop interface. The repository, source project and terminal command are named **unison**.

[فارسی](README.fa.md) · [Downloads](https://github.com/Nahur1/unison/releases) · [Contributing](CONTRIBUTING.md)

## Features

- Music library, albums, artists, favorites, playback sessions, equalizer and mini player.
- Video playback, fullscreen, PiP, smooth seeking, speed controls, shared mute/volume and remembered positions.
- Offline English-to-Persian subtitles with the bundled 22 MB Mozilla model and native Rust inference. Original, bilingual and Persian modes; sentence-aware translation, cue continuity, prefetching and Persian SRT export.
- A visible fullscreen pointer, top-right window controls and complete process exit on Close.
- The new U/play identity and Persian fonts included in every native package.

## Install

Version **0.4.0** is the first Unison release. Download the installer for your platform from Releases:

- Windows x64: `unison-setup-0.4.0.exe`; installed copies update from this repository automatically. A local portable build is `dist/unison-0.4.0/unison.exe`.
- macOS 15+: `unison-0.4.0-macos-arm64.dmg` or `unison-0.4.0-macos-x86_64.dmg`; drag **Unison Player** to Applications. Bundles are ad-hoc signed, not Apple notarized; first launch may require Privacy & Security approval.
- Debian/Ubuntu amd64: `sudo apt install ./unison-0.4.0-linux-amd64.deb`. Native package tests run on Ubuntu 22.04.

macOS/Linux updates are manual. Unison has independent settings, IPC and installer identity. The previous app's installation and profile are preserved. FFmpeg is optional for reading embedded subtitles ahead; yt-dlp enables online links. Neither is needed for local offline text subtitle translation.

## Terminal

```sh
unison
unison "/path/to/movie.mp4"
unison --code
unison mute
unison fullscreen
unison mini
unison close
```

The app display name is **Unison Player**. Executable and project names are always `unison`, never `unison-player`.

## Build and test

Use Rust stable and native libmpv development libraries. Windows also needs MSVC and Windows SDK; place `libmpv-2.dll` in `runtime`. On macOS, `brew install mpv dylibbundler` and set `MPV_LIB_DIR` to the Homebrew mpv lib folder.

```powershell
python scripts/prepare-offline.py
./scripts/build.ps1 -Test
./scripts/build.ps1
./scripts/release.ps1
```

On Unix run `cargo test --locked`, `cargo build --locked --release`, then `python3 scripts/package-unix.py linux` (or `macos`). See [native packaging and checks](docs/CROSS_PLATFORM.md).

Pushes to main and pull requests run native tests on Windows, Linux, Apple Silicon and Intel Mac. A new version on main is published automatically only after every required job succeeds. Bump both Cargo version entries and add release notes for each app update. Pull requests never publish; published versions are never overwritten.

[Project import and naming](docs/PROJECT_IMPORT.md) documents source provenance and the immutable external playback dependency. Existing ownership and third-party terms remain in [LICENSE](LICENSE), [COPYRIGHT.md](COPYRIGHT.md), [THIRD_PARTY.md](THIRD_PARTY.md) and [licenses](licenses).

## Project team

- [Mohammad Fakhari (Nahur1)](https://github.com/Nahur1) — maintainer
- [Reza Hashemian (reza-hashemian)](https://github.com/reza-hashemian) — maintainer and collaborator

GitHub's automatic Contributors list reflects attributed commits on the default
branch; accepting a collaboration invitation alone does not add an entry.

## Mobile application

Android and iPhone PWA sources are in `mobile/`. See [mobile features, installation,
builds and test limits](docs/MOBILE.md). The Android APK and PWA ZIP are built
by GitHub Actions; signed releases and Pages deployment follow a reviewed merge.
