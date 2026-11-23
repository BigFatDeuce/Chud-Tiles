import type { DifficultyParams } from './types.ts';
import { HAT, KICK, SNARE, TONAL } from '../analysis/onsets.ts';

// Shared by the offline generator and the real-time predictor: how much an attack matters
// (metric position, instrument), how dense a passage should be, and the spacing rules.

/** Metric levels of a grid position. */
export const DOWNBEAT = 0;
export const BEAT = 1;
export const EIGHTH = 2;
export const SIXTEENTH = 3;
export const TRIPLET = 4;
export const FREE = 5;

export const METRIC_WEIGHT = [1.0, 0.85, 0.62, 0.45, 0.5, 0.55];

export function classWeight(cls: number): number {
  return cls === KICK ? 1.0 : cls === SNARE ? 1.0 : cls === HAT ? 0.7 : cls === TONAL ? 0.9 : 0.6;
}

/** Whether a difficulty plays attacks at this metric level. */
export function levelAllowed(p: DifficultyParams, level: number, triplet: boolean): boolean {
  if (level <= BEAT) return true;
  if (level === EIGHTH) return p.finest >= 2;
  if (level === SIXTEENTH) return p.finest >= 4;
  // swung eighths are triplet positions: played wherever eighths are
  if (level === TRIPLET) return triplet ? p.finest >= 2 : p.triplets;
  return p.finest >= 2; // off-grid accents
}

/** Target notes per beat for an intensity in 0–1. */
export function densityFor(p: DifficultyParams, intensity: number): number {
  return p.densityLo + (p.densityHi - p.densityLo) * Math.pow(Math.max(0, Math.min(1, intensity)), 1.3);
}

/** Selected note times, with the spacing and notes-per-second rules of a difficulty. */
export class Spacing {
  private times: number[] = [];

  get count(): number {
    return this.times.length;
  }

  private lower(t: number): number {
    let lo = 0;
    let hi = this.times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.times[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Gap to the nearest selected note. */
  gap(t: number): number {
    const i = this.lower(t);
    let g = Infinity;
    if (i < this.times.length) g = Math.min(g, this.times[i] - t);
    if (i > 0) g = Math.min(g, t - this.times[i - 1]);
    return g;
  }

  /** Notes in [a, b). */
  countIn(a: number, b: number): number {
    return this.lower(b) - this.lower(a);
  }

  canAdd(t: number, p: DifficultyParams, gapScale = 1): boolean {
    if (this.gap(t) < p.minGap * gapScale) return false;
    // every 1-second window that contains t stays under the cap
    const cap = Math.floor(p.maxNps);
    for (let k = 0; k <= 4; k++) {
      const a = t - 1 + k * 0.25;
      if (this.countIn(a, a + 1) + 1 > cap) return false;
    }
    return true;
  }

  add(t: number): void {
    this.times.splice(this.lower(t), 0, t);
  }

  remove(t: number): void {
    const i = this.lower(t);
    if (i < this.times.length && Math.abs(this.times[i] - t) < 1e-9) this.times.splice(i, 1);
  }
}
