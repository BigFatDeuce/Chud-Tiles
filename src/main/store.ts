import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { userDataDir } from './paths';

// The few things the main process keeps itself: window bounds, music folders, the ad blocker
// switch. A small JSON file, written atomically (temporary file, then rename).

export interface MainState {
  window?: { width: number; height: number; x?: number; y?: number; maximized?: boolean; fullscreen?: boolean };
  folders: string[];
  adblock: boolean;
  /** Safe mode asked for the next start (by the player, or after crashes). */
  safeNext?: 'asked' | 'crash' | null;
  /** Starts that have not reached a working interface yet (crash detection). */
  starting?: number;
}

const DEFAULTS: MainState = { folders: [], adblock: true };
let state: MainState | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

const file = () => join(userDataDir(), 'chud-tiles.json');

export function load(): MainState {
  if (state) return state;
  try {
    state = { ...DEFAULTS, ...(JSON.parse(readFileSync(file(), 'utf8')) as Partial<MainState>) };
  } catch {
    state = { ...DEFAULTS };
  }
  return state;
}

export function save(patch: Partial<MainState>): void {
  state = { ...load(), ...patch };
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, 300);
}

export function flush(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!state) return;
  try {
    const tmp = `${file()}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 1));
    renameSync(tmp, file());
  } catch {
    /* read-only profile: settings simply do not persist */
  }
}
