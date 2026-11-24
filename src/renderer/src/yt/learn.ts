import type { TrackRef } from '@shared/types';
import { FRAME_SIZE, HOP } from '@core/analysis/frame';
import type { Analysis } from '@core/analysis/analyze';
import { analyseFrames, cachedAnalysis, storeAnalysis } from '../game/loader';
import * as db from '../storage/db';
import { shareOnce } from '../online/charts';
import type { FramesBatch } from './host';

// Learning a YouTube song: the feature frames measured while it plays (a live run, or a first
// listen) are kept, one per hop of media time, and once enough of the song has been heard they
// are analysed like a local file — the same analysis, the same charts. The recording itself is
// kept too, so a better analysis (new version of the game) needs no new listen.

interface Recording {
  version: 1;
  step: number;
  sampleRate: number;
  duration: number;
  times: Float64Array;
  frames: Float32Array;
  at: number;
}

/** Frames indexed by media time: a seek, a restart or a replay overwrite instead of piling up. */
export class FrameRecorder {
  step = 0;
  sampleRate = 0;
  private data = new Float32Array(0);
  private have = new Uint8Array(0);
  private count = 0;

  private grow(slots: number): void {
    if (slots <= this.have.length) return;
    const n = Math.max(slots, Math.ceil(this.have.length * 1.5), 4096);
    const d = new Float32Array(n * FRAME_SIZE);
    d.set(this.data);
    const h = new Uint8Array(n);
    h.set(this.have);
    this.data = d;
    this.have = h;
  }

  add(b: FramesBatch, offset = 0): void {
    if (!b.sampleRate || !b.times.length) return;
    if (!this.step) {
      this.sampleRate = b.sampleRate;
      this.step = HOP / b.sampleRate;
    }
    if (b.sampleRate !== this.sampleRate) return; // another device mid-song: ignored
    for (let i = 0; i < b.times.length; i++) {
      const t = b.times[i] + offset;
      if (t < 0) continue;
      const j = Math.round(t / this.step);
      if (j > 3_000_000) continue;
      this.grow(j + 1);
      if (!this.have[j]) this.count++;
      this.have[j] = 1;
      for (let k = 0; k < FRAME_SIZE; k++) this.data[j * FRAME_SIZE + k] = b.data[i * FRAME_SIZE + k];
    }
  }

  /** Seconds of the song heard. */
  heard(): number {
    return this.count * this.step;
  }

  /** Share of [0, duration] heard. */
  coverage(duration: number): number {
    if (!this.step || duration <= 0) return 0;
    const n = Math.min(this.have.length, Math.ceil(duration / this.step));
    let c = 0;
    for (let i = 0; i < n; i++) c += this.have[i];
    return c / Math.max(1, Math.ceil(duration / this.step));
  }

  /** The frames in time order; holes of a few frames (dropped by the browser) are bridged. */
  build(): { times: Float64Array; frames: Float32Array } {
    const n = this.have.length;
    let last = -1;
    const keep: number[] = [];
    const src: number[] = [];
    for (let i = 0; i < n; i++) {
      if (this.have[i]) {
        // bridge a short hole with the last frame heard (no attack in it: flux at 0)
        if (last >= 0 && i - last > 1 && i - last <= 8) for (let g = last + 1; g < i; g++) keep.push(g), src.push(-last - 1);
        keep.push(i);
        src.push(i);
        last = i;
      }
    }
    const times = new Float64Array(keep.length);
    const frames = new Float32Array(keep.length * FRAME_SIZE);
    for (let k = 0; k < keep.length; k++) {
      times[k] = keep[k] * this.step;
      const from = src[k] >= 0 ? src[k] : -src[k] - 1;
      frames.set(this.data.subarray(from * FRAME_SIZE, (from + 1) * FRAME_SIZE), k * FRAME_SIZE);
      if (src[k] < 0) {
        for (let b = 0; b < 8; b++) frames[k * FRAME_SIZE + b] = 0;
        frames[k * FRAME_SIZE + 31] = 0;
      }
    }
    return { times, frames };
  }
}

/** Enough of the song was heard to write its full chart. */
export const LEARN_COVERAGE = 0.85;

/** The full analysis of a YouTube song, if it was learned (analysed again from its recording if the analysis changed). */
export async function learnedAnalysis(ref: TrackRef): Promise<Analysis | null> {
  const a = await cachedAnalysis(ref);
  if (a) return a;
  const rec = await db.get<Recording>('learned', ref.key).catch(() => undefined);
  if (!rec || rec.version !== 1) return null;
  const analysis = await analyseFrames(rec.times.slice(), rec.frames.slice(), rec.step, rec.duration);
  await storeAnalysis(ref, analysis);
  return analysis;
}

/** Keeps the recording and analyses it; null when too little of the song was heard. */
export async function learnFrom(ref: TrackRef, rec: FrameRecorder, duration: number): Promise<Analysis | null> {
  if (!rec.step || duration <= 0 || rec.coverage(duration) < LEARN_COVERAGE) return null;
  const { times, frames } = rec.build();
  const stored: Recording = { version: 1, step: rec.step, sampleRate: rec.sampleRate, duration, times, frames, at: Date.now() };
  await db.put('learned', stored, ref.key).catch(() => undefined);
  const analysis = await analyseFrames(times.slice(), frames.slice(), rec.step, duration);
  await storeAnalysis(ref, analysis);
  void shareOnce(ref.videoId, analysis);
  return analysis;
}

export async function forgetLearned(ref: TrackRef): Promise<void> {
  await db.del('learned', ref.key).catch(() => undefined);
  await db.del('analyses', ref.key).catch(() => undefined);
}
