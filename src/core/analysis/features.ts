import { createFrameAnalyzer, FRAME_SIZE, HOP, WIN } from './frame.ts';

/** A sequence of feature frames at a regular step (see frame.ts for the layout of one frame). */
export interface FeatureTrack {
  /** n × FRAME_SIZE floats. */
  frames: Float32Array;
  n: number;
  /** Seconds between two frames. */
  step: number;
  /** Time (s) of frame 0's centre. Frame i is at t0 + i × step. */
  t0: number;
}

export const frameTime = (ft: FeatureTrack, i: number) => ft.t0 + i * ft.step;
export const frameAt = (ft: FeatureTrack, t: number) => Math.round((t - ft.t0) / ft.step);

/** Stereo or mono PCM → mono at about 24 kHz or more (features need nothing above 20 kHz). */
export function toMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const out = new Float32Array(n);
  const k = 1 / channels.length;
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] * k;
  return out;
}

/**
 * Whole-signal extraction (Mode B). `onProgress` is called every few thousand frames.
 * Frame i's centre is at ((i + 1) × HOP − WIN / 2) / sampleRate.
 */
export function extractFeatures(mono: Float32Array, sampleRate: number, onProgress?: (p: number) => void): FeatureTrack {
  const an = createFrameAnalyzer(sampleRate);
  const total = Math.floor(mono.length / HOP);
  const frames = new Float32Array(total * FRAME_SIZE);
  let n = 0;
  const CHUNK = HOP * 512;
  for (let off = 0; off < mono.length; off += CHUNK) {
    an.push(mono.subarray(off, Math.min(mono.length, off + CHUNK)), (f) => {
      if (n < total) frames.set(f, n * FRAME_SIZE);
      n++;
    });
    onProgress?.(Math.min(1, (off + CHUNK) / mono.length));
  }
  return { frames, n: Math.min(n, total), step: HOP / sampleRate, t0: (HOP - WIN / 2) / sampleRate };
}

/**
 * Frames received with their own timestamps (YouTube: media time of each frame, possibly with
 * gaps, pauses, seeks) → a regular track. Missing frames are left silent; a frame seen twice
 * (seek back) keeps its last measure.
 */
export function regularize(times: Float64Array | number[], frames: Float32Array, step: number): FeatureTrack {
  const count = times.length;
  if (!count) return { frames: new Float32Array(0), n: 0, step, t0: 0 };
  let tMin = Infinity;
  let tMax = -Infinity;
  for (let i = 0; i < count; i++) {
    tMin = Math.min(tMin, times[i]);
    tMax = Math.max(tMax, times[i]);
  }
  const t0 = Math.max(0, tMin);
  const n = Math.max(1, Math.round((tMax - t0) / step) + 1);
  const out = new Float32Array(n * FRAME_SIZE);
  // silent frames: energies at the floor, not 0 dB
  for (let i = 0; i < n; i++) for (let b = 0; b < 8; b++) out[i * FRAME_SIZE + 8 + b] = -100;
  for (let i = 0; i < count; i++) {
    const j = Math.round((times[i] - t0) / step);
    if (j >= 0 && j < n) out.set(frames.subarray(i * FRAME_SIZE, (i + 1) * FRAME_SIZE), j * FRAME_SIZE);
  }
  return { frames: out, n, step, t0 };
}

/** Linear-time percentile of a sample (copies and sorts a subsample when large). */
export function percentile(values: ArrayLike<number>, p: number): number {
  const n = values.length;
  if (!n) return 0;
  const stride = Math.max(1, Math.floor(n / 20000));
  const a: number[] = [];
  for (let i = 0; i < n; i += stride) a.push(values[i]);
  a.sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))];
}

/** Moving average with a window of ±r samples (O(n)). */
export function movingAverage(x: Float32Array, r: number): Float32Array {
  const n = x.length;
  const out = new Float32Array(n);
  let sum = 0;
  let lo = 0;
  let hi = -1;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - r);
    const b = Math.min(n - 1, i + r);
    while (hi < b) sum += x[++hi];
    while (lo < a) sum -= x[lo++];
    out[i] = sum / (hi - lo + 1);
  }
  return out;
}
