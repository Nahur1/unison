import { describe, it, expect } from "vitest";
import {
  parseSubtitles,
  activeCues,
  exportSrt,
  timecode,
  mediaBaseName,
  decodeSubtitle,
  parseCaptionFile,
  bestEmbeddedTrack,
} from "../src/subtitles";
describe("timed subtitles", () => {
  it("reads SRT and strips formatting without executing it", () => {
    const cues = parseSubtitles(
      "1\n00:00:01,200 --> 00:00:04,300\n<i>Hello.</i>\n\n2\n00:00:04,300 --> 00:00:07,000\nWhere are you?",
    );
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ start: 1.2, end: 4.3, text: "Hello." });
    expect(activeCues(cues, 4.3)[0].text).toBe("Where are you?");
  });
  it("preserves overlapping cues and clears gaps", () => {
    const cues = [
      { start: 0, end: 2, text: "One" },
      { start: 1, end: 3, text: "Two" },
    ];
    expect(activeCues(cues, 1.5)).toHaveLength(2);
    expect(activeCues(cues, 3)).toHaveLength(0);
  });
  it("reads WebVTT identifiers and cue settings", () => {
    expect(
      parseSubtitles(
        "WEBVTT\n\nintro\n00:01.500 --> 00:03.000 align:middle\nGood morning.",
      )[0],
    ).toEqual({ start: 1.5, end: 3, text: "Good morning." });
  });
  it("reads ASS dialogue containing commas", () => {
    const input =
      "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,{\\i1}Hello, world!\\NGoodbye.";
    expect(parseSubtitles(input)[0].text).toBe("Hello, world!\nGoodbye.");
  });
  it("exports Persian cues with unchanged timestamps", () => {
    const output = exportSrt([{ start: 1.125, end: 3.5, text: "Hello" }], {
      Hello: "سلام",
    });
    expect(output).toContain("00:00:01,125 --> 00:00:03,500\nسلام");
  });
  it("ignores invalid or inverted timing", () => {
    expect(parseSubtitles("00:00:05,000 --> 00:00:01,000\nWrong")).toEqual([]);
    expect(Number.isNaN(timecode("invalid"))).toBe(true);
  });
});
describe("subtitle files on Android", () => {
  it("pairs subtitle files with their video by name", () => {
    expect(mediaBaseName("Movie.2019.en.forced.srt")).toBe("movie.2019");
    expect(mediaBaseName("Movie.2019.mkv")).toBe("movie.2019");
    expect(mediaBaseName("Movie.2019.English.srt")).toBe("movie.2019");
  });
  it("decodes UTF-8, UTF-16 and older Windows files", () => {
    expect(decodeSubtitle(new TextEncoder().encode("Café"))).toBe("Café");
    expect(decodeSubtitle(new Uint8Array([255, 254, 72, 0, 105, 0]))).toBe(
      "Hi",
    );
    expect(decodeSubtitle(new Uint8Array([67, 97, 102, 233]))).toBe("Café");
  });
  it("reads LRC lyrics with end times", () => {
    const cues = parseCaptionFile(
      "song.lrc",
      "[00:01.00]One\n[00:03.50]Two",
      10,
    );
    expect(cues).toEqual([
      { start: 1, end: 3.5, text: "One" },
      { start: 3.5, end: 10, text: "Two" },
    ]);
  });
  it("prefers a full English embedded track over forced ones", () => {
    const tracks = [
      { language: "en", label: "Forced", cues: [1] },
      { language: "fr", label: "", cues: [1, 2, 3] },
      { language: "eng", label: "", cues: [1, 2] },
    ];
    expect(bestEmbeddedTrack(tracks)).toBe(tracks[2]);
  });
});
