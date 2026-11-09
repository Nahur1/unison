export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  kind: "audio" | "video";
  name: string;
  size: number;
  added: number;
  duration: number;
  position: number;
  favorite: boolean;
  blob?: Blob;
  stored?: boolean;
  nativePath?: string;
  artwork?: Blob;
  /** Embedded subtitle tracks were already looked for (Android). */
  scanned?: boolean;
}
export interface Cue {
  start: number;
  end: number;
  text: string;
}
export interface Session {
  id: string;
  name: string;
  tracks: string[];
}
export interface Settings {
  theme: "dark" | "light" | "system";
  accent: string;
  volume: number;
  muted: boolean;
  speed: number;
  repeat: "off" | "all" | "one";
  shuffle: boolean;
  gains: number[];
  preamp: number;
  eq: boolean;
  subtitleMode: "off" | "original" | "bilingual" | "persian";
  subtitleSize: number;
  subtitleOffset: number;
}
export const defaultSettings: Settings = {
  theme: "dark",
  accent: "#b6c4e6",
  volume: 0.8,
  muted: false,
  speed: 1,
  repeat: "off",
  shuffle: false,
  gains: Array(10).fill(0),
  preamp: 0,
  eq: false,
  subtitleMode: "bilingual",
  subtitleSize: 20,
  subtitleOffset: 0,
};
export interface Bookmark {
  id: string;
  track: string;
  time: number;
  note: string;
}
export interface CaptionFile {
  cues: Cue[];
  translations: Record<string, string>;
}
export const BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const PRESETS: Record<string, number[]> = {
  Flat: Array(10).fill(0),
  Rock: [4, 3, 1.5, 0, -1, -0.5, 1, 2.5, 3.5, 4],
  Pop: [-1, 0.5, 2, 3, 2, 0, -0.5, 0.5, 1.5, 2],
  "Vocal Boost": [-2, -2, -1, 1, 3, 4, 3.5, 1.5, 0, -1],
  "Bass Boost": [6, 5, 4, 2.5, 1, 0, 0, 0, 0, 0],
  "Late Night": [-4, -3, -1.5, 0, 1, 2, 2, 1, 0, -1],
};
