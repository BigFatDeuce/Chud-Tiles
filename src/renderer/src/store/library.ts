import { create } from 'zustand';
import type { TrackRef } from '@shared/types';
import * as db from '../storage/db';

// Songs the game knows: picked files, scanned folders, Chud Music's library, YouTube songs
// played. Stored in IndexedDB; play counts and last play feed "recent" and the home screen.

interface LibraryStore {
  tracks: Record<string, TrackRef>;
  loaded: boolean;
  load: () => Promise<void>;
  add: (refs: TrackRef[]) => Promise<void>;
  /** Marks a play (recents, counts). */
  touch: (ref: TrackRef) => Promise<void>;
  toggleFavorite: (key: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
}

export const useLibrary = create<LibraryStore>((set, get) => ({
  tracks: {},
  loaded: false,
  load: async () => {
    const all = await db.all<TrackRef>('tracks').catch(() => [] as TrackRef[]);
    set({ tracks: Object.fromEntries(all.map((t) => [t.key, t])), loaded: true });
  },
  add: async (refs) => {
    const cur = { ...get().tracks };
    for (const r of refs) {
      const prev = cur[r.key];
      // keep play history and favourites when a song is seen again
      cur[r.key] = { ...r, lastPlayed: prev?.lastPlayed ?? r.lastPlayed, plays: prev?.plays ?? r.plays ?? 0, favorite: prev?.favorite ?? r.favorite, cover: r.cover ?? prev?.cover ?? null };
      await db.put('tracks', cur[r.key]).catch(() => undefined);
    }
    set({ tracks: cur });
  },
  touch: async (ref) => {
    const prev = get().tracks[ref.key];
    const next: TrackRef = { ...(prev ?? ref), ...ref, lastPlayed: Date.now(), plays: (prev?.plays ?? 0) + 1, favorite: prev?.favorite ?? ref.favorite, cover: ref.cover ?? prev?.cover ?? null };
    set({ tracks: { ...get().tracks, [ref.key]: next } });
    await db.put('tracks', next).catch(() => undefined);
  },
  toggleFavorite: async (key) => {
    const t = get().tracks[key];
    if (!t) return;
    const next = { ...t, favorite: !t.favorite };
    set({ tracks: { ...get().tracks, [key]: next } });
    await db.put('tracks', next).catch(() => undefined);
  },
  remove: async (key) => {
    const cur = { ...get().tracks };
    delete cur[key];
    set({ tracks: cur });
    await db.del('tracks', key).catch(() => undefined);
  },
}));

export function recentTracks(tracks: Record<string, TrackRef>, n = 12): TrackRef[] {
  return Object.values(tracks)
    .filter((t) => t.lastPlayed)
    .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
    .slice(0, n);
}
