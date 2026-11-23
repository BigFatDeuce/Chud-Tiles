// What the game needs from whatever plays the music (a decoded file, the YouTube player):
// a clock that says which song time is heard at a given instant, and transport controls.

export interface SongPlayer {
  readonly kind: 'local' | 'youtube';
  readonly duration: number;
  /** Song time (s) heard at performance-clock instant `perf` (ms). Negative during a lead-in. */
  timeAt(perf: number): number;
  readonly playing: boolean;
  readonly rate: number;
  /** Starts at `from` (s) after `delay` seconds of silence (the lead-in). */
  play(from: number, delay?: number): void;
  pause(): void;
  resume(delay?: number): void;
  seek(t: number): void;
  stop(): void;
  setRate(r: number): void;
  /** Called once when the end of the song is reached. */
  onEnded: (() => void) | null;
  dispose(): void;
}
