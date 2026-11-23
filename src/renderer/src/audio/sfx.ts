import { audio, sfxBus } from './context';

// Interface and hit sounds, synthesized once at start (no sound files): soft, short, in tune with
// each other (a pentatonic around A), so they never fight the music.

type SfxName = 'hit' | 'hover' | 'click' | 'back' | 'whoosh' | 'count' | 'go' | 'milestone' | 'record' | 'fail';
const buffers = new Map<SfxName, AudioBuffer>();

function render(seconds: number, fn: (t: number, i: number, sr: number) => number): AudioBuffer {
  const ctx = audio();
  const sr = ctx.sampleRate;
  const n = Math.ceil(seconds * sr);
  const b = ctx.createBuffer(1, n, sr);
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = fn(i / sr, i, sr);
  return b;
}

let noiseSeed = 1;
const noise = () => {
  noiseSeed = (noiseSeed * 1664525 + 1013904223) >>> 0;
  return noiseSeed / 2147483648 - 1;
};
const tone = (f: number, t: number) => Math.sin(2 * Math.PI * f * t);
const env = (t: number, a: number, d: number) => (t < a ? t / a : Math.exp(-(t - a) / d));

function build(): void {
  if (buffers.size) return;
  buffers.set('hit', render(0.06, (t) => (noise() * 0.5 + tone(2400, t) * 0.5) * env(t, 0.0005, 0.012) * 0.5));
  buffers.set('hover', render(0.05, (t) => tone(1760, t) * env(t, 0.002, 0.012) * 0.08));
  buffers.set('click', render(0.12, (t) => (tone(880, t) * 0.6 + tone(1320, t) * 0.4) * env(t, 0.002, 0.03) * 0.22));
  buffers.set('back', render(0.12, (t) => (tone(660, t) * 0.6 + tone(440, t) * 0.4) * env(t, 0.002, 0.035) * 0.2));
  buffers.set('whoosh', render(1.2, (t) => {
    const k = t / 1.2;
    return noise() * Math.sin(Math.PI * k) ** 2 * 0.12 * (0.6 + 0.4 * tone(2 + k * 6, t));
  }));
  buffers.set('count', render(0.25, (t) => (tone(880, t) + tone(1760, t) * 0.3) * env(t, 0.003, 0.06) * 0.22));
  buffers.set('go', render(0.6, (t) => (tone(1320, t) + tone(1760, t) * 0.5 + tone(2640, t) * 0.2) * env(t, 0.004, 0.18) * 0.22));
  buffers.set('milestone', render(1.0, (t) => {
    const notes = [880, 1108.7, 1318.5, 1760];
    let s = 0;
    notes.forEach((f, k) => {
      const tt = t - k * 0.07;
      if (tt > 0) s += tone(f, tt) * env(tt, 0.004, 0.35) * (1 - k * 0.15);
    });
    return s * 0.12;
  }));
  buffers.set('record', render(2.2, (t) => {
    const notes = [659.3, 880, 1108.7, 1318.5, 1760, 2217.5];
    let s = 0;
    notes.forEach((f, k) => {
      const tt = t - k * 0.11;
      if (tt > 0) s += (tone(f, tt) + tone(f * 2, tt) * 0.25) * env(tt, 0.005, 0.7) * (1 - k * 0.08);
    });
    return s * 0.1;
  }));
  buffers.set('fail', render(1.4, (t) => (tone(220 * (1 - t * 0.3), t) + tone(330 * (1 - t * 0.3), t) * 0.5) * env(t, 0.01, 0.4) * 0.18));
}

export function playSfx(name: SfxName, gain = 1): void {
  try {
    build();
    const ctx = audio();
    if (ctx.state !== 'running') return;
    const src = ctx.createBufferSource();
    src.buffer = buffers.get(name)!;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(sfxBus());
    src.start();
  } catch {
    /* audio not available yet */
  }
}

export const playHit = (gain = 1) => playSfx('hit', gain);
