import { app } from 'electron';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

// User data (window, folders, settings of the main process) lives in the OS profile, caches in
// the OS cache location — never in the install folder, so updates and uninstalls cannot touch
// them. The game's own data (profile, history, analyses) is in the page's IndexedDB.

export function userDataDir(): string {
  return app.getPath('userData'); // %APPDATA%\Chud Tiles  |  ~/.config/Chud Tiles
}

export function cacheDir(...sub: string[]): string {
  const base = process.env.CT_USER_DATA
    ? join(process.env.CT_USER_DATA, 'Cache') // isolated test profile
    : process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Chud Tiles', 'Cache')
      : process.platform === 'darwin'
        ? join(homedir(), 'Library', 'Caches', 'Chud Tiles')
        : join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'chud-tiles');
  const dir = join(base, ...sub);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Chud Music's own files, read only (never written: see chud-music.ts). */
export function chudMusicPaths(): { db: string; covers: string } {
  const env = process.env.CT_CHUD_MUSIC_DATA; // tests: a copy of a Chud Music profile
  const data = env ?? join(app.getPath('appData'), 'Chud Music');
  const covers = env
    ? join(env, 'Cache', 'covers')
    : process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Chud Music', 'Cache', 'covers')
      : process.platform === 'darwin'
        ? join(homedir(), 'Library', 'Caches', 'Chud Music', 'covers')
        : join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'chud-music', 'covers');
  return { db: join(data, 'chud.db'), covers };
}
