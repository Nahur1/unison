// Store media as bounded byte chunks: no giant base64 strings or IndexedDB File clones.
const database = new Promise<IDBDatabase>((resolve, reject) => {
  const r = indexedDB.open("unison", 3);
  r.onupgradeneeded = () => {
    for (const name of [
      "tracks",
      "settings",
      "sessions",
      "bookmarks",
      "captions",
      "media",
      "folders",
    ])
      if (!r.result.objectStoreNames.contains(name))
        r.result.createObjectStore(name);
  };
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
async function read<T>(store: string, key?: string): Promise<T> {
  const db = await database;
  return new Promise((resolve, reject) => {
    const r =
      key === undefined
        ? db.transaction(store).objectStore(store).getAll()
        : db.transaction(store).objectStore(store).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error("Local storage read failed"));
  });
}
async function write(store: string, key: string, value: unknown) {
  const db = await database;
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite"),
      r = tx.objectStore(store).put(value, key);
    r.onerror = () => reject(r.error || new Error("Could not store this file"));
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(
        tx.error ||
          r.error ||
          new Error("Local storage transaction was aborted"),
      );
  });
}
type Stored = {
  blob?: Blob;
  artwork?: Blob | { bytes: ArrayBuffer; type: string };
  mediaChunks?: number;
  mediaType?: string;
  stored?: boolean;
  id: string;
};
function hydrate<T>(value: unknown): T {
  const item = value as Stored;
  if (item?.artwork && !(item.artwork instanceof Blob))
    item.artwork = new Blob([item.artwork.bytes], { type: item.artwork.type });
  if (item?.mediaChunks) item.stored = true;
  return item as T;
}
export async function getAll<T>(store: string): Promise<T[]> {
  const items = await read<T[]>(store);
  return store === "tracks" ? items.map((item) => hydrate<T>(item)) : items;
}
export async function get<T>(
  store: string,
  key: string,
): Promise<T | undefined> {
  const item = await read<T>(store, key);
  return store === "tracks" ? hydrate<T>(item) : item;
}
export async function mediaBlob(id: string): Promise<Blob | undefined> {
  const item = await read<Stored>("tracks", id);
  if (!item?.mediaChunks) return;
  const parts: ArrayBuffer[] = [];
  for (let i = 0; i < item.mediaChunks; i++) {
    const data = await read<ArrayBuffer>("media", `${id}:${i}`);
    if (!data)
      throw Error("Offline media is incomplete. Import the file again.");
    parts.push(data);
  }
  return new Blob(parts, { type: item.mediaType });
}
export async function put(store: string, key: string, value: unknown) {
  if (store !== "tracks") return write(store, key, value);
  const track = { ...(value as Stored) },
    previous = await read<Stored>("tracks", key);
  track.mediaChunks = previous?.mediaChunks;
  track.mediaType = previous?.mediaType;
  if (track.blob && !track.mediaChunks) {
    let count = 0;
    for (let offset = 0; offset < track.blob.size; offset += 4 * 1024 * 1024) {
      await write(
        "media",
        `${key}:${count}`,
        await track.blob.slice(offset, offset + 4 * 1024 * 1024).arrayBuffer(),
      );
      count++;
    }
    track.mediaChunks = count;
    track.mediaType = track.blob.type;
  }
  if (track.artwork instanceof Blob)
    track.artwork = {
      bytes: await track.artwork.arrayBuffer(),
      type: track.artwork.type,
    };
  delete track.blob;
  await write(store, key, track);
}
export async function remove(store: string, key: string) {
  if (store === "tracks") {
    const item = await read<Stored>("tracks", key);
    for (let i = 0; i < (item?.mediaChunks || 0); i++)
      await remove("media", `${key}:${i}`);
  }
  const db = await database;
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(tx.error || new Error("Could not remove saved file"));
  });
}
