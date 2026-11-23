import { F_CHROMA, F_ENERGY, F_RMS, FRAME_SIZE } from './frame.ts';
import { percentile, type FeatureTrack } from './features.ts';
import type { Onset } from './onsets.ts';
import type { BeatGrid } from './tempo.ts';

// Song structure at the bar level: intensity (how much is going on), sections (where the music
// changes), labels (which sections are the same music again: verse, chorus…) and, for every bar,
// the earlier bar it repeats — the chart generator reuses its pattern so a riff that comes back
// is played the same way.

export interface Bar {
  start: number;
  end: number;
  /** Index of its first beat in grid.beats. */
  beat: number;
  /** 0–1, relative to this song. */
  intensity: number;
  /** Loudness (dB), mean over the bar. */
  loud: number;
  /** Earlier bar with the same music (-1: none). */
  repeatOf: number;
  section: number;
}

export interface Section {
  startBar: number;
  endBar: number; // exclusive
  start: number;
  end: number;
  /** Same letter = same music (A, B, C…). */
  label: number;
  intensity: number;
  /** The most intense label that comes back: the chorus. */
  chorus: boolean;
}

export interface Structure {
  bars: Bar[];
  sections: Section[];
}

const vecLen = 12 + 8 + 1;

export function analyzeStructure(ft: FeatureTrack, grid: BeatGrid, onsets: Onset[], duration: number): Structure {
  const { beats, meter } = grid;
  const bars: Bar[] = [];
  // bars from the downbeat; a partial bar before it becomes bar 0 when long enough
  const starts: number[] = [];
  for (let k = grid.downbeat; k < beats.length; k += meter) starts.push(k);
  if (!starts.length) {
    return { bars: [{ start: 0, end: duration, beat: 0, intensity: 0.5, loud: -30, repeatOf: -1, section: 0 }], sections: [{ startBar: 0, endBar: 1, start: 0, end: duration, label: 0, intensity: 0.5, chorus: false }] };
  }
  const idx = (t: number) => Math.max(0, Math.min(ft.n - 1, Math.round((t - ft.t0) / ft.step)));
  const vecs: Float64Array[] = [];
  const loudArr: number[] = [];
  const density: number[] = [];
  const bright: number[] = [];
  let oi = 0;
  for (let b = 0; b < starts.length; b++) {
    const k = starts[b];
    const start = beats[k];
    const endBeat = k + meter;
    const end = endBeat < beats.length ? beats[endBeat] : Math.min(duration, start + (beats[k + 1] !== undefined ? (beats[k + 1] - beats[k]) * meter : 2));
    const v = new Float64Array(vecLen);
    let rms = 0;
    let cnt = 0;
    for (let i = idx(start); i < idx(end); i++) {
      const o = i * FRAME_SIZE;
      for (let c = 0; c < 12; c++) v[c] += ft.frames[o + F_CHROMA + c];
      for (let e = 0; e < 8; e++) v[12 + e] += ft.frames[o + F_ENERGY + e];
      rms += ft.frames[o + F_RMS] ** 2;
      cnt++;
    }
    for (let c = 0; c < vecLen; c++) v[c] /= Math.max(1, cnt);
    while (oi < onsets.length && onsets[oi].t < start) oi++;
    let on = 0;
    let s = 0;
    for (let j = oi; j < onsets.length && onsets[j].t < end; j++) {
      on++;
      s += onsets[j].s;
    }
    const beatsInBar = Math.max(1, Math.min(meter, beats.length - k));
    v[20] = on / beatsInBar;
    vecs.push(v);
    loudArr.push(10 * Math.log10(rms / Math.max(1, cnt) + 1e-10));
    density.push(s / beatsInBar);
    bright.push((v[12 + 5] + v[12 + 6]) / 2);
    bars.push({ start, end, beat: k, intensity: 0, loud: loudArr[b], repeatOf: -1, section: 0 });
  }
  const nb = bars.length;
  // ── intensity: loudness, attack density, brightness, each ranked within the song ──
  const rank = (arr: number[]) => {
    const lo = percentile(arr, 0.05);
    const hi = percentile(arr, 0.95);
    return arr.map((x) => Math.max(0, Math.min(1, (x - lo) / (hi - lo + 1e-9))));
  };
  const rl = rank(loudArr);
  const rd = rank(density);
  const rb = rank(bright);
  const raw = rl.map((_, b) => 0.45 * rl[b] + 0.35 * rd[b] + 0.2 * rb[b]);
  // ── similarity between bars (chroma: harmony; energies: timbre and orchestration) ──
  const z = zscoreEnergies(vecs);
  const sim = (a: number, b: number) => cosine(z[a], z[b]);
  // ── novelty → section boundaries (checkerboard kernel over 4 bars each side) ──
  const K = 4;
  const nov = new Float64Array(nb);
  for (let b = K; b < nb - K + 1; b++) {
    let within = 0;
    let across = 0;
    for (let i = b - K; i < b; i++) {
      for (let j = b - K; j < b; j++) within += sim(i, j);
      for (let j = b; j < b + K && j < nb; j++) across += sim(i, j);
    }
    for (let i = b; i < b + K && i < nb; i++) for (let j = b; j < b + K && j < nb; j++) within += sim(i, j);
    nov[b] = within / (2 * K * K) - across / (K * K);
  }
  const novThr = percentile(Array.from(nov), 0.85);
  const cuts = [0];
  for (let b = 2; b < nb - 1; b++) {
    if (nov[b] < novThr || nov[b] <= 0.04) continue;
    if (nov[b] < nov[b - 1] || nov[b] < nov[b + 1]) continue;
    // phrases are 4 or 8 bars: snap a boundary that is one bar off
    let at = b;
    if (b % 4 === 1 && nov[b - 1] > nov[b] * 0.6) at = b - 1;
    else if (b % 4 === 3 && nov[b + 1] > nov[b] * 0.6) at = b + 1;
    if (at - cuts[cuts.length - 1] >= 4) cuts.push(at);
  }
  // also cut on big intensity jumps (drops, breaks)
  for (let b = 1; b < nb; b++) {
    if (Math.abs(raw[b] - raw[b - 1]) > 0.45 && cuts.every((c) => Math.abs(c - b) >= 3)) cuts.push(b);
  }
  cuts.sort((a, b) => a - b);
  cuts.push(nb);
  const sections: Section[] = [];
  for (let s = 0; s < cuts.length - 1; s++) {
    const a = cuts[s];
    const e = cuts[s + 1];
    if (e <= a) continue;
    let inten = 0;
    for (let b = a; b < e; b++) inten += raw[b];
    sections.push({ startBar: a, endBar: e, start: bars[a].start, end: bars[e - 1].end, label: -1, intensity: inten / (e - a), chorus: false });
  }
  // ── labels: sections with similar mean vectors share a label ──
  const meanVec = (s: Section) => {
    const v = new Float64Array(vecLen);
    for (let b = s.startBar; b < s.endBar; b++) for (let c = 0; c < vecLen; c++) v[c] += z[b][c];
    return v;
  };
  const mv = sections.map(meanVec);
  let nextLabel = 0;
  for (let s = 0; s < sections.length; s++) {
    for (let r = 0; r < s; r++) {
      if (cosine(mv[s], mv[r]) > 0.9) {
        sections[s].label = sections[r].label;
        break;
      }
    }
    if (sections[s].label < 0) sections[s].label = nextLabel++;
  }
  // chorus: the most intense label that occurs at least twice
  const byLabel = new Map<number, { n: number; inten: number }>();
  for (const s of sections) {
    const e = byLabel.get(s.label) ?? { n: 0, inten: 0 };
    e.n++;
    e.inten += s.intensity;
    byLabel.set(s.label, e);
  }
  let chorusLabel = -1;
  let best = -1;
  for (const [label, e] of byLabel) if (e.n >= 2 && e.inten / e.n > best) {
    best = e.inten / e.n;
    chorusLabel = label;
  }
  for (const s of sections) s.chorus = s.label === chorusLabel && s.intensity > 0.45;
  // ── final bar intensity: mostly the section's, a bit of the bar's own; choruses lifted ──
  sections.forEach((s, si) => {
    for (let b = s.startBar; b < s.endBar; b++) {
      bars[b].section = si;
      const v = 0.6 * s.intensity + 0.4 * raw[b] + (s.chorus ? 0.12 : 0);
      bars[b].intensity = Math.max(0, Math.min(1, v));
    }
  });
  // ── repetition: earlier bar with the same 2-bar context, same place in the phrase ──
  for (let b = 1; b < nb; b++) {
    let bestSim = 0.93;
    let src = -1;
    for (let p = 1; p < b; p++) {
      if ((b - p) % 2 !== 0) continue;
      const s2 = 0.5 * (sim(b, p) + sim(b - 1, p - 1));
      if (s2 > bestSim) {
        bestSim = s2;
        src = p;
      }
    }
    bars[b].repeatOf = src;
  }
  return { bars, sections };
}

function zscoreEnergies(vecs: Float64Array[]): Float64Array[] {
  const n = vecs.length;
  const mean = new Float64Array(vecLen);
  const sd = new Float64Array(vecLen);
  for (const v of vecs) for (let c = 0; c < vecLen; c++) mean[c] += v[c] / n;
  for (const v of vecs) for (let c = 0; c < vecLen; c++) sd[c] += (v[c] - mean[c]) ** 2 / n;
  return vecs.map((v) => {
    const o = new Float64Array(vecLen);
    // chroma kept as a shape (normalised), energies and density standardised and weighted
    let cs = 0;
    for (let c = 0; c < 12; c++) cs += v[c];
    for (let c = 0; c < 12; c++) o[c] = cs > 0 ? (v[c] / cs - 1 / 12) * 4 : 0;
    for (let c = 12; c < vecLen; c++) o[c] = ((v[c] - mean[c]) / (Math.sqrt(sd[c]) + 1e-6)) * 0.35;
    return o;
  });
}

function cosine(a: Float64Array, b: Float64Array): number {
  let d = 0, x = 0, y = 0;
  for (let c = 0; c < a.length; c++) {
    d += a[c] * b[c];
    x += a[c] * a[c];
    y += b[c] * b[c];
  }
  return x > 0 && y > 0 ? d / Math.sqrt(x * y) : 0;
}
