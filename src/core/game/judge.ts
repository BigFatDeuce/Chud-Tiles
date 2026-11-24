import type { Note } from '../chart/types.ts';

// Judgement and score. Everything is decided from times (song time of the press, of the note),
// never from frames: a press is judged the same at 30 or 240 images per second.

export type Judgement = 'perfect' | 'great' | 'good' | 'miss';

/** Half-widths of the judgement windows, s (× the difficulty's windowScale). */
export const WINDOWS = { perfect: 0.045, great: 0.09, good: 0.135 };
/**
 * Dead centre: the tile's centre line right on the hit line. A perfect this close is worth half as
 * much again, and dead-centre hits in a row build the centre streak, a bonus on top of the combo.
 */
export const CENTRE_WINDOW = 0.02;
const POINTS = { perfect: 1000, great: 600, good: 250, miss: 0 };
export const CENTRE_POINTS = 1500;
/** +10 % per dead-centre hit in a row, up to +100 %. */
export const centreBonus = (streak: number) => 1 + 0.1 * Math.min(Math.max(streak - 1, 0), 10);
const ACC = { perfect: 1, great: 0.7, good: 0.4, miss: 0 };
/** Releasing this long before the end of a long note still counts as held to the end. */
export const RELEASE_GRACE = 0.15;

export type JudgeEventKind = 'hit' | 'miss' | 'hold-ok' | 'hold-break' | 'ghost' | 'stray';

export interface JudgeEvent {
  kind: JudgeEventKind;
  /** Index of the note in the judge's list (-1 for a stray press). */
  note: number;
  lane: number;
  judgement?: Judgement;
  /** Press time minus note time, s (negative = early). */
  offset?: number;
  /** Dead centre (a perfect within the centre window). */
  centre?: boolean;
  /** Points won by this event (multipliers included). */
  points?: number;
  t: number;
}

export interface ScoreState {
  score: number;
  combo: number;
  maxCombo: number;
  perfect: number;
  great: number;
  good: number;
  miss: number;
  holdOk: number;
  holdBreak: number;
  stray: number;
  ghosts: number;
  /** Sum of accuracy values and number of judged items (heads + tails). */
  accSum: number;
  judged: number;
  /** 0–100; the run fails at 0 when failing is enabled. */
  energy: number;
  failed: boolean;
  multiplier: number;
  /** Dead-centre hits (counted among the perfects), the current and best streaks of them. */
  centre: number;
  centreStreak: number;
  bestCentreStreak: number;
  /** Signed offsets of every hit (s), for the timing histogram and calibration hints. */
  offsets: number[];
}

export interface JudgeOptions {
  windowScale?: number;
  /** The run can fail (energy at zero). */
  fail?: boolean;
  /** Live notes: was this predicted note real? A note the music does not confirm dissolves. */
  confirm?: (t: number) => boolean;
}

/** Combo tiers: ×2 at 25, ×3 at 50, ×4 at 100, ×6 at 200, ×8 at 400. */
export const COMBO_TIERS = [25, 50, 100, 200, 400];
export function multiplierFor(combo: number): number {
  return combo >= 400 ? 8 : combo >= 200 ? 6 : combo >= 100 ? 4 : combo >= 50 ? 3 : combo >= 25 ? 2 : 1;
}

/** 0 below the first tier, then 1 to 5. */
export function comboTier(combo: number): number {
  let k = 0;
  for (const t of COMBO_TIERS) if (combo >= t) k++;
  return k;
}

export function emptyScore(): ScoreState {
  return { score: 0, combo: 0, maxCombo: 0, perfect: 0, great: 0, good: 0, miss: 0, holdOk: 0, holdBreak: 0, stray: 0, ghosts: 0, accSum: 0, judged: 0, energy: 100, failed: false, multiplier: 1, centre: 0, centreStreak: 0, bestCentreStreak: 0, offsets: [] };
}

export function accuracyOf(s: ScoreState): number {
  return s.judged ? s.accSum / s.judged : 1;
}

export type Rank = 'SS' | 'S' | 'A' | 'B' | 'C' | 'D';
export function rankOf(s: ScoreState): Rank {
  const a = accuracyOf(s);
  if (a >= 0.99 && s.miss === 0 && s.holdBreak === 0) return 'SS';
  if (a >= 0.95) return 'S';
  if (a >= 0.9) return 'A';
  if (a >= 0.8) return 'B';
  if (a >= 0.7) return 'C';
  return 'D';
}

/** 0–3 stars: cleared, ≥ 90 %, ≥ 97 %. */
export function starsOf(s: ScoreState, cleared: boolean): number {
  if (!cleared) return 0;
  const a = accuracyOf(s);
  return a >= 0.97 ? 3 : a >= 0.9 ? 2 : 1;
}

export const fullCombo = (s: ScoreState) => s.miss === 0 && s.holdBreak === 0 && s.judged > 0;

interface Active {
  note: number;
  end: number;
}

export class Judge {
  readonly notes: Note[];
  readonly state: ScoreState = emptyScore();
  private statusBuf: Uint8Array;
  private readonly win: { perfect: number; great: number; good: number };
  private readonly centreWin: number;
  private readonly opt: JudgeOptions;
  private readonly lanes: number[][] = [];
  private readonly next: number[] = [];
  private readonly active: (Active | null)[] = [];

  constructor(notes: Note[], lanes: number, opt: JudgeOptions = {}) {
    this.notes = notes.slice();
    this.opt = opt;
    const k = opt.windowScale ?? 1;
    this.win = { perfect: WINDOWS.perfect * k, great: WINDOWS.great * k, good: WINDOWS.good * k };
    this.centreWin = CENTRE_WINDOW * k;
    this.statusBuf = new Uint8Array(Math.max(16, this.notes.length * 2));
    for (let l = 0; l < lanes; l++) {
      this.lanes.push([]);
      this.next.push(0);
      this.active.push(null);
    }
    this.index(0);
  }

  /** Per note: 0 pending, 1 judged (hit or missed), 2 dissolved ghost. */
  get status(): Uint8Array {
    return this.statusBuf;
  }

  get windows() {
    return this.win;
  }

  /** Live mode: notes committed while playing (always later than everything already there). */
  addNotes(notes: Note[]): number {
    if (!notes.length) return 0;
    const from = this.notes.length;
    this.notes.push(...notes);
    if (this.notes.length > this.statusBuf.length) {
      const b = new Uint8Array(this.notes.length * 2);
      b.set(this.statusBuf);
      this.statusBuf = b;
    }
    this.index(from);
    return from;
  }

  private index(from: number): void {
    for (let i = from; i < this.notes.length; i++) {
      const n = this.notes[i];
      const q = this.lanes[n.lane];
      if (!q) continue;
      // keep each lane sorted (live notes may arrive slightly out of order across lanes)
      let at = q.length;
      while (at > 0 && this.notes[q[at - 1]].t > n.t) at--;
      q.splice(at, 0, i);
    }
  }

  /** Total judged items expected (heads + tails of long notes), ghosts excluded. */
  get totalItems(): number {
    let c = 0;
    for (const n of this.notes) c += n.dur > 0 ? 2 : 1;
    return c;
  }

  private judgementFor(off: number): Judgement {
    const a = Math.abs(off);
    return a <= this.win.perfect ? 'perfect' : a <= this.win.great ? 'great' : a <= this.win.good ? 'good' : 'miss';
  }

  private credit(j: Judgement, points: number = POINTS[j]): number {
    const s = this.state;
    if (j === 'miss') {
      s.miss++;
      s.combo = 0;
      s.centreStreak = 0;
      s.energy = Math.max(0, s.energy - 8);
    } else {
      s[j]++;
      s.combo++;
      s.maxCombo = Math.max(s.maxCombo, s.combo);
      s.energy = Math.min(100, s.energy + (j === 'perfect' ? 1.5 : j === 'great' ? 1 : 0));
    }
    s.multiplier = multiplierFor(s.combo);
    const won = Math.round(points * (j === 'miss' ? 0 : s.multiplier));
    s.score += won;
    s.accSum += ACC[j];
    s.judged++;
    if (this.opt.fail && s.energy <= 0) s.failed = true;
    return won;
  }

  press(lane: number, t: number): JudgeEvent | null {
    const q = this.lanes[lane];
    if (!q) return null;
    if (this.active[lane]) return null; // already holding this lane
    let i = this.next[lane];
    while (i < q.length && this.status[q[i]] !== 0) i++;
    this.next[lane] = i;
    // the earliest pending note within the window; a later one if the earliest is already past
    for (let k = i; k < q.length; k++) {
      const idx = q[k];
      if (this.status[idx] !== 0) continue;
      const n = this.notes[idx];
      const off = t - n.t;
      if (off < -this.win.good) break; // too early for anything
      if (off > this.win.good) continue; // late: update() will count it as missed
      const j = this.judgementFor(off);
      const s = this.state;
      const centre = j === 'perfect' && Math.abs(off) <= this.centreWin;
      if (centre) {
        s.centre++;
        s.centreStreak++;
        s.bestCentreStreak = Math.max(s.bestCentreStreak, s.centreStreak);
      } else s.centreStreak = 0;
      this.status[idx] = 1;
      const points = this.credit(j, centre ? CENTRE_POINTS * centreBonus(s.centreStreak) : POINTS[j]);
      s.offsets.push(off);
      if (n.dur > 0) this.active[lane] = { note: idx, end: n.t + n.dur };
      return { kind: 'hit', note: idx, lane, judgement: j, offset: off, centre, points, t };
    }
    this.state.stray++;
    this.state.energy = Math.max(0, this.state.energy - 2);
    if (this.opt.fail && this.state.energy <= 0) this.state.failed = true;
    return { kind: 'stray', note: -1, lane, t };
  }

  release(lane: number, t: number): JudgeEvent | null {
    const a = this.active[lane];
    if (!a) return null;
    this.active[lane] = null;
    if (t >= a.end - RELEASE_GRACE) {
      this.state.holdOk++;
      const points = this.credit('perfect', 500);
      this.state.perfect--; // tails are counted apart
      return { kind: 'hold-ok', note: a.note, lane, points, t };
    }
    this.state.holdBreak++;
    this.state.combo = 0;
    this.state.centreStreak = 0;
    this.state.multiplier = 1;
    this.state.energy = Math.max(0, this.state.energy - 6);
    this.state.judged++;
    if (this.opt.fail && this.state.energy <= 0) this.state.failed = true;
    return { kind: 'hold-break', note: a.note, lane, t };
  }

  /** Notes that went past unplayed, long notes held to the end. Call every frame. */
  update(t: number): JudgeEvent[] {
    const out: JudgeEvent[] = [];
    for (let lane = 0; lane < this.lanes.length; lane++) {
      const a = this.active[lane];
      if (a && t >= a.end) {
        this.active[lane] = null;
        this.state.holdOk++;
        const points = this.credit('perfect', 500);
        this.state.perfect--;
        out.push({ kind: 'hold-ok', note: a.note, lane, points, t: a.end });
      }
      const q = this.lanes[lane];
      let i = this.next[lane];
      while (i < q.length) {
        const idx = q[i];
        if (this.status[idx] !== 0) {
          i++;
          continue;
        }
        const n = this.notes[idx];
        if (t - n.t <= this.win.good) break;
        // a live note is only judged once the music had time to confirm it
        if (n.live && this.opt.confirm) {
          if (t - n.t < this.win.good + 0.1) break;
          if (!this.opt.confirm(n.t)) {
            this.status[idx] = 2;
            this.state.ghosts++;
            out.push({ kind: 'ghost', note: idx, lane, t: n.t });
            i++;
            continue;
          }
        }
        this.status[idx] = 1;
        this.credit('miss');
        if (n.dur > 0) {
          // the tail of a missed long note is lost too
          this.state.holdBreak++;
          this.state.judged++;
        }
        out.push({ kind: 'miss', note: idx, lane, judgement: 'miss', t: n.t });
        i++;
      }
      this.next[lane] = i;
    }
    return out;
  }

  /** Lanes currently held on a long note. */
  holding(lane: number): boolean {
    return !!this.active[lane];
  }

  /** Every note judged or dissolved, and nothing held. */
  done(): boolean {
    for (let i = 0; i < this.notes.length; i++) if (this.status[i] === 0) return false;
    return this.active.every((a) => !a);
  }
}
