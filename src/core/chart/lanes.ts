import type { DifficultyParams } from './types.ts';
import { HAT, KICK, SNARE, TONAL } from '../analysis/onsets.ts';

// Lane assignment: which column each note goes to. A sequence of small decisions, each one the
// cheapest choice under a cost that encodes what makes a chart feel musical and fair:
//   · never a lane still held by a long note, never a same-lane repeat faster than the rules allow
//   · a riff that comes back reuses the lanes it had (strong preference)
//   · melody: pitch going up moves right, going down moves left
//   · instruments lean to a side (kick left, snare right), cymbal streams alternate
//   · hands stay balanced, fast passages alternate hands
//   · no lane overused, no monotonous back-and-forth that the music does not ask for
// A little seeded noise breaks ties, so two similar passages are not mechanically identical
// unless the music repeats.

export interface LaneEvent {
  t: number;
  /** Notes in this event (1 = single, 2–3 = chord). */
  size: number;
  cls: number;
  pc: number;
  pcClarity: number;
  /** Lanes suggested by the repeated bar (empty: none). */
  hint: number[];
  /** Duration of a long note starting here (s, 0 = tap). */
  dur: number;
}

export class LaneAssigner {
  private readonly lanes: number;
  /** Time each lane is free again (end of a long note), and the last hit time per lane. */
  private readonly busyUntil: Float64Array;
  private readonly lastHit: Float64Array;
  private readonly history: number[] = [];
  private lastT = -10;
  private lastLanes: number[] = [];
  private lastPitch = -1;
  private hatSide = 0;
  private readonly p: DifficultyParams;
  private readonly rand: () => number;

  constructor(p: DifficultyParams, rand: () => number) {
    this.p = p;
    this.rand = rand;
    this.lanes = p.lanes;
    this.busyUntil = new Float64Array(this.lanes).fill(-10);
    this.lastHit = new Float64Array(this.lanes).fill(-10);
  }

  private hand(l: number): number {
    // the middle lane of an odd count belongs to neither hand
    const n = this.lanes;
    if (n % 2 === 1 && l === (n - 1) / 2) return 0.5;
    return l < n / 2 ? 0 : 1;
  }

  /** Lanes that can take a note at time t (free and not jacked too fast). */
  available(t: number): number[] {
    const out: number[] = [];
    for (let l = 0; l < this.lanes; l++) if (this.busyUntil[l] <= t - 0.05 && t - this.lastHit[l] >= this.p.laneGap) out.push(l);
    return out;
  }

  /** Keys held at time t (long notes not yet released). */
  heldAt(t: number): number {
    let c = 0;
    for (let l = 0; l < this.lanes; l++) if (this.busyUntil[l] > t) c++;
    return c;
  }

  /** Chooses lanes for one event; null when nothing is playable (the event is then dropped). */
  assign(e: LaneEvent): number[] | null {
    const free = this.available(e.t);
    if (!free.length) return null;
    const size = Math.min(e.size, free.length, Math.max(1, this.p.maxFingers - this.heldAt(e.t)));
    if (size < 1) return null;
    const combos = size === 1 ? free.map((l) => [l]) : combinations(free, size);
    let best: number[] | null = null;
    let bestCost = Infinity;
    for (const c of combos) {
      const cost = this.cost(e, c);
      if (cost < bestCost) {
        bestCost = cost;
        best = c;
      }
    }
    if (!best) return null;
    this.commit(e, best);
    return best;
  }

  private cost(e: LaneEvent, lanes: number[]): number {
    const n = this.lanes;
    const gap = e.t - this.lastT;
    const fast = gap < Math.max(0.2, this.p.minGap * 1.8);
    let cost = this.rand() * 0.35;
    for (const l of lanes) {
      // same lane again: allowed by the rules, but less pleasant the shorter the gap
      const since = e.t - this.lastHit[l];
      if (since < 0.6) cost += 1.2 * (1 - since / 0.6);
      // repeated music → repeated lanes
      if (e.hint.length) cost += e.hint.includes(l) ? -2.5 : 0.6;
      // overuse in the recent past
      let used = 0;
      for (let k = Math.max(0, this.history.length - 8); k < this.history.length; k++) if (this.history[k] === l) used++;
      cost += Math.max(0, used - 8 / n) * 0.5;
    }
    if (lanes.length === 1) {
      const l = lanes[0];
      const pos = n > 1 ? l / (n - 1) : 0.5; // 0 left … 1 right
      const prev = this.lastLanes.length === 1 ? this.lastLanes[0] : -1;
      // instruments lean to a side
      if (e.cls === KICK) cost += pos * 0.7;
      else if (e.cls === SNARE) cost += (1 - pos) * 0.7;
      else if (e.cls === HAT) {
        // cymbal streams sweep from one side to the other
        const want = this.hatSide;
        cost += Math.abs(pos - want) * 0.5;
      } else if (e.cls === TONAL && prev >= 0 && this.lastPitch >= 0 && e.pcClarity > 0.2) {
        // melodic contour: the smallest interval to the previous pitch decides the direction
        let d = e.pc - this.lastPitch;
        if (d > 6) d -= 12;
        if (d < -6) d += 12;
        const move = l - prev;
        if (d !== 0 && move !== 0 && Math.sign(d) !== Math.sign(move)) cost += 0.9 * Math.min(1, Math.abs(d) / 3) * e.pcClarity;
        if (d === 0 && move !== 0) cost += 0.25 * e.pcClarity;
      }
      if (prev >= 0) {
        // fast passages: alternate hands, avoid wide jumps
        if (fast && this.hand(l) === this.hand(prev) && this.hand(l) !== 0.5) cost += 0.8;
        if (fast) cost += Math.max(0, Math.abs(l - prev) - 2) * 0.4;
        // ping-pong between two lanes for more than 4 notes: boring unless the music insists
        const h = this.history;
        if (h.length >= 4 && h[h.length - 1] === h[h.length - 3] && h[h.length - 2] === h[h.length - 4] && l === h[h.length - 2]) cost += 0.9;
        // three in a row on the same lane
        if (h.length >= 2 && h[h.length - 1] === l && h[h.length - 2] === l) cost += 1.5;
      }
    } else {
      // chords: one note per hand reads best; adjacent lanes are fine too, the same lanes again less so
      const hands = new Set(lanes.map((l) => this.hand(l)));
      if (hands.size === 1) cost += 0.6;
      if (this.lastLanes.length > 1 && lanes.every((l) => this.lastLanes.includes(l))) cost += 0.8;
    }
    return cost;
  }

  private commit(e: LaneEvent, lanes: number[]): void {
    for (const l of lanes) {
      this.lastHit[l] = e.t;
      if (e.dur > 0) this.busyUntil[l] = e.t + e.dur;
      this.history.push(l);
    }
    if (this.history.length > 32) this.history.splice(0, this.history.length - 32);
    this.lastT = e.t;
    this.lastLanes = lanes;
    if (e.cls === TONAL && e.pcClarity > 0.2) this.lastPitch = e.pc;
    if (e.cls === HAT) {
      const n = this.lanes;
      const pos = n > 1 ? lanes[0] / (n - 1) : 0.5;
      // sweep direction flips at the edges
      this.hatSide = pos >= 0.99 ? 0 : pos <= 0.01 ? 1 : this.hatSide;
    }
  }
}

function combinations(xs: number[], k: number): number[][] {
  const out: number[][] = [];
  const rec = (start: number, acc: number[]) => {
    if (acc.length === k) {
      out.push(acc.slice());
      return;
    }
    for (let i = start; i < xs.length; i++) {
      acc.push(xs[i]);
      rec(i + 1, acc);
      acc.pop();
    }
  };
  rec(0, []);
  return out;
}
