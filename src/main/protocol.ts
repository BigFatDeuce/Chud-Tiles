import { protocol } from 'electron';
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { isAudioName } from '@shared/audio';
import { cacheDir, chudMusicPaths, userDataDir } from './paths';
import * as store from './store';
import { ytSchemePrivilege } from './chud/yt-player';

// Adapted from Chud Music (src/main/protocol.ts): same scheme design, fewer hosts.
//
// ct-media://file/<encoded path>      audio files, with Range support
// ct-media://cover/<name>             covers extracted by Chud Tiles (its cache)
// ct-media://chud-cover/<name>        covers of Chud Music's library (its cache, read only)
// Only audio files the app itself opened (dialog, drop, Chud Music import — remembered across
// launches) or found in one of the music folders are served: the page cannot read other files.

export const SCHEME = 'ct-media';

const norm = (p: string) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
const allowedFile = () => join(userDataDir(), 'opened-files.json');
let allowed: Set<string> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function allowedSet(): Set<string> {
  if (allowed) return allowed;
  allowed = new Set();
  try {
    for (const p of JSON.parse(readFileSync(allowedFile(), 'utf8')) as string[]) allowed.add(p);
  } catch {
    /* first launch */
  }
  return allowed;
}

export function flushAllowed(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  try {
    if (allowed) writeFileSync(allowedFile(), JSON.stringify([...allowed]));
  } catch {
    /* read-only profile */
  }
}

/** An audio file the user opened (or that Chud Music lists): playable now and after a restart. */
export function allowPath(p: string): void {
  const set = allowedSet();
  const n = norm(p);
  if (set.has(n) || !isAudioName(p)) return;
  set.add(n);
  saveTimer ??= setTimeout(flushAllowed, 2000);
}

const sources: ((normalized: string) => boolean)[] = [];
/** Another list of files the user chose elsewhere (Chud Music's library). */
export function addAllowSource(has: (normalized: string) => boolean): void {
  sources.push(has);
}
export { norm as normPath };

function isAllowed(p: string): boolean {
  if (!isAudioName(p)) return false;
  const n = norm(p);
  return allowedSet().has(n) || store.load().folders.some((f) => n.startsWith(norm(f) + sep)) || sources.some((has) => has(n));
}

export const fileUrl = (p: string) => `${SCHEME}://file/${encodeURIComponent(p)}`;
export const coverUrl = (name: string) => `${SCHEME}://cover/${encodeURIComponent(name)}`;
export const chudCoverUrl = (name: string) => `${SCHEME}://chud-cover/${encodeURIComponent(name)}`;

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.webm': 'audio/webm',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.wma': 'audio/x-ms-wma',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export function registerSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }, ytSchemePrivilege]);
}

function inside(dir: string, name: string): string | null {
  const p = join(dir, name);
  return resolve(p).startsWith(resolve(dir) + sep) ? p : null;
}

export function handleProtocol(): void {
  protocol.handle(SCHEME, async (req) => {
    const url = new URL(req.url);
    const name = decodeURIComponent(url.pathname.slice(1));
    let path: string | null;
    if (url.host === 'cover') path = inside(cacheDir('covers'), name);
    else if (url.host === 'chud-cover') path = inside(chudMusicPaths().covers, name);
    else if (url.host === 'file') path = isAllowed(name) ? name : null;
    else return new Response(null, { status: 404 });
    if (!path) return new Response(null, { status: 403 });

    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      return new Response(null, { status: 404 });
    }
    const headers: Record<string, string> = {
      'Content-Type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
    };
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') ?? '');
    if (!m) {
      headers['Content-Length'] = String(size);
      return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, { status: 200, headers });
    }
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    headers['Content-Length'] = String(end - start + 1);
    return new Response(Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream, { status: 206, headers });
  });
}
