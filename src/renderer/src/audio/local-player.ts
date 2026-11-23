import { audio, musicBus } from './context';
import type { SongPlayer } from './player';

// A decoded song played by an AudioBufferSourceNode: sample-exact, and its clock is the audio
// hardware's. getOutputTimestamp() pairs the context time being heard *now* with the performance
// clock, so the output latency announced by the system is already taken into account. The pair
// is refreshed by the audio thread in steps; a slow filter keeps the mapping smooth without
// drifting (big disagreements — a device change, a glitch — snap at once).

export class LocalPlayer implements SongPlayer {
  readonly kind = 'local' as const;
  readonly duration: number;
  onEnded: (() => void) | null = null;
  private readonly ctx = audio();
  private src: AudioBufferSourceNode | null = null;
  private readonly gain: GainNode;
  /** Context time at which song position `startPos` is heard (scheduled start). */
  private startCtx = 0;
  private startPos = 0;
  private pausedAt = 0;
  private _playing = false;
  private _rate = 1;
  /** Smoothed offset: context time = perf / 1000 + off. */
  private off = NaN;
  private ended = false;
  /** Started before the beginning of the song: the time flows through the lead-in. */
  private leadIn = false;
  private readonly buffer: AudioBuffer;

  constructor(buffer: AudioBuffer) {
    this.buffer = buffer;
    this.duration = buffer.duration;
    this.gain = this.ctx.createGain();
    this.gain.connect(musicBus());
  }

  get playing(): boolean {
    return this._playing;
  }

  get rate(): number {
    return this._rate;
  }

  /** Context time heard at performance instant `perf` (ms). */
  private ctxAt(perf: number): number {
    const ts = this.ctx.getOutputTimestamp?.();
    let raw: number;
    if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0) {
      raw = ts.contextTime - ts.performanceTime / 1000;
    } else {
      // no timestamp yet (just started, or unsupported): current time minus the announced latency
      raw = this.ctx.currentTime - (this.ctx.outputLatency || this.ctx.baseLatency || 0) - performance.now() / 1000;
    }
    if (Number.isNaN(this.off) || Math.abs(raw - this.off) > 0.03) this.off = raw;
    else this.off += (raw - this.off) * 0.02;
    return perf / 1000 + this.off;
  }

  timeAt(perf: number): number {
    if (!this._playing) return this.pausedAt;
    const d = this.ctxAt(perf) - this.startCtx;
    // a lead-in flows from negative times; a resume after a countdown stays put until it starts
    return this.startPos + (this.leadIn ? d : Math.max(0, d)) * this._rate;
  }

  play(from: number, delay = 0): void {
    this.stopSource();
    if (this.ctx.state !== 'running') void this.ctx.resume();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this._rate;
    src.connect(this.gain);
    // a lead-in before the start of the song is a negative position: wait, then start at 0
    const pos = Math.max(0, from);
    const wait = Math.max(0, delay) + Math.max(0, -from) / this._rate;
    const when = this.ctx.currentTime + 0.03 + wait;
    src.start(when, pos);
    this.startCtx = when - (from < 0 ? -from / this._rate : 0);
    this.startPos = from < 0 ? from : pos;
    this.leadIn = from < 0;
    this.src = src;
    this._playing = true;
    this.ended = false;
    src.onended = () => {
      if (this.src !== src) return;
      this._playing = false;
      this.pausedAt = this.duration;
      if (!this.ended) {
        this.ended = true;
        this.onEnded?.();
      }
    };
  }

  pause(): void {
    if (!this._playing) return;
    this.pausedAt = this.timeAt(performance.now());
    this.stopSource();
    this._playing = false;
  }

  resume(delay = 0): void {
    if (this._playing) return;
    this.play(this.pausedAt, delay);
  }

  seek(t: number): void {
    if (this._playing) this.play(t);
    else this.pausedAt = t;
  }

  stop(): void {
    this.stopSource();
    this._playing = false;
    this.pausedAt = 0;
  }

  setRate(r: number): void {
    const t = this.timeAt(performance.now());
    this._rate = r;
    if (this._playing) this.play(t);
  }

  /** Fades out and slows down (failed run). */
  windDown(seconds = 1.6): void {
    if (!this.src) return;
    const t = this.ctx.currentTime;
    this.src.playbackRate.setTargetAtTime(0.3, t, seconds / 3);
    this.gain.gain.setTargetAtTime(0, t, seconds / 4);
  }

  private stopSource(): void {
    if (this.src) {
      const s = this.src;
      this.src = null;
      try {
        s.onended = null;
        s.stop();
      } catch {
        /* already stopped */
      }
      s.disconnect();
    }
    this.gain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.gain.gain.value = 1;
  }

  dispose(): void {
    this.stopSource();
    this.gain.disconnect();
  }
}
