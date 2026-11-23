import { dialog, nativeImage, type BrowserWindow } from 'electron';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { LibraryScan, TrackRef } from '@shared/types';
import { AUDIO_EXTENSIONS } from '@shared/audio';
import { cacheDir } from './paths';
import { allowPath, coverUrl } from './protocol';
import * as store from './store';
import { say } from './i18n';

// Music on disk: files picked in the dialog, dropped on the window, and music folders scanned
// for the archives. Tags (title, artist, album, duration, cover) are read with music-metadata;
// covers are shrunk once into the cache. Files are only ever read.

export const AUDIO_EXT = new Set(AUDIO_EXTENSIONS.map((e) => `.${e}`));
export const isAudioPath = (p: string) => AUDIO_EXT.has(extname(p).toLowerCase());

let mm: typeof import('music-metadata') | null = null;

function fromName(path: string): { title: string; artist: string | null } {
  const base = basename(path).replace(/\.[^.]+$/, '').replace(/_+/g, ' ').trim();
  const m = base.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return m ? { artist: m[1]!.trim(), title: m[2]!.trim() } : { title: base, artist: null };
}

/** One cover per album (or per file without album), 320 px JPEG in the cache. */
function saveCover(data: Uint8Array, key: string): string | null {
  const name = `${createHash('sha1').update(key).digest('hex').slice(0, 24)}.jpg`;
  const out = join(cacheDir('covers'), name);
  if (existsSync(out)) return coverUrl(name);
  try {
    const img = nativeImage.createFromBuffer(Buffer.from(data));
    if (img.isEmpty()) return null;
    const small = img.getSize().width > 320 ? img.resize({ width: 320, quality: 'good' }) : img;
    writeFileSync(out, small.toJPEG(86));
    return coverUrl(name);
  } catch {
    return null;
  }
}

export async function readTrack(path: string, origin: TrackRef['origin'] = 'pick'): Promise<TrackRef> {
  // files of the music folders are served because of where they are (protocol.ts)
  if (origin !== 'folder') allowPath(path);
  const st = await stat(path);
  const named = fromName(path);
  const ref: TrackRef = { key: `local:${path}`, source: 'local', path, title: named.title, artist: named.artist, album: null, duration: null, size: st.size, mtime: Math.round(st.mtimeMs), origin, cover: null };
  try {
    mm ??= await import('music-metadata');
    const meta = await mm.parseFile(path, { duration: true, skipCovers: false });
    const c = meta.common;
    ref.title = c.title?.trim() || named.title;
    ref.artist = c.artist?.trim() || c.albumartist?.trim() || named.artist;
    ref.album = c.album?.trim() || null;
    ref.duration = meta.format.duration ?? null;
    const pic = c.picture?.[0];
    if (pic?.data) ref.cover = saveCover(pic.data, ref.album ? `${ref.artist ?? ''}|${ref.album}` : path);
  } catch {
    /* unreadable tags: the file name says enough */
  }
  return ref;
}

export async function pickFiles(win: BrowserWindow | null): Promise<TrackRef[]> {
  const opts: Electron.OpenDialogOptions = {
    title: say('Choisir des morceaux', 'Choose songs'),
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Audio', extensions: [...AUDIO_EXT].map((e) => e.slice(1)) },
      { name: say('Tous les fichiers', 'All files'), extensions: ['*'] },
    ],
  };
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  if (res.canceled) return [];
  const out: TrackRef[] = [];
  for (const p of res.filePaths) out.push(await readTrack(p));
  return out;
}

// ── folders ────────────────────────────────────────────────────────────────────────────────

export const folders = (): string[] => store.load().folders;

export async function addFolder(win: BrowserWindow | null): Promise<string | null> {
  const opts: Electron.OpenDialogOptions = { title: say('Ajouter un dossier de musique', 'Add a music folder'), properties: ['openDirectory'] };
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  const dir = res.canceled ? null : (res.filePaths[0] ?? null);
  if (dir && !folders().includes(dir)) store.save({ folders: [...folders(), dir] });
  return dir;
}

export function removeFolder(dir: string): void {
  store.save({ folders: folders().filter((f) => f !== dir) });
}

interface ScanCache {
  [path: string]: { size: number; mtime: number; ref: TrackRef };
}

async function walk(dir: string, out: string[], depth = 0): Promise<void> {
  if (depth > 24) return;
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out, depth + 1);
    else if (e.isFile() && isAudioPath(p)) out.push(p);
  }
}

/** Every audio file of the music folders; tags read again only for new or changed files. */
export async function scan(onProgress?: (done: number, total: number) => void): Promise<LibraryScan> {
  const cacheFile = join(cacheDir(), 'scan.json');
  let cache: ScanCache = {};
  try {
    cache = JSON.parse(readFileSync(cacheFile, 'utf8')) as ScanCache;
  } catch {
    /* first scan */
  }
  const files: string[] = [];
  for (const f of folders()) await walk(f, files);
  const next: ScanCache = {};
  const tracks: TrackRef[] = [];
  let skipped = 0;
  let done = 0;
  const queue = files.slice();
  const worker = async () => {
    for (;;) {
      const p = queue.shift();
      if (!p) return;
      try {
        const st = await stat(p);
        const hit = cache[p];
        let ref: TrackRef;
        if (hit && hit.size === st.size && hit.mtime === Math.round(st.mtimeMs)) ref = hit.ref;
        else ref = await readTrack(p, 'folder');
        next[p] = { size: st.size, mtime: Math.round(st.mtimeMs), ref };
        tracks.push(ref);
      } catch {
        skipped++;
      }
      done++;
      if (done % 25 === 0) onProgress?.(done, files.length);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  try {
    writeFileSync(cacheFile, JSON.stringify(next));
  } catch {
    /* cache only */
  }
  return { tracks, folders: folders(), skipped };
}

/** Dropped files and folders (folders are walked): the music among them. */
export async function fromPaths(paths: string[]): Promise<TrackRef[]> {
  const files: string[] = [];
  for (const p of paths.slice(0, 500)) {
    try {
      const st = await stat(p);
      if (st.isDirectory()) await walk(p, files);
      else if (isAudioPath(p)) files.push(p);
    } catch {
      /* gone */
    }
    if (files.length > 2000) break;
  }
  const out: TrackRef[] = [];
  for (const f of files.slice(0, 2000)) out.push(await readTrack(f, 'pick'));
  return out;
}
