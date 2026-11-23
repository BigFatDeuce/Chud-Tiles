import { create } from 'zustand';
import type { Playlist, TrackRef, YtItem } from '@shared/types';
import * as db from '../storage/db';
import { useLibrary } from './library';

// Lists of songs: made in Chud Tiles, imported from Chud Music (read from its library, never
// written back), or saved from YouTube Music. Kept in IndexedDB with the songs themselves in the
// archives.

interface PlaylistStore {
  lists: Playlist[];
  loaded: boolean;
  load: () => Promise<void>;
  save: (p: Playlist) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Chud Music's lists replace the previous import (they follow Chud Music). */
  setChudMusic: (lists: Playlist[]) => Promise<void>;
}

const persist = (lists: Playlist[]) => db.put('kv', lists, 'playlists').catch(() => undefined);

export const usePlaylists = create<PlaylistStore>((set, get) => ({
  lists: [],
  loaded: false,
  load: async () => {
    const lists = (await db.get<Playlist[]>('kv', 'playlists').catch(() => undefined)) ?? [];
    set({ lists, loaded: true });
  },
  save: async (p) => {
    const lists = [...get().lists.filter((l) => l.id !== p.id), p];
    set({ lists });
    await persist(lists);
  },
  remove: async (id) => {
    const lists = get().lists.filter((l) => l.id !== id);
    set({ lists });
    await persist(lists);
  },
  setChudMusic: async (cm) => {
    const lists = [...get().lists.filter((l) => l.origin !== 'chud-music'), ...cm];
    set({ lists });
    await persist(lists);
  },
}));

/** A YouTube Music result as a song of the archives. */
export function ytTrack(it: YtItem): TrackRef {
  return { key: `yt:${it.id}`, source: 'youtube', videoId: it.id, title: it.title, artist: it.artist, album: it.album ?? null, duration: it.duration, cover: it.thumbnail, origin: 'youtube' };
}

/** Saves a YouTube album or playlist as a list (its songs join the archives). */
export async function saveYtList(id: string, name: string, items: YtItem[]): Promise<Playlist> {
  const refs = items.filter((i) => i.kind === 'song' || i.kind === 'video').map(ytTrack);
  await useLibrary.getState().add(refs);
  const p: Playlist = { id: `youtube:${id}`, name, tracks: refs.map((r) => r.key), origin: 'youtube', cover: refs[0]?.cover ?? null };
  await usePlaylists.getState().save(p);
  return p;
}
