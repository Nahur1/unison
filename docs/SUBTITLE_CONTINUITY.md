# Subtitle continuity fix - 0.3.4

An empty subtitle notification immediately cleared the translated sentence,
including at short gaps between cues belonging to that same sentence. A
controls/layout redraw during the translation wait could also clear both the
source and translated text.

The player now reconciles empty notifications with the live subtitle property
and parsed cue timing. It preserves a sentence across its own cue gaps, clears
real gaps, and checks for missed text changes at most ten times per second.
Playback position, subtitle delay and subtitle speed determine the fallback
timing; it does not keep an old sentence indefinitely after a seek. The source
line remains readable while a new translation is pending. Track resets also
invalidate outstanding cue extraction so an older track cannot repopulate it.

Validation on the owner's local course files:

- Release test suite: 30 passed, 0 failed; 3 resource-dependent tests ignored.
- `course_cue_continuity`: 278 SRT files, 246 within-sentence gaps checked.
- Separate native-model diagnostic: 51 sampled lines, 0 empty translations;
  maximum observed inference time 32 ms in that run.
- `render_overlay_frames`: three actual videos, with screenshots at their
  beginning, middle and end (9 frames); checked Persian shaping, line order
  and the larger subtitle size. These are libmpv rendering tests, not a complete
  interactive walkthrough of the application.

Run the extra checks with local resources:

```powershell
$env:UNISON_SUBS_TEST_DIR = 'PATH_TO_COURSE_FOLDER'
./scripts/build.ps1 -Release -Test -Filter course_cue_continuity -Ignored
$env:UNISON_SUBS_TEST_VIDEO = 'PATH_TO_VIDEO_WITH_MATCHING_SRT.mp4'
./scripts/build.ps1 -Release -Test -Filter render_overlay_frames -Ignored
```

No user media or screenshots are included in the repository. The full cause of
every intermittent disappearance has not been established from the screenshot;
these changes address the reproduced display gaps and add recovery for missing
subtitle notifications.
