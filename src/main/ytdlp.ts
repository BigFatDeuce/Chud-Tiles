import { net } from 'electron';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { ffmpegPath } from './ffmpeg';
import { say } from './i18n';
import { cacheDir, userDataDir } from './paths';
import { normPath } from './protocol';
import type { YtDownloaded as Downloaded, YtdlpStatus } from '@shared/types';

// The main way to play a YouTube song on the desktop (Settings › YouTube; the official player live
// is the other): its sound is downloaded once with yt-dlp, then played and analysed like a local
// file (full chart at once, no stutter, no ads). It goes against YouTube's terms, which Settings
// says. yt-dlp is not shipped: the system's copy, or the official release installed on first use.

const EXE = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const RELEASE = { win32: 'yt-dlp.exe', darwin: 'yt-dlp_macos', linux: 'yt-dlp_linux' }[process.platform as 'win32' | 'darwin' | 'linux'] ?? 'yt-dlp';
const RELEASE_URL = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${RELEASE}`;
const ID = /^[\w-]{11}$/;

const ownPath = () => join(userDataDir(), 'bin', EXE);
export const audioDir = () => cacheDir('youtube-audio');

/** Downloaded songs are playable through the media protocol. */
export function isDownloaded(normalized: string): boolean {
  return normalized.startsWith(normPath(audioDir()) + sep);
}

// YouTube hides formats from clients that cannot solve its JavaScript challenges: yt-dlp gets a
// JavaScript runtime, Chud Tiles' own executable running as Node.js (Electron's RunAsNode).
const JS_RUNTIME = ['--js-runtimes', `node:${process.execPath}`];
const childEnv = () => ({ ...process.env, ELECTRON_RUN_AS_NODE: '1' });

function run(exe: string, args: string[], onLine?: (line: string) => void): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(exe, args, { windowsHide: true, env: childEnv() });
    let out = '';
    let err = '';
    let partial = '';
    p.stdout.on('data', (b: Buffer) => {
      const s = b.toString();
      out += s;
      if (out.length > 200_000) out = out.slice(-100_000);
      if (!onLine) return;
      const lines = (partial + s).split(/\r?\n/);
      partial = lines.pop() ?? '';
      lines.forEach(onLine);
    });
    p.stderr.on('data', (b: Buffer) => {
      err += b.toString();
      if (err.length > 50_000) err = err.slice(-20_000);
    });
    p.on('error', reject);
    p.on('exit', (code) => resolve({ code: code ?? -1, out, err }));
  });
}

let exeCache: { exe: string; version: string } | null | undefined;

/** yt-dlp: the copy Chud Tiles installed, else the system's. */
async function findExe(): Promise<{ exe: string; version: string } | null> {
  if (exeCache !== undefined) return exeCache;
  for (const exe of [ownPath(), 'yt-dlp']) {
    if (exe !== 'yt-dlp' && !existsSync(exe)) continue;
    try {
      const r = await run(exe, ['--version']);
      if (r.code === 0) return (exeCache = { exe, version: r.out.trim().split(/\s+/)[0] ?? '' });
    } catch {
      /* not there */
    }
  }
  return (exeCache = null);
}

function cacheSize(): { songs: number; bytes: number } {
  let songs = 0;
  let bytes = 0;
  for (const f of readdirSync(audioDir())) {
    if (/\.(part|ytdl|tmp)$/.test(f)) continue;
    songs++;
    bytes += statSync(join(audioDir(), f)).size;
  }
  return { songs, bytes };
}

export async function status(): Promise<YtdlpStatus> {
  const found = await findExe();
  return { found: !!found, version: found?.version ?? null, own: found?.exe === ownPath(), ...cacheSize() };
}

/** Downloads (or updates) yt-dlp from its official GitHub releases into Chud Tiles' profile. */
export async function install(): Promise<YtdlpStatus> {
  const res = await net.fetch(RELEASE_URL);
  if (!res.ok) throw new Error(say(`Téléchargement de yt-dlp impossible (${res.status}).`, `Could not download yt-dlp (${res.status}).`));
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 1_000_000) throw new Error(say('Fichier yt-dlp reçu incomplet.', 'The yt-dlp file received is incomplete.'));
  const dest = ownPath();
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.download`;
  writeFileSync(tmp, bytes);
  if (process.platform !== 'win32') chmodSync(tmp, 0o755);
  renameSync(tmp, dest);
  exeCache = undefined;
  const st = await status();
  if (!st.found) throw new Error(say('yt-dlp installé mais ne démarre pas.', 'yt-dlp installed but does not start.'));
  return st;
}

let preparing: Promise<void> | null = null;

/**
 * At launch (download mode): installs yt-dlp if it is missing, or updates the copy Chud Tiles
 * installed (YouTube changes often; an old yt-dlp is a common cause of failed downloads).
 */
export function prepare(): Promise<void> {
  preparing ??= (async () => {
    const found = await findExe();
    if (!found) {
      await install();
      return;
    }
    if (found.exe !== ownPath()) return; // the system's copy is updated by the system
    const r = await run(found.exe, ['-U']);
    if (r.code !== 0) console.warn('[yt-dlp] update failed', r.err.trim().split(/\r?\n/).pop());
    exeCache = undefined;
  })()
    .catch((e: unknown) => console.warn('[yt-dlp] prepare', e))
    .finally(() => (preparing = null));
  return preparing;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jobs = new Map<string, Promise<Downloaded>>();

function existing(id: string): Downloaded | null {
  for (const f of readdirSync(audioDir())) {
    if (!f.startsWith(`${id}.`) || /\.(part|ytdl|tmp)$/.test(f)) continue;
    const path = join(audioDir(), f);
    const st = statSync(path);
    if (st.size > 10_000) return { path, size: st.size, mtime: Math.round(st.mtimeMs) };
  }
  return null;
}

/** The song's sound as a file (downloaded once, then kept in the cache). */
export function download(id: string, progress: (p: number) => void): Promise<Downloaded> {
  if (!ID.test(id)) return Promise.reject(new Error(say('Identifiant de vidéo invalide.', 'Invalid video id.')));
  const have = existing(id);
  if (have) return Promise.resolve(have);
  const running = jobs.get(id);
  if (running) return running;
  const job = (async () => {
    // an install or update started at launch finishes first; then first use installs it
    if (preparing) await preparing;
    if (!(await findExe())) await install();
    const found = await findExe();
    if (!found) throw new Error(say('yt-dlp n’est pas installé : Réglages › YouTube › Installer yt-dlp.', 'yt-dlp is not installed: Settings › YouTube › Install yt-dlp.'));
    const ff = ffmpegPath();
    const args = [
      '--no-playlist',
      '--no-warnings',
      '--no-mtime',
      ...JS_RUNTIME,
      '--retries',
      '5',
      '--fragment-retries',
      '5',
      '--extractor-retries',
      '3',
      '-f',
      'bestaudio[ext=m4a]/bestaudio/best',
      '-o',
      join(audioDir(), `${id}.%(ext)s`),
      '--newline',
      '--progress-template',
      'download:CTP %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s',
      ...(ff !== 'ffmpeg' ? ['--ffmpeg-location', ff] : []),
      '--',
      `https://www.youtube.com/watch?v=${id}`,
    ];
    // a few attempts: a freshly installed exe may still be scanned by the antivirus, YouTube may
    // refuse one request
    let why = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await sleep(1500 * attempt);
      let r: { code: number; err: string };
      try {
        r = await run(found.exe, args, (line) => {
          const m = /^CTP (\S+) (\S+) (\S+)/.exec(line.trim());
          if (!m) return;
          const done = Number(m[1]);
          const total = Number(m[2]) || Number(m[3]);
          if (done > 0 && total > 0) progress(Math.min(1, done / total));
        });
      } catch (e) {
        r = { code: -1, err: `ERROR: ${(e as Error).message}` };
      }
      const got = existing(id);
      if (r.code === 0 && got) return got;
      why = r.err.split(/\r?\n/).filter((l) => /ERROR/.test(l)).pop()?.replace(/^ERROR:\s*/, '') || `code ${r.code}`;
      console.warn(`[yt-dlp] ${id} attempt ${attempt + 1} failed: ${why}`);
      // the video itself is refused: trying again changes nothing
      if (/private|unavailable|removed|copyright|confirm your age|members-only/i.test(why)) break;
    }
    throw new Error(say(`Téléchargement impossible : ${why}`, `Download failed: ${why}`));
  })().finally(() => jobs.delete(id));
  jobs.set(id, job);
  return job;
}

/** Deletes every downloaded song (the analyses stay in the game's cache). */
export function clear(): void {
  for (const f of readdirSync(audioDir())) rmSync(join(audioDir(), f), { force: true });
}
