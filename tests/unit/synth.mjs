// Synthetic music with a known truth: tempo, beat times, downbeats, every drum hit and note.
// Deterministic (seeded noise), so test results never flicker.

export const SR = 44100;

function noiseGen(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

function addKick(buf, t, amp = 0.9) {
  const i0 = Math.round(t * SR);
  let ph = 0;
  for (let i = 0; i < SR * 0.35 && i0 + i < buf.length; i++) {
    const s = i / SR;
    const f = 45 + 90 * Math.exp(-s * 30);
    ph += (2 * Math.PI * f) / SR;
    buf[i0 + i] += amp * Math.sin(ph) * Math.exp(-s * 9) * Math.min(1, i / 20);
  }
}

function addSnare(buf, t, rnd, amp = 0.55) {
  const i0 = Math.round(t * SR);
  let lp = 0;
  for (let i = 0; i < SR * 0.2 && i0 + i < buf.length; i++) {
    const s = i / SR;
    const n = rnd();
    const hp = n - lp;
    lp = lp * 0.6 + n * 0.4;
    buf[i0 + i] += amp * (0.7 * hp * Math.exp(-s * 22) + 0.4 * Math.sin(2 * Math.PI * 185 * s) * Math.exp(-s * 30)) * Math.min(1, i / 10);
  }
}

function addHat(buf, t, rnd, amp = 0.22) {
  const i0 = Math.round(t * SR);
  let prev = 0;
  for (let i = 0; i < SR * 0.05 && i0 + i < buf.length; i++) {
    const s = i / SR;
    const n = rnd();
    buf[i0 + i] += amp * (n - prev) * Math.exp(-s * 90);
    prev = n;
  }
}

function addTone(buf, t, dur, midi, amp = 0.18) {
  const i0 = Math.round(t * SR);
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const len = Math.round(dur * SR);
  for (let i = 0; i < len + SR * 0.08 && i0 + i < buf.length; i++) {
    const s = i / SR;
    const env = Math.min(1, i / 60) * (i < len ? 1 - 0.3 * (s / dur) : Math.exp(-(i - len) / (SR * 0.02)) * 0.7);
    const v = Math.sin(2 * Math.PI * f * s) + 0.5 * Math.sin(4 * Math.PI * f * s) + 0.25 * Math.sin(6 * Math.PI * f * s);
    buf[i0 + i] += amp * env * v;
  }
}

/**
 * A song: `bars` bars of 4/4 at `bpm` (or a tempo map), drums + bass + melody.
 * Options: swing (0–1), intro bars without drums, quiet factor for the intro, tempo change.
 */
export function makeSong({ bpm = 120, bars = 32, swing = 0, intro = 4, seed = 1, lead = 0.5, bpm2 = null, melody = true, noise = 0.002 } = {}) {
  const rnd = noiseGen(seed);
  const beats = [];
  let t = lead;
  for (let b = 0; b < bars * 4; b++) {
    beats.push(t);
    const cur = bpm2 && b >= bars * 2 ? bpm2 : bpm;
    t += 60 / cur;
  }
  const duration = t + 1.5;
  const buf = new Float32Array(Math.ceil(duration * SR));
  const events = [];
  const beatDur = (k) => (beats[k + 1] ?? beats[k] + 60 / (bpm2 ?? bpm)) - beats[k];
  const scale = [0, 3, 5, 7, 10, 12, 15, 12];
  for (let k = 0; k < beats.length; k++) {
    const bar = Math.floor(k / 4);
    const inBar = k % 4;
    const bt = beats[k];
    const d = beatDur(k);
    const off = bt + d * (0.5 + swing * (2 / 3 - 0.5));
    const drums = bar >= intro;
    if (drums) {
      if (inBar === 0 || inBar === 2) {
        addKick(buf, bt);
        events.push({ t: bt, cls: 'kick' });
      }
      if (inBar === 2 && bar % 2 === 1) {
        addKick(buf, off, 0.7);
        events.push({ t: off, cls: 'kick' });
      }
      if (inBar === 1 || inBar === 3) {
        addSnare(buf, bt, rnd);
        events.push({ t: bt, cls: 'snare' });
      }
      addHat(buf, bt, rnd);
      addHat(buf, off, rnd, 0.16);
      events.push({ t: off, cls: 'hat' });
    }
    // bass on each beat (intro: quieter, long notes)
    addTone(buf, bt, d * (drums ? 0.45 : 0.95), 36 + [0, 5, 3, 7][bar % 4], drums ? 0.2 : 0.12);
    if (!drums) events.push({ t: bt, cls: 'bass' });
    // a pad chord per bar, as in most produced music: the harmony changes on the bar line
    if (inBar === 0) {
      const root = 52 + [0, 5, 3, 7][bar % 4];
      for (const iv of [0, 4, 7]) addTone(buf, bt, d * 3.9, root + iv, 0.05);
    }
    if (melody && drums && bar % 4 >= 2 && inBar % 2 === 0) {
      addTone(buf, bt, d * 1.6, 64 + scale[(bar + inBar) % scale.length], 0.12);
      events.push({ t: bt, cls: 'lead', dur: d * 1.6 });
    }
  }
  for (let i = 0; i < buf.length; i++) buf[i] = buf[i] * 0.6 + noise * rnd();
  return { pcm: buf, sr: SR, beats, downbeats: beats.filter((_, k) => k % 4 === 0), events, duration, bpm, bpm2 };
}

/** Single 2 ms clicks at known times (onset timing calibration). */
export function makeClicks(times, duration) {
  const buf = new Float32Array(Math.ceil(duration * SR));
  const rnd = noiseGen(7);
  for (const t of times) {
    const i0 = Math.round(t * SR);
    for (let i = 0; i < SR * 0.002; i++) buf[i0 + i] += 0.8 * rnd() * (1 - i / (SR * 0.002));
  }
  return buf;
}
