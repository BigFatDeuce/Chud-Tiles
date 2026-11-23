import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ChudMusicLibrary, Playlist, TrackRef } from '@shared/types';
import { cacheDir, chudMusicPaths } from './paths';
import { chudCoverUrl, fileUrl, normPath } from './protocol';

// Chud Music's library and playlists, read without ever touching Chud Music: its database is
// copied into Chud Tiles' cache (with its write-ahead log, so the latest changes are there) and
// only the copy is opened. Covers are read from Chud Music's cache folder, read only.

interface Row {
  id: string;
  source: 'local' | 'youtube';
  path: string | null;
  yt_video_id: string | null;
  title: string;
  artist: string | null;
  album: string | null;
  duration_sec: number | null;
  cover_ref: string | null;
  file_size: number | null;
  mtime_ms: number | null;
}

function snapshot(db: string): string {
  const dir = cacheDir('chud-music');
  const snap = join(dir, 'chud.db');
  for (const ext of ['', '-wal', '-shm']) rmSync(snap + ext, { force: true });
  copyFileSync(db, snap);
  if (existsSync(`${db}-wal`)) copyFileSync(`${db}-wal`, `${snap}-wal`);
  return snap;
}

/** Local files listed by Chud Music (normalized paths), from the last read of its library. */
let known: Set<string> | null = null;
let knownAt = 0;
/** Is this file in Chud Music's library? Its list is read again at most once a minute. */
export function chudMusicHas(normalized: string): boolean {
  if (!known || (!known.has(normalized) && Date.now() - knownAt > 60_000)) {
    try {
      readChudMusic();
    } catch {
      known ??= new Set();
      knownAt = Date.now();
    }
  }
  return known!.has(normalized);
}

const hasTable = (d: DatabaseSync, name: string) => !!d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

export function readChudMusic(): ChudMusicLibrary {
  const { db } = chudMusicPaths();
  if (!existsSync(db)) {
    known = new Set();
    knownAt = Date.now();
    return { found: false, path: null, tracks: [], playlists: [] };
  }
  const d = new DatabaseSync(snapshot(db));
  try {
    const libCol = (d.prepare("SELECT 1 FROM pragma_table_info('tracks') WHERE name = 'in_library'").get() as unknown) !== undefined;
    const inPlaylists = hasTable(d, 'playlist_items') ? 'OR id IN (SELECT track_id FROM playlist_items)' : '';
    const rows = d
      .prepare(`SELECT id, source, path, yt_video_id, title, artist, album, duration_sec, cover_ref, file_size, mtime_ms FROM tracks WHERE available = 1 AND (${libCol ? 'in_library = 1' : '1'} ${inPlaylists})`)
      .all() as unknown as Row[];
    const found = new Map<string, string>();
    if (hasTable(d, 'found_covers')) for (const r of d.prepare('SELECT track_id, ref FROM found_covers').all() as unknown as { track_id: string; ref: string }[]) found.set(r.track_id, r.ref);

    const keyOf = new Map<string, string>();
    const tracks: TrackRef[] = [];
    const paths = new Set<string>();
    for (const r of rows) {
      if (r.source === 'local' && r.path) {
        paths.add(normPath(r.path));
        const ref = r.cover_ref ?? found.get(r.id) ?? null;
        const t: TrackRef = { key: `local:${r.path}`, source: 'local', path: r.path, title: r.title, artist: r.artist, album: r.album, duration: r.duration_sec, size: r.file_size ?? undefined, mtime: r.mtime_ms ?? undefined, cover: ref ? (/^https?:/.test(ref) ? ref : chudCoverUrl(ref)) : null, origin: 'chud-music' };
        keyOf.set(r.id, t.key);
        tracks.push(t);
      } else if (r.source === 'youtube' && r.yt_video_id) {
        const t: TrackRef = { key: `yt:${r.yt_video_id}`, source: 'youtube', videoId: r.yt_video_id, title: r.title, artist: r.artist, album: r.album, duration: r.duration_sec, cover: r.cover_ref && /^https?:/.test(r.cover_ref) ? r.cover_ref : `https://i.ytimg.com/vi/${r.yt_video_id}/hqdefault.jpg`, origin: 'chud-music' };
        keyOf.set(r.id, t.key);
        tracks.push(t);
      }
    }

    const playlists: Playlist[] = [];
    if (hasTable(d, 'playlists') && hasTable(d, 'playlist_items')) {
      const lists = d.prepare('SELECT id, name FROM playlists ORDER BY name COLLATE NOCASE').all() as unknown as { id: number; name: string }[];
      const items = d.prepare('SELECT playlist_id, track_id FROM playlist_items ORDER BY playlist_id, position').all() as unknown as { playlist_id: number; track_id: string }[];
      const by = new Map<number, string[]>();
      for (const it of items) {
        const k = keyOf.get(it.track_id);
        if (!k) continue;
        const arr = by.get(it.playlist_id) ?? [];
        arr.push(k);
        by.set(it.playlist_id, arr);
      }
      for (const l of lists) {
        const keys = by.get(l.id) ?? [];
        if (!keys.length) continue;
        const first = tracks.find((t) => t.key === keys[0]);
        playlists.push({ id: `chud-music:${l.id}`, name: l.name, tracks: keys, origin: 'chud-music', cover: first?.cover ?? null });
      }
    }
    known = paths;
    knownAt = Date.now();
    return { found: true, path: db, tracks, playlists };
  } finally {
    d.close();
  }
}

export { fileUrl };
