import {
  Capacitor,
  registerPlugin,
  type PluginListenerHandle,
} from "@capacitor/core";
export const native = Capacitor.isNativePlatform();
export interface NativeFile {
  path: string;
  uri: string;
  name: string;
  size: number;
  mime: string;
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  artwork?: string;
}
export interface NativeState {
  playing: boolean;
  position: number;
  duration: number;
  ended: boolean;
  trackId: string;
}
export interface NativeSubtitleFile {
  name: string;
  data: string;
}
export interface NativeSubtitleTrack {
  language: string;
  label: string;
  cues: { start: number; end: number; text: string }[];
}
export interface NativeMedia {
  pickFiles(): Promise<{
    files: NativeFile[];
    subtitles?: NativeSubtitleFile[];
  }>;
  pickSubtitles(): Promise<{
    files: NativeFile[];
    subtitles?: NativeSubtitleFile[];
  }>;
  extractSubtitles(options: {
    path: string;
  }): Promise<{ tracks: NativeSubtitleTrack[] }>;
  pictureInPicture(options: { width: number; height: number }): Promise<void>;
  setAutoPictureInPicture(options: {
    enabled: boolean;
    width: number;
    height: number;
  }): Promise<void>;
  play(options: {
    uri: string;
    title: string;
    artist: string;
    position: number;
    items: { id: string; uri: string; title: string; artist: string }[];
    index: number;
  }): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(options: { position: number }): Promise<void>;
  configure(options: {
    volume: number;
    speed: number;
    muted: boolean;
    gains: number[];
    eq: boolean;
  }): Promise<void>;
  sleep(options: { minutes: number }): Promise<void>;
  removeFile(options: { path: string }): Promise<void>;
  status(): Promise<void>;
  stop(): Promise<void>;
  close(): Promise<void>;
  addListener(
    event: "state",
    listener: (state: NativeState) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: "pip",
    listener: (state: { active: boolean }) => void,
  ): Promise<PluginListenerHandle>;
}
export const Native = registerPlugin<NativeMedia>("UnisonMedia");
export function nativeUrl(path: string) {
  return Capacitor.convertFileSrc(path);
}
