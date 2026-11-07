# Local validation — 6 November 2026 (0.3.0, live Persian subtitles)

Windows laptop: Intel i7-11850H, 32 GB RAM, NVIDIA T1200 / Intel UHD.

## Automated checks

- 26 deterministic tests pass: library, IPC, metadata, lyrics, EQ, sessions, SRT/WebVTT/ASS parsing (including broken cues, short milliseconds and text like "I <3 you"), UTF-16 Persian, sentence grouping across cues, balanced line wrapping, ASS escaping, idiom rephrasing and Persian half-space fixes.
- `mt::tests::real_model_translates` (ignored by default) loads the 22 MB model in about 65 ms and translates each sample line in about 8–17 ms (release build, beam size 4).

## Rendering check

`subtitle_ui::tests::render_overlay_frames` opens a short mpv window over `test-results/live-demo.mkv` and saves window screenshots with the overlay. Checked by eye: Persian letters join correctly, lines read right-to-left with punctuation on the correct side, dialogue dashes are placed correctly, long lines break into two even lines, and the overlay shows with `osd-level=0`.

## Live timing in the running app

With `UNISON_SUBS_LOG=1`, the release build played a 40-second fixture with an embedded English track. From the moment mpv reported each English line until the English + Persian pair was sent to the screen took 1.8–11 ms. The English track was selected automatically, the following lines were prepared ahead, and "I don't know if / we can make it before the storm." was translated as one sentence across both cues.

## Not verified here

Screen control was not available for this session, so the new subtitle panel (Slint UI) and the keyboard shortcuts were compiled but not clicked through. Export of a Persian SRT and the model download button were not exercised interactively.
