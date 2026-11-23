import { F_CENTROID, F_CHROMA, F_ENERGY, F_FLAT, F_FLUX, FRAME_SIZE } from './frame.ts';
import { frameTime, movingAverage, percentile, type FeatureTrack } from './features.ts';

/** What made a sound start: the instrument family it most looks like. */
export type OnsetClass = 0 | 1 | 2 | 3; // kick, snare, cymbal/hat, tonal (melody, chords, voice)
export const KICK = 0;
export const SNARE = 1;
export const HAT = 2;
export const TONAL = 3;

export interface Onset {
  /** Seconds. */
  t: number;
  /** Frame index. */
  i: number;
  /** Absolute strength (≈ 0–2, 1 = loud attack for this track). */
  s: number;
  /** Prominence against its surroundings (≈ 1 = ordinary, > 2 = stands out). */
  rel: number;
  cls: OnsetClass;
  /** Share of each class at the attack (kick, snare, hat, tonal), sums to 1. */
  mix: [number, number, number, number];
  /** How long the sound holds after the attack (s). */
  sustain: number;
  /** Dominant pitch class 0–11 and how clear it is (0–1). */
  pc: number;
  pcClarity: number;
  /** Spectral centroid (kHz), a brightness proxy. */
  bright: number;
}

export interface Odf {
  /** Combined detection function, normalized (p95 ≈ 1). */
  all: Float32Array;
  kick: Float32Array;
  snare: Float32Array;
  hat: Float32Array;
  tonal: Float32Array;
}

/**
 * Measured on synthetic clicks (tests/unit/onsets): the detection peak lands this long after the
 * true attack with WIN 2048 / HOP 512 / SuperFlux lag 2. Subtracted from every onset time.
 */
export const ONSET_DELAY = -0.002;

const CLS_W = [1.0, 0.9, 0.45, 0.7];

export function detectionFunctions(ft: FeatureTrack): Odf {
  const n = ft.n;
  const fr = ft.frames;
  // per-band flux, normalized by its own loud level over the track
  const scale = new Float64Array(8);
  for (let b = 0; b < 8; b++) {
    const col = new Float32Array(n);
    for (let i = 0; i < n; i++) col[i] = fr[i * FRAME_SIZE + F_FLUX + b];
    scale[b] = percentile(col, 0.97) + 1e-6;
  }
  const kick = new Float32Array(n);
  const snare = new Float32Array(n);
  const hat = new Float32Array(n);
  const tonal = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * FRAME_SIZE + F_FLUX;
    const f = (b: number) => fr[o + b] / scale[b];
    kick[i] = f(1) + 0.5 * f(0);
    snare[i] = 0.35 * f(2) + 0.25 * f(4) + 0.6 * f(5);
    hat[i] = f(6) + 0.6 * f(7);
    const flat = fr[i * FRAME_SIZE + F_FLAT];
    tonal[i] = (f(3) + f(4) + 0.5 * f(2)) * Math.max(0.15, 1 - flat * 1.5);
  }
  const norm = (x: Float32Array) => {
    const p = percentile(x, 0.95) + 1e-6;
    for (let i = 0; i < x.length; i++) x[i] /= p;
    return x;
  };
  norm(kick);
  norm(snare);
  norm(hat);
  norm(tonal);
  const all = new Float32Array(n);
  for (let i = 0; i < n; i++) all[i] = CLS_W[0] * kick[i] + CLS_W[1] * snare[i] + CLS_W[2] * hat[i] + CLS_W[3] * tonal[i];
  norm(all);
  return { all, kick, snare, hat, tonal };
}

export function detectOnsets(ft: FeatureTrack, odf: Odf): Onset[] {
  const { all } = odf;
  const n = ft.n;
  const fps = 1 / ft.step;
  const shortR = Math.max(2, Math.round(0.1 * fps));
  const longR = Math.round(2 * fps);
  const maS = movingAverage(all, shortR);
  const maL = movingAverage(all, longR);
  const W = 3; // local max over ±3 frames (~32 ms)
  const WAIT = 3;
  const out: Onset[] = [];
  let last = -1e9;
  for (let i = 1; i < n - 1; i++) {
    const v = all[i];
    const thr = 1.1 * maS[i] + 0.3 * maL[i] + 0.04;
    if (v < thr) continue;
    let isMax = true;
    for (let k = Math.max(0, i - W); k <= Math.min(n - 1, i + W); k++) {
      if (all[k] > v || (all[k] === v && k < i)) {
        isMax = false;
        break;
      }
    }
    if (!isMax || i - last < WAIT) continue;
    last = i;
    // sub-frame position
    const a = all[i - 1];
    const c = all[i + 1];
    const den = a - 2 * v + c;
    const d = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
    out.push(describe(ft, odf, i, frameTime(ft, i + d) - ONSET_DELAY, v, v / (maL[i] * 1.5 + 0.05)));
  }
  computeSustain(ft, out);
  return out;
}

function describe(ft: FeatureTrack, odf: Odf, i: number, t: number, s: number, rel: number): Onset {
  const n = ft.n;
  const peak = (x: Float32Array) => Math.max(x[i], i > 0 ? x[i - 1] : 0, i < n - 1 ? x[i + 1] : 0);
  const raw = [peak(odf.kick) * CLS_W[0], peak(odf.snare) * CLS_W[1], peak(odf.hat) * CLS_W[2], peak(odf.tonal) * CLS_W[3]];
  const sum = raw[0] + raw[1] + raw[2] + raw[3] + 1e-9;
  const mix = raw.map((x) => x / sum) as [number, number, number, number];
  let cls: OnsetClass = 0;
  for (let k = 1; k < 4; k++) if (mix[k] > mix[cls]) cls = k as OnsetClass;
  // pitch: chroma just after the attack
  const ch = new Float64Array(12);
  let bright = 0;
  let cnt = 0;
  for (let k = i + 1; k <= Math.min(n - 1, i + 6); k++) {
    const o = k * FRAME_SIZE;
    for (let c = 0; c < 12; c++) ch[c] += ft.frames[o + F_CHROMA + c];
    bright += ft.frames[o + F_CENTROID];
    cnt++;
  }
  let pc = 0;
  let tot = 0;
  for (let c = 0; c < 12; c++) {
    tot += ch[c];
    if (ch[c] > ch[pc]) pc = c;
  }
  return { t, i, s, rel, cls, mix, sustain: 0, pc, pcClarity: tot > 0 ? Math.min(1, (ch[pc] / tot - 1 / 12) * 4) : 0, bright: cnt ? bright / cnt : 0 };
}

/**
 * How long each sound holds: the energy of the musical bands (150 Hz – 6 kHz) stays within
 * 8 dB of its level just after the attack, and no comparable new attack comes.
 */
function computeSustain(ft: FeatureTrack, onsets: Onset[]): void {
  const n = ft.n;
  const fps = 1 / ft.step;
  const maxF = Math.round(4 * fps);
  const midE = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * FRAME_SIZE + F_ENERGY;
    let p = 0;
    for (let b = 2; b <= 5; b++) p += Math.pow(10, ft.frames[o + b] / 10);
    midE[i] = 10 * Math.log10(p + 1e-10);
  }
  for (let k = 0; k < onsets.length; k++) {
    const on = onsets[k];
    let ref = -200;
    for (let j = on.i; j <= Math.min(n - 1, on.i + 3); j++) ref = Math.max(ref, midE[j]);
    let nextAttack = n;
    for (let m = k + 1; m < onsets.length; m++) {
      if (onsets[m].i - on.i > maxF) break;
      if (onsets[m].s >= 0.6 * on.s && onsets[m].mix[TONAL] + onsets[m].mix[SNARE] > 0.35) {
        nextAttack = onsets[m].i;
        break;
      }
    }
    let j = on.i + 3;
    const end = Math.min(n - 1, on.i + maxF, nextAttack);
    while (j < end && midE[j] >= ref - 8) j++;
    on.sustain = Math.max(0, (j - on.i) * ft.step);
  }
}
