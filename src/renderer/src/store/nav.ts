import { create } from 'zustand';
import type { TrackRef } from '@shared/types';
import type { PlayRecord } from '@core/game/progress';
import type { Achievement } from '@core/game/progress';
import type { Chart } from '@core/chart/types';
import type { EditorParams } from '../pages/Editor';
import { engine } from '../gfx/engine';
import type { PlaceId } from '../gfx/cosmos';
import { playSfx } from '../audio/sfx';

// Navigation. Each page is a place of the universe: going to a page flies the camera there.

export interface GameParams {
  track: TrackRef;
  chart: Chart;
  /** Local songs: the decoded audio. YouTube songs: played by the official player. */
  buffer?: AudioBuffer;
  practice?: { from: number; to: number; loop: boolean; rate: number } | null;
  /** The game plays itself: preview of the chart. */
  autoplay?: boolean;
  /** YouTube, Mode A: no chart yet, notes are predicted while the song plays. */
  live?: boolean;
}

export interface ResultParams {
  record: PlayRecord;
  offsets: number[];
  chart: Chart;
  track: TrackRef;
  xp: number;
  unlocked: Achievement[];
  previousBest: PlayRecord | null;
  game: GameParams;
}

export type Page =
  | { id: 'home' }
  | { id: 'library' }
  | { id: 'search'; query?: string }
  | { id: 'playlists' }
  | { id: 'stats' }
  | { id: 'settings'; tab?: string }
  | { id: 'calibration' }
  | { id: 'song'; track: TrackRef; file?: File }
  | { id: 'game'; game: GameParams }
  | { id: 'results'; result: ResultParams }
  | { id: 'editor'; editor: EditorParams };

const PLACE: Record<Page['id'], PlaceId> = {
  home: 'home',
  library: 'library',
  search: 'search',
  playlists: 'playlists',
  stats: 'stats',
  settings: 'settings',
  calibration: 'calibration',
  song: 'song',
  game: 'game',
  results: 'results',
  editor: 'song',
};

interface NavStore {
  page: Page;
  stack: Page[];
  /** Increments on every change: keys page transitions. */
  n: number;
  go: (p: Page, opts?: { replace?: boolean; silent?: boolean }) => void;
  back: () => void;
}

export const useNav = create<NavStore>((set, get) => ({
  page: { id: 'home' },
  stack: [],
  n: 0,
  go: (p, opts) => {
    const cur = get().page;
    const place = PLACE[p.id];
    if (engine.cosmos.place !== place) {
      engine.cosmos.goTo(place);
      if (!opts?.silent) playSfx('whoosh', 0.8);
    }
    set({ page: p, stack: opts?.replace ? get().stack : [...get().stack, cur].slice(-20), n: get().n + 1 });
  },
  back: () => {
    const st = get().stack;
    const prev = st[st.length - 1];
    if (!prev || prev.id === 'game') {
      get().go({ id: 'home' }, { replace: true });
      return;
    }
    engine.cosmos.goTo(PLACE[prev.id]);
    playSfx('back', 0.8);
    set({ page: prev, stack: st.slice(0, -1), n: get().n + 1 });
  },
}));

export const go = (p: Page, opts?: { replace?: boolean; silent?: boolean }) => useNav.getState().go(p, opts);
