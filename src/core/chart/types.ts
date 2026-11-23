// Charts: the notes a player plays, and the rules each difficulty follows.

export type DifficultyId = 'easy' | 'normal' | 'hard' | 'expert' | 'custom';
export const DIFFICULTIES: Exclude<DifficultyId, 'custom'>[] = ['easy', 'normal', 'hard', 'expert'];

export interface DifficultyParams {
  lanes: number;
  /** Finest subdivision of the beat used (1 = quarter notes, 2 = eighths, 4 = sixteenths). */
  finest: 1 | 2 | 4;
  /** Triplet subdivisions allowed where the music swings. */
  triplets: boolean;
  /** Minimum time between two notes (any lanes), s. Chords excepted. */
  minGap: number;
  /** Minimum time between two notes in the same lane, s. */
  laneGap: number;
  /** Max notes in any 1-second window. */
  maxNps: number;
  /** Target notes per beat at the calmest (lo) and most intense (hi) moments. */
  densityLo: number;
  densityHi: number;
  /** Share of notes that may be chords. */
  chordRate: number;
  /** Share of chords that may have three notes (needs ≥ 4 lanes). */
  tripleRate: number;
  /** Share of notes that may become long notes. */
  holdRate: number;
  /** Shortest long note, in beats. */
  minHoldBeats: number;
  /** Nothing else to play while a long note is held. */
  holdExclusive: boolean;
  /** Most keys down at once (long notes included). */
  maxFingers: number;
  /** Judgement windows multiplier (1 = standard). */
  windowScale: number;
  /** Below this salience (0–1, relative to the song), an attack never becomes a note. */
  floor: number;
}

export const PRESETS: Record<Exclude<DifficultyId, 'custom'>, DifficultyParams> = {
  easy: { lanes: 4, finest: 2, triplets: false, minGap: 0.3, laneGap: 0.45, maxNps: 3.5, densityLo: 0.35, densityHi: 1.0, chordRate: 0, tripleRate: 0, holdRate: 0.2, minHoldBeats: 1, holdExclusive: true, maxFingers: 2, windowScale: 1.15, floor: 0.25 },
  normal: { lanes: 4, finest: 2, triplets: false, minGap: 0.17, laneGap: 0.26, maxNps: 5.5, densityLo: 0.6, densityHi: 1.75, chordRate: 0.04, tripleRate: 0, holdRate: 0.22, minHoldBeats: 1, holdExclusive: false, maxFingers: 2, windowScale: 1.05, floor: 0.18 },
  hard: { lanes: 4, finest: 4, triplets: true, minGap: 0.115, laneGap: 0.17, maxNps: 8, densityLo: 0.9, densityHi: 2.7, chordRate: 0.09, tripleRate: 0, holdRate: 0.22, minHoldBeats: 1, holdExclusive: false, maxFingers: 3, windowScale: 1, floor: 0.12 },
  expert: { lanes: 4, finest: 4, triplets: true, minGap: 0.085, laneGap: 0.12, maxNps: 12, densityLo: 1.2, densityHi: 3.8, chordRate: 0.15, tripleRate: 0.08, holdRate: 0.22, minHoldBeats: 1, holdExclusive: false, maxFingers: 4, windowScale: 1, floor: 0.08 },
};

export function paramsFor(id: DifficultyId, custom?: Partial<DifficultyParams>, lanes?: number): DifficultyParams {
  const base = id === 'custom' ? { ...PRESETS.normal, ...custom } : { ...PRESETS[id] };
  if (lanes) base.lanes = lanes;
  base.lanes = Math.max(3, Math.min(7, Math.round(base.lanes)));
  return base;
}

export const TAP = 0;
export const HOLD = 1;

export interface Note {
  /** Hit time, s (song time). */
  t: number;
  lane: number;
  /** Long note: length in s (0 for a tap). */
  dur: number;
  kind: 0 | 1;
  /** Notes of one chord share a group id (-1: alone). */
  chord: number;
  /** Musical weight (0–1+): effects and scoring hints. */
  w: number;
  /** Instrument family it came from (onsets.ts classes). */
  cls: number;
  /** Predicted in real time (Mode A): dissolves without penalty if the music does not confirm it. */
  live?: boolean;
}

export interface ChartStats {
  notes: number;
  holds: number;
  chords: number;
  /** Mean and peak notes per second (1-s windows). */
  nps: number;
  peakNps: number;
  /** 1–20 rating. */
  level: number;
}

export interface Chart {
  version: number;
  difficulty: DifficultyId;
  params: DifficultyParams;
  notes: Note[];
  /** For the beat lines and pulsing visuals. */
  beats: number[];
  downbeat: number;
  meter: number;
  bpm: number;
  sections: { start: number; end: number; intensity: number; chorus: boolean }[];
  duration: number;
  source: 'offline' | 'learned' | 'live';
  stats: ChartStats;
  seed: number;
}

export const CHART_VERSION = 5;
