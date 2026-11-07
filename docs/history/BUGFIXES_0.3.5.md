# Window, exit and audio fixes - 0.3.5

- Fullscreen keeps a visible cursor. Native pointer events wake the video HUD
  and continue to normal hit-testing. Geometry notifications are deferred until
  the current player operation has completed: synchronous mini/fullscreen size
  changes previously could re-enter the player's RefCell and freeze the UI.
- Close saves the session, stops playback and quits. It no longer hides the
  application in the tray. Minimise remains available separately.
- Music, mini music, video/fullscreen and PiP have mute buttons beside volume
  sliders. The same mute state is used everywhere, with the prior volume kept.
  Raising the volume unmutes. PiP subtitles lift above the new volume strip.

Local validation:

- Existing Rust suite: 30 passed, 3 resource-dependent tests ignored.
- Release automation tests: 7 passed.
- Real executable smoke test: mute/unmute, retained volume, mini/full changes,
  persisted mute across restart, process exit and released IPC port passed.
- Interactive Windows tests with a separate profile: music and mini music mute,
  slider unmute, mouse fullscreen entry/exit, visible cursor with the HUD hidden,
  fullscreen mute preserving volume, PiP mute, readable PiP subtitle placement,
  and native Alt+F4 closing the video process were checked.

The smoke test is a required Windows Actions step before uploading release
assets. It uses the software renderer and silent audio for CI; fullscreen GPU
input/rendering is checked interactively on the Windows laptop.

```powershell
python scripts/smoke-player.py --exe 'dist/Unison Player 0.3.5/unison.exe'
```

For independent interactive checks, use `UNISON_PROFILE_DIR` and
`UNISON_IPC_PORT`. Normal launches retain their existing data directories.
Test profiles have their own database, cover cache, subtitle cache and update
directory; they do not share the normal player's IPC endpoint.
