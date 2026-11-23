import { F_RMS, FRAME_SIZE } from './frame.ts';
import type { FeatureTrack } from './features.ts';
import { detectionFunctions, detectOnsets, type Onset } from './onsets.ts';
import { analyzeBeats, beatPosition, type BeatGrid } from './tempo.ts';
import { analyzeStructure, type Structure } from './structure.ts';

/** Bumped whenever the analysis changes: cached analyses of an older version are redone. */
export const ANALYSIS_VERSION = 3;

export type Feel = 'straight' | 'triplet';

/** Everything the chart generator needs to know about a song. Plain data: cacheable as is. */
export interface Analysis {
  version: number;
  duration: number;
  grid: BeatGrid;
  onsets: Onset[];
  structure: Structure;
  /** Rhythmic feel of each section (same order as structure.sections). */
  feel: Feel[];
  /** Ranges (s) with no sound at all: no note may be placed there. */
  silences: [number, number][];
  /** Where the analysis came from. */
  source: 'offline' | 'learned';
}

export function analyzeTrack(ft: FeatureTrack, duration: number, source: Analysis['source'] = 'offline'): Analysis {
  const odf = detectionFunctions(ft);
  const onsets = detectOnsets(ft, odf);
  const grid = analyzeBeats(ft, odf, onsets);
  const structure = analyzeStructure(ft, grid, onsets, duration);
  const feel = structure.sections.map((s) => detectFeel(grid, onsets.filter((o) => o.t >= s.start && o.t < s.end)));
  return { version: ANALYSIS_VERSION, duration, grid, onsets, structure, feel, silences: findSilences(ft), source };
}

/** Straight (binary subdivisions) or triplet/shuffle, from where the off-beat attacks fall. */
export function detectFeel(grid: BeatGrid, onsets: Onset[]): Feel {
  let straight = 0;
  let triplet = 0;
  for (const o of onsets) {
    const p = beatPosition(grid.beats, o.t);
    const f = p - Math.floor(p);
    if (f < 0.12 || f > 0.88) continue; // on the beat: says nothing
    const ds = Math.min(...[0.25, 0.5, 0.75].map((g) => Math.abs(f - g)));
    const dt = Math.min(...[1 / 3, 2 / 3].map((g) => Math.abs(f - g)));
    const w = Math.min(2, o.s);
    if (dt + 0.02 < ds) triplet += w;
    else if (ds + 0.02 < dt) straight += w;
  }
  return triplet > 1.3 * straight && triplet > 3 ? 'triplet' : 'straight';
}

/** Stretches of at least 1.2 s where the level stays 45 dB under the song's loud level. */
function findSilences(ft: FeatureTrack): [number, number][] {
  let peak = 0;
  for (let i = 0; i < ft.n; i++) peak = Math.max(peak, ft.frames[i * FRAME_SIZE + F_RMS]);
  const floor = peak * Math.pow(10, -45 / 20);
  const out: [number, number][] = [];
  let from = -1;
  for (let i = 0; i <= ft.n; i++) {
    const quiet = i < ft.n && ft.frames[i * FRAME_SIZE + F_RMS] < floor;
    if (quiet && from < 0) from = i;
    if (!quiet && from >= 0) {
      const a = ft.t0 + from * ft.step;
      const b = ft.t0 + i * ft.step;
      if (b - a >= 1.2) out.push([a, b]);
      from = -1;
    }
  }
  return out;
}
