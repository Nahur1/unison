//! The music library: folders you add, and every track in them, indexed in
//! SQLite so browsing is instant. Rescans only re-read files that changed.

use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use rusqlite::{Connection, OptionalExtension, params};

use crate::library;

#[derive(Clone, Debug)]
pub struct Song {
    pub path: PathBuf,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: f64,
    pub favorite: bool,
}

#[derive(Clone, Debug)]
pub struct Album {
    pub name: String,
    pub artist: String,
}

/// Which songs a list shows.
#[derive(Clone, Debug, PartialEq)]
pub enum Filter {
    Songs,
    Search(String),
    Album(String),
    Artist(String),
    Favorites,
    Recent,
    Videos,
    /// A folder the user made in Unison (its id).
    Folder(i64),
}

/// A folder the user made inside Unison ("Relax", "Pop"…): a hand-picked set
/// of songs and videos. Files stay where they are; only the list is stored.
#[derive(Clone, Debug)]
pub struct UserFolder {
    pub id: i64,
    pub name: String,
    pub count: usize,
}

/// The session whose library is everything (the others show only their own folders).
pub const MAIN_SESSION: &str = "Main";

pub struct Catalog {
    db: Connection,
    /// The session being browsed: its folders are what the library shows.
    session: String,
    /// SQL condition on `path` for that session's folders ("1" = everything).
    scope: String,
}

pub fn db_path() -> PathBuf {
    crate::profile::data_dir().join("unison.db")
}

/// Where album covers for the grid are cached.
pub fn thumbnail_path(album: &str) -> PathBuf {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    album.to_lowercase().hash(&mut h);
    crate::profile::cache_dir()
        .join("albums")
        .join(format!("{:016x}.png", h.finish()))
}

fn open(path: &Path) -> rusqlite::Result<Connection> {
    let db = Connection::open(path)?;
    db.busy_timeout(std::time::Duration::from_secs(5))?;
    db.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA synchronous=NORMAL;
         CREATE TABLE IF NOT EXISTS library_dirs (path TEXT PRIMARY KEY);
         -- Each session has its own library folders. (library_dirs is the old,
         -- shared list: its folders move to Main.)
         CREATE TABLE IF NOT EXISTS session_dirs (
             session TEXT NOT NULL,
             path TEXT NOT NULL,
             PRIMARY KEY (session, path)
         );
         INSERT OR IGNORE INTO session_dirs (session, path) SELECT 'Main', path FROM library_dirs;
         DELETE FROM library_dirs;
         CREATE TABLE IF NOT EXISTS tracks (
             path TEXT PRIMARY KEY,
             title TEXT NOT NULL,
             artist TEXT NOT NULL,
             album TEXT NOT NULL,
             track_no INTEGER NOT NULL,
             duration REAL NOT NULL,
             mtime INTEGER NOT NULL,
             added_at INTEGER NOT NULL,
             play_count INTEGER NOT NULL DEFAULT 0,
             last_played INTEGER,
             favorite INTEGER NOT NULL DEFAULT 0,
             is_video INTEGER NOT NULL DEFAULT 0
         );
         CREATE INDEX IF NOT EXISTS tracks_album ON tracks(album);
         CREATE INDEX IF NOT EXISTS tracks_artist ON tracks(artist);
         CREATE INDEX IF NOT EXISTS tracks_added ON tracks(added_at);
         CREATE TABLE IF NOT EXISTS folders (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             name TEXT NOT NULL UNIQUE COLLATE NOCASE,
             created_at INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS folder_items (
             folder INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
             path TEXT NOT NULL,
             pos INTEGER NOT NULL,
             PRIMARY KEY (folder, path)
         );",
    )?;
    Ok(db)
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn mtime(p: &Path) -> i64 {
    std::fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn song(r: &rusqlite::Row) -> rusqlite::Result<Song> {
    Ok(Song {
        path: PathBuf::from(r.get::<_, String>(0)?),
        title: r.get(1)?,
        artist: r.get(2)?,
        album: r.get(3)?,
        duration: r.get(4)?,
        favorite: r.get::<_, i64>(5)? != 0,
    })
}

const SONG_COLS: &str = "path, title, artist, album, duration, favorite";

/// SQL condition: `path` is inside one of `dirs`. Paths are compared as plain
/// text prefixes (LIKE would treat `_` and `%` in folder names as wildcards).
fn scope_sql(dirs: &[PathBuf]) -> String {
    if dirs.is_empty() {
        return "0".into();
    }
    let path_expr = if cfg!(windows) { "replace(path, char(92), '/')" } else { "path" };
    let parts: Vec<String> = dirs
        .iter()
        .map(|d| {
            let d = d.to_string_lossy();
            let d = if cfg!(windows) { d.replace('\\', "/") } else { d.into_owned() };
            let prefix = format!("{}/", d.trim_end_matches('/'));
            format!("substr({path_expr}, 1, {}) = '{}'", prefix.chars().count(), prefix.replace('\'', "''"))
        })
        .collect();
    format!("({})", parts.join(" OR "))
}

fn query_dirs(db: &Connection, sql: &str, arg: Option<&str>) -> Vec<PathBuf> {
    let Ok(mut st) = db.prepare(sql) else { return Vec::new() };
    let get = |r: &rusqlite::Row| r.get::<_, String>(0);
    let rows = match arg {
        Some(a) => st.query_map([a], get).map(|r| r.flatten().collect::<Vec<_>>()),
        None => st.query_map([], get).map(|r| r.flatten().collect::<Vec<_>>()),
    };
    rows.unwrap_or_default().into_iter().map(PathBuf::from).collect()
}

impl Catalog {
    pub fn open() -> anyhow::Result<Catalog> {
        Self::with_db(open(&db_path())?)
    }

    #[cfg(test)]
    fn open_at(path: &Path) -> anyhow::Result<Catalog> {
        Self::with_db(open(path)?)
    }

    fn with_db(db: Connection) -> anyhow::Result<Catalog> {
        let mut c = Catalog { db, session: MAIN_SESSION.into(), scope: "1".into() };
        c.set_session(MAIN_SESSION);
        Ok(c)
    }

    /// Browse another session's library.
    pub fn set_session(&mut self, name: &str) {
        self.session = name.to_string();
        self.scope = if name == MAIN_SESSION { "1".into() } else { scope_sql(&self.dirs()) };
    }

    /// Every library folder, of every session (what the scanner indexes).
    pub fn all_dirs(&self) -> Vec<PathBuf> {
        query_dirs(&self.db, "SELECT DISTINCT path FROM session_dirs ORDER BY path", None)
    }

    /// The current session's folders. Main's library is all of them.
    pub fn dirs(&self) -> Vec<PathBuf> {
        if self.session == MAIN_SESSION {
            return self.all_dirs();
        }
        query_dirs(&self.db, "SELECT path FROM session_dirs WHERE session = ?1 ORDER BY path", Some(&self.session))
    }

    pub fn add_dir(&mut self, dir: &Path) {
        let _ = self.db.execute(
            "INSERT OR IGNORE INTO session_dirs (session, path) VALUES (?1, ?2)",
            params![self.session, dir.to_string_lossy()],
        );
        let name = self.session.clone();
        self.set_session(&name);
    }

    /// A deleted session's folders leave with it.
    pub fn forget_session(&mut self, name: &str) {
        let current = std::mem::replace(&mut self.session, name.to_string());
        for d in self.dirs() {
            self.remove_dir(&d);
        }
        self.set_session(&current);
    }

    /// Take a folder out of this session's library (out of every session's, in
    /// Main). Its files stay on disk; they just leave the index unless another
    /// library folder still holds them.
    pub fn remove_dir(&mut self, dir: &Path) {
        let p = dir.to_string_lossy();
        let _ = if self.session == MAIN_SESSION {
            self.db.execute("DELETE FROM session_dirs WHERE path = ?1", [&p])
        } else {
            self.db.execute("DELETE FROM session_dirs WHERE session = ?1 AND path = ?2", params![self.session, p])
        };
        let name = self.session.clone();
        self.set_session(&name);
        let others = self.all_dirs();
        let Ok(mut st) = self.db.prepare("SELECT path FROM tracks") else { return };
        let paths: Vec<String> =
            st.query_map([], |r| r.get::<_, String>(0)).map(|r| r.flatten().collect()).unwrap_or_default();
        drop(st);
        let Ok(tx) = self.db.unchecked_transaction() else { return };
        for p in paths {
            let path = Path::new(&p);
            if path.starts_with(dir) && !others.iter().any(|d| path.starts_with(d)) {
                let _ = tx.execute("DELETE FROM tracks WHERE path = ?1", [&p]);
            }
        }
        let _ = tx.commit();
    }

    /// Whether this session's library has nothing in it.
    pub fn is_empty(&self) -> bool {
        let sql = format!("SELECT COUNT(*) FROM tracks WHERE {}", self.scope);
        self.db.query_row(&sql, [], |r| r.get::<_, i64>(0)).unwrap_or(0) == 0
    }

    pub fn songs(&self, filter: &Filter) -> Vec<Song> {
        let sc = &self.scope;
        let (sql, arg): (String, Option<String>) = match filter {
            Filter::Songs => (format!("SELECT {SONG_COLS} FROM tracks WHERE is_video = 0 AND {sc} ORDER BY title COLLATE NOCASE"), None),
            Filter::Videos => (format!("SELECT {SONG_COLS} FROM tracks WHERE is_video = 1 AND {sc} ORDER BY path"), None),
            Filter::Favorites => (format!("SELECT {SONG_COLS} FROM tracks WHERE favorite = 1 AND {sc} ORDER BY title COLLATE NOCASE"), None),
            Filter::Recent => (format!("SELECT {SONG_COLS} FROM tracks WHERE {sc} ORDER BY added_at DESC, path LIMIT 200"), None),
            Filter::Album(a) => (
                format!("SELECT {SONG_COLS} FROM tracks WHERE album = ?1 AND {sc} ORDER BY track_no, title COLLATE NOCASE"),
                Some(a.clone()),
            ),
            Filter::Artist(a) => (
                format!("SELECT {SONG_COLS} FROM tracks WHERE artist = ?1 AND {sc} ORDER BY album COLLATE NOCASE, track_no, title"),
                Some(a.clone()),
            ),
            Filter::Folder(id) => return self.folder_songs(*id),
            Filter::Search(q) => (
                format!(
                    "SELECT {SONG_COLS} FROM tracks
                     WHERE (title LIKE ?1 OR artist LIKE ?1 OR album LIKE ?1 OR path LIKE ?1) AND {sc}
                     ORDER BY title COLLATE NOCASE LIMIT 500"
                ),
                Some(format!("%{}%", q.trim())),
            ),
        };
        let Ok(mut st) = self.db.prepare(&sql) else { return Vec::new() };
        let rows = match &arg {
            Some(a) => st.query_map([a], song),
            None => st.query_map([], song),
        };
        let mut out: Vec<Song> = rows.map(|r| r.flatten().collect()).unwrap_or_default();
        if matches!(filter, Filter::Videos) {
            out.sort_by(|a, b| library::natural_cmp(&a.path.to_string_lossy(), &b.path.to_string_lossy()));
        }
        out
    }

    /// A folder's songs and videos in the order they were added. Files the
    /// index doesn't know (yet) still show, by file name.
    fn folder_songs(&self, id: i64) -> Vec<Song> {
        let Ok(mut st) = self.db.prepare(
            "SELECT fi.path, t.title, t.artist, t.album, t.duration, t.favorite
             FROM folder_items fi LEFT JOIN tracks t ON t.path = fi.path
             WHERE fi.folder = ?1 ORDER BY fi.pos",
        ) else {
            return Vec::new();
        };
        st.query_map([id], |r| {
            let path = PathBuf::from(r.get::<_, String>(0)?);
            let title: Option<String> = r.get(1)?;
            Ok(Song {
                title: title.filter(|t| !t.is_empty()).unwrap_or_else(|| {
                    path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
                }),
                artist: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                album: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                duration: r.get::<_, Option<f64>>(4)?.unwrap_or(0.0),
                favorite: r.get::<_, Option<i64>>(5)?.unwrap_or(0) != 0,
                path,
            })
        })
        .map(|r| r.flatten().collect())
        .unwrap_or_default()
    }

    pub fn folders(&self) -> Vec<UserFolder> {
        let Ok(mut st) = self.db.prepare(
            "SELECT f.id, f.name, COUNT(fi.path) FROM folders f
             LEFT JOIN folder_items fi ON fi.folder = f.id
             GROUP BY f.id ORDER BY f.name COLLATE NOCASE",
        ) else {
            return Vec::new();
        };
        st.query_map([], |r| Ok(UserFolder { id: r.get(0)?, name: r.get(1)?, count: r.get::<_, i64>(2)? as usize }))
            .map(|r| r.flatten().collect())
            .unwrap_or_default()
    }

    /// Make a folder. A name already in use (any letter case) gives its id.
    pub fn create_folder(&self, name: &str) -> Option<i64> {
        let name = name.trim();
        if name.is_empty() {
            return None;
        }
        let _ = self.db.execute("INSERT OR IGNORE INTO folders (name, created_at) VALUES (?1, ?2)", params![name, now()]);
        self.db.query_row("SELECT id FROM folders WHERE name = ?1", [name], |r| r.get(0)).optional().ok().flatten()
    }

    pub fn rename_folder(&self, id: i64, name: &str) -> bool {
        let name = name.trim();
        !name.is_empty() && self.db.execute("UPDATE folders SET name = ?2 WHERE id = ?1", params![id, name]).unwrap_or(0) == 1
    }

    /// Delete a folder. Only the list goes; the files are untouched.
    pub fn delete_folder(&self, id: i64) {
        let _ = self.db.execute("DELETE FROM folder_items WHERE folder = ?1", [id]);
        let _ = self.db.execute("DELETE FROM folders WHERE id = ?1", [id]);
    }

    pub fn remove_from_folder(&self, id: i64, paths: &[PathBuf]) {
        let Ok(tx) = self.db.unchecked_transaction() else { return };
        for p in paths {
            let _ = tx.execute("DELETE FROM folder_items WHERE folder = ?1 AND path = ?2", params![id, p.to_string_lossy()]);
        }
        let _ = tx.commit();
    }

    pub fn albums(&self) -> Vec<Album> {
        let Ok(mut st) = self.db.prepare(&format!(
            "SELECT album, MIN(artist) FROM tracks
             WHERE album != '' AND is_video = 0 AND {} GROUP BY album ORDER BY album COLLATE NOCASE",
            self.scope
        )) else {
            return Vec::new();
        };
        st.query_map([], |r| {
            Ok(Album { name: r.get(0)?, artist: r.get(1)? })
        })
        .map(|r| r.flatten().collect())
        .unwrap_or_default()
    }

    pub fn artists(&self) -> Vec<(String, usize)> {
        let Ok(mut st) = self.db.prepare(&format!(
            "SELECT artist, COUNT(*) FROM tracks WHERE artist != '' AND is_video = 0 AND {}
             GROUP BY artist ORDER BY artist COLLATE NOCASE",
            self.scope
        )) else {
            return Vec::new();
        };
        st.query_map([], |r| Ok((r.get(0)?, r.get::<_, i64>(1)? as usize)))
            .map(|r| r.flatten().collect())
            .unwrap_or_default()
    }

    pub fn is_favorite(&self, path: &Path) -> bool {
        self.db
            .query_row("SELECT favorite FROM tracks WHERE path = ?1", [path.to_string_lossy()], |r| r.get::<_, i64>(0))
            .optional()
            .ok()
            .flatten()
            .unwrap_or(0)
            != 0
    }

    /// Mark a track as a favourite. Files outside the library are added so the heart sticks.
    pub fn set_favorite(&self, path: &Path, fav: bool) {
        let p = path.to_string_lossy();
        let changed = self.db.execute("UPDATE tracks SET favorite = ?2 WHERE path = ?1", params![p, fav as i64]).unwrap_or(0);
        if changed == 0 && fav {
            let t = crate::meta::read_tags(path);
            let _ = self.db.execute(
                "INSERT INTO tracks (path, title, artist, album, track_no, duration, mtime, added_at, favorite, is_video)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9)",
                params![p, t.title, t.artist, t.album, t.track_no, t.duration, mtime(path), now(), library::is_video(path) as i64],
            );
        }
    }

    /// Forget a track (after its file was moved to the Trash).
    pub fn remove(&self, path: &Path) {
        let _ = self.db.execute("DELETE FROM tracks WHERE path = ?1", [path.to_string_lossy()]);
    }

    pub fn record_play(&self, path: &Path) {
        let _ = self.db.execute(
            "UPDATE tracks SET play_count = play_count + 1, last_played = ?2 WHERE path = ?1",
            params![path.to_string_lossy(), now()],
        );
    }
}

/// Put files into a folder, after the ones already there; files it already
/// holds are skipped. Files the index doesn't know are read and indexed so
/// they show their real title. Runs on a worker thread with its own
/// connection (`db` is the catalog file). Returns how many were added.
pub fn add_to_folder(db: &Path, id: i64, paths: &[PathBuf]) -> usize {
    let Ok(db) = open(db) else { return 0 };
    let Ok(tx) = db.unchecked_transaction() else { return 0 };
    let mut pos: i64 = tx
        .query_row("SELECT COALESCE(MAX(pos), -1) FROM folder_items WHERE folder = ?1", [id], |r| r.get(0))
        .unwrap_or(-1);
    let mut added = 0;
    for p in paths {
        let key = p.to_string_lossy();
        let known: bool =
            tx.query_row("SELECT 1 FROM tracks WHERE path = ?1", [&key], |_| Ok(true)).optional().ok().flatten().unwrap_or(false);
        if !known && p.is_file() {
            let t = crate::meta::read_tags(p);
            let _ = tx.execute(
                "INSERT OR IGNORE INTO tracks (path, title, artist, album, track_no, duration, mtime, added_at, is_video)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![key, t.title, t.artist, t.album, t.track_no, t.duration, mtime(p), now(), library::is_video(p) as i64],
            );
        }
        if tx
            .execute("INSERT OR IGNORE INTO folder_items (folder, path, pos) VALUES (?1, ?2, ?3)", params![id, key, pos + 1])
            .unwrap_or(0)
            == 1
        {
            pos += 1;
            added += 1;
        }
    }
    let _ = tx.commit();
    added
}

/// Bring the index up to date with the library folders. Runs on a worker
/// thread with its own connection. Returns true if anything changed.
pub fn scan(on_progress: impl Fn(usize)) -> bool {
    let Ok(db) = open(&db_path()) else { return false };
    let dirs: Vec<PathBuf> = {
        let Ok(mut st) = db.prepare("SELECT DISTINCT path FROM session_dirs") else { return false };
        st.query_map([], |r| r.get::<_, String>(0)).map(|r| r.flatten().map(PathBuf::from).collect()).unwrap_or_default()
    };
    let known: HashMap<String, i64> = {
        let Ok(mut st) = db.prepare("SELECT path, mtime FROM tracks") else { return false };
        st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
            .map(|r| r.flatten().collect())
            .unwrap_or_default()
    };
    let mut seen = HashSet::new();
    let mut changed = false;
    let mut done = 0usize;
    let added = now();
    for dir in &dirs {
        let files = library::scan(dir, true);
        let mut batch = Vec::new();
        for f in files {
            let key = f.to_string_lossy().into_owned();
            let m = mtime(&f);
            if known.get(&key) != Some(&m) {
                batch.push((key.clone(), f, m));
            }
            seen.insert(key);
        }
        for chunk in batch.chunks(64) {
            let rows: Vec<_> = chunk.iter().map(|(k, f, m)| (k, crate::meta::read_tags(f), *m, library::is_video(f))).collect();
            let Ok(tx) = db.unchecked_transaction() else { continue };
            for (k, t, m, video) in rows {
                let _ = tx.execute(
                    "INSERT INTO tracks (path, title, artist, album, track_no, duration, mtime, added_at, is_video)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                     ON CONFLICT(path) DO UPDATE SET title = excluded.title, artist = excluded.artist,
                         album = excluded.album, track_no = excluded.track_no, duration = excluded.duration,
                         mtime = excluded.mtime, is_video = excluded.is_video",
                    params![k, t.title, t.artist, t.album, t.track_no, t.duration, m, added, video as i64],
                );
            }
            let _ = tx.commit();
            changed = true;
            done += chunk.len();
            on_progress(done);
        }
    }
    // Forget files that are gone from library folders (favourites outside them stay).
    let gone: Vec<&String> = known
        .keys()
        .filter(|k| !seen.contains(*k) && dirs.iter().any(|d| Path::new(k).starts_with(d)))
        .collect();
    if !gone.is_empty() {
        if let Ok(tx) = db.unchecked_transaction() {
            for k in gone {
                let _ = tx.execute("DELETE FROM tracks WHERE path = ?1", [k]);
            }
            let _ = tx.commit();
            changed = true;
        }
    }
    // Album covers for the grid.
    if let Ok(mut st) = db.prepare("SELECT album, MIN(path) FROM tracks WHERE album != '' AND is_video = 0 GROUP BY album") {
        let albums: Vec<(String, String)> =
            st.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map(|r| r.flatten().collect()).unwrap_or_default();
        for (album, sample) in albums {
            let out = thumbnail_path(&album);
            if !out.exists() && crate::meta::save_thumbnail(Path::new(&sample), &out, 200).is_some() {
                changed = true;
            }
        }
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_folders_keep_order_and_survive_unknown_files() {
        let dir = std::env::temp_dir().join(format!("unison-folders-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("c.db");
        let cat = Catalog::open_at(&db).unwrap();
        cat.db
            .execute(
                "INSERT INTO tracks (path, title, artist, album, track_no, duration, mtime, added_at) VALUES ('/m/a.mp3', 'Alpha', 'X', 'One', 1, 60, 0, 0)",
                [],
            )
            .unwrap();
        let relax = cat.create_folder("Relax").unwrap();
        assert_eq!(cat.create_folder("relax"), Some(relax), "same name, any case, is the same folder");
        let files = [PathBuf::from("/m/a.mp3"), PathBuf::from("/elsewhere/Night Drive.mp3")];
        assert_eq!(add_to_folder(&db, relax, &files), 2);
        assert_eq!(add_to_folder(&db, relax, &files[..1]), 0, "no duplicates");
        let songs = cat.songs(&Filter::Folder(relax));
        assert_eq!(songs.iter().map(|s| s.title.as_str()).collect::<Vec<_>>(), ["Alpha", "Night Drive"]);
        assert_eq!(cat.folders()[0].count, 2);
        cat.remove_from_folder(relax, &files[..1]);
        assert_eq!(cat.songs(&Filter::Folder(relax)).len(), 1);
        assert!(cat.rename_folder(relax, "Calm"));
        assert_eq!(cat.folders()[0].name, "Calm");
        cat.delete_folder(relax);
        assert!(cat.folders().is_empty());
        assert!(cat.songs(&Filter::Folder(relax)).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn favorites_and_filters() {
        let dir = std::env::temp_dir().join(format!("unison-cat-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut cat = Catalog::open_at(&dir.join("c.db")).unwrap();
        for (p, title, album) in [("/m/a.mp3", "Alpha", "One"), ("/m/b.mp3", "Beta", "One"), ("/m/c.mkv", "Clip", "")] {
            cat.db
                .execute(
                    "INSERT INTO tracks (path, title, artist, album, track_no, duration, mtime, added_at, is_video)
                     VALUES (?1, ?2, 'X', ?3, 0, 60, 0, 0, ?4)",
                    params![p, title, album, p.ends_with("mkv") as i64],
                )
                .unwrap();
        }
        assert_eq!(cat.songs(&Filter::Songs).len(), 2);
        assert_eq!(cat.songs(&Filter::Videos).len(), 1);
        assert_eq!(cat.albums().len(), 1);
        assert_eq!(cat.songs(&Filter::Search("bet".into())).len(), 1);
        cat.set_favorite(Path::new("/m/b.mp3"), true);
        assert!(cat.is_favorite(Path::new("/m/b.mp3")));
        assert_eq!(cat.songs(&Filter::Favorites).len(), 1);
        cat.add_dir(Path::new("/m"));
        cat.remove_dir(Path::new("/m"));
        assert!(cat.dirs().is_empty());
        assert!(cat.is_empty());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn each_session_sees_its_own_folders() {
        let dir = std::env::temp_dir().join(format!("unison-scope-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut cat = Catalog::open_at(&dir.join("c.db")).unwrap();
        for p in ["/music/a.mp3", "/music/b.mp3", "/films/x.mkv", "/music_old/c.mp3", "/it's/d.mp3"] {
            cat.db
                .execute(
                    "INSERT INTO tracks (path, title, artist, album, track_no, duration, mtime, added_at, is_video)
                     VALUES (?1, ?1, 'X', '', 0, 60, 0, 0, ?2)",
                    params![p, p.ends_with("mkv") as i64],
                )
                .unwrap();
        }
        cat.set_session("mu");
        assert!(cat.is_empty(), "a new session starts with an empty library");
        cat.add_dir(Path::new("/music"));
        assert_eq!(cat.songs(&Filter::Songs).len(), 2, "/music_old is not inside /music");
        assert!(cat.songs(&Filter::Videos).is_empty());
        cat.set_session("vido");
        cat.add_dir(Path::new("/films"));
        cat.add_dir(Path::new("/it's"));
        assert_eq!(cat.songs(&Filter::Videos).len(), 1);
        assert_eq!(cat.songs(&Filter::Songs).len(), 1, "quotes in folder names are fine");
        cat.set_session(MAIN_SESSION);
        assert_eq!(cat.dirs().len(), 3, "Main shows every folder");
        assert_eq!(cat.songs(&Filter::Songs).len(), 4);
        cat.forget_session("vido");
        assert_eq!(cat.all_dirs(), vec![PathBuf::from("/music")]);
        std::fs::remove_dir_all(dir).ok();
    }
}
