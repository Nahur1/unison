import { useCallback, useEffect, useRef, useMemo, useState } from "react";
import {
  Music2,
  Film,
  Library,
  Captions,
  SlidersHorizontal,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Shuffle,
  Repeat,
  Repeat1,
  Heart,
  Plus,
  Search,
  ChevronLeft,
  ListMusic,
  Maximize,
  Minimize,
  PictureInPicture2,
  Download,
  Check,
  WifiOff,
  X,
  MoreHorizontal,
  BookmarkPlus,
  Clock3,
  Trash2,
  FolderOpen,
  Sparkles,
  FileText,
  Moon,
  Smartphone,
  ArrowUpRight,
  LoaderCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  Track,
  Settings,
  Cue,
  Session,
  Bookmark,
  CaptionFile,
} from "./types";
import { defaultSettings, BANDS, PRESETS } from "./types";
import * as db from "./storage";
import { parseSubtitles, activeCues, formatTime, exportSrt } from "./subtitles";
import { OfflineTranslator } from "./translation";
import { Equalizer } from "./equalizer";
import { Native, native, nativeUrl } from "./native";
import { parseBlob } from "music-metadata";
const translator = new OfflineTranslator(),
  equalizer = new Equalizer();
// crypto.randomUUID needs WebView 92; Android 7-10 phones can be older.
function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function IconButton({
  icon: Icon,
  label,
  onClick,
  active = false,
  disabled = false,
  className = "",
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`icon-button ${active ? "active" : ""} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon size={22} />
    </button>
  );
}
function Brand() {
  return (
    <span className="brand">
      <img src="./icons/unison-128.png" alt="" />
      <span>
        Unison <span className="brand-player">Player</span>
      </span>
    </span>
  );
}
function Art({ track, large = false }: { track?: Track; large?: boolean }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!track?.artwork) {
      setUrl("");
      return;
    }
    const object = URL.createObjectURL(track.artwork);
    setUrl(object);
    return () => URL.revokeObjectURL(object);
  }, [track?.artwork]);
  return (
    <div
      className={`art ${large ? "large" : ""} ${track?.kind === "video" ? "video-art" : ""}`}
    >
      {url ? (
        <img src={url} alt="Album artwork" />
      ) : track?.kind === "video" ? (
        <Film />
      ) : (
        <Music2 />
      )}
    </div>
  );
}
function download(text: string, name: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/plain;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
export default function App() {
  const [legalText, setLegalText] = useState("");
  const [tracks, setTracks] = useState<Track[]>([]),
    [settings, setSettings] = useState<Settings>(defaultSettings),
    [sessions, setSessions] = useState<Session[]>([]),
    [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [tab, setTab] = useState("now"),
    [category, setCategory] = useState("songs"),
    [group, setGroup] = useState(""),
    [query, setQuery] = useState(""),
    [currentId, setCurrentId] = useState(""),
    [queue, setQueue] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false),
    [time, setTime] = useState(0),
    [duration, setDuration] = useState(0),
    [source, setSource] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [sheet, setSheet] = useState(""),
    [full, setFull] = useState(false);
  const [cues, setCues] = useState<Cue[]>([]),
    [translations, setTranslations] = useState<Record<string, string>>({}),
    [modelState, setModelState] = useState("idle"),
    [modelProgress, setModelProgress] = useState(0),
    [translateCount, setTranslateCount] = useState(0);
  const [sleep, setSleep] = useState(0),
    [loop, setLoop] = useState<[number, number?] | null>(null),
    [note, setNote] = useState(""),
    [sessionName, setSessionName] = useState(""),
    [online, setOnline] = useState(navigator.onLine),
    [loaded, setLoaded] = useState(false);
  const media = useRef<HTMLMediaElement | null>(null),
    videoStage = useRef<HTMLDivElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    subtitleInput = useRef<HTMLInputElement>(null);
  const currentRef = useRef<Track | undefined>(undefined),
    tracksRef = useRef<Track[]>([]),
    settingsRef = useRef(settings),
    queueRef = useRef(queue),
    endedRef = useRef(() => {}),
    generation = useRef(0),
    saveAt = useRef(0),
    sleepTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    isNativeAudio = useRef(false),
    sourceUrl = useRef(""),
    wantsPlay = useRef(false),
    translationBusy = useRef(false);
  useEffect(() => {
    if (!sheet) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>("[role=dialog]");
    const focusables = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,a[href],[tabindex="0"]',
        ) || [],
      );
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSheet("");
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables(),
        first = list[0],
        last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [sheet]);
  const nativeClock = useRef({ position: 0, at: performance.now() });
  const current = tracks.find((t) => t.id === currentId);
  currentRef.current = current;
  tracksRef.current = tracks;
  settingsRef.current = settings;
  queueRef.current = queue;
  const toast = useCallback((text: string) => setNotice(text), []);
  useEffect(() => {
    Promise.all([
      db.getAll<Track>("tracks"),
      db.get<Settings>("settings", "player"),
      db.getAll<Session>("sessions"),
      db.getAll<Bookmark>("bookmarks"),
      db.get<string>("settings", "current"),
      db.get<string[]>("settings", "queue"),
    ])
      .then(([items, s, p, b, id, q]) => {
        setTracks(items);
        if (s) setSettings({ ...defaultSettings, ...s });
        setSessions(p);
        setBookmarks(b);
        setCurrentId(id || "");
        setQueue(q || items.map((t) => t.id));
        setLoaded(true);
      })
      .catch((e) => toast("Could not open library: " + errorText(e)));
  }, [toast]);
  useEffect(() => {
    if (loaded)
      void db
        .put("settings", "player", settings)
        .catch((e) => toast(errorText(e)));
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.style.setProperty("--accent", settings.accent);
  }, [settings, loaded, toast]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6500);
    return () => clearTimeout(timer);
  }, [notice]);
  const change = useCallback(
    (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })),
    [],
  );
  const persistTrack = useCallback(async (track: Track) => {
    await db.put("tracks", track.id, track);
    setTracks((items) => items.map((t) => (t.id === track.id ? track : t)));
  }, []);
  const seek = useCallback(
    (position: number) => {
      const target = Math.max(0, Math.min(position, duration || position));
      setTime(target);
      nativeClock.current = { position: target, at: performance.now() };
      if (isNativeAudio.current)
        void Native.seek({ position: target }).catch((e) =>
          toast(errorText(e)),
        );
      else if (media.current) media.current.currentTime = target;
    },
    [duration, toast],
  );
  const choose = useCallback(
    async (track: Track, ids?: string[], autoplay = true) => {
      generation.current++;
      setCues([]);
      setTranslations({});
      setLoop(null);
      setTime(track.position || 0);
      setDuration(track.duration || 0);
      setPlaying(false);
      setCurrentId(track.id);
      currentRef.current = track;
      isNativeAudio.current = native && track.kind === "audio";
      const nextQueue = [...(ids || queueRef.current)];
      if (!nextQueue.includes(track.id)) nextQueue.push(track.id);
      setQueue(nextQueue);
      void db
        .put("settings", "queue", nextQueue)
        .catch((e) => toast(errorText(e)));
      void db
        .put("settings", "current", track.id)
        .catch((e) => toast(errorText(e)));
      media.current?.pause();
      if (native && autoplay && !isNativeAudio.current)
        await Native.stop().catch(() => {});
      if (sourceUrl.current) {
        URL.revokeObjectURL(sourceUrl.current);
        sourceUrl.current = "";
      }
      wantsPlay.current = autoplay && !isNativeAudio.current;
      const blob =
        track.blob ||
        (!track.nativePath ? await db.mediaBlob(track.id) : undefined);
      if (currentRef.current?.id !== track.id) return;
      if (track.nativePath) setSource(nativeUrl(track.nativePath));
      else if (blob) {
        sourceUrl.current = URL.createObjectURL(blob);
        setSource(sourceUrl.current);
      } else {
        setSource("");
        toast("Select this file again to restore access.");
        return;
      }
      try {
        if (isNativeAudio.current && autoplay) {
          const music = nextQueue
            .map((id) => tracksRef.current.find((t) => t.id === id))
            .filter(
              (t): t is Track => !!t && t.kind === "audio" && !!t.nativePath,
            );
          await Native.play({
            uri: track.nativePath || "",
            title: track.title,
            artist: track.artist,
            position: track.position || 0,
            items: music.map((t) => ({
              id: t.id,
              uri: t.nativePath!,
              title: t.title,
              artist: t.artist,
            })),
            index: Math.max(
              0,
              music.findIndex((t) => t.id === track.id),
            ),
          });
          await Native.configure(settingsRef.current);
          setPlaying(true);
        } else if (isNativeAudio.current) {
          await Native.status();
        }
        const captions = await db.get<CaptionFile>("captions", track.id);
        if (currentRef.current?.id === track.id && captions) {
          setCues(captions.cues);
          setTranslations(captions.translations);
        }
      } catch (e) {
        toast(errorText(e));
      }
    },
    [toast],
  );
  useEffect(() => {
    if (loaded && currentRef.current && !source)
      void choose(currentRef.current, undefined, false);
  }, [loaded, choose, source]);
  const step = useCallback(
    (direction: number) => {
      const ids = queueRef.current.filter((id) =>
        tracksRef.current.some((t) => t.id === id),
      );
      if (!ids.length) return;
      let index = ids.indexOf(currentRef.current?.id || "") + direction;
      if (settingsRef.current.shuffle && ids.length > 1) {
        const options = ids.filter((id) => id !== currentRef.current?.id);
        index = ids.indexOf(
          options[Math.floor(Math.random() * options.length)],
        );
      }
      if (index >= ids.length || index < 0) {
        if (settingsRef.current.repeat === "all")
          index = (index + ids.length) % ids.length;
        else {
          setPlaying(false);
          return;
        }
      }
      const track = tracksRef.current.find((t) => t.id === ids[index]);
      if (track) void choose({ ...track, position: 0 }, ids);
    },
    [choose],
  );
  const toggle = useCallback(async () => {
    try {
      const track = currentRef.current;
      if (!track) return;
      if (isNativeAudio.current) {
        if (playing) {
          await Native.pause();
          setPlaying(false);
        } else {
          try {
            await Native.resume();
          } catch {
            await choose(track);
          }
          setPlaying(true);
        }
      } else if (media.current) {
        if (media.current.paused) {
          await equalizer.resume();
          await media.current.play();
        } else media.current.pause();
      }
    } catch (e) {
      toast(errorText(e));
    }
  }, [playing, toast, choose]);
  endedRef.current = () => {
    if (settingsRef.current.repeat === "one") {
      seek(0);
      if (isNativeAudio.current) void Native.resume();
      else void media.current?.play();
    } else step(1);
  };
  const updatePosition = useCallback(
    (position: number, total: number) => {
      setTime(position);
      if (total > 0) setDuration(total);
      const track = currentRef.current;
      if (track && Date.now() - saveAt.current > 4000) {
        saveAt.current = Date.now();
        void persistTrack({
          ...track,
          position,
          duration: total || track.duration,
        }).catch((e) => toast(errorText(e)));
      }
    },
    [persistTrack, toast],
  );
  useEffect(() => {
    if (!native) return;
    const handle = Native.addListener("state", (s) => {
      if (!isNativeAudio.current) return;
      if (s.trackId && s.trackId !== currentRef.current?.id) {
        const t = tracksRef.current.find((t) => t.id === s.trackId);
        if (t) {
          currentRef.current = t;
          setCurrentId(t.id);
          generation.current++;
          setCues([]);
          setTranslations({});
          void db.get<CaptionFile>("captions", t.id).then((c) => {
            if (c && currentRef.current?.id === t.id) {
              setCues(c.cues);
              setTranslations(c.translations);
            }
          });
        }
      }
      nativeClock.current = { position: s.position, at: performance.now() };
      setPlaying(s.playing);
      updatePosition(s.position, s.duration);
      if (s.ended) endedRef.current();
    });
    return () => {
      void handle.then((h) => h.remove());
    };
  }, [updatePosition]);
  useEffect(() => {
    if (
      source &&
      wantsPlay.current &&
      !isNativeAudio.current &&
      media.current
    ) {
      wantsPlay.current = false;
      void media.current
        .play()
        .catch(() => toast("Tap Play to start playback."));
    }
  }, [source, toast]);
  useEffect(() => {
    const e = media.current;
    if (e) {
      e.volume = settings.volume;
      e.muted = settings.muted;
      e.playbackRate = settings.speed;
    }
    equalizer.apply(settings);
    if (isNativeAudio.current)
      void Native.configure(settings).catch((e) => toast(errorText(e)));
  }, [settings, toast]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const e = media.current;
      if (isNativeAudio.current) {
        setTime(
          nativeClock.current.position +
            ((performance.now() - nativeClock.current.at) / 1000) *
              settingsRef.current.speed,
        );
      } else if (e) {
        setTime(e.currentTime);
        if (loop?.[1] !== undefined && e.currentTime >= loop[1])
          e.currentTime = loop[0];
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, loop]);
  useEffect(() => {
    if (isNativeAudio.current && loop?.[1] !== undefined && time >= loop[1])
      seek(loop[0]);
  }, [time, loop, seek]);
  useEffect(() => {
    if (native || !("mediaSession" in navigator) || !current) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artist,
      album: current.album,
    });
    navigator.mediaSession.setActionHandler("play", () => {
      void media.current?.play();
    });
    navigator.mediaSession.setActionHandler("pause", () =>
      media.current?.pause(),
    );
    navigator.mediaSession.setActionHandler("previoustrack", () => step(-1));
    navigator.mediaSession.setActionHandler("nexttrack", () => step(1));
    navigator.mediaSession.setActionHandler("seekto", (d) =>
      seek(d.seekTime || 0),
    );
  }, [current, step, seek]);
  useEffect(() => {
    const sync = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  useEffect(
    () => () => {
      translator.close();
      clearTimeout(sleepTimer.current);
    },
    [],
  );
  async function importFiles(files: FileList | File[]) {
    setBusy(true);
    let added = 0;
    try {
      const next = [...tracksRef.current];
      for (const file of Array.from(files)) {
        if (
          !/\.(mp3|m4a|aac|wav|ogg|opus|flac|mp4|m4v|mov|webm|mkv)$/i.test(
            file.name,
          ) ||
          next.some((t) => t.name === file.name && t.size === file.size)
        )
          continue;
        let title = file.name.replace(/\.[^.]+$/, ""),
          artist = "Unknown artist",
          album = "Local collection",
          total = 0,
          artwork: Blob | undefined;
        try {
          const m = await parseBlob(file, { duration: true });
          title = m.common.title || title;
          artist = m.common.artist || artist;
          album = m.common.album || album;
          total = m.format.duration || 0;
          const p = m.common.picture?.[0];
          if (p)
            artwork = new Blob([new Uint8Array(p.data)], { type: p.format });
        } catch {
          /* Optional metadata never prevents import. */
        }
        const track: Track = {
          id: newId(),
          title,
          artist,
          album,
          kind: /\.(mp4|m4v|mov|webm|mkv)$/i.test(file.name)
            ? "video"
            : "audio",
          name: file.name,
          size: file.size,
          added: Date.now(),
          duration: total,
          position: 0,
          favorite: false,
          blob: file,
          artwork,
        };
        await db.put("tracks", track.id, track);
        next.push(track);
        added++;
        setTracks([...next]);
      }
      setQueue(next.map((t) => t.id));
      toast(
        added
          ? `${added} files added · available offline`
          : "No new supported media files found.",
      );
    } catch (e) {
      toast("Import stopped. Existing files are safe. " + errorText(e));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function addFiles() {
    if (!native) {
      fileInput.current?.click();
      return;
    }
    setBusy(true);
    try {
      const result = await Native.pickFiles(),
        next = [...tracksRef.current];
      for (const file of result.files) {
        if (next.some((t) => t.name === file.name && t.size === file.size)) {
          await Native.removeFile({ path: file.path });
          continue;
        }
        const track: Track = {
          id: newId(),
          title: file.title || file.name.replace(/\.[^.]+$/, ""),
          artist: file.artist || "Unknown artist",
          album: file.album || "Local collection",
          kind: file.mime.startsWith("video/") ? "video" : "audio",
          name: file.name,
          size: file.size,
          added: Date.now(),
          duration: file.duration || 0,
          position: 0,
          favorite: false,
          nativePath: file.path,
          artwork: file.artwork
            ? new Blob(
                [Uint8Array.from(atob(file.artwork), (c) => c.charCodeAt(0))],
                { type: "image/jpeg" },
              )
            : undefined,
        };
        await db.put("tracks", track.id, track);
        next.push(track);
      }
      setTracks(next);
      setQueue(next.map((t) => t.id));
      toast(`${result.files.length} files selected`);
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function favorite(track: Track) {
    try {
      await persistTrack({ ...track, favorite: !track.favorite });
    } catch (e) {
      toast(errorText(e));
    }
  }
  async function deleteTrack(track: Track) {
    try {
      if (currentId === track.id) {
        media.current?.pause();
        if (native) await Native.stop();
        setCurrentId("");
        setSource("");
      }
      if (native && track.nativePath)
        await Native.removeFile({ path: track.nativePath });
      await db.remove("tracks", track.id);
      await db.remove("captions", track.id);
      setTracks((ts) => ts.filter((t) => t.id !== track.id));
      setQueue((q) => q.filter((id) => id !== track.id));
      toast("Removed from your Unison library.");
    } catch (e) {
      toast(errorText(e));
    }
  }
  async function readCaptions(file: File) {
    if (!current) {
      toast("Choose a song or video first.");
      return;
    }
    try {
      const id = current.id,
        bytes = new Uint8Array(await file.arrayBuffer()),
        input = new TextDecoder(
          bytes[0] === 255 && bytes[1] === 254
            ? "utf-16le"
            : bytes[0] === 254 && bytes[1] === 255
              ? "utf-16be"
              : "utf-8",
        ).decode(bytes);
      let parsed: Cue[];
      if (file.name.toLowerCase().endsWith(".lrc")) {
        parsed = input
          .split("\n")
          .flatMap((line) => {
            const m = line.match(/\[(\d+):(\d+(?:\.\d+)?)\](.*)/);
            return m
              ? [
                  {
                    start: Number(m[1]) * 60 + Number(m[2]),
                    end: 0,
                    text: m[3].trim(),
                  },
                ]
              : [];
          })
          .sort((a, b) => a.start - b.start);
        parsed = parsed.map((c, i) => ({
          ...c,
          end: parsed[i + 1]?.start || duration || c.start + 8,
        }));
      } else parsed = parseSubtitles(input);
      if (!parsed.length) throw Error("No timed subtitles found.");
      await db.put("captions", id, { cues: parsed, translations: {} });
      if (currentRef.current?.id === id) {
        generation.current++;
        setCues(parsed);
        setTranslations({});
      }
      toast(`${parsed.length} cues loaded`);
    } catch (e) {
      toast(errorText(e));
    } finally {
      if (subtitleInput.current) subtitleInput.current.value = "";
    }
  }
  async function prepare() {
    setModelState("loading");
    translator.onProgress = setModelProgress;
    await navigator.storage?.persist?.();
    try {
      await translator.prepare();
      setModelState("ready");
      toast("Persian translation is ready on this device.");
      return true;
    } catch (e) {
      setModelState("failed");
      toast(errorText(e));
      return false;
    }
  }
  async function translateAll() {
    if (!current || !cues.length || !(await prepare())) return;
    const token = ++generation.current,
      id = current.id,
      result = { ...translations };
    setTranslateCount(0);
    try {
      for (let i = 0; i < cues.length; i++) {
        if (token !== generation.current) return;
        const text = cues[i].text;
        if (!result[text]) result[text] = await translator.translate(text);
        if (token !== generation.current) return;
        setTranslations({ ...result });
        setTranslateCount(i + 1);
        await db.put("captions", id, { cues, translations: result });
      }
      toast("Persian subtitles are ready offline.");
    } catch (e) {
      toast(errorText(e));
    }
  }
  useEffect(() => {
    if (
      modelState !== "ready" ||
      !current ||
      ["off", "original"].includes(settings.subtitleMode)
    )
      return;
    const token = generation.current,
      id = current.id;
    if (translationBusy.current) return;
    const index = cues.findIndex((c) => c.end > time + settings.subtitleOffset);
    if (index < 0) return;
    const upcoming = cues
      .slice(index, index + 3)
      .filter((c) => !translations[c.text]);
    if (!upcoming.length) return;
    translationBusy.current = true;
    void (async () => {
      for (const cue of upcoming) {
        if (token !== generation.current) return;
        const result = await translator.translate(cue.text);
        if (token !== generation.current || currentRef.current?.id !== id)
          return;
        setTranslations((previous) => {
          const next = { ...previous, [cue.text]: result };
          void db
            .put("captions", id, { cues, translations: next })
            .catch((e) => toast(errorText(e)));
          return next;
        });
      }
    })()
      .catch((e) => toast(errorText(e)))
      .finally(() => {
        translationBusy.current = false;
      });
  }, [
    Math.floor(time),
    cues,
    modelState,
    currentId,
    settings.subtitleMode,
    settings.subtitleOffset,
  ]);
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (videoStage.current?.requestFullscreen)
        await videoStage.current.requestFullscreen();
      else setFull(!full);
    } catch {
      setFull(!full);
    }
  }
  async function pip() {
    try {
      const e = media.current as HTMLVideoElement & {
        webkitSetPresentationMode?: (mode: string) => void;
      };
      if (document.pictureInPictureElement)
        await document.exitPictureInPicture();
      else if (e.requestPictureInPicture) await e.requestPictureInPicture();
      else if (e.webkitSetPresentationMode)
        e.webkitSetPresentationMode("picture-in-picture");
      else toast("Picture in Picture is unavailable on this device.");
    } catch (e) {
      toast(errorText(e));
    }
  }
  function setSleepMinutes(minutes: number) {
    clearTimeout(sleepTimer.current);
    setSleep(minutes);
    if (native) {
      void Native.sleep({ minutes }).catch((e) => toast(errorText(e)));
      return;
    }
    if (minutes)
      sleepTimer.current = setTimeout(() => {
        media.current?.pause();
        if (native) void Native.pause();
        setPlaying(false);
        setSleep(0);
      }, minutes * 60000);
  }
  async function addBookmark() {
    if (!current) return;
    const b: Bookmark = {
      id: newId(),
      track: current.id,
      time,
      note: note.trim() || "Bookmark",
    };
    try {
      await db.put("bookmarks", b.id, b);
      setBookmarks((items) => [...items, b]);
      setNote("");
      toast("Bookmark saved");
    } catch (e) {
      toast(errorText(e));
    }
  }
  async function makeSession() {
    if (!sessionName.trim()) return;
    const s: Session = {
      id: newId(),
      name: sessionName.trim(),
      tracks: queue,
    };
    await db.put("sessions", s.id, s);
    setSessions((items) => [...items, s]);
    setSessionName("");
    toast("Session saved");
  }
  const active = activeCues(cues, time + settings.subtitleOffset),
    upcoming = queue
      .map((id) => tracks.find((t) => t.id === id))
      .filter((t): t is Track => !!t);
  const filtered = useMemo(
    () =>
      tracks
        .filter(
          (t) =>
            (category === "videos"
              ? t.kind === "video"
              : category === "favorites"
                ? t.favorite
                : category === "recent"
                  ? true
                  : t.kind === "audio") &&
            (!group ||
              (category === "albums"
                ? t.album === group
                : t.artist === group)) &&
            `${t.title} ${t.artist} ${t.album}`
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
        .sort((a, b) =>
          category === "recent"
            ? b.added - a.added
            : a.title.localeCompare(b.title),
        ),
    [tracks, category, group, query],
  );
  const groups = [
    ...new Set(
      filtered.map((t) => (category === "albums" ? t.album : t.artist)),
    ),
  ];
  const MediaTag = current?.kind === "video" ? "video" : "audio";
  const controls = (
    <div className="transport">
      <IconButton
        icon={Shuffle}
        label="Shuffle"
        active={settings.shuffle}
        onClick={() => change({ shuffle: !settings.shuffle })}
      />
      <IconButton
        icon={SkipBack}
        label="Previous"
        onClick={() => step(-1)}
        disabled={!current}
      />
      <IconButton
        icon={playing ? Pause : Play}
        label={playing ? "Pause" : "Play"}
        className="play-button"
        onClick={() => void toggle()}
        disabled={!current}
      />
      <IconButton
        icon={SkipForward}
        label="Next"
        onClick={() => step(1)}
        disabled={!current}
      />
      <IconButton
        icon={settings.repeat === "one" ? Repeat1 : Repeat}
        label={`Repeat ${settings.repeat}`}
        active={settings.repeat !== "off"}
        onClick={() =>
          change({
            repeat:
              settings.repeat === "off"
                ? "all"
                : settings.repeat === "all"
                  ? "one"
                  : "off",
          })
        }
      />
    </div>
  );
  const timeline = (
    <div className="timeline">
      <input
        aria-label="Playback position"
        type="range"
        min="0"
        max={duration || 1}
        step="0.01"
        value={Math.min(time, duration || 1)}
        onChange={(e) => seek(+e.target.value)}
        style={
          {
            "--progress": `${duration ? (time / duration) * 100 : 0}%`,
          } as React.CSSProperties
        }
      />
      <div className="time-labels">
        <span>{formatTime(time)}</span>
        <span>−{formatTime(duration - time)}</span>
      </div>
    </div>
  );
  const volume = (
    <div className="volume">
      <IconButton
        icon={settings.muted || settings.volume === 0 ? VolumeX : Volume2}
        label={settings.muted ? "Unmute" : "Mute"}
        active={settings.muted}
        onClick={() => change({ muted: !settings.muted })}
      />
      <input
        aria-label="Volume"
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={settings.volume}
        onChange={(e) => change({ volume: +e.target.value })}
      />
      <span>{Math.round(settings.volume * 100)}%</span>
    </div>
  );
  return (
    <div className="app-shell">
      <input
        ref={fileInput}
        hidden
        type="file"
        accept="audio/*,video/*,.mkv,.flac,.opus"
        multiple
        onChange={(e) => e.target.files && void importFiles(e.target.files)}
      />
      <input
        ref={subtitleInput}
        hidden
        type="file"
        accept=".srt,.vtt,.ass,.ssa,.lrc"
        onChange={(e) =>
          e.target.files?.[0] && void readCaptions(e.target.files[0])
        }
      />
      <aside className="desktop-sidebar">
        <Brand />
        <p className="eyebrow">YOUR SPACE, IN HARMONY</p>
        {[
          { id: "now", icon: Music2, label: "Now Playing" },
          { id: "library", icon: Library, label: "Library" },
          { id: "subtitles", icon: Captions, label: "Persian Subtitles" },
          { id: "settings", icon: SlidersHorizontal, label: "Settings" },
        ].map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            className={tab === id ? "selected" : ""}
            onClick={() => setTab(id)}
          >
            <Icon size={19} />
            {label}
          </button>
        ))}
        <div className="sidebar-bottom">
          <span>
            <WifiOff size={16} />
            Made for offline moments
          </span>
          <small>Unison Player · 0.5.0</small>
        </div>
      </aside>
      <main>
        <header className="app-header">
          <Brand />
          <span className="connection">
            {online ? (
              <>
                <span />
                On device
              </>
            ) : (
              <>
                <WifiOff size={14} />
                Offline
              </>
            )}
          </span>
          <IconButton
            icon={busy ? LoaderCircle : Plus}
            label="Add media files"
            onClick={() => void addFiles()}
            disabled={busy}
          />
        </header>
        <section
          className={`page now-page ${tab !== "now" ? "page-hidden" : ""}`}
          aria-hidden={tab !== "now"}
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">A LITTLE SPACE FOR YOURSELF</p>
              <h1>Now Playing</h1>
            </div>
            <IconButton
              icon={MoreHorizontal}
              label="Playback tools"
              onClick={() => setSheet("tools")}
            />
          </div>
          <div
            ref={videoStage}
            className={`player-stage ${current?.kind === "video" ? "is-video" : ""} ${full ? "expanded" : ""}`}
          >
            <MediaTag
              ref={(node: HTMLVideoElement | HTMLAudioElement | null) => {
                media.current = node;
              }}
              src={!isNativeAudio.current ? source || undefined : undefined}
              playsInline
              preload="metadata"
              className={
                current?.kind === "video" ? "video-element" : "audio-element"
              }
              onPlay={() => setPlaying(true)}
              onPause={() => {
                if (!isNativeAudio.current) setPlaying(false);
              }}
              onTimeUpdate={() => {
                if (media.current && !isNativeAudio.current)
                  updatePosition(
                    media.current.currentTime,
                    media.current.duration || 0,
                  );
              }}
              onLoadedMetadata={() => {
                const e = media.current;
                if (e) {
                  setDuration(e.duration || 0);
                  e.currentTime = currentRef.current?.position || 0;
                  e.playbackRate = settingsRef.current.speed;
                  if (wantsPlay.current) {
                    wantsPlay.current = false;
                    void e
                      .play()
                      .catch(() => toast("Tap Play to start playback."));
                  }
                }
              }}
              onEnded={() => endedRef.current()}
              onError={() =>
                toast(
                  "This format could not be played. Try MP4/H.264 video or MP3/AAC audio.",
                )
              }
            />
            {current?.kind !== "video" && (
              <div className="album-stage">
                <div className="art-glow" />
                <Art track={current} large />
                {!current && (
                  <span className="empty-art-caption">
                    A little more in harmony.
                  </span>
                )}
              </div>
            )}
            {!!active.length && settings.subtitleMode !== "off" && (
              <div
                className={`caption-overlay ${current?.kind !== "video" ? "audio-captions" : ""}`}
                style={{ fontSize: settings.subtitleSize }}
              >
                {active.map((cue, i) => (
                  <div key={i}>
                    {settings.subtitleMode !== "persian" && (
                      <p className="original-caption">{cue.text}</p>
                    )}
                    {settings.subtitleMode !== "original" && (
                      <p className="persian-caption" dir="rtl">
                        {translations[cue.text] ||
                          (settings.subtitleMode === "persian" ? cue.text : "")}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
            {current?.kind === "video" && (
              <div className="video-actions">
                <IconButton
                  icon={Captions}
                  label="Subtitle settings"
                  onClick={() => {
                    setFull(false);
                    setTab("subtitles");
                  }}
                  active={settings.subtitleMode !== "off"}
                />
                <IconButton
                  icon={PictureInPicture2}
                  label="Picture in Picture"
                  onClick={() => void pip()}
                />
                <IconButton
                  icon={full ? Minimize : Maximize}
                  label={full ? "Exit fullscreen" : "Fullscreen"}
                  onClick={() => void fullscreen()}
                />
              </div>
            )}
            {full && (
              <div className="fullscreen-controls">
                {timeline}
                {controls}
                {volume}
              </div>
            )}
          </div>
          <div className="track-heading">
            <div>
              <h2>{current?.title || "Let’s play something"}</h2>
              <p>
                {current
                  ? `${current.artist} · ${current.album}`
                  : "Music, films, and words that feel closer."}
              </p>
            </div>
            <IconButton
              icon={Heart}
              label={
                current?.favorite ? "Remove from favorites" : "Add to favorites"
              }
              active={current?.favorite}
              disabled={!current}
              onClick={() => current && void favorite(current)}
            />
          </div>
          {!current && (
            <button
              className="primary import-first"
              onClick={() => void addFiles()}
              disabled={busy}
            >
              <FolderOpen size={19} />
              {busy ? "Adding files…" : "Choose your music or videos"}
            </button>
          )}
          {current && (
            <>
              {timeline}
              {controls}
              {volume}
            </>
          )}
          {current && (
            <div className="player-extras">
              <button
                onClick={() =>
                  change({
                    speed: settings.speed >= 2 ? 0.5 : settings.speed + 0.25,
                  })
                }
              >
                {settings.speed}× <span>Speed</span>
              </button>
              <button onClick={() => setSheet("timer")}>
                <Clock3 size={18} />
                <span>{sleep ? `${sleep} min` : "Sleep timer"}</span>
              </button>
              <button onClick={() => setSheet("queue")}>
                <ListMusic size={19} />
                <span>Up next</span>
                <b>{queue.length}</b>
              </button>
            </div>
          )}
          <div className="quiet-note">
            <WifiOff size={15} />
            <span>Your files stay yours. Your player stays with you.</span>
          </div>
        </section>
        {tab === "library" && (
          <section className="page library-page">
            <div className="section-heading">
              <div>
                <p className="eyebrow">EVERYTHING YOU LOVE</p>
                <h1>Your library</h1>
              </div>
              <button
                className="soft-button"
                onClick={() => void addFiles()}
                disabled={busy}
              >
                <Plus size={18} />
                Add files
              </button>
            </div>
            <label className="search">
              <Search size={19} />
              <input
                aria-label="Search library"
                placeholder="Songs, artists, albums…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <IconButton
                  icon={X}
                  label="Clear search"
                  onClick={() => setQuery("")}
                />
              )}
            </label>
            <div className="chips" aria-label="Library categories">
              {[
                "songs",
                "albums",
                "artists",
                "videos",
                "favorites",
                "recent",
                "sessions",
              ].map((item) => (
                <button
                  key={item}
                  className={category === item ? "selected" : ""}
                  onClick={() => {
                    setCategory(item);
                    setGroup("");
                  }}
                >
                  {item[0].toUpperCase() + item.slice(1)}
                </button>
              ))}
            </div>
            {group && (
              <button className="text-button" onClick={() => setGroup("")}>
                <ChevronLeft size={16} />
                {group}
              </button>
            )}
            {category === "sessions" ? (
              <>
                <div className="inline-form">
                  <input
                    aria-label="New session name"
                    placeholder="Name a session…"
                    value={sessionName}
                    onChange={(e) => setSessionName(e.target.value)}
                  />
                  <button
                    className="soft-button"
                    onClick={() =>
                      void makeSession().catch((e) => toast(errorText(e)))
                    }
                    disabled={!sessionName.trim()}
                  >
                    Save queue
                  </button>
                </div>
                {sessions.map((s) => (
                  <div className="session-card" key={s.id}>
                    <button
                      onClick={() => {
                        const t = tracks.find((t) => s.tracks.includes(t.id));
                        if (t) {
                          void choose(t, s.tracks);
                          setTab("now");
                        } else toast("This session has no available files.");
                      }}
                    >
                      <ListMusic />
                      <span>
                        <strong>{s.name}</strong>
                        <small>{s.tracks.length} files</small>
                      </span>
                      <Play size={20} />
                    </button>
                    <IconButton
                      icon={Trash2}
                      label={`Delete session ${s.name}`}
                      onClick={() =>
                        void db
                          .remove("sessions", s.id)
                          .then(() =>
                            setSessions((items) =>
                              items.filter((x) => x.id !== s.id),
                            ),
                          )
                          .catch((e) => toast(errorText(e)))
                      }
                    />
                  </div>
                ))}
              </>
            ) : (category === "albums" || category === "artists") && !group ? (
              <div className="album-grid">
                {groups.map((name) => (
                  <button
                    key={name}
                    className="album-card"
                    onClick={() => setGroup(name)}
                  >
                    <Art
                      track={filtered.find(
                        (t) =>
                          (category === "albums" ? t.album : t.artist) === name,
                      )}
                    />
                    <strong>{name}</strong>
                    <small>
                      {
                        filtered.filter(
                          (t) =>
                            (category === "albums" ? t.album : t.artist) ===
                            name,
                        ).length
                      }{" "}
                      tracks
                    </small>
                  </button>
                ))}
              </div>
            ) : (
              <>
                <div className="list-summary">
                  <span>
                    {filtered.length}{" "}
                    {category === "videos" ? "videos" : "tracks"}
                  </span>
                  {!!filtered.length && (
                    <button
                      className="text-button"
                      onClick={() => {
                        void choose(
                          filtered[0],
                          filtered.map((t) => t.id),
                        );
                        setTab("now");
                      }}
                    >
                      <Play size={15} />
                      Play all
                    </button>
                  )}
                </div>
                <div className="track-list">
                  {filtered.map((track) => (
                    <div
                      className={`track-row ${track.id === currentId ? "current" : ""}`}
                      key={track.id}
                    >
                      <button
                        className="track-main"
                        onClick={() => {
                          void choose(
                            track,
                            filtered.map((t) => t.id),
                          );
                          setTab("now");
                        }}
                      >
                        <Art track={track} />
                        <span>
                          <strong>{track.title}</strong>
                          <small>
                            {track.artist} · {formatTime(track.duration)}
                          </small>
                        </span>
                        {track.id === currentId && playing && (
                          <span className="playing-bars">
                            <i />
                            <i />
                            <i />
                          </span>
                        )}
                      </button>
                      <IconButton
                        icon={Heart}
                        label={`Favorite ${track.title}`}
                        active={track.favorite}
                        onClick={() => void favorite(track)}
                      />
                      <IconButton
                        icon={Trash2}
                        label={`Remove ${track.title}`}
                        onClick={() => setSheet(`delete:${track.id}`)}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
            {!tracks.length && (
              <div className="empty-state">
                <Library />
                <h2>A home for your collection</h2>
                <p>
                  Add the music and films already on your phone. They’ll be
                  here, even without a connection.
                </p>
                <button className="primary" onClick={() => void addFiles()}>
                  <Plus size={18} />
                  Add your first files
                </button>
              </div>
            )}
          </section>
        )}
        {tab === "subtitles" && (
          <section className="page subtitle-page">
            <div className="section-heading">
              <div>
                <p className="eyebrow">WORDS, A LITTLE CLOSER</p>
                <h1>Persian subtitles</h1>
              </div>
              <Captions className="heading-icon" />
            </div>
            <div className="feature-card">
              <span className="feature-symbol">
                <Sparkles />
              </span>
              <div>
                <h2>Understood. Even offline.</h2>
                <p>
                  English to Persian, on your device. The same translation
                  engine as Unison for desktop.
                </p>
              </div>
              <span
                className={`status-pill ${modelState === "ready" ? "ready" : ""}`}
              >
                {modelState === "ready" ? (
                  <Check size={14} />
                ) : (
                  <WifiOff size={14} />
                )}{" "}
                {modelState === "ready" ? "Ready offline" : "Private by design"}
              </span>
              <button
                className="primary"
                onClick={() => void prepare()}
                disabled={modelState === "loading"}
              >
                {modelState === "loading" ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <Download size={18} />
                )}{" "}
                {modelState === "loading"
                  ? `Preparing ${Math.round(modelProgress * 100)}%`
                  : modelState === "ready"
                    ? "Verify offline model"
                    : "Prepare offline translation · 22 MB"}
              </button>
            </div>
            <div className="settings-card">
              <div className="card-title">
                <Captions size={19} />
                <h2>
                  For this {current?.kind === "video" ? "video" : "track"}
                </h2>
              </div>
              <p className="muted">
                {current?.title ||
                  "Choose a song or video to attach subtitles."}
              </p>
              <button
                className="soft-button full-width"
                onClick={() => subtitleInput.current?.click()}
                disabled={!current}
              >
                <FolderOpen size={18} />
                Open subtitles or timed lyrics
              </button>
              <label className="field-label">Display</label>
              <div className="segmented">
                {(["off", "original", "bilingual", "persian"] as const).map(
                  (mode) => (
                    <button
                      key={mode}
                      className={
                        settings.subtitleMode === mode ? "selected" : ""
                      }
                      onClick={() => change({ subtitleMode: mode })}
                    >
                      {mode === "bilingual"
                        ? "Both"
                        : mode[0].toUpperCase() + mode.slice(1)}
                    </button>
                  ),
                )}
              </div>
              <label className="setting-row">
                <span>Text size</span>
                <input
                  aria-label="Subtitle text size"
                  type="range"
                  min="14"
                  max="32"
                  value={settings.subtitleSize}
                  onChange={(e) => change({ subtitleSize: +e.target.value })}
                />
                <small>{settings.subtitleSize}px</small>
              </label>
              <label className="setting-row">
                <span>Timing offset</span>
                <input
                  aria-label="Subtitle timing offset"
                  type="number"
                  min="-120"
                  max="120"
                  step="0.25"
                  value={settings.subtitleOffset}
                  onChange={(e) => change({ subtitleOffset: +e.target.value })}
                />
                <small>seconds</small>
              </label>
              <div className="subtitle-preview">
                <p>Some things sound better together.</p>
                <p dir="rtl">بعضی چیزها در کنار هم زیباترند.</p>
              </div>
            </div>
            {!!cues.length && (
              <div className="settings-card">
                <div className="card-title">
                  <FileText size={19} />
                  <h2>{cues.length} subtitle cues</h2>
                </div>
                <p className="muted">
                  Translate ahead to keep every Persian line ready during
                  playback.
                </p>
                <button
                  className="primary full-width"
                  onClick={() => void translateAll()}
                >
                  <Sparkles size={18} />
                  Translate this subtitle
                </button>
                {translateCount > 0 && (
                  <p className="muted">
                    {translateCount} / {cues.length} translated
                  </p>
                )}
                <div className="button-pair">
                  <button
                    className="soft-button"
                    onClick={() => {
                      generation.current++;
                      toast("Translation paused. Completed lines are saved.");
                    }}
                  >
                    Pause translation
                  </button>
                  <button
                    className="soft-button"
                    onClick={() =>
                      download(
                        exportSrt(cues, translations),
                        `${current?.title || "subtitles"}.fa.srt`,
                      )
                    }
                  >
                    <Download size={16} />
                    Export SRT
                  </button>
                </div>
                <div className="cue-list">
                  {cues.slice(0, 300).map((cue, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        seek(cue.start);
                        setTab("now");
                      }}
                    >
                      <small>{formatTime(cue.start)}</small>
                      <span>
                        {cue.text}
                        {translations[cue.text] && (
                          <em dir="rtl">{translations[cue.text]}</em>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <p className="footnote">
              Translation supports English → Persian. Import Persian subtitles
              directly for other languages. No audio transcription or online
              translation is used.
            </p>
          </section>
        )}
        {tab === "settings" && (
          <section className="page settings-page">
            <div className="section-heading">
              <div>
                <p className="eyebrow">MAKE IT FEEL LIKE YOU</p>
                <h1>Settings</h1>
              </div>
              <SlidersHorizontal className="heading-icon" />
            </div>
            <div className="settings-card">
              <div className="card-title">
                <Moon size={19} />
                <h2>Appearance</h2>
              </div>
              <div className="segmented">
                {(["dark", "light", "system"] as const).map((theme) => (
                  <button
                    key={theme}
                    className={settings.theme === theme ? "selected" : ""}
                    onClick={() => change({ theme })}
                  >
                    {theme[0].toUpperCase() + theme.slice(1)}
                  </button>
                ))}
              </div>
              <label className="field-label">Accent</label>
              <div className="accent-options">
                {["#b6c4e6", "#d5b8e8", "#e6b6c7", "#a9d5c9", "#e2c5a0"].map(
                  (accent) => (
                    <button
                      key={accent}
                      aria-label={`Accent ${accent}`}
                      style={{ background: accent }}
                      onClick={() => change({ accent })}
                    >
                      {accent === settings.accent && <Check size={17} />}
                    </button>
                  ),
                )}
              </div>
            </div>
            <div className="settings-card">
              <div className="card-title">
                <SlidersHorizontal size={19} />
                <h2>Equalizer</h2>
                <button
                  className={`toggle ${settings.eq ? "on" : ""}`}
                  role="switch"
                  aria-checked={settings.eq}
                  aria-label="Equalizer enabled"
                  onClick={() => {
                    if (!native && media.current)
                      void equalizer
                        .connect(media.current)
                        .then(() => change({ eq: !settings.eq }))
                        .catch((e) => toast(errorText(e)));
                    else change({ eq: !settings.eq });
                  }}
                >
                  <span />
                </button>
              </div>
              <div className="chips">
                {Object.keys(PRESETS).map((preset) => (
                  <button
                    key={preset}
                    onClick={() => {
                      if (!native && media.current)
                        void equalizer
                          .connect(media.current)
                          .then(() =>
                            change({ gains: PRESETS[preset], eq: true }),
                          )
                          .catch((e) => toast(errorText(e)));
                      else change({ gains: PRESETS[preset], eq: true });
                    }}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <div className="equalizer">
                {BANDS.map((frequency, i) => (
                  <label key={frequency}>
                    <small>
                      {settings.gains[i] > 0 ? "+" : ""}
                      {settings.gains[i]}
                    </small>
                    <input
                      aria-label={`Equalizer ${frequency} Hz`}
                      type="range"
                      min="-12"
                      max="12"
                      step="0.5"
                      value={settings.gains[i]}
                      onChange={(e) =>
                        change({
                          gains: settings.gains.map((g, n) =>
                            n === i ? +e.target.value : g,
                          ),
                        })
                      }
                    />
                    <span>
                      {frequency >= 1000 ? `${frequency / 1000}k` : frequency}
                    </span>
                  </label>
                ))}
              </div>
              <p className="footnote">
                {native
                  ? "Native equalization applies during music playback."
                  : "The equalizer connects to your audio engine on first use."}
              </p>
            </div>
            <div className="settings-card">
              <div className="card-title">
                <Smartphone size={19} />
                <h2>{native ? "On your Android" : "Install on your iPhone"}</h2>
              </div>
              <p className="muted">
                {native
                  ? "Music continues when the screen locks. Removing Unison from recent apps stops playback."
                  : "Open this page in Safari, tap Share, then Add to Home Screen. Open it once online and prepare the translation model before going offline."}
              </p>
              <button
                className="soft-button"
                onClick={() =>
                  void navigator.storage
                    ?.persist?.()
                    .then((allowed) =>
                      toast(
                        allowed
                          ? "Persistent storage enabled."
                          : "Storage is managed by your browser. Keep backups of your files.",
                      ),
                    )
                }
              >
                <Download size={17} />
                Keep offline files
              </button>
              <p className="footnote">
                On iPhone, storage and background playback follow Safari’s
                rules. MP4/H.264 and MP3/AAC are the most portable formats.
              </p>
            </div>
            <div className="about-card">
              <Brand />
              <p>Music, films, and a world of understanding.</p>
              <small>Version 0.5.0 · Mobile preview</small>
              <button
                className="text-button"
                onClick={() => {
                  setSheet("legal");
                  void fetch(new URL("licenses/NOTICE.txt", document.baseURI))
                    .then((r) => {
                      if (!r.ok) throw Error("Could not load notices");
                      return r.text();
                    })
                    .then(setLegalText)
                    .catch((e) => toast(errorText(e)));
                }}
              >
                Licenses &amp; notices
              </button>
              <a
                href="https://github.com/Nahur1/unison"
                target="_blank"
                rel="noreferrer"
              >
                Made by Nahur1 & Reza Hashemian <ArrowUpRight size={14} />
              </a>
            </div>
            <button
              className="danger-button"
              onClick={() => {
                media.current?.pause();
                if (native) void Native.close();
                else {
                  setPlaying(false);
                  toast("Playback stopped. You can close this app.");
                }
              }}
            >
              Stop playback{native ? " and close" : ""}
            </button>
          </section>
        )}
      </main>
      {tab !== "now" && current && (
        <div className="mini-player">
          <button className="mini-info" onClick={() => setTab("now")}>
            <Art track={current} />
            <span>
              <strong>{current.title}</strong>
              <small>{current.artist}</small>
            </span>
          </button>
          <IconButton
            icon={playing ? Pause : Play}
            label={playing ? "Pause" : "Play"}
            onClick={() => void toggle()}
          />
          <span
            className="mini-line"
            style={{ width: `${duration ? (time / duration) * 100 : 0}%` }}
          />
        </div>
      )}
      <nav className="bottom-nav" aria-label="Main navigation">
        {[
          { id: "now", icon: Music2, label: "Playing" },
          { id: "library", icon: Library, label: "Library" },
          { id: "subtitles", icon: Captions, label: "Subtitles" },
          { id: "settings", icon: SlidersHorizontal, label: "Settings" },
        ].map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            aria-current={tab === id ? "page" : undefined}
            className={tab === id ? "selected" : ""}
            onClick={() => setTab(id)}
          >
            <Icon size={22} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <IconButton
            icon={X}
            label="Dismiss notice"
            onClick={() => setNotice("")}
          />
        </div>
      )}
      {sheet && (
        <div className="sheet-backdrop" onClick={() => setSheet("")}>
          <section
            className="bottom-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={sheet.startsWith("delete:") ? "Remove file" : sheet}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sheet-handle" />
            <div className="card-title">
              <h2>
                {sheet === "queue"
                  ? "Up next"
                  : sheet === "timer"
                    ? "Sleep timer"
                    : sheet.startsWith("delete:")
                      ? "Remove from library?"
                      : sheet === "legal"
                        ? "Licenses & notices"
                        : "Playback tools"}
              </h2>
              <IconButton
                icon={X}
                label="Close sheet"
                onClick={() => setSheet("")}
              />
            </div>
            {sheet === "legal" && (
              <pre className="legal-copy">
                {legalText || "Loading bundled notices…"}
              </pre>
            )}
            {sheet === "queue" && (
              <>
                {upcoming.length ? (
                  upcoming.map((track) => (
                    <button
                      className="queue-row"
                      key={track.id}
                      onClick={() => {
                        void choose(track);
                        setSheet("");
                        setTab("now");
                      }}
                    >
                      <Art track={track} />
                      <span>
                        <strong>{track.title}</strong>
                        <small>{track.artist}</small>
                      </span>
                      {track.id === currentId && <Music2 size={18} />}
                    </button>
                  ))
                ) : (
                  <p className="muted">
                    Add music or videos to start your queue.
                  </p>
                )}
                <button
                  className="soft-button full-width"
                  onClick={() => {
                    setSessionName("");
                    setCategory("sessions");
                    setTab("library");
                    setSheet("");
                  }}
                >
                  Save as a session
                </button>
              </>
            )}
            {sheet === "timer" && (
              <div className="timer-grid">
                {[0, 15, 30, 45, 60, 90].map((minutes) => (
                  <button
                    key={minutes}
                    className={sleep === minutes ? "selected" : ""}
                    onClick={() => {
                      setSleepMinutes(minutes);
                      setSheet("");
                    }}
                  >
                    {minutes ? `${minutes} min` : "Off"}
                  </button>
                ))}
              </div>
            )}
            {sheet.startsWith("delete:") && (
              <>
                <p className="muted">
                  This removes Unison’s saved entry. Your original file is
                  untouched.
                </p>
                <button
                  className="danger-button"
                  onClick={() => {
                    const track = tracks.find((t) => t.id === sheet.slice(7));
                    if (track) void deleteTrack(track);
                    setSheet("");
                  }}
                >
                  Remove file
                </button>
              </>
            )}
            {sheet === "tools" && (
              <>
                <button
                  className="tool-row"
                  onClick={() => subtitleInput.current?.click()}
                >
                  <FileText />
                  Import timed lyrics or subtitles
                </button>
                <button
                  className="tool-row"
                  disabled={!current}
                  onClick={() => {
                    if (loop && loop[1] === undefined && time <= loop[0]) {
                      toast("Set B after A.");
                      return;
                    }
                    setLoop(
                      loop
                        ? loop[1] === undefined
                          ? [loop[0], time]
                          : null
                        : [time],
                    );
                    toast(
                      loop
                        ? loop[1] === undefined
                          ? "B set — loop enabled"
                          : "Loop cleared"
                        : "A set — tap again to set B",
                    );
                  }}
                >
                  <Repeat />
                  A–B loop{" "}
                  <small>
                    {loop
                      ? `${formatTime(loop[0])} → ${loop[1] === undefined ? "…" : formatTime(loop[1])}`
                      : "Off"}
                  </small>
                </button>
                <div className="inline-form">
                  <input
                    placeholder="Bookmark note…"
                    aria-label="Bookmark note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <IconButton
                    icon={BookmarkPlus}
                    label="Add bookmark"
                    onClick={() => void addBookmark()}
                    disabled={!current}
                  />
                </div>
                {bookmarks
                  .filter((b) => b.track === currentId)
                  .map((b) => (
                    <div className="bookmark-row" key={b.id}>
                      <button
                        onClick={() => {
                          seek(b.time);
                          setSheet("");
                        }}
                      >
                        <small>{formatTime(b.time)}</small>
                        {b.note}
                      </button>
                      <IconButton
                        icon={Trash2}
                        label="Delete bookmark"
                        onClick={() =>
                          void db
                            .remove("bookmarks", b.id)
                            .then(() =>
                              setBookmarks((bs) =>
                                bs.filter((x) => x.id !== b.id),
                              ),
                            )
                            .catch((e) => toast(errorText(e)))
                        }
                      />
                    </div>
                  ))}
                <button
                  className="soft-button full-width"
                  onClick={() =>
                    download(
                      bookmarks
                        .filter((b) => b.track === currentId)
                        .map((b) => `- ${formatTime(b.time)} ${b.note}`)
                        .join("\n"),
                      `${current?.title || "unison"}.notes.md`,
                    )
                  }
                >
                  <Download size={17} />
                  Export notes
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
