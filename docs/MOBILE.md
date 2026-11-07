# Unison mobile: Android and iPhone PWA

The shared mobile application lives in `mobile/`; the Rust/Slint desktop player
stays in place. Display name: **Unison Player**. Project, command and assets:
**unison**. Mobile app ID: `io.github.nahur1.unison`.

## Architecture and visual adaptation

React/TypeScript renders the same interface in an Android Capacitor shell and
an installable PWA. Existing Inter/Vazirmatn fonts, selected U/play artwork,
dark/light palette, glass surfaces and muted accent colors are reused. On phones,
four thumb-friendly tabs replace the desktop sidebar. The sidebar returns on
wider screens. Video controls/subtitles live inside the fullscreen container;
settings remain in sheets/cards. Safe-area insets, portrait/landscape, keyboard
focus, reduced motion, persistent mini controls and 320px layouts are covered.

Android music uses a native Media3 foreground MediaSessionService: audio focus,
headphone disconnection, lock-screen controls, a native queue, repeat/shuffle,
speed, volume, equalization and a native sleep timer. Closing via the app's Stop
and Close button or removing the task stops the player and service. Locking the
screen keeps music playing, as requested by the owner. Video uses the shared
HTML video surface; it does not claim desktop libmpv codec parity.

The native Rust translator/tokenizer (`src/mt.rs`, `src/spm.rs`) compile into a
small standalone WebAssembly crate. The only shared desktop change is an
in-memory model loader; desktop loading still delegates to exactly the same
inference implementation. Translation executes in a worker, not the UI thread.
The exact pinned Mozilla en→fa model is SHA256-verified before use. No subtitle
text goes to a server, and no separate cloud or generic word dictionary is used.

## Capability audit

| Existing desktop capability                                                 | Android / iPhone PWA implementation                                                                                                                                                                                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Music/video library, search, albums, artists, favorites, recent files       | Local imports with persisted metadata/artwork and filters. Android system document picker; PWA file picker. No unrestricted disk scan.                                                                                                      |
| Persistent queue and sessions                                               | Saved queues/sessions; native Android music queue continues with the screen locked.                                                                                                                                                         |
| Play/pause, previous/next, smooth seek, mute/volume, speed, repeat/shuffle  | Implemented. Browser codec and system volume restrictions still apply.                                                                                                                                                                      |
| Video fullscreen and PiP                                                    | Shared video surface with fullscreen subtitle overlay; PiP feature-detected. Browser support varies; CSS fullscreen fallback is available.                                                                                                  |
| Offline English→Persian model                                               | Same Rust model/tokenizer via WebAssembly, bundled with APK and PWA distribution; explicit preparation caches and verifies model for offline PWA use.                                                                                       |
| SRT/WebVTT/ASS and Persian formatting                                       | External subtitle import, UTF-8/UTF-16, original/Persian/bilingual/off modes, timing offset, text size, pretranslation, incremental cache, SRT export and Vazirmatn RTL rendering.                                                          |
| Live subtitle continuity                                                    | Pending translations keep the source cue visible. Replies belong to a track generation; late replies never replace a different video's subtitles. Translate ahead for uninterrupted Persian. Cross-cue sentence grouping is not yet ported. |
| Lyrics                                                                      | Local timed LRC import. Online LRCLIB lookup is not ported.                                                                                                                                                                                 |
| Bookmarks, notes, A–B loop, sleep timer                                     | Implemented, notes export to Markdown; Android music timer lives in native service. Browser timers follow OS suspension rules.                                                                                                              |
| 10-band EQ / presets                                                        | Web Audio filters; Android maps the ten target frequencies onto available hardware bands. Automatic genre detection and custom presets/preamp controls are not yet ported.                                                                  |
| Mini player / theme                                                         | Persistent mini bar, dark/light/system and original accent palette. Desktop floating windows become in-app controls.                                                                                                                        |
| Desktop-only integration                                                    | CLI, tray, global hotkeys, desktop file trash, window traffic lights, MPRIS and installer updater have no direct PWA equivalent.                                                                                                            |
| libmpv embedded subtitle/audio-track selection, frame stepping, yt-dlp URLs | Not exposed as fake mobile controls. These require a further native video backend or browser-specific support. Use external subtitles and supported local formats for this preview.                                                         |

This is a functional **0.5.0 mobile preview**, not a claim that Safari can run all
libmpv formats or that every desktop integration exists on a phone. MP4/H.264+AAC
and MP3/AAC are preferred interchange formats. Android audio uses Media3's wider
format support. iPhone codec/PiP/background capabilities are determined by Safari.

## Offline storage and installation

Android imports copies into its private media directory without broad storage
permissions. Removing an item removes only that imported copy. Original files
stay untouched. PWA media uses bounded 4MiB IndexedDB byte chunks; large files
are never base64-encoded. On reload metadata/artwork load first, and media bytes
load when selected. Cache Storage keeps the model and versioned app shell.
Storage failures are surfaced; persistent-storage requests are advisory because
iOS can evict data under pressure. Keep originals/backups outside the app.

After merge and successful CI, GitHub Pages deploys to
`https://nahur1.github.io/unison/`. On iPhone open in Safari, Share → Add to Home
Screen. Open once online, import your files and prepare offline translation,
then test Airplane Mode. APK includes the model/runtime for offline first use.
The PWA ZIP can also be hosted under any HTTPS subdirectory.

## Development

Requirements: Node24, Rust stable with wasm32-unknown-unknown, Java21, Android
SDK36/build-tools36. The owner has SDK at D:/Android/Sdk. Do not commit local
SDK paths or signing material. On Windows use the portable MSVC setup for Rust
host build scripts, as in scripts/build.ps1.

```sh
python scripts/prepare-offline.py
cd mobile
npm ci
npm run prepare:assets
npm run build:translator
npm test
npm run build
npx playwright install chromium webkit
npm run test:e2e
npm run android:sync
cd android
./gradlew assembleDebug testDebugUnitTest assembleDebugAndroidTest
```

For release signing set UNISON_ANDROID_KEYSTORE, UNISON_ANDROID_STORE_PASSWORD,
UNISON_ANDROID_KEY_PASSWORD and UNISON_ANDROID_KEY_ALIAS. The owner's stable
PKCS12 key and recovery metadata are backed up locally in ignored
`.tools/signing/`. Corresponding encrypted GitHub secrets sign official main
builds. **Back up this folder privately: updates must retain the same key.**
Never print, commit, upload as an artifact, replace or regenerate the key casually.
Debug CI APKs have a different signature and are test-only; install the signed
release APK for normal direct installation and later upgrades.

## Tests and automation

The native build workflow calls mobile.yml. It builds and tests the PWA, tests
Chromium on Linux, WebKit on macOS (closer to Safari for media), builds Android,
runs native unit tests and an Android emulator audio/service lifecycle test.
Only successful desktop AND mobile jobs allow publication. Official releases
include the signed APK/checksum and PWA ZIP/checksum, alongside desktop assets.
Pages deploys only after publication from main; PRs only produce test artifacts.
No app source or private file upload is required for playback/translation.

Local WebKit on this Windows host cannot play even a standalone data-URL MP3
outside Unison. Its layout/translation/offline tests run locally, while the two
media tests explicitly skip only Windows WebKit and run unskipped on macOS CI.
This is not an iPhone hardware test: actual device acceptance remains necessary
for lock-screen playback, Safari storage pressure, codecs, PiP and safe areas.
No Android device/emulator is installed locally; native instrumentation is
compiled locally and runs in GitHub's emulator job. Do not claim those jobs
passed until verified. The owner requested no waiting/polling after a push.

Primary references:

- https://capacitorjs.com/docs/getting-started/environment-setup
- https://developer.android.com/media/media3/session/background-playback
- https://developer.android.com/jetpack/androidx/releases/media3
- https://webkit.org/blog/14403/updates-to-storage-policy/
- https://playwright.dev/docs/browsers
