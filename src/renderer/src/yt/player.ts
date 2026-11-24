import type { SongPlayer } from '../audio/player';
import { YT_ENDED, type YtHost } from './host';

// A YouTube song as the game's music: the official player plays it, its clock is the media time
// measured inside the player (desktop) or read from its API (browser).
//
// The lead-in before the first note has no sound: the time flows from a negative value on the
// performance clock, and YouTube is asked to play a little before 0 (its start latency, learned
// from the previous starts). Until YouTube actually plays, the time waits just before 0 — then
// the media time takes over. A resume after a countdown works the same way, from the paused time.

type Mode = 'idle' | 'lead' | 'playing' | 'paused';

/** Start latency of the player (s): how long after `play` its media time starts advancing. */
let latency = 0.12;

export class YouTubePlayer implements SongPlayer {
  readonly kind = 'youtube' as const;
  onEnded: (() => void) | null = null;
  private readonly host: YtHost;
  private readonly videoId: string;
  private readonly knownDuration: number;
  private mode: Mode = 'idle';
  private _rate = 1;
  /** Lead: time at `leadPerf`, the target media time, whether the time flows before the start. */
  private leadFrom = 0;
  private leadPerf = 0;
  private target = 0;
  private flows = true;
  private playTimer: ReturnType<typeof setTimeout> | undefined;
  private playSentAt = 0;
  private pausedAt = 0;
  private lastT = 0;
  private ended = false;
  private readonly off: () => void;
  private fading: ReturnType<typeof setInterval> | undefined;
  private volume = 1;

  constructor(host: YtHost, videoId: string, duration: number, volume: number) {
    this.host = host;
    this.videoId = videoId;
    this.knownDuration = duration;
    this.volume = volume;
    void host.prime(videoId).catch(() => undefined);
    this.off = host.on((e) => {
      if (e.type === 'state' && e.state === YT_ENDED && (this.mode === 'playing' || this.mode === 'lead') && !this.ended) {
        this.ended = true;
        this.pausedAt = this.duration;
        this.mode = 'paused';
        this.onEnded?.();
      }
    });
  }

  get duration(): number {
    return this.host.duration > 1 ? this.host.duration : this.knownDuration;
  }

  get playing(): boolean {
    return this.mode === 'playing' || this.mode === 'lead';
  }

  get rate(): number {
    return this._rate;
  }

  /** The player is in an ad, buffering or waiting for YouTube to start. */
  get waiting(): boolean {
    if (this.mode === 'lead') return performance.now() - this.leadPerf > ((this.target - this.leadFrom) / this._rate) * 1000 + 250;
    if (this.mode !== 'playing') return false;
    const m = this.host.mediaAt(performance.now());
    return !m.playing;
  }

  timeAt(perf: number): number {
    if (this.mode === 'paused' || this.mode === 'idle') return this.pausedAt;
    const m = this.host.mediaAt(perf);
    if (this.mode === 'lead') {
      // started: advancing from the target since `play` was sent (an older pair — before the
      // seek — cannot pass for the start)
      const since = this.playSentAt ? ((perf - this.playSentAt) / 1000) * this._rate : -1;
      const started = since >= 0 && m.playing && m.t > this.target + 0.005 && m.t < this.target + since + 0.3;
      if (started) {
        // learn how long YouTube takes to start
        const measured = (performance.now() - this.playSentAt) / 1000 - (m.t - this.target) / this._rate;
        if (measured > 0 && measured < 1.5) latency += (measured - latency) * 0.4;
        this.mode = 'playing';
        this.lastT = m.t;
        return m.t;
      }
      const wall = this.leadFrom + ((perf - this.leadPerf) / 1000) * this._rate;
      const held = this.flows ? wall : this.leadFrom;
      return Math.min(held, this.target - 0.002);
    }
    // playing: the media time (held while YouTube buffers or shows an ad)
    this.lastT = m.t;
    return m.t;
  }

  play(from: number, delay = 0): void {
    this.ended = false;
    this.cancelFade();
    this.target = Math.max(0, from);
    this.leadFrom = from;
    this.flows = from < 0;
    this.leadPerf = performance.now();
    this.mode = 'lead';
    this.playSentAt = 0;
    if (this.host.mediaAt(this.leadPerf).playing) this.host.pause();
    this.host.setRate(this._rate);
    const wait = Math.max(0, delay) + Math.max(0, -from) / this._rate;
    const go = () => {
      this.playSentAt = performance.now();
      this.host.play();
    };
    clearTimeout(this.playTimer);
    void this.host.prime(this.videoId).then(
      () => {
        if (this.mode !== 'lead') return;
        const m = this.host.mediaAt(performance.now());
        if (Math.abs(m.t - this.target) > 0.08) this.host.seek(this.target);
        const left = wait - (performance.now() - this.leadPerf) / 1000 - latency;
        if (left > 0.004) this.playTimer = setTimeout(go, left * 1000);
        else go();
      },
      () => undefined,
    );
  }

  pause(): void {
    if (this.mode === 'idle' || this.mode === 'paused') return;
    this.pausedAt = this.timeAt(performance.now());
    clearTimeout(this.playTimer);
    this.host.pause();
    this.mode = 'paused';
  }

  resume(delay = 0): void {
    if (this.mode === 'playing' || this.mode === 'lead') return;
    this.play(this.pausedAt, delay);
    this.flows = false;
  }

  seek(t: number): void {
    if (this.mode === 'playing' || this.mode === 'lead') this.play(t);
    else {
      this.pausedAt = t;
      this.host.seek(Math.max(0, t));
    }
  }

  stop(): void {
    clearTimeout(this.playTimer);
    this.cancelFade();
    if (this.mode !== 'idle') this.host.pause();
    this.mode = 'idle';
    this.pausedAt = 0;
  }

  setRate(r: number): void {
    const t = this.timeAt(performance.now());
    this._rate = r;
    this.host.setRate(r);
    if (this.mode === 'playing') this.play(t);
  }

  /** Failed run: the sound fades out, then the player pauses. */
  windDown(seconds = 1.6): void {
    this.cancelFade();
    const t0 = performance.now();
    this.fading = setInterval(() => {
      const k = (performance.now() - t0) / (seconds * 1000);
      if (k >= 1) {
        this.cancelFade();
        this.host.pause();
        return;
      }
      this.host.setVolume(this.volume * (1 - k));
    }, 60);
  }

  /** Volume 0–1 (music × master), applied at once unless a fade is running. */
  setVolume(v: number): void {
    this.volume = v;
    if (this.fading === undefined) this.host.setVolume(v);
  }

  private cancelFade(): void {
    if (this.fading === undefined) return;
    clearInterval(this.fading);
    this.fading = undefined;
    this.host.setVolume(this.volume);
  }

  dispose(): void {
    this.stop();
    this.off();
  }
}
