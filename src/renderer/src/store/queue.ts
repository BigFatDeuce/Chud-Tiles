import { create } from 'zustand';
import type { TrackRef } from '@shared/types';

// What plays next: a list started from "Listes", an album, or YouTube Music's radio of a song.
// The results screen offers the next song of the queue.

interface QueueStore {
  name: string | null;
  items: TrackRef[];
  index: number;
  start: (name: string, items: TrackRef[], index?: number) => void;
  /** The song after the current one (null at the end). */
  next: () => TrackRef | null;
  peek: () => TrackRef | null;
  /** The current song left the queue's order (opened from elsewhere). */
  sync: (key: string) => void;
  clear: () => void;
}

export const useQueue = create<QueueStore>((set, get) => ({
  name: null,
  items: [],
  index: -1,
  start: (name, items, index = 0) => set({ name, items, index }),
  peek: () => {
    const { items, index } = get();
    return index >= 0 && index + 1 < items.length ? items[index + 1] : null;
  },
  next: () => {
    const n = get().peek();
    if (n) set({ index: get().index + 1 });
    return n;
  },
  sync: (key) => {
    const { items, index } = get();
    if (items[index]?.key === key) return;
    const i = items.findIndex((t) => t.key === key);
    set(i >= 0 ? { index: i } : { name: null, items: [], index: -1 });
  },
  clear: () => set({ name: null, items: [], index: -1 }),
}));
