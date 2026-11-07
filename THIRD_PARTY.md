# Attribution and bundled components

Unison Player is maintained by Mohammad Fakhari (Nahur1). Its earlier player architecture, music library functionality and previously published MIT material retain their MIT permissions, preserved in `licenses/LEGACY-MIT.txt`. The original player's personal attribution was removed at their request, as confirmed by the project owner. New original material covered by the root LICENSE has separate, restricted terms; those terms do not override this file's component licenses or earlier permissions.

Live translation uses the English→Persian model (version 1.1) from Mozilla's [Firefox Translations](https://github.com/mozilla/firefox-translations-models), under the Mozilla Public License 2.0; its notice is in `models/enfa/LICENSE.txt`. The model is run by Unison's own Rust code, written from the published Marian model format; no Mozilla or Marian code is included. Checksums are pinned in `src/subtitles.rs` and `scripts/prepare-offline.py`.

[Vazirmatn](https://github.com/rastikerdar/vazirmatn) by the Vazirmatn Project Authors and [Inter](https://rsms.me/inter/) are distributed under the SIL Open Font License. Their license files are in `ui/fonts` and the portable app's `runtime/fonts` folder.

Playback uses libmpv; FFmpeg is optional (reading embedded tracks ahead) and is not bundled by default. The development/portable build uses the existing libmpv DLL. These binaries can have GPL components. Before publicly distributing binaries, supply the exact corresponding source and all applicable license notices, or rebuild compatible components under suitable terms. See [mpv copyright](https://github.com/mpv-player/mpv/blob/master/Copyright) and [FFmpeg legal](https://ffmpeg.org/legal.html). Local source use and the provided private build do not publish any files.

Slint has its own licensing terms: [Slint licensing](https://slint.dev/license). Review these and dependency licenses before commercial distribution.
