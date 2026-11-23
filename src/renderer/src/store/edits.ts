import type { TrackRef } from '@shared/types';
import { CHART_VERSION, type Chart, type DifficultyId, type Note } from '@core/chart/types';
import { chartStats } from '@core/chart/generate';
import * as db from '../storage/db';

// Charts edited in the workshop: the notes of one song, difficulty and number of lanes, saved
// over the generated chart (which stays available: "restore"). Kept in IndexedDB.

export interface EditedChart {
  notes: Note[];
  savedAt: number;
  /** Chart model the edit was made on (a newer generator does not erase it). */
  version: number;
}

export const editKey = (track: TrackRef, d: DifficultyId, lanes: number) => `edit:${track.key}|${d}|${lanes}`;

export async function loadEdit(track: TrackRef, d: DifficultyId, lanes: number): Promise<EditedChart | null> {
  return (await db.get<EditedChart>('kv', editKey(track, d, lanes)).catch(() => undefined)) ?? null;
}

export async function loadEdits(track: TrackRef, ds: DifficultyId[], lanes: number): Promise<Partial<Record<DifficultyId, EditedChart>>> {
  const out: Partial<Record<DifficultyId, EditedChart>> = {};
  for (const d of ds) {
    const e = await loadEdit(track, d, lanes);
    if (e) out[d] = e;
  }
  return out;
}

export async function saveEdit(track: TrackRef, d: DifficultyId, lanes: number, notes: Note[]): Promise<EditedChart> {
  const e: EditedChart = { notes: normalizeNotes(notes), savedAt: Date.now(), version: CHART_VERSION };
  await db.put('kv', e, editKey(track, d, lanes));
  return e;
}

export async function removeEdit(track: TrackRef, d: DifficultyId, lanes: number): Promise<void> {
  await db.del('kv', editKey(track, d, lanes)).catch(() => undefined);
}

/** Sorted, kinds from lengths, chords for notes struck together. */
export function normalizeNotes(notes: Note[]): Note[] {
  const out = notes
    .map((n) => ({ ...n, t: Math.round(n.t * 10000) / 10000, dur: n.dur > 0.05 ? n.dur : 0 }))
    .map((n) => ({ ...n, kind: (n.dur > 0 ? 1 : 0) as 0 | 1, chord: -1, live: undefined }))
    .sort((a, b) => a.t - b.t || a.lane - b.lane);
  let id = 0;
  for (let i = 0; i < out.length; ) {
    let j = i + 1;
    while (j < out.length && Math.abs(out[j].t - out[i].t) < 0.002) j++;
    if (j - i > 1) {
      for (let k = i; k < j; k++) out[k].chord = id;
      id++;
    }
    i = j;
  }
  return out;
}

/** The generated chart with the edited notes (and a practice range, if any). */
export function withEdit(chart: Chart, e: EditedChart | null | undefined, range?: { from: number; to: number } | null): Chart {
  if (!e) return chart;
  const notes = range ? e.notes.filter((n) => n.t >= range.from && n.t <= range.to) : e.notes;
  return { ...chart, notes, stats: chartStats(notes, chart.duration, chart.difficulty) };
}
