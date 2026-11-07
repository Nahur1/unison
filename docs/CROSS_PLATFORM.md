# Native macOS and Linux builds

Every push to main and every pull request runs native Windows x64, Ubuntu 22.04
amd64, macOS 15 Apple Silicon and macOS 15 Intel jobs. Main publishes one release
only after all four jobs succeed. A PR never publishes. Keep the version and
release notes in sync; published versions are never overwritten.

## Outputs

- Windows: existing Inno Setup installer and `latest.json` (silent updater).
- Linux: `unison-VERSION-linux-amd64.deb`; install with
  `sudo apt install ./unison-*-linux-amd64.deb`.
- macOS: separate `macos-arm64.dmg` and `macos-x86_64.dmg` files. Open the image
  and drag Unison Player into Applications. macOS 15 or newer is required.

Both Unix formats include the pinned offline translation model, fonts, font and
model licenses, application license notices and the selected U/play logo.
Linux uses distro libmpv and runtime dependencies resolved by dpkg-shlibdeps;
APT installs those dependencies. FFmpeg and yt-dlp are recommended for embedded
subtitle prefetching and online links. macOS vendors libmpv's recursive dylib
dependencies with relative paths, and includes Homebrew receipts/license files.
No Homebrew installation is required on the user's Mac.

Mac bundles have an ad-hoc signature for integrity, not a Developer ID signature
or Apple notarization. Gatekeeper may require explicit approval under Privacy &
Security on first launch. Signing/notarization with the owner's Apple Developer
credentials can be added separately. No such credentials are stored here.
Linux and macOS updates use manual downloads from Releases; Windows keeps its
existing automatic updater. The Linux package is not an RPM or AppImage.

## Required checks

Native jobs execute Rust unit tests and publishing regression tests, then run the
real English-to-Persian inference test using the bundled, checksum-verified model
(including the scalar ARM implementation). Builds use `--locked`.

Linux installs the actual .deb with APT. Mac jobs verify and mount the actual DMG,
copy the app to another folder, verify its signature and reject non-system
absolute dylib dependencies. Both run the packaged executable from an unrelated
working directory under an isolated profile and native Unix IPC socket.

The smoke suite checks real playback, mute/unmute with retained volume, mini/full
transitions, persisted mute after restart, successful shutdown and the absence
of a surviving IPC listener. A second run plays an FFmpeg-generated video through
OpenGL and requires the native rendered-frame counter to keep advancing before,
during and after fullscreen, then PiP and back. Linux runs under Xvfb/Openbox with
Mesa software OpenGL and a D-Bus session. These checks do not substitute for
manual visual checks on physical GPU hardware or every Linux desktop/Wayland
compositor.

macOS fullscreen uses winit's simple fullscreen mode on the current desktop,
avoiding overlapping AppKit Spaces transitions on the custom frameless window.
The one-pixel GPU surface repair remains Windows-only. Hosted Mac smoke tests
use a scale factor of 1 to keep their CPU OpenGL renderer practical; physical
Macs retain their normal display scaling.

## Local builds

Install native libmpv development libraries plus Rust stable and platform GUI
build dependencies. On macOS use `brew install mpv dylibbundler`; set
`MPV_LIB_DIR="$(brew --prefix mpv)/lib"`. Then run:

```sh
python3 scripts/prepare-offline.py
cargo test --locked
cargo test --locked --release mt::tests::real_model_translates -- --ignored --nocapture
cargo build --locked --release
python3 scripts/package-unix.py linux # or macos
```

Package staging deliberately refuses to overwrite an existing staging folder.
Use a fresh checkout/output folder for a new package build.
