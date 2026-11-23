import { F_CHROMA, FRAME_SIZE } from './frame.ts';
import { movingAverage, type FeatureTrack } from './features.ts';
import type { Odf, Onset } from './onsets.ts';

// Tempo and beats. Global tempo by autocorrelation with a log-Gaussian prior (Ellis 2007), local
// tempo by the same on sliding windows (tempo changes), beats by dynamic programming, then a
// piecewise-linear fit of the beat grid (sub-millisecond on music produced to a click), phase
// corrected on the strongest attacks. Downbeats from kicks and harmonic changes.

const MIN_BPM = 55;
const MAX_BPM = 215;

/** Autocorrelation of a mean-removed, half-wave-rectified envelope for lags lo..hi (frames). */
export function autocorr(x: Float32Array, from: number, to: number, lo: number, hi: number): Float64Array {
  const ac = new Float64Array(hi + 2);
  for (let lag = lo; lag <= hi + 1; lag++) {
    let s = 0;
    for (let i = from + lag; i < to; i++) s += x[i] * x[i - lag];
    ac[lag] = s / Math.max(1, to - from - lag);
  }
  return ac;
}

/** The envelope tempo works on: ODF minus its local mean, rectified, lightly smoothed. */
export function tempoEnvelope(odf: Float32Array, fps: number): Float32Array {
  const ma = movingAverage(odf, Math.round(fps * 0.5));
  const x = new Float32Array(odf.length);
  for (let i = 0; i < odf.length; i++) x[i] = Math.max(0, odf[i] - ma[i]);
  // 3-tap smoothing: tolerance to ±1 frame jitter
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = 0.25 * (x[i - 1] ?? 0) + 0.5 * x[i] + 0.25 * (x[i + 1] ?? 0);
  return y;
}

export interface TempoEstimate {
  bpm: number;
  /** Peak sharpness, 0–1. */
  confidence: number;
}

/**
 * Tempo of env[from..to). `center` is the prior's centre (BPM), `width` its spread in octaves.
 * Lags are scored with their double (bar-level reinforcement) and refined by parabolic fit.
 */
export function estimateTempo(env: Float32Array, fps: number, from = 0, to = env.length, center = 120, width = 1.0): TempoEstimate {
  const lo = Math.max(2, Math.floor((60 * fps) / MAX_BPM));
  const hi = Math.ceil((60 * fps) / MIN_BPM);
  if (to - from < hi * 3) return { bpm: center, confidence: 0 };
  const ac = autocorr(env, from, to, lo, Math.min(2 * hi + 2, to - from - 1));
  const zero = (() => {
    let s = 0;
    for (let i = from; i < to; i++) s += env[i] * env[i];
    return s / (to - from) + 1e-12;
  })();
  const score = new Float64Array(hi + 2);
  let best = lo;
  for (let lag = lo; lag <= hi; lag++) {
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / center) / width, 2));
    const dbl = 2 * lag < ac.length ? ac[2 * lag] : 0;
    score[lag] = (ac[lag] + 0.5 * dbl) * prior;
    if (score[lag] > score[best]) best = lag;
  }
  // parabolic refinement
  let lag = best;
  if (best > lo && best < hi) {
    const a = score[best - 1];
    const b = score[best];
    const c = score[best + 1];
    const den = a - 2 * b + c;
    if (den < 0) lag = best + (0.5 * (a - c)) / den;
  }
  let mean = 0;
  for (let l = lo; l <= hi; l++) mean += score[l];
  mean /= hi - lo + 1;
  const confidence = Math.max(0, Math.min(1, (score[best] / (mean + 1e-12) - 1.2) / 3)) * Math.min(1, (ac[best] / zero) * 3);
  return { bpm: (60 * fps) / lag, confidence };
}

/** Keeps a tempo in the range a player reads naturally as "the beat" (75–185 BPM). */
export function playableTempo(bpm: number): number {
  let b = bpm;
  while (b < 75) b *= 2;
  while (b > 185) b /= 2;
  return b;
}

/** Local tempo every `hopS` seconds on `winS`-second windows, pulled towards the global tempo. */
function localTempo(env: Float32Array, fps: number, global: number, winS = 12, hopS = 3): { t: number; bpm: number }[] {
  const out: { t: number; bpm: number }[] = [];
  const w = Math.round(winS * fps);
  const h = Math.round(hopS * fps);
  for (let c = Math.round(w / 2); c < env.length; c += h) {
    const from = Math.max(0, c - (w >> 1));
    const to = Math.min(env.length, c + (w >> 1));
    if (to - from < w * 0.6) continue;
    const e = estimateTempo(env, fps, from, to, global, 0.25);
    // keep the global metrical level: a local estimate near double/half is folded back
    let b = e.bpm;
    const r = b / global;
    if (r > 1.6) b /= 2;
    else if (r < 0.625) b *= 2;
    out.push({ t: c / fps, bpm: e.confidence > 0.05 ? b : global });
  }
  // median filter of 5: a lone odd window is noise, a run of them is a tempo change
  return out.map((p, i) => {
    const v = out.slice(Math.max(0, i - 2), i + 3).map((q) => q.bpm).sort((a, b) => a - b);
    return { t: p.t, bpm: v[v.length >> 1] };
  });
}

/** Ellis' dynamic-programming beat tracker with a period that may change along the track. */
function trackBeats(env: Float32Array, fps: number, periodAt: (i: number) => number, tightness = 100): number[] {
  const n = env.length;
  let std = 0;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += env[i];
  mean /= n || 1;
  for (let i = 0; i < n; i++) std += (env[i] - mean) ** 2;
  std = Math.sqrt(std / (n || 1)) + 1e-9;
  const local = new Float64Array(n);
  for (let i = 0; i < n; i++) local[i] = env[i] / std;
  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const P = periodAt(i);
    const lo = Math.max(0, Math.round(i - 2 * P));
    const hi = Math.round(i - P / 2);
    let best = 0;
    let arg = -1;
    for (let j = lo; j <= hi; j++) {
      const d = Math.log((i - j) / P);
      const v = score[j] - tightness * d * d;
      if (arg < 0 || v > best) {
        best = v;
        arg = j;
      }
    }
    score[i] = local[i] + (arg >= 0 ? best : 0);
    back[i] = arg;
  }
  // last beat: the best score in the final period, among frames that are actual peaks
  const P = periodAt(n - 1);
  let end = n - 1;
  let bestEnd = -Infinity;
  for (let i = Math.max(0, Math.round(n - 1 - P)); i < n; i++) {
    if (score[i] > bestEnd) {
      bestEnd = score[i];
      end = i;
    }
  }
  const beats: number[] = [];
  for (let i = end; i >= 0; i = back[i]) {
    beats.push(i);
    if (back[i] < 0) break;
  }
  return beats.reverse();
}

/**
 * Smooth beat times: one straight line through every beat when the music has a steady tempo
 * (residual < 12 ms), otherwise a running linear fit over ±6 beats.
 */
function fitGrid(beatsS: number[]): { times: number[]; steady: boolean } {
  const n = beatsS.length;
  if (n < 4) return { times: beatsS.slice(), steady: false };
  const fit = (from: number, to: number) => {
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    const m = to - from;
    for (let k = from; k < to; k++) {
      sx += k;
      sy += beatsS[k];
      sxx += k * k;
      sxy += k * beatsS[k];
    }
    const b = (m * sxy - sx * sy) / (m * sxx - sx * sx);
    const a = (sy - b * sx) / m;
    return { a, b };
  };
  const g = fit(0, n);
  let err = 0;
  let maxErr = 0;
  for (let k = 0; k < n; k++) {
    const e = Math.abs(beatsS[k] - (g.a + g.b * k));
    err += e * e;
    maxErr = Math.max(maxErr, e);
  }
  err = Math.sqrt(err / n);
  if (err < 0.012 && maxErr < 0.04) return { times: beatsS.map((_, k) => g.a + g.b * k), steady: true };
  const times = beatsS.map((_, k) => {
    const from = Math.max(0, k - 6);
    const to = Math.min(n, k + 7);
    const f = fit(from, to);
    return f.a + f.b * k;
  });
  return { times, steady: false };
}

export interface BeatGrid {
  /** Beat times (s), increasing. */
  beats: number[];
  /** Index (in `beats`) of the first downbeat; bars start every `meter` beats from there. */
  downbeat: number;
  meter: 3 | 4;
  bpm: number;
  /** Steady tempo (single straight-line grid). */
  steady: boolean;
  /** 0 (no pulse found) … 1 (very clear pulse). */
  confidence: number;
}

/** Shifts the whole grid by the median offset of strong attacks near beats (phase fix). */
function phaseCorrect(times: number[], onsets: Onset[]): number[] {
  if (times.length < 8) return times;
  const offs: number[] = [];
  const strong = onsets.filter((o) => o.s > 0.5);
  let j = 0;
  const period = (times[times.length - 1] - times[0]) / (times.length - 1);
  for (const o of strong) {
    while (j < times.length - 1 && times[j + 1] <= o.t) j++;
    const near = Math.abs(o.t - times[j]) < Math.abs(o.t - (times[j + 1] ?? Infinity)) ? times[j] : times[j + 1];
    const d = o.t - near;
    if (Math.abs(d) < Math.min(0.05, period * 0.15)) offs.push(d);
  }
  if (offs.length < 8) return times;
  offs.sort((a, b) => a - b);
  const med = offs[offs.length >> 1];
  return times.map((t) => t + med);
}

export function analyzeBeats(ft: FeatureTrack, odf: Odf, onsets: Onset[]): BeatGrid {
  const fps = 1 / ft.step;
  const env = tempoEnvelope(odf.all, fps);
  const g = estimateTempo(env, fps);
  const global = g.bpm;
  const local = localTempo(env, fps, global);
  const periodAt = (i: number) => {
    const t = i / fps;
    if (!local.length) return (60 * fps) / global;
    let k = 0;
    while (k < local.length - 1 && local[k + 1].t <= t) k++;
    return (60 * fps) / local[k].bpm;
  };
  const raw = trackBeats(env, fps, periodAt).map((i) => ft.t0 + i * ft.step);
  const fitted = fitGrid(raw);
  let beats = phaseCorrect(fitted.times, onsets);
  // a grid wider than the music: drop beats before the first sound / after the last
  const first = onsets[0]?.t ?? 0;
  const last = onsets[onsets.length - 1]?.t ?? 0;
  beats = beats.filter((t) => t > first - 1.0 && t < last + 1.0 && t >= 0);
  const period = beats.length > 1 ? (beats[beats.length - 1] - beats[0]) / (beats.length - 1) : 60 / global;
  // confidence: how much more the envelope sits on beats than between them
  let on = 0;
  let off = 0;
  for (let k = 0; k < beats.length - 1; k++) {
    const i = Math.round((beats[k] - ft.t0) / ft.step);
    const j = Math.round(((beats[k] + beats[k + 1]) / 2 - ft.t0) / ft.step);
    const q = Math.round(((3 * beats[k] + beats[k + 1]) / 4 - ft.t0) / ft.step);
    on += Math.max(env[i] ?? 0, env[i - 1] ?? 0, env[i + 1] ?? 0);
    off += Math.max(env[q] ?? 0, env[q + 1] ?? 0) * 0.5 + Math.max(env[j] ?? 0, env[j + 1] ?? 0) * 0.5;
  }
  const ratio = on / (off + 1e-9);
  const confidence = Math.max(0, Math.min(1, (ratio - 1.05) / 1.2)) * (0.5 + 0.5 * Math.min(1, g.confidence * 3));
  const { downbeat, meter } = findDownbeat(ft, odf, beats);
  return { beats, downbeat, meter, bpm: 60 / period, steady: fitted.steady, confidence };
}

/** Meter (3 or 4) and the phase of the first downbeat: kicks and chord changes favour bar starts. */
function findDownbeat(ft: FeatureTrack, odf: Odf, beats: number[]): { downbeat: number; meter: 3 | 4 } {
  const nb = beats.length;
  if (nb < 8) return { downbeat: 0, meter: 4 };
  const idx = (t: number) => Math.max(0, Math.min(ft.n - 1, Math.round((t - ft.t0) / ft.step)));
  // per-beat accent: kick + low energy jump + harmonic change across the beat
  const accent = new Float64Array(nb);
  const chromaAround = (from: number, to: number) => {
    const c = new Float64Array(12);
    for (let i = idx(from); i <= idx(to); i++) for (let k = 0; k < 12; k++) c[k] += ft.frames[i * FRAME_SIZE + F_CHROMA + k];
    return c;
  };
  const cos = (a: Float64Array, b: Float64Array) => {
    let d = 0, x = 0, y = 0;
    for (let k = 0; k < 12; k++) {
      d += a[k] * b[k];
      x += a[k] * a[k];
      y += b[k] * b[k];
    }
    return x > 0 && y > 0 ? d / Math.sqrt(x * y) : 1;
  };
  for (let k = 1; k < nb - 1; k++) {
    const i = idx(beats[k]);
    const kick = Math.max(odf.kick[i] ?? 0, odf.kick[i + 1] ?? 0, odf.kick[i - 1] ?? 0);
    const before = chromaAround(beats[k - 1], beats[k]);
    const after = chromaAround(beats[k], beats[k + 1]);
    const change = 1 - cos(before, after);
    accent[k] = 0.35 * kick + 2.5 * change;
  }
  // harmony per beat, for the bar-level test below
  const beatChroma: Float64Array[] = [];
  for (let k = 0; k < nb - 1; k++) beatChroma.push(chromaAround(beats[k], beats[k + 1]));
  /**
   * Bars cut at the right place differ from one to the next (chords change on bar lines);
   * bars cut in the middle share half of their content with their neighbours.
   */
  const barChange = (meter: number, ph: number) => {
    let sum = 0;
    let cnt = 0;
    let prev: Float64Array | null = null;
    for (let k = ph; k + meter <= beatChroma.length; k += meter) {
      const v = new Float64Array(12);
      for (let j = k; j < k + meter; j++) for (let c = 0; c < 12; c++) v[c] += beatChroma[j][c];
      if (prev) {
        sum += 1 - cos(prev, v);
        cnt++;
      }
      prev = v;
    }
    return cnt ? sum / cnt : 0;
  };
  let bestScore = -Infinity;
  let res = { downbeat: 0, meter: 4 as 3 | 4 };
  for (const meter of [4, 3] as const) {
    const changes = Array.from({ length: meter }, (_, ph) => barChange(meter, ph));
    const meanChange = changes.reduce((a, b) => a + b, 0) / meter + 1e-9;
    for (let ph = 0; ph < meter; ph++) {
      let s = 0;
      let cnt = 0;
      let other = 0;
      let oc = 0;
      for (let k = 0; k < nb; k++) {
        if ((k - ph) % meter === 0) {
          s += accent[k];
          cnt++;
        } else {
          other += accent[k];
          oc++;
        }
      }
      // contrast between bar starts and the other beats, and how cleanly bars separate;
      // 3/4 must win clearly to be chosen
      const score = s / Math.max(1, cnt) - other / Math.max(1, oc) + 3 * (changes[ph] / meanChange - 1) - (meter === 3 ? 0.4 : 0);
      if (score > bestScore) {
        bestScore = score;
        res = { downbeat: ph, meter };
      }
    }
  }
  return res;
}

/** Position of time t on the grid: beat index (fractional). Outside the grid: extrapolated. */
export function beatPosition(beats: number[], t: number): number {
  const n = beats.length;
  if (n < 2) return 0;
  if (t <= beats[0]) return (t - beats[0]) / (beats[1] - beats[0]);
  if (t >= beats[n - 1]) return n - 1 + (t - beats[n - 1]) / (beats[n - 1] - beats[n - 2]);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] <= t) lo = mid;
    else hi = mid;
  }
  return lo + (t - beats[lo]) / (beats[lo + 1] - beats[lo]);
}

/** Time of a fractional beat position (inverse of beatPosition). */
export function beatTime(beats: number[], p: number): number {
  const n = beats.length;
  if (n < 2) return beats[0] ?? 0;
  if (p <= 0) return beats[0] + p * (beats[1] - beats[0]);
  if (p >= n - 1) return beats[n - 1] + (p - (n - 1)) * (beats[n - 1] - beats[n - 2]);
  const k = Math.floor(p);
  return beats[k] + (p - k) * (beats[k + 1] - beats[k]);
}
