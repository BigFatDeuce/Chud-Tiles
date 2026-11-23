import { app } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { say } from './i18n';

// FFmpeg (LGPL build, the same as Chud Music's) for the formats the page cannot decode itself
// (WMA, ALAC, some AIFF…). The file is only read: FFmpeg writes FLAC to a pipe, never to disk,
// and the original stays untouched.

export function ffmpegPath(): string {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const dir = process.platform === 'win32' ? 'ffmpeg' : process.platform === 'darwin' ? 'ffmpeg-mac' : 'ffmpeg-linux';
  const bundled = app.isPackaged ? join(process.resourcesPath, 'ffmpeg', exe) : join(__dirname, '../../build/vendor', dir, exe);
  return existsSync(bundled) ? bundled : 'ffmpeg';
}

export function hasFfmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn(ffmpegPath(), ['-version'], { windowsHide: true });
    p.on('error', () => resolve(false));
    p.on('exit', (code) => resolve(code === 0));
  });
}

/** Any audio file → FLAC bytes (metadata and pictures dropped). */
export function transcode(path: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', path, '-vn', '-map_metadata', '-1', '-c:a', 'flac', '-f', 'flac', 'pipe:1'], { windowsHide: true });
    const out: Buffer[] = [];
    let err = '';
    proc.stdout.on('data', (b: Buffer) => out.push(b));
    proc.stderr.on('data', (b: Buffer) => (err += b.toString()));
    proc.on('error', (e) => reject(new Error(say(`FFmpeg introuvable (${e.message}).`, `FFmpeg not found (${e.message}).`))));
    proc.on('exit', (code) => {
      if (code === 0 && out.length) resolve(Buffer.concat(out));
      else {
        const why = err.trim().split('\n').pop() || `code ${code}`;
        reject(new Error(say(`Conversion impossible : ${why}`, `Conversion failed: ${why}`)));
      }
    });
  });
}
