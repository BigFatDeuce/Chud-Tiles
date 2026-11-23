/// <reference lib="webworker" />
import { extractFeatures, regularize } from '@core/analysis/features';
import { analyzeTrack } from '@core/analysis/analyze';

// Offline analysis off the main thread: the game stays fluid while a song is analysed.

type Msg =
  | { id: number; kind: 'pcm'; mono: Float32Array; sampleRate: number; duration: number }
  | { id: number; kind: 'frames'; times: Float64Array; frames: Float32Array; step: number; duration: number };

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  try {
    let lastP = -1;
    const ft =
      m.kind === 'pcm'
        ? extractFeatures(m.mono, m.sampleRate, (p) => {
            const q = Math.round(p * 100);
            if (q !== lastP) {
              lastP = q;
              (self as unknown as Worker).postMessage({ id: m.id, progress: p * 0.85 });
            }
          })
        : regularize(m.times, m.frames, m.step);
    const analysis = analyzeTrack(ft, m.duration, m.kind === 'pcm' ? 'offline' : 'learned');
    (self as unknown as Worker).postMessage({ id: m.id, progress: 1, analysis });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: m.id, error: err instanceof Error ? err.message : String(err) });
  }
};
