import type { Note } from '@core/chart/types';
import type { DifficultyParams } from '@core/chart/types';
import { LivePredictor, type LiveStatus } from '@core/live/predictor';
import { F_ENERGY, F_RMS, FRAME_SIZE } from '@core/analysis/frame';
import type { FramesBatch, YtHost } from '../yt/host';
import { FrameRecorder } from '../yt/learn';

// Mode A in a run: the frames measured inside YouTube's player feed the predictor, which commits
// notes ahead of the music; the same frames are recorded so the song is learned for next time.
// A restart starts a new predictor (the recording is kept).

export class LiveFeed {
  readonly recorder = new FrameRecorder();
  private predictor: LivePredictor | null = null;
  private readonly params: DifficultyParams;
  private readonly horizon: number;
  private seed: number;
  private readonly offsetS: () => number;
  private readonly off: () => void;
  /** Levels of the last frames (the universe reacts to them). */
  private energy = 0;
  private bass = 0;
  private lastFrameAt = 0;
  private framesSeen = 0;

  /** Predicts notes (Mode A); otherwise only records and measures levels. */
  private readonly predict: boolean;

  constructor(host: YtHost, params: DifficultyParams, horizon: number, seed: number, offsetS: () => number, predict = true) {
    this.predict = predict;
    this.params = params;
    this.horizon = horizon;
    this.seed = seed;
    this.offsetS = offsetS;
    this.off = host.onFrames((b) => this.onFrames(b));
  }

  private onFrames(b: FramesBatch): void {
    const off = this.offsetS();
    this.recorder.add(b, off);
    if (!this.predictor && this.predict) this.predictor = new LivePredictor({ params: this.params, horizon: this.horizon, seed: this.seed, sampleRate: b.sampleRate });
    const f = new Float32Array(FRAME_SIZE);
    for (let i = 0; i < b.times.length; i++) {
      for (let k = 0; k < FRAME_SIZE; k++) f[k] = b.data[i * FRAME_SIZE + k];
      this.predictor?.push(b.times[i] + off, f);
      // loudness for the universe: RMS and the kick band
      const rms = f[F_RMS];
      const kick = f[F_ENERGY + 1];
      this.energy += (Math.min(1, rms * 3.2) - this.energy) * 0.2;
      this.bass += (Math.min(1, Math.max(0, (kick + 42) / 36)) - this.bass) * 0.35;
    }
    this.framesSeen += b.times.length;
    this.lastFrameAt = performance.now();
  }

  /** New notes up to song time `t` + horizon. */
  advance(t: number): Note[] {
    return this.predictor ? this.predictor.advance(t) : [];
  }

  confirm(t: number): boolean {
    return this.predictor ? this.predictor.confirm(t) : true;
  }

  beatsBetween(from: number, to: number): number[] {
    return this.predictor ? this.predictor.beatsBetween(from, to) : [];
  }

  status(): (LiveStatus & { receiving: boolean }) | null {
    const receiving = performance.now() - this.lastFrameAt < 800;
    return this.predictor ? { ...this.predictor.status(), receiving } : null;
  }

  /** Frames are arriving (the analyser inside the player works). */
  get receiving(): boolean {
    return this.framesSeen > 0 && performance.now() - this.lastFrameAt < 800;
  }

  levels(): { energy: number; bass: number } {
    const fresh = performance.now() - this.lastFrameAt < 500;
    return fresh ? { energy: this.energy, bass: this.bass } : { energy: 0, bass: 0 };
  }

  reset(): void {
    this.predictor = null;
    this.seed = (this.seed * 1103515245 + 12345) >>> 0;
  }

  dispose(): void {
    this.off();
  }
}
