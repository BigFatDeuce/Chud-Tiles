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

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[([][^)\]]*(official|video|audio|lyric|clip|visuali[sz]er|hd|4k|remaster|music)[^)\]]*[)\]]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * The same song seen under several keys (a picked file and the scanned folder, Chud Music's copy,
 * the YouTube clip and the audio track) has one identity: its title and artist, cleaned of the
 * usual decorations ("(Official Video)", "Artist - Topic"…).
 */
export function songId(t: Pick<TrackRef, 'key' | 'title' | 'artist'>): string {
  const artist = fold((t.artist ?? '').replace(/\s*-\s*topic$/i, '').replace(/vevo$/i, ''));
  let title = fold(t.title);
  if (artist && title.startsWith(`${artist} `)) title = title.slice(artist.length + 1);
  return title ? `${artist}|${title}` : t.key;
}

/** Keeps the first of each song (lists already sorted by what matters). */
export function uniqueSongs<T extends Pick<TrackRef, 'key' | 'title' | 'artist'>>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((t) => {
    const id = songId(t);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function recentTracks(tracks: Record<string, TrackRef>, n = 12): TrackRef[] {
  return uniqueSongs(
    Object.values(tracks)
      .filter((t) => t.lastPlayed)
      .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0)),
  ).slice(0, n);
}
