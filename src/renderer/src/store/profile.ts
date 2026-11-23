import { create } from 'zustand';
import type { DifficultyId } from '@core/chart/types';
import { applyRun, emptyProfile, type Achievement, type PlayRecord, type Profile } from '@core/game/progress';
import * as db from '../storage/db';

// The player: profile (experience, achievements, totals) and every finished run.

interface ProfileStore {
  profile: Profile;
  loaded: boolean;
  /** Most recent runs (history page, home), newest first. */
  recent: PlayRecord[];
  load: () => Promise<void>;
  /** Stores a finished run; returns what it changed. */
  saveRun: (r: PlayRecord) => Promise<{ xp: number; unlocked: Achievement[]; previousBest: PlayRecord | null }>;
  markCalibrated: () => Promise<Achievement[]>;
}

export const useProfile = create<ProfileStore>((set, get) => ({
  profile: emptyProfile(),
  loaded: false,
  recent: [],
  load: async () => {
    const p = await db.get<Profile>('kv', 'profile').catch(() => undefined);
    const all = await db.all<PlayRecord>('records').catch(() => [] as PlayRecord[]);
    all.sort((a, b) => b.playedAt - a.playedAt);
    set({ profile: { ...emptyProfile(), ...p }, recent: all.slice(0, 200), loaded: true });
  },
  saveRun: async (r) => {
    // a chart preview leaves no trace (no history, no experience, no trophy)
    if (r.autoplay) return { xp: 0, unlocked: [], previousBest: null };
    const runs = await db.byIndex<PlayRecord>('records', 'track', r.trackKey).catch(() => [] as PlayRecord[]);
    const real = runs.filter((x) => !x.practice);
    const previousBest = best(real, r.difficulty, r.lanes);
    const clearedOnSong = new Set<DifficultyId>(real.filter((x) => x.cleared).map((x) => x.difficulty));
    if (r.cleared && !r.practice) clearedOnSong.add(r.difficulty);
    const res = applyRun(get().profile, r, { clearedOnSong, newSong: runs.length === 0 });
    await db.put('records', r).catch(() => undefined);
    await db.put('kv', res.profile, 'profile').catch(() => undefined);
    set({ profile: res.profile, recent: [r, ...get().recent].slice(0, 200) });
    return { xp: res.xp, unlocked: res.unlocked, previousBest };
  },
  markCalibrated: async () => {
    const p = { ...get().profile, calibrated: true };
    const unlocked: Achievement[] = [];
    if (!p.achievements.calibrated) {
      p.achievements = { ...p.achievements, calibrated: Date.now() };
      const { ACHIEVEMENTS } = await import('@core/game/progress');
      const a = ACHIEVEMENTS.find((x) => x.id === 'calibrated');
      if (a) unlocked.push(a);
    }
    set({ profile: p });
    await db.put('kv', p, 'profile').catch(() => undefined);
    return unlocked;
  },
}));

/** Best run (score) for a difficulty and lane count among runs. */
export function best(runs: PlayRecord[], difficulty: DifficultyId, lanes?: number): PlayRecord | null {
  let b: PlayRecord | null = null;
  for (const r of runs) {
    if (r.practice || r.difficulty !== difficulty || (lanes && r.lanes !== lanes)) continue;
    if (!b || r.score > b.score) b = r;
  }
  return b;
}

export async function runsOf(trackKey: string): Promise<PlayRecord[]> {
  return db.byIndex<PlayRecord>('records', 'track', trackKey).catch(() => [] as PlayRecord[]);
}
