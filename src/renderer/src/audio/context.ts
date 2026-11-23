// The one AudioContext of the application. 'interactive' asks the system for its smallest output
// buffer. Browsers only start audio after a user gesture: resume() is called from the first input.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let music: GainNode | null = null;
let sfx: GainNode | null = null;
let analyser: AnalyserNode | null = null;

export function audio(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'interactive' });
    master = ctx.createGain();
    master.connect(ctx.destination);
    music = ctx.createGain();
    sfx = ctx.createGain();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.6;
    music.connect(master);
    music.connect(analyser);
    sfx.connect(master);
    const unlock = () => {
      if (ctx && ctx.state !== 'running') void ctx.resume();
    };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
  }
  return ctx;
}

export const musicBus = (): GainNode => (audio(), music!);
export const sfxBus = (): GainNode => (audio(), sfx!);
export const masterBus = (): GainNode => (audio(), master!);
export const musicAnalyser = (): AnalyserNode => (audio(), analyser!);

export function setVolumes(v: { master: number; music: number; sfx: number }): void {
  audio();
  const t = ctx!.currentTime;
  master!.gain.setTargetAtTime(v.master, t, 0.02);
  music!.gain.setTargetAtTime(v.music, t, 0.02);
  sfx!.gain.setTargetAtTime(v.sfx, t, 0.02);
}

/** Output latency announced by the system (s), for the settings screen. */
export function outputLatency(): number {
  const c = audio();
  return (c.outputLatency || 0) + (c.baseLatency || 0);
}

/** Levels of what is playing (0–1): drives the universe in game. Reuses its buffer. */
const bins = new Uint8Array(512);
export function musicLevels(): { energy: number; bass: number } {
  if (!analyser) return { energy: 0, bass: 0 };
  analyser.getByteFrequencyData(bins);
  let lo = 0;
  let all = 0;
  // 512 bins over 0–24 kHz: bins 0–5 ≈ 0–230 Hz
  for (let i = 0; i < 6; i++) lo += bins[i];
  for (let i = 0; i < 256; i++) all += bins[i];
  return { energy: Math.min(1, all / 256 / 150), bass: Math.min(1, lo / 6 / 210) };
}
