import type { TrackRef } from '@shared/types';
import { ANALYSIS_VERSION, type Analysis } from '@core/analysis/analyze';
import { toMono } from '@core/analysis/features';
import { audio } from '../audio/context';
import { platform } from '../platform';
import * as db from '../storage/db';
import { tr } from '../i18n';

// Local song → decoded audio + analysis. The original file is only read, never written. The
// analysis is cached per song (invalidated when the file changes or the analysis improves), so a
// song is analysed once and starts instantly afterwards.

export type LoadStage = 'read' | 'decode' | 'convert' | 'analyse' | 'ready';
export interface LoadProgress {
  stage: LoadStage;
  /** 0–1 within the stage (analysis only). */
  p: number;
}

export interface LoadedSong {
  ref: TrackRef;
  buffer: AudioBuffer;
  analysis: Analysis;
  /** The analysis came from the cache. */
  cached: boolean;
}

interface CachedAnalysis {
  version: number;
  size?: number;
  mtime?: number;
  analysis: Analysis;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (a: Analysis) => void; reject: (e: Error) => void; progress?: (p: number) => void }>();

function analysisWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<{ id: number; progress?: number; analysis?: Analysis; error?: string }>) => {
    const job = pending.get(e.data.id);
    if (!job) return;
    if (e.data.error) {
      pending.delete(e.data.id);
      job.reject(new Error(e.data.error));
    } else if (e.data.analysis) {
      pending.delete(e.data.id);
      job.resolve(e.data.analysis);
    } else if (e.data.progress !== undefined) job.progress?.(e.data.progress);
  };
  worker.onerror = (e) => {
    for (const j of pending.values()) j.reject(new Error(e.message || tr('Analyse impossible')));
    pending.clear();
    worker = null;
  };
  return worker;
}

export function analysePcm(buffer: AudioBuffer, progress?: (p: number) => void): Promise<Analysis> {
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  const mono = toMono(channels);
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, progress });
    analysisWorker().postMessage({ id, kind: 'pcm', mono, sampleRate: buffer.sampleRate, duration: buffer.duration }, [mono.buffer]);
  });
}

/** Learning step: frames recorded during a YouTube listen → precise analysis. */
export function analyseFrames(times: Float64Array, frames: Float32Array, step: number, duration: number): Promise<Analysis> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    analysisWorker().postMessage({ id, kind: 'frames', times, frames, step, duration }, [times.buffer, frames.buffer]);
  });
}

/** decodeAudioData first (every format the engine knows); FFmpeg → FLAC for the others. */
export async function decode(ref: TrackRef, bytes: ArrayBuffer, file: File | undefined, onStage: (s: LoadStage) => void): Promise<AudioBuffer> {
  const ctx = audio();
  try {
    return await ctx.decodeAudioData(bytes.slice(0));
  } catch (first) {
    if (!platform.transcode) throw new Error(tr('Format non pris en charge par ce navigateur ({title}). La version bureau sait le lire.', { title: ref.title }), { cause: first });
    onStage('convert');
    const flac = await platform.transcode(ref, file);
    return ctx.decodeAudioData(flac);
  }
}

export async function cachedAnalysis(ref: TrackRef): Promise<Analysis | null> {
  const c = await db.get<CachedAnalysis>('analyses', ref.key).catch(() => undefined);
  if (!c || c.version !== ANALYSIS_VERSION) return null;
  if (ref.size !== undefined && c.size !== undefined && ref.size !== c.size) return null;
  if (ref.mtime !== undefined && c.mtime !== undefined && ref.mtime !== c.mtime) return null;
  return c.analysis;
}

export async function storeAnalysis(ref: TrackRef, analysis: Analysis): Promise<void> {
  await db.put('analyses', { version: ANALYSIS_VERSION, size: ref.size, mtime: ref.mtime, analysis } satisfies CachedAnalysis, ref.key).catch(() => undefined);
}

export async function loadLocal(ref: TrackRef, file: File | undefined, onProgress: (p: LoadProgress) => void): Promise<LoadedSong> {
  onProgress({ stage: 'read', p: 0 });
  const bytes = await platform.readTrack(ref, file);
  onProgress({ stage: 'decode', p: 0 });
  const buffer = await decode(ref, bytes, file, (stage) => onProgress({ stage, p: 0 }));
  let analysis = await cachedAnalysis(ref);
  const cached = !!analysis;
  if (!analysis) {
    onProgress({ stage: 'analyse', p: 0 });
    analysis = await analysePcm(buffer, (p) => onProgress({ stage: 'analyse', p }));
    await storeAnalysis(ref, analysis);
  }
  onProgress({ stage: 'ready', p: 1 });
  return { ref: { ...ref, duration: ref.duration ?? buffer.duration }, buffer, analysis, cached };
}
