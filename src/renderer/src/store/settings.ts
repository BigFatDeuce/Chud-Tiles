import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DifficultyId, DifficultyParams } from '@core/chart/types';
import type { Quality } from '../gfx/engine';
import { tr, type LangSetting } from '../i18n';

// Every setting of the game, kept in localStorage (read synchronously at start, so the first
// image already uses the right quality and offsets).

export type Bindings = Record<number, string[][]>;
export type PadBindings = Record<number, number[][]>;

/** Keyboard: home row, symmetrical around the middle; arrows as an alternative for 4 lanes. */
export const DEFAULT_KEYS: Bindings = {
  3: [['KeyF', 'ArrowLeft'], ['Space', 'ArrowDown'], ['KeyJ', 'ArrowRight']],
  4: [['KeyD', 'ArrowLeft'], ['KeyF', 'ArrowDown'], ['KeyJ', 'ArrowUp'], ['KeyK', 'ArrowRight']],
  5: [['KeyD'], ['KeyF'], ['Space'], ['KeyJ'], ['KeyK']],
  6: [['KeyS'], ['KeyD'], ['KeyF'], ['KeyJ'], ['KeyK'], ['KeyL']],
  7: [['KeyS'], ['KeyD'], ['KeyF'], ['Space'], ['KeyJ'], ['KeyK'], ['KeyL']],
};

/** Gamepad (standard mapping): D-pad and shoulders on the left, face buttons and shoulders on the right. */
export const DEFAULT_PAD: PadBindings = {
  3: [[14, 4], [13, 0], [1, 5]],
  4: [[14, 4], [13, 6], [0, 7], [1, 5]],
  5: [[14, 4], [13, 6], [12, 3], [0, 7], [1, 5]],
  6: [[14], [13], [4], [5], [0], [1]],
  7: [[14], [13], [4], [12], [5], [0], [1]],
};

export interface Settings {
  lanes: number;
  difficulty: DifficultyId;
  custom: Partial<DifficultyParams>;
  /** Seconds a note stays visible before reaching the hit line. */
  approach: number;
  /** Track tilt (degrees, 0 = flat). */
  tilt: number;
  fail: boolean;
  /** + = the sound reaches the ears later than the system says (Bluetooth, TV). */
  audioOffsetMs: number;
  /** + = images appear later than expected. */
  visualOffsetMs: number;
  keys: Bindings;
  pad: PadBindings;
  volume: { master: number; music: number; sfx: number };
  hitSounds: boolean;
  quality: Quality | 'auto';
  fpsCap: number;
  menuFps30: boolean;
  /** Visual effects: 1 full, 0.5 reduced, 0 minimal. */
  effects: number;
  showFps: boolean;
  reducedMotion: boolean;
  autoPause: boolean;
  showOffsets: boolean;
  /** YouTube: analyse live, or wait for a first listen to learn the song. */
  ytMode: 'live' | 'learn-first';
  /** Extra offset for YouTube songs (+ = the sound of the YouTube player arrives later). */
  ytOffsetMs: number;
  calibrated: boolean;
  /** Language of the interface ('auto': the system's). Applied by reloading the interface. */
  lang: LangSetting;
}

export const DEFAULTS: Settings = {
  lanes: 4,
  difficulty: 'normal',
  custom: {},
  approach: 1.25,
  tilt: 26,
  fail: true,
  audioOffsetMs: 0,
  visualOffsetMs: 0,
  keys: DEFAULT_KEYS,
  pad: DEFAULT_PAD,
  volume: { master: 0.9, music: 1, sfx: 0.6 },
  hitSounds: false,
  quality: 'auto',
  fpsCap: 0,
  menuFps30: false,
  effects: 1,
  showFps: false,
  reducedMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  autoPause: true,
  showOffsets: true,
  ytMode: 'live',
  ytOffsetMs: 0,
  calibrated: false,
  lang: 'auto',
};

interface SettingsStore extends Settings {
  set: (patch: Partial<Settings>) => void;
  reset: (keys?: (keyof Settings)[]) => void;
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      set: (patch) => set(patch),
      reset: (keys) => set(keys ? Object.fromEntries(keys.map((k) => [k, DEFAULTS[k]])) : DEFAULTS),
    }),
    {
      name: 'chud-tiles-settings',
      version: 1,
      merge: (persisted, current) => ({ ...current, ...(persisted as Partial<Settings>), keys: { ...DEFAULT_KEYS, ...(persisted as Settings)?.keys }, pad: { ...DEFAULT_PAD, ...(persisted as Settings)?.pad } }),
    },
  ),
);

export const settings = () => useSettings.getState();

/** Human-readable name of a key code. */
export function keyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return tr('Pavé {k}', { k: code.slice(6) });
  const names: Record<string, string> = { Space: tr('Espace'), ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', ShiftLeft: tr('Maj G'), ShiftRight: tr('Maj D'), ControlLeft: tr('Ctrl G'), ControlRight: tr('Ctrl D'), Semicolon: ';', Comma: ',', Period: '.', Slash: '/', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Enter: tr('Entrée'), Tab: 'Tab', AltLeft: 'Alt', AltRight: 'Alt Gr' };
  return names[code] ?? code;
}

const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Select', 'Start', 'L3', 'R3', '↑', '↓', '←', '→', 'Home'];
export const padName = (b: number) => PAD_NAMES[b] ?? tr('Bouton {b}', { b });
