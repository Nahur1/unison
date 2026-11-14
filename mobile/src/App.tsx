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
  Folder as FolderIcon,
  FolderPlus,
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
  Folder,
} from "./types";
import { defaultSettings, BANDS, PRESETS } from "./types";
import * as db from "./storage";
import {
  activeCues,
  bestEmbeddedTrack,
  decodeSubtitle,
  exportSrt,
  formatTime,
  mediaBaseName,
  parseCaptionFile,
} from "./subtitles";
import { OfflineTranslator } from "./translation";
import { Equalizer } from "./equalizer";
import { Native, native, nativeUrl, type NativeSubtitleFile } from "./native";
import { parseBlob } from "music-metadata";
const translator = new OfflineTranslator(),
  equalizer = new Equalizer();
// crypto.randomUUID needs WebView 92; Android 7-10 phones can be older.
function sortFolders(items: Folder[]) {
  return [...items].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}
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
    [folders, setFolders] = useState<Folder[]>([]),
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
    [folderName, setFolderName] = useState(""),
    [selecting, setSelecting] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
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
    scanEmbeddedRef = useRef((_track: Track, _quiet?: boolean) =>
      Promise.resolve(),
    ),
    generation = useRef(0),
    saveAt = useRef(0),
    sleepTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    isNativeAudio = useRef(false),
    sourceUrl = useRef(""),
    wantsPlay = useRef(false),
    translationBusy = useRef(false),
    importInto = useRef(""),
    foldersRef = useRef<Folder[]>([]),
    scanning = useRef(new Set<string>()),
    chromeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [chrome, setChrome] = useState(true),
    [pipMode, setPipMode] = useState(false);
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
  foldersRef.current = folders;
  const toast = useCallback((text: string) => setNotice(text), []);
  useEffect(() => {
    Promise.all([
      db.getAll<Track>("tracks"),
      db.get<Settings>("settings", "player"),
      db.getAll<Session>("sessions"),
      db.getAll<Bookmark>("bookmarks"),
      db.get<string>("settings", "current"),
      db.get<string[]>("settings", "queue"),
      db.getAll<Folder>("folders"),
    ])
      .then(([items, s, p, b, id, q, f]) => {
        setFolders(sortFolders(f));
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
        } else if (!captions && !track.scanned)
          void scanEmbeddedRef.current(track, true);
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
  const showChrome = useCallback(() => {
    setChrome(true);
    clearTimeout(chromeTimer.current);
    chromeTimer.current = setTimeout(() => {
      if (!media.current?.paused) setChrome(false);
    }, 3000);
  }, []);
  useEffect(() => {
    // Fullscreen controls fade away while a video plays so they never sit on
    // the subtitles; a touch brings them back for three seconds.
    if (!full || !playing) {
      clearTimeout(chromeTimer.current);
      setChrome(true);
    } else showChrome();
    return () => clearTimeout(chromeTimer.current);
  }, [full, playing, showChrome]);
  useEffect(() => {
    if (!native) return;
    const handle = Native.addListener("pip", ({ active }) => {
      setPipMode(active);
      document.documentElement.classList.toggle("pip-mode", active);
    });
    return () => {
      void handle.then((h) => h.remove());
    };
  }, []);
  useEffect(() => {
    if (!native) return;
    const v = media.current as HTMLVideoElement | null;
    void Native.setAutoPictureInPicture({
      enabled: playing && current?.kind === "video",
      width: v?.videoWidth || 16,
      height: v?.videoHeight || 9,
    }).catch(() => {});
  }, [playing, current?.kind]);
  useEffect(() => {
    // Never keep a hidden page fullscreen, whatever changed the tab.
    if (tab !== "now" && document.fullscreenElement)
      void document.exitFullscreen().catch(() => {});
    if (tab !== "now") setFull(false);
  }, [tab]);
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
    const ids: string[] = [];
    try {
      const next = [...tracksRef.current];
      for (const file of Array.from(files)) {
        if (
          !/\.(mp3|m4a|aac|wav|ogg|opus|flac|mp4|m4v|mov|webm|mkv)$/i.test(
            file.name,
          )
        )
          continue;
        const known = next.find(
          (t) => t.name === file.name && t.size === file.size,
        );
        if (known) {
          ids.push(known.id);
          continue;
        }
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
        ids.push(track.id);
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
    const folder = importInto.current;
    importInto.current = "";
    if (folder && ids.length) await addToFolder(folder, ids);
  }
  /** Pick files on the device straight into a folder. */
  function addFilesTo(folderId: string) {
    importInto.current = folderId;
    void addFiles();
  }
  async function addFiles() {
    if (!native) {
      fileInput.current?.click();
      return;
    }
    setBusy(true);
    try {
      const result = await Native.pickFiles(),
        next = [...tracksRef.current],
        added: Track[] = [];
      const ids: string[] = [];
      for (const file of result.files) {
        const known = next.find(
          (t) => t.name === file.name && t.size === file.size,
        );
        if (known) {
          await Native.removeFile({ path: file.path });
          ids.push(known.id);
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
        added.push(track);
        ids.push(track.id);
      }
      setTracks(next);
      tracksRef.current = next;
      setQueue(next.map((t) => t.id));
      const subtitles = result.subtitles || [];
      let attached = 0;
      for (const file of subtitles) {
        const base = mediaBaseName(file.name),
          videos = next.filter((t) => t.kind === "video"),
          target =
            videos.find((t) => mediaBaseName(t.name) === base) ||
            (added.filter((t) => t.kind === "video").length === 1
              ? added.find((t) => t.kind === "video")
              : !added.length
                ? currentRef.current
                : undefined);
        if (!target) continue;
        try {
          await attachCaptions(target.id, nativeCaptions(file), file.name);
          attached++;
        } catch (e) {
          toast(errorText(e));
        }
      }
      toast(
        (result.files.length || !attached
          ? `${result.files.length} files selected`
          : "Subtitles") +
          (attached ? ` · ${attached} subtitle files attached` : "") +
          (subtitles.length > attached
            ? ` · ${subtitles.length - attached} subtitle files had no matching video`
            : ""),
      );
      for (const t of added) if (t.kind === "video") void scanEmbedded(t, true);
      const folder = importInto.current;
      importInto.current = "";
      if (folder && ids.length) await addToFolder(folder, ids);
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
      for (const f of foldersRef.current)
        if (f.tracks.includes(track.id))
          await saveFolder({
            ...f,
            tracks: f.tracks.filter((id) => id !== track.id),
          });
      setTracks((ts) => ts.filter((t) => t.id !== track.id));
      setQueue((q) => q.filter((id) => id !== track.id));
      toast("Removed from your Unison library.");
    } catch (e) {
      toast(errorText(e));
    }
  }
  async function attachCaptions(id: string, parsed: Cue[], label: string) {
    if (!parsed.length) throw Error(`No timed subtitles found in ${label}.`);
    await db.put("captions", id, { cues: parsed, translations: {} });
    if (currentRef.current?.id === id) {
      generation.current++;
      setCues(parsed);
      setTranslations({});
    }
  }
  async function readCaptions(file: File) {
    if (!current) {
      toast("Choose a song or video first.");
      return;
    }
    try {
      const parsed = parseCaptionFile(
        file.name,
        decodeSubtitle(new Uint8Array(await file.arrayBuffer())),
        duration,
      );
      await attachCaptions(current.id, parsed, file.name);
      toast(`${parsed.length} cues loaded`);
    } catch (e) {
      toast(errorText(e));
    } finally {
      if (subtitleInput.current) subtitleInput.current.value = "";
    }
  }
  function nativeCaptions(file: NativeSubtitleFile) {
    const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
    return parseCaptionFile(file.name, decodeSubtitle(bytes), duration);
  }
  async function chooseSubtitleFile() {
    if (!native) {
      subtitleInput.current?.click();
      return;
    }
    // Android's picker cannot filter by .srt (it has no registered MIME type),
    // so the native picker lists every file and the name decides.
    const track = currentRef.current;
    if (!track) {
      toast("Choose a song or video first.");
      return;
    }
    try {
      const result = await Native.pickSubtitles();
      for (const f of result.files)
        await Native.removeFile({ path: f.path }).catch(() => {});
      const file = result.subtitles?.[0];
      if (!file) {
        if (result.files.length)
          toast("Choose a subtitle file: SRT, VTT, ASS, SSA or LRC.");
        return;
      }
      const parsed = nativeCaptions(file);
      await attachCaptions(track.id, parsed, file.name);
      toast(`${parsed.length} cues loaded`);
    } catch (e) {
      toast(errorText(e));
    }
  }
  scanEmbeddedRef.current = (track, quiet) => scanEmbedded(track, quiet);
  async function scanEmbedded(track: Track, quiet = false) {
    if (!native || track.kind !== "video" || !track.nativePath) return;
    if (scanning.current.has(track.id)) return;
    scanning.current.add(track.id);
    try {
      const { tracks: found } = await Native.extractSubtitles({
        path: track.nativePath,
      });
      const latest = tracksRef.current.find((t) => t.id === track.id);
      if (latest) await persistTrack({ ...latest, scanned: true });
      const best = bestEmbeddedTrack(found);
      if (!best || (await db.get<CaptionFile>("captions", track.id))) return;
      await attachCaptions(track.id, best.cues, track.name);
      if (!quiet || currentRef.current?.id === track.id)
        toast(
          `${best.cues.length} subtitles found inside ${track.title}` +
            (found.length > 1 ? ` (${found.length} tracks)` : ""),
        );
    } catch (e) {
      if (!quiet) toast(errorText(e));
    } finally {
      scanning.current.delete(track.id);
    }
  }
  async function prepare(quiet = false) {
    setModelState("loading");
    translator.onProgress = setModelProgress;
    await navigator.storage?.persist?.();
    try {
      await translator.prepare();
      setModelState("ready");
      if (!quiet) toast("Persian translation is ready on this device.");
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
    // Live translation starts by itself, like on the desktop: the model ships
    // with the app, so no button press or connection is needed.
    if (
      modelState === "idle" &&
      cues.length &&
      !["off", "original"].includes(settings.subtitleMode)
    )
      void prepare(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelState, cues, settings.subtitleMode]);
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
  async function leaveFullscreen() {
    setFull(false);
    if (document.fullscreenElement)
      await document.exitFullscreen().catch(() => {});
  }
  async function openSubtitles() {
    // The stage is the fullscreen element: hiding its page while it is still
    // fullscreen leaves an empty layer above the app that swallows every touch.
    await leaveFullscreen();
    setTab("subtitles");
  }
  async function pip() {
    try {
      const e = media.current as HTMLVideoElement & {
        webkitSetPresentationMode?: (mode: string) => void;
      };
      if (native) {
        // The Android WebView has no web Picture in Picture; the whole
        // activity shrinks instead and the stage fills the small window.
        const v = media.current as HTMLVideoElement | null;
        await Native.pictureInPicture({
          width: v?.videoWidth || 16,
          height: v?.videoHeight || 9,
        });
        return;
      }
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
  // ---------- folders made in Unison ----------
  async function saveFolder(folder: Folder) {
    await db.put("folders", folder.id, folder);
    setFolders((items) =>
      sortFolders([...items.filter((f) => f.id !== folder.id), folder]),
    );
  }
  /** A new folder, or the one with that name already (any letter case). */
  async function createFolder(name: string, ids: string[] = []) {
    const clean = name.trim();
    if (!clean) return;
    const same = foldersRef.current.find(
      (f) => f.name.toLowerCase() === clean.toLowerCase(),
    );
    try {
      if (same) {
        if (ids.length) await addToFolder(same.id, ids);
        else toast(`There is already a folder called “${same.name}”`);
        return same.id;
      }
      const folder: Folder = { id: newId(), name: clean, tracks: [] };
      await saveFolder(folder);
      foldersRef.current = [...foldersRef.current, folder];
      if (ids.length) await addToFolder(folder.id, ids);
      else toast(`Folder “${clean}” created`);
      return folder.id;
    } catch (e) {
      toast(errorText(e));
    }
  }
  async function addToFolder(folderId: string, ids: string[]) {
    const folder = foldersRef.current.find((f) => f.id === folderId);
    if (!folder) return;
    const fresh = ids.filter(
      (id, i) => !folder.tracks.includes(id) && ids.indexOf(id) === i,
    );
    try {
      if (fresh.length)
        await saveFolder({ ...folder, tracks: [...folder.tracks, ...fresh] });
      toast(
        !fresh.length
          ? `Already in “${folder.name}”`
          : fresh.length < ids.length
            ? `Added ${fresh.length} to “${folder.name}” (${ids.length - fresh.length} were already there)`
            : `Added ${fresh.length} to “${folder.name}”`,
      );
    } catch (e) {
      toast(errorText(e));
    }
  }
  async function removeFromFolder(folderId: string, ids: string[]) {
    const folder = foldersRef.current.find((f) => f.id === folderId);
    if (!folder) return;
    try {
      await saveFolder({
        ...folder,
        tracks: folder.tracks.filter((id) => !ids.includes(id)),
      });
      toast(
        ids.length === 1
          ? "Removed from the folder (the file stays in your library)"
          : `Removed ${ids.length} from the folder (the files stay in your library)`,
      );
    } catch (e) {
      toast(errorText(e));
    }
  }
  async function deleteFolder(folder: Folder) {
    try {
      await db.remove("folders", folder.id);
      setFolders((items) => items.filter((f) => f.id !== folder.id));
      if (group === folder.id) setGroup("");
      toast(`Deleted “${folder.name}” (the files stay in your library)`);
    } catch (e) {
      toast(errorText(e));
    }
  }
  function endSelection() {
    setSelecting(false);
    setSelected([]);
  }
  function toggleSelected(id: string) {
    setSelected((items) =>
      items.includes(id) ? items.filter((x) => x !== id) : [...items, id],
    );
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
  // A folder made in Unison, when one is open: its tracks in the order added.
  const openFolder =
    category === "folders" && group
      ? folders.find((f) => f.id === group)
      : undefined;
  const listed = openFolder
    ? openFolder.tracks
        .map((id) => tracks.find((t) => t.id === id))
        .filter(
          (t): t is Track =>
            !!t &&
            `${t.title} ${t.artist} ${t.album}`
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
    : filtered;
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
          <small>Unison Player · 0.5.2</small>
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
            className={`player-stage ${current?.kind === "video" ? "is-video" : ""} ${full ? "expanded" : ""} ${(full && !chrome) || pipMode ? "chrome-hidden" : ""}`}
            onPointerDown={(e) => {
              if (!full) return;
              const target = e.target as HTMLElement;
              const onControl = !!target.closest(
                ".fullscreen-controls, .video-actions",
              );
              if (onControl || !chrome) showChrome();
              else if (playing) {
                clearTimeout(chromeTimer.current);
                setChrome(false);
              }
            }}
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
                  onClick={() => void openSubtitles()}
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
                "folders",
                "recent",
                "sessions",
              ].map((item) => (
                <button
                  key={item}
                  className={category === item ? "selected" : ""}
                  onClick={() => {
                    setCategory(item);
                    setGroup("");
                    endSelection();
                  }}
                >
                  {item[0].toUpperCase() + item.slice(1)}
                </button>
              ))}
            </div>
            {group && (
              <button
                className="text-button"
                onClick={() => {
                  setGroup("");
                  endSelection();
                }}
              >
                <ChevronLeft size={16} />
                {openFolder ? "Folders" : group}
              </button>
            )}
            {category === "folders" && !group ? (
              <>
                <div className="inline-form">
                  <input
                    aria-label="New folder name"
                    placeholder="Name a folder: Relax, Pop…"
                    value={folderName}
                    onChange={(e) => setFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && folderName.trim()) {
                        void createFolder(folderName);
                        setFolderName("");
                      }
                    }}
                  />
                  <button
                    className="soft-button"
                    onClick={() => {
                      void createFolder(folderName);
                      setFolderName("");
                    }}
                    disabled={!folderName.trim()}
                  >
                    <FolderPlus size={18} />
                    Create
                  </button>
                </div>
                {!folders.length && (
                  <p className="muted-note">
                    Make folders for your songs and videos, then add files one
                    by one or all at once with Select.
                  </p>
                )}
                {folders.map((f) => (
                  <div className="session-card" key={f.id}>
                    <button
                      onClick={() => {
                        setGroup(f.id);
                        endSelection();
                      }}
                    >
                      <FolderIcon />
                      <span>
                        <strong>{f.name}</strong>
                        <small>
                          {f.tracks.length === 1
                            ? "1 file"
                            : `${f.tracks.length} files`}
                        </small>
                      </span>
                      <ChevronLeft size={20} className="flip" />
                    </button>
                    <IconButton
                      icon={Trash2}
                      label={`Delete folder ${f.name}`}
                      onClick={() => void deleteFolder(f)}
                    />
                  </div>
                ))}
              </>
            ) : category === "sessions" ? (
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
                {openFolder && (
                  <div className="folder-heading">
                    <h2>{openFolder.name}</h2>
                    <button
                      className="soft-button"
                      onClick={() => addFilesTo(openFolder.id)}
                      disabled={busy}
                    >
                      <Plus size={18} />
                      Add files
                    </button>
                  </div>
                )}
                {selecting ? (
                  <div className="select-bar" role="toolbar">
                    <button
                      className="text-button"
                      onClick={() =>
                        setSelected(
                          selected.length === listed.length
                            ? []
                            : listed.map((t) => t.id),
                        )
                      }
                    >
                      {selected.length === listed.length
                        ? "Clear"
                        : "Select all"}
                    </button>
                    <button
                      className="soft-button"
                      disabled={!selected.length}
                      onClick={() => setSheet("folders")}
                    >
                      <FolderPlus size={17} />
                      Add {selected.length || ""} to folder
                    </button>
                    {openFolder && (
                      <button
                        className="text-button"
                        disabled={!selected.length}
                        onClick={() => {
                          void removeFromFolder(openFolder.id, selected);
                          endSelection();
                        }}
                      >
                        Remove
                      </button>
                    )}
                    <button className="text-button" onClick={endSelection}>
                      Done
                    </button>
                  </div>
                ) : (
                  <div className="list-summary">
                    <span>
                      {listed.length}{" "}
                      {category === "videos"
                        ? "videos"
                        : openFolder
                          ? "files"
                          : "tracks"}
                    </span>
                    {!!listed.length && (
                      <button
                        className="text-button"
                        onClick={() => setSelecting(true)}
                      >
                        <Check size={15} />
                        Select
                      </button>
                    )}
                    {!!listed.length && (
                      <button
                        className="text-button"
                        onClick={() => {
                          void choose(
                            listed[0],
                            listed.map((t) => t.id),
                          );
                          setTab("now");
                        }}
                      >
                        <Play size={15} />
                        Play all
                      </button>
                    )}
                  </div>
                )}
                {openFolder && !listed.length && (
                  <p className="muted-note">
                    Empty. Tap Add files, or use Select in Songs or Videos.
                  </p>
                )}
                <div className="track-list">
                  {listed.map((track) => (
                    <div
                      className={`track-row ${track.id === currentId ? "current" : ""} ${selected.includes(track.id) ? "selected" : ""}`}
                      key={track.id}
                    >
                      <button
                        className="track-main"
                        aria-pressed={
                          selecting ? selected.includes(track.id) : undefined
                        }
                        onClick={() => {
                          if (selecting) {
                            toggleSelected(track.id);
                            return;
                          }
                          void choose(
                            track,
                            listed.map((t) => t.id),
                          );
                          setTab("now");
                        }}
                      >
                        {selecting && (
                          <span
                            className={`check-box ${selected.includes(track.id) ? "on" : ""}`}
                            aria-hidden="true"
                          >
                            {selected.includes(track.id) && <Check size={15} />}
                          </span>
                        )}
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
                      {openFolder ? (
                        <IconButton
                          icon={X}
                          label={`Remove ${track.title} from ${openFolder.name}`}
                          onClick={() =>
                            void removeFromFolder(openFolder.id, [track.id])
                          }
                        />
                      ) : (
                        <IconButton
                          icon={Trash2}
                          label={`Remove ${track.title}`}
                          onClick={() => setSheet(`delete:${track.id}`)}
                        />
                      )}
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
                onClick={() => void chooseSubtitleFile()}
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
              <small>Version 0.5.2 · Mobile preview</small>
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
                      : sheet === "folders"
                        ? `Add ${selected.length} to a folder`
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
            {sheet === "folders" && (
              <>
                {folders.map((f) => (
                  <button
                    className="queue-row"
                    key={f.id}
                    onClick={() => {
                      void addToFolder(f.id, selected);
                      setSheet("");
                      endSelection();
                    }}
                  >
                    <span className="folder-symbol">
                      <FolderIcon size={20} />
                    </span>
                    <span>
                      <strong>{f.name}</strong>
                      <small>{f.tracks.length} files</small>
                    </span>
                  </button>
                ))}
                <div className="inline-form">
                  <input
                    aria-label="New folder name"
                    placeholder="New folder…"
                    value={folderName}
                    onChange={(e) => setFolderName(e.target.value)}
                  />
                  <button
                    className="soft-button"
                    disabled={!folderName.trim()}
                    onClick={() => {
                      void createFolder(folderName, selected);
                      setFolderName("");
                      setSheet("");
                      endSelection();
                    }}
                  >
                    <FolderPlus size={18} />
                    Create
                  </button>
                </div>
              </>
            )}
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
                  onClick={() => void chooseSubtitleFile()}
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
