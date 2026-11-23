import { F_ENERGY, F_FLAT, F_FLUX, F_RMS, FRAME_SIZE, HOP } from '../analysis/frame.ts';
import { HAT, KICK, SNARE, TONAL } from '../analysis/onsets.ts';
import { estimateTempo, playableTempo, tempoEnvelope } from '../analysis/tempo.ts';
import { percentile } from '../analysis/features.ts';
import { LaneAssigner } from '../chart/lanes.ts';
import { BEAT, DOWNBEAT, EIGHTH, METRIC_WEIGHT, SIXTEENTH, TRIPLET, Spacing, classWeight, densityFor, levelAllowed } from '../chart/rules.ts';
import { HOLD, TAP, type DifficultyParams, type Note } from '../chart/types.ts';
import { rng } from '../util/rng.ts';

// Mode A — notes for music that is being heard for the first time, with no way to look ahead.
//
// The only honest way to place a note before its sound is to predict it. Music repeats: the
// tempo holds, the beat keeps its phase, and a bar mostly sounds like the bar 1, 2 or 4 bars
// before it. So:
//   1. attacks are detected as the frames arrive (a few frames of delay);
//   2. tempo is re-estimated every half second (hysteresis: a change must persist), the beat
//      phase is tracked by a phase-locked loop;
//   3. each finished bar is stored as 16 slots (sixteenths) with the strength and instrument heard;
//   4. a bar about to enter the screen is predicted from the bars 2, 4 and 8 before it, weighted
//      by how well each of these lags predicted the recent bars;
//   5. notes are chosen with the same rules as offline charts (density, spacing, lanes) and are
//      committed once, `horizon` seconds ahead — never moved or removed once visible.
// A predicted note the music does not confirm (no attack near it) is a "ghost": the game lets it
// dissolve without penalty (see confirm()).

export interface LiveOptions {
  params: DifficultyParams;
  /** How far ahead notes must exist (approach time + margin), s. */
  horizon: number;
  seed: number;
  /** Seconds of listening before the first note. */
  warmup?: number;
  sampleRate?: number;
}

export interface LiveStatus {
  bpm: number;
  confidence: number;
  locked: boolean;
  /** 0–1. */
  intensity: number;
  /** Seconds of music heard. */
  heard: number;
  /** No pulse found: sparse safe-mode notes. */
  safe: boolean;
}

interface LiveOnset {
  t: number;
  s: number;
  cls: number;
}

/** Slots per bar: 12 per beat, so both sixteenths (every 3) and triplets (every 4) fit. */
const SLOTS = 48;
const PER_BEAT = 12;
const LAGS = [1, 2, 4, 8];

export class LivePredictor {
  private readonly p: DifficultyParams;
  private readonly horizon: number;
  private readonly warmup: number;
  private readonly step: number;
  // recording (for learning)
  private recTimes = new Float64Array(1 << 14);
  private recFrames = new Float32Array((1 << 14) * FRAME_SIZE);
  private recN = 0;
  // recent history (regular frames since the last discontinuity)
  private readonly cap: number;
  private odf: Float32Array;
  private cls: Float32Array; // 4 per frame
  private times: Float64Array;
  private rms: Float32Array;
  private flatness: Float32Array;
  private head = 0; // total frames in this run
  private runStart = 0; // time of the first frame of this run
  private lastT = -Infinity;
  private bandScale = new Float64Array(8).fill(1);
  private scaleAt = -Infinity;
  private odfScale = 1;
  private onsets: LiveOnset[] = [];
  // tempo / phase
  private bpm = 120;
  private period = 0.5;
  private confidence = 0;
  private locked = false;
  private safe = false;
  private anchorTime = 0;
  private anchorIndex = 0;
  private tempoAt = -Infinity;
  private disagree = 0;
  private barPhase = new Float64Array(4);
  /** Evidence for straight vs swung (triplet) subdivisions, decaying. */
  private straightW = 1;
  private tripletW = 0;
  // patterns
  private bars = new Map<number, { s: Float32Array; c: Int8Array; loud: number }>();
  private lastStoredBar = -1;
  private lagWeight = new Float64Array(LAGS.length).fill(1);
  private loudHist: number[] = [];
  private intensity = 0.5;
  // output
  private decided = new Set<number>();
  private spacing = new Spacing();
  private lanes: LaneAssigner;
  private readonly rand: () => number;
  private committed: Note[] = [];

  constructor(opt: LiveOptions) {
    this.p = opt.params;
    this.horizon = opt.horizon;
    this.warmup = opt.warmup ?? 6;
    this.step = HOP / (opt.sampleRate ?? 48000);
    this.cap = Math.ceil(16 / this.step);
    this.odf = new Float32Array(this.cap);
    this.cls = new Float32Array(this.cap * 4);
    this.times = new Float64Array(this.cap);
    this.rms = new Float32Array(this.cap);
    this.flatness = new Float32Array(this.cap);
    this.rand = rng(opt.seed);
    this.lanes = new LaneAssigner(this.p, this.rand);
  }

  status(): LiveStatus {
    return { bpm: this.bpm, confidence: this.confidence, locked: this.locked, intensity: this.intensity, heard: this.head * this.step, safe: this.safe };
  }

  /** Everything heard so far: the learning step builds the precise chart from it. */
  recorded(): { times: Float64Array; frames: Float32Array; step: number } {
    return { times: this.recTimes.subarray(0, this.recN), frames: this.recFrames.subarray(0, this.recN * FRAME_SIZE), step: this.step };
  }

  /** Predicted beat times in [from, to] (beat lines, tests). */
  beatsBetween(from: number, to: number): number[] {
    if (!this.locked) return [];
    const out: number[] = [];
    for (let k = Math.ceil(this.beatIndexAt(from)); ; k++) {
      const t = this.beatTimeOf(k);
      if (t > to) break;
      out.push(t);
    }
    return out;
  }

  /** True when an attack was heard within ±80 ms of t (a predicted note was real). */
  confirm(t: number): boolean {
    for (let i = this.onsets.length - 1; i >= 0; i--) {
      const o = this.onsets[i];
      if (o.t < t - 0.2) break;
      if (Math.abs(o.t - t) <= 0.08 && o.s >= 0.12) return true;
    }
    return false;
  }

  // ── input ──────────────────────────────────────────────────────────────────────────────

  private readonly bridge = new Float32Array(FRAME_SIZE);

  push(t: number, frame: Float32Array): void {
    // a frame a little before the last one (clock jitter): already covered
    if (t <= this.lastT && t > this.lastT - 0.12) return;
    this.record(t, frame);
    const gap = t - this.lastT;
    if (this.head > 0 && gap > 1.5 * this.step && gap <= 0.35) {
      // a few frames missing (dropped, or around a buffering stall): bridged with quiet frames,
      // so the sequence stays regular and the tempo and phase found are kept
      this.bridge.set(frame);
      for (let b = 0; b < 8; b++) this.bridge[F_FLUX + b] = 0;
      this.bridge[31] = 0;
      const missing = Math.round(gap / this.step) - 1;
      for (let k = 1; k <= missing; k++) this.ingest(this.lastT + this.step, this.bridge);
    } else if (t < this.lastT - 0.12 || gap > 0.35) this.resetRun(t); // a jump (seek, long stall): a new run
    this.ingest(t, frame);
  }

  private ingest(t: number, frame: Float32Array): void {
    this.lastT = t;
    if (t - this.scaleAt > 0.5) this.updateScales(t);
    const i = this.head % this.cap;
    const f = (b: number) => frame[F_FLUX + b] / this.bandScale[b];
    const kick = f(1) + 0.5 * f(0);
    const snare = 0.35 * f(2) + 0.25 * f(4) + 0.6 * f(5);
    const hat = f(6) + 0.6 * f(7);
    const tonal = (f(3) + f(4) + 0.5 * f(2)) * Math.max(0.15, 1 - frame[F_FLAT] * 1.5);
    this.cls[i * 4] = kick;
    this.cls[i * 4 + 1] = snare * 0.9;
    this.cls[i * 4 + 2] = hat * 0.45;
    this.cls[i * 4 + 3] = tonal * 0.7;
    // stored raw: the scale moves with the music, the stored history must not move with it
    this.odf[i] = kick + 0.9 * snare + 0.45 * hat + 0.7 * tonal;
    this.times[i] = t;
    this.rms[i] = frame[F_RMS];
    this.flatness[i] = frame[F_ENERGY + 1];
    this.head++;
    this.detectOnset();
  }

  private record(t: number, frame: Float32Array): void {
    if (this.recN >= this.recTimes.length) {
      const nt = new Float64Array(this.recTimes.length * 2);
      nt.set(this.recTimes);
      this.recTimes = nt;
      const nf = new Float32Array(this.recFrames.length * 2);
      nf.set(this.recFrames);
      this.recFrames = nf;
    }
    this.recTimes[this.recN] = t;
    this.recFrames.set(frame, this.recN * FRAME_SIZE);
    this.recN++;
  }

  private resetRun(t: number): void {
    this.head = 0;
    this.runStart = t;
    this.onsets = [];
    this.locked = false;
    this.confidence = 0;
    this.tempoAt = -Infinity;
    this.bars.clear();
    this.lastStoredBar = -1;
    this.barPhase.fill(0);
    // bar numbers restart with the new run; spacing and lanes forget the old position (a jump
    // back would otherwise leave every lane "just used" in the future)
    this.decided.clear();
    this.spacing = new Spacing();
    this.lanes = new LaneAssigner(this.p, this.rand);
    this.lastSafe = -Infinity;
    // notes already committed stay; nothing new until the beat is found again
  }

  private updateScales(t: number): void {
    this.scaleAt = t;
    const n = Math.min(this.head, this.cap);
    if (n < 50) return;
    const odfs: number[] = [];
    for (let k = 0; k < n; k++) odfs.push(this.odf[k]);
    // the band scales come from the recorded frames (last 10 s)
    const from = Math.max(0, this.recN - Math.round(10 / this.step));
    for (let b = 0; b < 8; b++) {
      const col: number[] = [];
      for (let k = from; k < this.recN; k++) col.push(this.recFrames[k * FRAME_SIZE + F_FLUX + b]);
      const v = percentile(col, 0.97);
      if (v > 1e-6) this.bandScale[b] = v;
    }
    const s = percentile(odfs, 0.95);
    if (s > 1e-6) this.odfScale = s;
  }

  private at(k: number): number {
    // frame k of this run (k < head, k ≥ head - cap)
    return k % this.cap;
  }

  private detectOnset(): void {
    const LOOK = 3;
    const m = this.head - 1 - LOOK;
    if (m < 4 || this.head < 20) return;
    const sc = 1 / this.odfScale;
    const v = this.odf[this.at(m)] * sc;
    for (let k = m - 3; k <= m + 3; k++) {
      const x = this.odf[this.at(k)] * sc;
      if (k !== m && x >= v && (k > m || x > v)) return;
    }
    // causal thresholds: short and long means of the past
    let sS = 0, nS = 0, sL = 0, nL = 0;
    const shortN = Math.round(0.1 / this.step);
    const longN = Math.round(2 / this.step);
    for (let k = m - 1; k >= Math.max(0, m - longN, this.head - this.cap); k--) {
      const x = this.odf[this.at(k)] * sc;
      if (m - k <= shortN) {
        sS += x;
        nS++;
      }
      sL += x;
      nL++;
    }
    const thr = 1.1 * (nS ? sS / nS : 0) + 0.3 * (nL ? sL / nL : 0) + 0.04;
    if (v < thr) return;
    const last = this.onsets[this.onsets.length - 1];
    const t = this.times[this.at(m)] + 0.002;
    if (last && t - last.t < 3 * this.step) return;
    let cls = 0;
    const base = this.at(m) * 4;
    for (let c = 1; c < 4; c++) if (this.cls[base + c] > this.cls[base + cls]) cls = c;
    this.onsets.push({ t, s: v, cls });
    if (this.onsets.length > 400) this.onsets.splice(0, 100);
  }

  // ── beat tracking ──────────────────────────────────────────────────────────────────────

  private beatTimeOf(k: number): number {
    return this.anchorTime + (k - this.anchorIndex) * this.period;
  }

  private beatIndexAt(t: number): number {
    return this.anchorIndex + (t - this.anchorTime) / this.period;
  }

  private updateTempo(now: number): void {
    const n = Math.min(this.head, this.cap, Math.round(10 / this.step));
    if (n * this.step < 4) return;
    const env0 = new Float32Array(n);
    const start = this.head - n;
    for (let k = 0; k < n; k++) env0[k] = this.odf[this.at(start + k)];
    const fps = 1 / this.step;
    const env = tempoEnvelope(env0, fps);
    const t0 = this.times[this.at(start)];
    const tEnd = this.times[this.at(this.head - 1)];
    /** Best beat comb for a period: its score, mean score over phases, and the latest beat time. */
    const comb = (P: number) => {
      const steps = 64;
      const scores = new Float64Array(steps);
      let best = 0;
      let mean = 0;
      for (let s = 0; s < steps; s++) {
        const phi = (s / steps) * P;
        let sc = 0;
        for (let k = 0; k < 16; k++) {
          const idx = Math.round((tEnd - phi - k * P - t0) / this.step);
          if (idx < 1 || idx >= n - 1) continue;
          sc += Math.max(env[idx], 0.7 * env[idx - 1], 0.7 * env[idx + 1]) * Math.pow(0.92, k);
        }
        scores[s] = sc;
        mean += sc / steps;
        if (sc > scores[best]) best = s;
      }
      const a = scores[(best - 1 + steps) % steps];
      const c = scores[(best + 1) % steps];
      const den = a - 2 * scores[best] + c;
      const frac = den < 0 ? (0.5 * (a - c)) / den : 0;
      return { score: scores[best], mean, beatT: tEnd - ((best + frac) / steps) * P };
    };
    const est = estimateTempo(env, fps, 0, n, this.locked ? this.bpm : 120, this.locked ? 0.35 : 1.0);
    const cand = playableTempo(est.bpm);
    if (!this.locked) {
      // locking needs the same tempo twice in a row
      const stable = Math.abs(cand - this.bpm) / this.bpm < 0.02;
      this.bpm = cand;
      this.period = 60 / cand;
      const c = comb(this.period);
      this.confidence = Math.max(0, Math.min(1, (c.score / (c.mean + 1e-9) - 1.15) / 1.3)) * (0.4 + 0.6 * Math.min(1, est.confidence * 3));
      if (stable && this.confidence > 0.3 && now - this.runStart >= this.warmup * 0.7) {
        this.locked = true;
        this.anchorIndex = 0;
        this.anchorTime = c.beatT;
        this.disagree = 0;
      }
    } else {
      // a tempo change must be clearly better, several times in a row, to replace the current one
      if (Math.abs(cand - this.bpm) / this.bpm >= 0.04) {
        const cur = comb(this.period);
        const alt = comb(60 / cand);
        if (alt.score > 1.25 * cur.score) this.disagree++;
        else this.disagree = 0;
        if (this.disagree >= 4) {
          this.bpm = cand;
          this.period = 60 / cand;
          this.anchorIndex = Math.round(this.beatIndexAt(alt.beatT));
          this.anchorTime = alt.beatT;
          this.disagree = 0;
        }
      } else this.disagree = 0;
      // phase and period from the attacks that fell on predicted beats (least squares)
      this.refineFromOnsets(now);
      const c = comb(this.period);
      this.confidence = 0.8 * this.confidence + 0.2 * Math.max(0, Math.min(1, (c.score / (c.mean + 1e-9) - 1.15) / 1.3));
      if (this.confidence < 0.08) this.locked = false;
    }
    this.safe = !this.locked && now - this.runStart > this.warmup + 6;
  }

  /**
   * Strong attacks of the last 8 s within 60 ms of a predicted beat: a straight line through
   * (beat index, attack time) gives the phase and the period to sub-millisecond precision.
   */
  private refineFromOnsets(now: number): void {
    const P = this.period;
    const ks: number[] = [];
    const ts: number[] = [];
    for (let i = this.onsets.length - 1; i >= 0; i--) {
      const o = this.onsets[i];
      if (o.t < now - 8) break;
      if (o.s < 0.35) continue;
      const k = Math.round(this.beatIndexAt(o.t));
      if (Math.abs(o.t - this.beatTimeOf(k)) > Math.min(0.06, P * 0.15)) continue;
      ks.push(k);
      ts.push(o.t);
    }
    if (ks.length < 6) return;
    let sk = 0, st = 0, skk = 0, skt = 0;
    const m = ks.length;
    for (let i = 0; i < m; i++) {
      sk += ks[i];
      st += ts[i];
      skk += ks[i] * ks[i];
      skt += ks[i] * ts[i];
    }
    const den = m * skk - sk * sk;
    if (den <= 0) return;
    const b = (m * skt - sk * st) / den;
    const a = (st - b * sk) / m;
    if (Math.abs(b - P) / P > 0.03) return; // implausible jump: keep the current period
    const kNow = Math.round(this.beatIndexAt(now));
    this.period = b;
    this.bpm = 60 / b;
    this.anchorIndex = kNow;
    this.anchorTime = a + b * kNow;
  }

  // ── bars and patterns ──────────────────────────────────────────────────────────────────

  private get swing(): boolean {
    return this.tripletW > 1.3 * this.straightW && this.tripletW > 3;
  }

  private downbeatOffset(): number {
    let best = 0;
    for (let k = 1; k < 4; k++) if (this.barPhase[k] > this.barPhase[best]) best = k;
    return best;
  }

  /** Bar index of beat k (bars start on beats ≡ downbeatOffset mod 4). */
  private barOfBeat(k: number): number {
    return Math.floor((k - this.downbeatOffset()) / 4);
  }

  private barStartBeat(bar: number): number {
    return bar * 4 + this.downbeatOffset();
  }

  /** Stores every bar that is over (plus a margin for late onset detection). */
  private storeBars(now: number): void {
    if (!this.locked) return;
    const curBar = this.barOfBeat(Math.floor(this.beatIndexAt(now - 0.15)));
    for (let b = Math.max(this.lastStoredBar + 1, curBar - 4); b < curBar; b++) {
      const k0 = this.barStartBeat(b);
      const t0 = this.beatTimeOf(k0);
      const slotDur = this.period / PER_BEAT;
      const gridStep = this.swing ? 4 : 3;
      const s = new Float32Array(SLOTS);
      const c = new Int8Array(SLOTS).fill(-1);
      for (const o of this.onsets) {
        if (o.t < t0 - slotDur / 2) continue;
        if (o.t >= t0 + SLOTS * slotDur - slotDur / 2) break;
        // where the attack falls inside its beat tells straight from swung music
        const f = this.beatIndexAt(o.t) % 1;
        if (f > 0.12 && f < 0.88) {
          const ds = Math.min(Math.abs(f - 0.25), Math.abs(f - 0.5), Math.abs(f - 0.75));
          const dt = Math.min(Math.abs(f - 1 / 3), Math.abs(f - 2 / 3));
          if (dt + 0.02 < ds) this.tripletW += Math.min(2, o.s);
          else if (ds + 0.02 < dt) this.straightW += Math.min(2, o.s);
        }
        const slot = Math.round((o.t - t0) / slotDur / gridStep) * gridStep;
        if (slot < 0 || slot >= SLOTS) continue;
        if (o.s > s[slot]) {
          s[slot] = o.s;
          c[slot] = o.cls;
        }
        // accents on beats feed the downbeat estimate
        if (slot % PER_BEAT === 0 && o.cls === KICK) this.barPhase[(((k0 + slot / PER_BEAT) % 4) + 4) % 4] += o.s;
      }
      // loudness of the bar → intensity
      let r = 0;
      let cnt = 0;
      const n = Math.min(this.head, this.cap);
      for (let k = this.head - n; k < this.head; k++) {
        const t = this.times[this.at(k)];
        if (t >= t0 && t < t0 + 4 * this.period) {
          r += this.rms[this.at(k)] ** 2;
          cnt++;
        }
      }
      const loud = 10 * Math.log10(r / Math.max(1, cnt) + 1e-10);
      // how well each lag predicted this bar: lags that work get more say
      LAGS.forEach((L, li) => {
        const src = this.bars.get(b - L);
        if (!src) return;
        this.lagWeight[li] = 0.7 * this.lagWeight[li] + 0.3 * Math.exp(3 * similarity(src.s, s));
      });
      this.bars.set(b, { s, c, loud });
      this.bars.delete(b - 12);
      this.loudHist.push(loud);
      if (this.loudHist.length > 64) this.loudHist.shift();
      const lo = percentile(this.loudHist, 0.1);
      const hi = percentile(this.loudHist, 0.95);
      this.straightW *= 0.97;
      this.tripletW *= 0.97;
      const density = s.reduce((a, x) => a + (x > 0.2 ? 1 : 0), 0) / 16;
      this.intensity = 0.7 * this.intensity + 0.3 * Math.max(0, Math.min(1, 0.6 * ((loud - lo) / (hi - lo + 3)) + 0.4 * density * 2));
      this.lastStoredBar = b;
    }
  }

  /** Expected strength and instrument of each slot of bar b, from the stored bars. */
  private predictBar(b: number): { s: Float32Array; c: Int8Array } {
    const s = new Float32Array(SLOTS);
    const votes: Float32Array[] = Array.from({ length: SLOTS }, () => new Float32Array(4));
    let wsum = 0;
    LAGS.forEach((L, li) => {
      const src = this.bars.get(b - L);
      if (!src) return;
      const w = this.lagWeight[li];
      wsum += w;
      for (let k = 0; k < SLOTS; k++) {
        s[k] += w * src.s[k];
        if (src.c[k] >= 0) votes[k][src.c[k]] += w * src.s[k];
      }
    });
    if (wsum === 0) {
      // nothing to repeat yet: average of whatever bars exist
      for (const src of this.bars.values()) {
        wsum++;
        for (let k = 0; k < SLOTS; k++) {
          s[k] += src.s[k];
          if (src.c[k] >= 0) votes[k][src.c[k]] += src.s[k];
        }
      }
    }
    const c = new Int8Array(SLOTS).fill(-1);
    for (let k = 0; k < SLOTS; k++) {
      s[k] /= wsum || 1;
      let best = -1;
      for (let x = 0; x < 4; x++) if (votes[k][x] > 0 && (best < 0 || votes[k][x] > votes[k][best])) best = x;
      c[k] = best;
    }
    return { s, c };
  }

  // ── output ─────────────────────────────────────────────────────────────────────────────

  /** Notes newly committed up to now + horizon. Call every frame (cheap when nothing is due). */
  advance(now: number): Note[] {
    if (now - this.tempoAt >= 0.5 && this.head > 0) {
      this.tempoAt = now;
      this.updateTempo(now);
    }
    this.storeBars(now);
    const out: Note[] = [];
    if (this.safe) return this.safeMode(now);
    if (!this.locked || now - this.runStart < this.warmup) return out;
    const until = now + this.horizon;
    const firstBar = this.barOfBeat(Math.ceil(this.beatIndexAt(now + this.horizon * 0.5)));
    const lastBar = this.barOfBeat(Math.floor(this.beatIndexAt(until)));
    for (let b = firstBar; b <= lastBar; b++) {
      if (this.decided.has(b)) continue;
      this.decided.add(b);
      out.push(...this.decideBar(b, now));
    }
    this.committed.push(...out);
    return out;
  }

  private decideBar(b: number, now: number): Note[] {
    const pred = this.predictBar(b);
    const k0 = this.barStartBeat(b);
    const target = Math.max(1, Math.round(densityFor(this.p, this.intensity) * 4));
    const cands: { t: number; sal: number; cls: number; level: number; slot: number }[] = [];
    const swing = this.swing;
    for (let k = 0; k < SLOTS; k += swing ? 4 : 3) {
      const strength = pred.s[k];
      if (strength < 0.18) continue;
      const level = k === 0 ? DOWNBEAT : k % PER_BEAT === 0 ? BEAT : swing ? TRIPLET : k % 6 === 0 ? EIGHTH : SIXTEENTH;
      if (!levelAllowed(this.p, level, swing)) continue;
      const t = this.beatTimeOf(k0 + k / PER_BEAT);
      if (t < now + this.horizon * 0.5) continue; // too late to show fairly
      const sal = Math.min(1.5, strength) * METRIC_WEIGHT[level] * classWeight(pred.c[k]) * (0.65 + 0.35 * this.intensity);
      if (sal < this.p.floor * 0.8) continue;
      cands.push({ t, sal, cls: pred.c[k] < 0 ? -1 : pred.c[k], level, slot: k });
    }
    cands.sort((x, y) => y.sal - x.sal);
    const chosen: typeof cands = [];
    for (const c of cands) {
      if (chosen.length >= target) break;
      if (!this.spacing.canAdd(c.t, this.p)) continue;
      this.spacing.add(c.t);
      chosen.push(c);
    }
    chosen.sort((x, y) => x.t - y.t);
    const notes: Note[] = [];
    for (const c of chosen) {
      // live long notes: a tonal slot followed by silence for at least a beat, held for a beat
      const nextSlot = c.slot + PER_BEAT <= SLOTS ? pred.s.slice(c.slot + 1, c.slot + PER_BEAT).every((x) => x < 0.15) : false;
      const hold = c.cls === TONAL && nextSlot && this.p.holdRate > 0 && c.level <= BEAT;
      const dur = hold ? this.period * Math.max(1, this.p.minHoldBeats) : 0;
      const lanes = this.lanes.assign({ t: c.t, size: 1, cls: c.cls, pc: 0, pcClarity: 0, hint: [], dur });
      if (!lanes) continue;
      for (const lane of lanes) notes.push({ t: c.t, lane, dur, kind: dur > 0 ? HOLD : TAP, chord: -1, w: c.sal, cls: c.cls, live: true });
    }
    return notes;
  }

  /** Mean RMS of the frames heard in the last `span` seconds (0 when none). */
  private recentLevel(now: number, span: number): number {
    let r = 0;
    let cnt = 0;
    const n = Math.min(this.head, this.cap);
    for (let k = this.head - 1; k >= this.head - n; k--) {
      const i = this.at(k);
      if (this.times[i] < now - span) break;
      r += this.rms[i];
      cnt++;
    }
    return cnt ? r / cnt : 0;
  }

  /** No pulse: one note every second beat of the best guess, only while music is heard. */
  private lastSafe = -Infinity;
  private safeMode(now: number): Note[] {
    const out: Note[] = [];
    // silence (an intro, a pause, a capture without sound): no note is invented
    if (this.recentLevel(now, 1.5) < SILENCE_RMS) return out;
    const gap = Math.max(this.p.minGap * 2, this.period * 2, 0.8);
    let t = Math.max(this.lastSafe + gap, now + this.horizon * 0.6);
    while (t <= now + this.horizon) {
      const lanes = this.lanes.assign({ t, size: 1, cls: -1, pc: 0, pcClarity: 0, hint: [], dur: 0 });
      if (lanes) for (const lane of lanes) out.push({ t, lane, dur: 0, kind: TAP, chord: -1, w: 0.3, cls: -1, live: true });
      this.lastSafe = t;
      t += gap;
    }
    this.committed.push(...out);
    return out;
  }
}

/** Below this mean RMS (≈ −48 dBFS) the song is taken as silent. */
const SILENCE_RMS = 0.004;

function similarity(a: Float32Array, b: Float32Array): number {
  let d = 0, x = 0, y = 0;
  for (let k = 0; k < a.length; k++) {
    d += a[k] * b[k];
    x += a[k] * a[k];
    y += b[k] * b[k];
  }
  return x > 0 && y > 0 ? d / Math.sqrt(x * y) : 0;
}

export { HAT, KICK, SNARE };
