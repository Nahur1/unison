import type { Cue } from "./types";
export function timecode(value: string): number {
  const p = value.trim().replace(",", ".").split(":").map(Number);
  if (p.length < 2 || p.some((x) => !Number.isFinite(x))) return NaN;
  return p.reduce((a, x) => a * 60 + x, 0);
}
export function plain(text: string): string {
  return text
    .replace(/\{[^}]*\}/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\\N/gi, "\n")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}
export function parseSubtitles(input: string): Cue[] {
  const text = input.replace(/^\uFEFF/, "").replace(/\r/g, "");
  const cues: Cue[] = [];
  if (/^\[Script Info\]|^\[Events\]/m.test(text)) {
    let fields = [
      "layer",
      "start",
      "end",
      "style",
      "name",
      "marginl",
      "marginr",
      "marginv",
      "effect",
      "text",
    ];
    for (const line of text.split("\n")) {
      if (line.startsWith("Format:"))
        fields = line
          .slice(7)
          .toLowerCase()
          .split(",")
          .map((s) => s.trim());
      if (!line.startsWith("Dialogue:")) continue;
      const values = line.slice(9).split(",");
      const index = fields.indexOf("text");
      const start = timecode(values[fields.indexOf("start")] || "");
      const end = timecode(values[fields.indexOf("end")] || "");
      const content = plain(values.slice(index).join(","));
      if (end > start && content) cues.push({ start, end, text: content });
    }
  } else {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(
        /(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3})/,
      );
      if (!m) continue;
      const body: string[] = [];
      while (i + 1 < lines.length && lines[i + 1].trim()) body.push(lines[++i]);
      const start = timecode(m[1]),
        end = timecode(m[2]),
        content = plain(body.join("\n"));
      if (end > start && content) cues.push({ start, end, text: content });
    }
  }
  return cues.sort((a, b) => a.start - b.start);
}
export function activeCues(cues: Cue[], time: number): Cue[] {
  return cues.filter((c) => time >= c.start && time < c.end);
}
function stamp(t: number) {
  const ms = Math.round(t * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}
export function exportSrt(cues: Cue[], translations: Record<string, string>) {
  return cues
    .map(
      (c, i) =>
        `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${translations[c.text] || c.text}\n`,
    )
    .join("\n");
}
export function formatTime(seconds: number) {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return s >= 3600
    ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
    : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
