# Unison project notes

## Names and workspace

- Active independent workspace: `D:\Unison`; repository: https://github.com/Nahur1/unison.
- Application display name: **Unison Player** only in UI, app launchers, installer display metadata and the native macOS app bundle.
- Repository, Cargo package, executable, CLI, resource filenames, environment prefixes and technical identifiers: **unison** / **UNISON_**. Never use unison-player as a technical project name.
- Preserve the selected silver/ice-blue/lavender U/play icon. Its master is design/unison/unison-icon-v1.png; exported app/installer/Linux icons must match it.
- Preserve the source project and the owner's original folder. Do not push, modify or delete its backups or releases as part of this project.

## Preserve working behavior

- Native Rust offline English-to-Persian translation, Mozilla pinned model, Persian fonts, bilingual modes, sentence merging, prefetching and subtitle continuity.
- Apple-inspired UI, enlarged top-right window controls/order, smooth timeline, visible fullscreen cursor and native pointer event forwarding.
- Closing the window hides Unison in the tray (pausing video) when the desktop has one; Quit in the tray menu and `unison close` stop playback and exit completely. Shared mute/volume works in music, video, mini and PiP.
- Windows fullscreen surface repair stays Windows-only; macOS uses same-desktop simple fullscreen and matching UI state.
- Legacy libmpv startup/profile, loadfile command syntax and OpenGL ABI compatibility must remain tested.
- UNISON_PROFILE_DIR / UNISON_IPC_PORT / UNISON_SOCKET isolate native tests. Normal Unison uses its own data directories and port 47826, distinct from the previous app.
- Keep the new Unison installer AppId stable; never substitute the previous application's AppId or silently share its profile/updater.

## Collaboration and publication

- Reza Hashemian (reza-hashemian), who wrote the original player (Nava), and Mohammad Fakhari (Nahur1) are the authors; Nahur1 hosts the repository. Real contributors commit under their own identities. Do not rewrite someone else's work as the owner's.
- On this owner's computer use local Git identity Nahur1 <51950495+Nahur1@users.noreply.github.com>. Do not add AI identities or AI Co-Authored-By trailers.
- Hooks must allow real collaborators. Do not reinstate an owner-only author filter across the shared history.
- Increment Cargo.toml and Cargo.lock version and add docs/releases/X.Y.Z.md for app updates. Push explicit refs to Nahur1/unison; never use --mirror or push unrelated backup refs.
- Required Actions jobs: Windows x64, Linux amd64, macOS arm64 and Intel. Require unit/publishing/model-inference/native playback and full process-exit checks before publishing.
- Wait for publish success and verify actual public downloads/checksums before reporting a version released. Do not substitute a local binary for CI output.
- Existing ownership/license terms and legacy MIT/dependency notices remain intact. Never infer a transfer of third-party ownership from collaborator access.
- Source provenance and archived prior release notes are documented in docs/PROJECT_IMPORT.md. External dependency source names are not current product names.
