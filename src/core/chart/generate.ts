import type { Analysis } from '../analysis/analyze.ts';
import { TONAL, type Onset } from '../analysis/onsets.ts';
import { beatPosition, beatTime } from '../analysis/tempo.ts';
import { rng } from '../util/rng.ts';
import { LaneAssigner } from './lanes.ts';
import { BEAT, DOWNBEAT, EIGHTH, FREE, METRIC_WEIGHT, SIXTEENTH, Spacing, TRIPLET, classWeight, densityFor, levelAllowed } from './rules.ts';
import { CHART_VERSION, HOLD, TAP, type Chart, type ChartStats, type DifficultyId, type DifficultyParams, type Note } from './types.ts';

// From analysis to notes (Mode B, and learned YouTube songs). See docs/ETUDE-ARCHITECTURE.md §7.

export interface GenerateOptions {
  difficulty: DifficultyId;
  params: DifficultyParams;
  seed: number;
  /** No note before this time (s). */
  startAt?: number;
  /** No note after this time (s). */
  endAt?: number;
}

interface Cand {
  t: number;
  /** Fractional beat index. */
  pos: number;
  level: number;
  bar: number;
  /** Position inside the bar in 48ths of a beat (comparison between repeated bars). */
  slot: number;
  s: number;
  rel: number;
  cls: number;
  mix: number[];
  sustain: number;
  pc: number;
  pcClarity: number;
  sal: number;
  triplet: boolean;
  synthetic: boolean;
}

const STRAIGHT: [number, number][] = [[0, BEAT], [0.25, SIXTEENTH], [0.5, EIGHTH], [0.75, SIXTEENTH], [1, BEAT]];
const TRIPLETS: [number, number][] = [[0, BEAT], [1 / 3, TRIPLET], [2 / 3, TRIPLET], [1, BEAT]];

export function generateChart(an: Analysis, opt: GenerateOptions): Chart {
  const p = opt.params;
  const rand = rng(opt.seed);
  const { beats, meter, downbeat } = an.grid;
  const { bars, sections } = an.structure;
  const startAt = Math.max(opt.startAt ?? 0.4, 0);
  const endAt = Math.min(opt.endAt ?? an.duration, an.duration) - 0.15;
  const hasGrid = beats.length >= 8 && an.grid.confidence > 0.08;

  const barOf = (t: number) => {
    if (!bars.length || t < bars[0].start) return 0;
    let lo = 0;
    let hi = bars.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (bars[mid].start <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const sectionOf = (t: number) => {
    for (let s = 0; s < sections.length; s++) if (t < sections[s].end) return s;
    return Math.max(0, sections.length - 1);
  };
  const inSilence = (t: number) => an.silences.some(([a, b]) => t > a + 0.05 && t < b - 0.05);
  const intensityAt = (t: number) => bars[barOf(t)]?.intensity ?? 0.5;

  // ── 1. candidates: attacks snapped to the grid ──
  const byKey = new Map<string, Cand>();
  const cands: Cand[] = [];
  const pushCand = (c: Cand) => {
    const key = c.level === FREE ? `f${c.t.toFixed(3)}` : c.pos.toFixed(3);
    const prev = byKey.get(key);
    if (prev) {
      // two attacks on the same slot: one stronger event, mixing both sources
      if (c.s > prev.s) Object.assign(prev, { ...c, mix: prev.mix.map((m, k) => Math.max(m, c.mix[k])), sustain: Math.max(prev.sustain, c.sustain) });
      else prev.mix = prev.mix.map((m, k) => Math.max(m, c.mix[k]));
      return;
    }
    byKey.set(key, c);
    cands.push(c);
  };
  const barStartPos = (bar: number) => (bars[bar] ? bars[bar].beat : downbeat);
  for (const o of an.onsets) {
    if (o.t < startAt || o.t > endAt || inSilence(o.t)) continue;
    pushCand(snap(o));
  }
  function snap(o: Onset): Cand {
    const bar = barOf(o.t);
    const base = { t: o.t, bar, s: o.s, rel: o.rel, cls: o.cls, mix: o.mix.slice(), sustain: o.sustain, pc: o.pc, pcClarity: o.pcClarity, sal: 0, synthetic: false };
    if (!hasGrid) return { ...base, pos: 0, level: FREE, slot: -1, triplet: false };
    const pos = beatPosition(beats, o.t);
    const k = Math.floor(pos);
    const f = pos - k;
    const triplet = an.feel[sectionOf(o.t)] === 'triplet';
    const grid = triplet ? TRIPLETS : STRAIGHT;
    const beatDur = (beats[Math.min(beats.length - 1, Math.max(1, k + 1))] - beats[Math.min(beats.length - 2, Math.max(0, k))]) || 0.5;
    let g = grid[0];
    for (const x of grid) if (Math.abs(f - x[0]) < Math.abs(f - g[0])) g = x;
    const sub = beatDur * (triplet ? 1 / 3 : 0.25);
    const d = Math.abs(f - g[0]) * beatDur;
    if (d <= Math.max(0.03, 0.32 * sub)) {
      const sp = k + g[0];
      const beatIdx = Math.round(sp);
      let level = g[1];
      if (level === BEAT && Number.isInteger(sp) && (beatIdx - downbeat) % meter === 0) level = DOWNBEAT;
      // the grid regularizes small deviations; where it is locally off (soft intro, rubato), the
      // attack the player hears wins: a note is never moved more than 20 ms away from it
      const gt = beatTime(beats, sp);
      return { ...base, t: Math.abs(gt - o.t) <= 0.02 ? gt : o.t, pos: sp, level, slot: Math.round((sp - barStartPos(bar)) * 48), triplet };
    }
    return { ...base, pos, level: FREE, slot: Math.round((pos - barStartPos(bar)) * 48), triplet };
  }
  // pulses: beats with no attack near them, weak candidates for calm regular passages
  if (hasGrid && an.onsets.length) {
    // only inside the music: never before its first attack or after its last one
    const first = an.onsets[0].t - 0.05;
    const last = an.onsets[an.onsets.length - 1].t + 0.05;
    for (let k = 0; k < beats.length; k++) {
      const t = beats[k];
      if (t < startAt || t > endAt || t < first || t > last || inSilence(t)) continue;
      if (byKey.has(k.toFixed(3))) continue;
      const bar = barOf(t);
      const level = (k - downbeat) % meter === 0 ? DOWNBEAT : BEAT;
      pushCand({ t, pos: k, level, bar, slot: Math.round((k - barStartPos(bar)) * 48), s: 0.2, rel: 0.6, cls: -1, mix: [0.25, 0.25, 0.25, 0.25], sustain: 0, pc: 0, pcClarity: 0, sal: 0, triplet: false, synthetic: true });
    }
  }
  // off-grid attacks only when they really stand out
  const kept = cands.filter((c) => c.level !== FREE || !hasGrid || (c.rel > 1.5 && c.s > 0.45));
  // ── 2. salience ──
  for (const c of kept) {
    const strength = 0.55 * Math.min(1.5, c.s) + 0.45 * (Math.min(2.5, c.rel) / 2.5);
    c.sal = strength * METRIC_WEIGHT[c.level] * classWeight(c.cls) * (0.65 + 0.35 * intensityAt(c.t)) * (c.synthetic ? 0.6 : 1);
  }
  const sals = kept.filter((c) => !c.synthetic).map((c) => c.sal).sort((a, b) => a - b);
  const ref = sals.length ? sals[Math.floor(sals.length * 0.9)] : 1;
  for (const c of kept) c.sal /= ref || 1;
  kept.sort((a, b) => a.t - b.t);

  // ── 3. selection, bar by bar, towards the density the section calls for ──
  const spacing = new Spacing();
  const chosen: Cand[] = [];
  const slotsOfBar = new Map<number, Set<number>>();
  const groups = new Map<number, Cand[]>();
  for (const c of kept) {
    const g = groups.get(c.bar) ?? [];
    g.push(c);
    groups.set(c.bar, g);
  }
  const barIds = [...groups.keys()].sort((a, b) => a - b);
  for (const b of barIds) {
    const list = groups.get(b)!;
    const bar = bars[b];
    const inten = bar?.intensity ?? 0.5;
    const target = Math.max(1, Math.round(densityFor(p, inten) * meter));
    const src = bar && bar.repeatOf >= 0 ? slotsOfBar.get(bar.repeatOf) : undefined;
    const order = list
      // subdivisions must be clearly heard: a faint attack between beats is more often a decay
      // or a reverb tail than something a player would want to tap
      .filter((c) => levelAllowed(p, c.level, c.triplet) && c.sal >= p.floor * (c.synthetic ? 0.5 : c.level === SIXTEENTH ? 1.6 : 1))
      .map((c) => ({ c, score: c.sal + (src ? (src.has(c.slot) ? 0.5 : -0.1) : 0) }))
      .sort((x, y) => y.score - x.score);
    let taken = 0;
    const mine = new Set<number>();
    for (const { c } of order) {
      if (taken >= target) break;
      if (!spacing.canAdd(c.t, p)) continue;
      spacing.add(c.t);
      chosen.push(c);
      mine.add(c.slot);
      taken++;
    }
    slotsOfBar.set(b, mine);
  }
  chosen.sort((a, b) => a.t - b.t);

  // ── 4. long notes ──
  const beatDurAt = (t: number) => {
    if (beats.length < 2) return 0.5;
    const k = Math.max(0, Math.min(beats.length - 2, Math.floor(beatPosition(beats, t))));
    return beats[k + 1] - beats[k];
  };
  const holdOf = new Map<Cand, number>();
  const maxHolds = Math.round(p.holdRate * chosen.length);
  const holdCands = chosen
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !c.synthetic && (c.cls === TONAL || c.mix[TONAL] > 0.35) && c.sustain >= p.minHoldBeats * beatDurAt(c.t))
    .sort((a, b) => b.c.sustain * b.c.sal - a.c.sustain * a.c.sal);
  for (const { c, i } of holdCands) {
    if (holdOf.size >= maxHolds) break;
    const bd = beatDurAt(c.t);
    const q = p.finest >= 2 ? 0.5 : 1;
    let lenBeats = Math.floor(Math.min(c.sustain, 4 * bd) / bd / q) * q;
    let end = hasGrid ? beatTime(beats, c.pos + lenBeats) : c.t + lenBeats * bd;
    if (p.holdExclusive) {
      const next = chosen[i + 1];
      if (next && end > next.t - p.minGap) {
        lenBeats = Math.floor((next.t - p.minGap - c.t) / bd / q) * q;
        end = hasGrid ? beatTime(beats, c.pos + lenBeats) : c.t + lenBeats * bd;
      }
    }
    if (lenBeats < p.minHoldBeats || end > endAt) continue;
    holdOf.set(c, end - c.t);
  }
  // fewer sustained sounds than wanted: a note followed by a breath (≥ 1.5 beats of nothing) rings
  // on as a long note until just before the next one — tonal notes first, then the strongest
  if (holdOf.size < maxHolds) {
    const breaths = chosen
      .map((c, i) => ({ c, next: chosen[i + 1] }))
      .filter(({ c, next }) => !c.synthetic && !holdOf.has(c) && !!next && next.t - c.t >= 1.5 * beatDurAt(c.t))
      .sort((a, b) => b.c.mix[TONAL] - a.c.mix[TONAL] || b.c.sal - a.c.sal);
    for (const { c, next } of breaths) {
      if (holdOf.size >= maxHolds) break;
      const bd = beatDurAt(c.t);
      const q = p.finest >= 2 ? 0.5 : 1;
      const room = next!.t - c.t - Math.max(p.minGap, 0.5 * bd);
      const lenBeats = Math.floor(Math.min(room, 2 * bd) / bd / q) * q;
      if (lenBeats < p.minHoldBeats) continue;
      const end = hasGrid ? beatTime(beats, c.pos + lenBeats) : c.t + lenBeats * bd;
      if (end > endAt || end > next!.t - p.minGap) continue;
      holdOf.set(c, end - c.t);
    }
  }
  // calm, sustained bars with nothing to play: one long note on the downbeat
  if (hasGrid) {
    const loudRef = bars.map((b) => b.loud).sort((a, b) => a - b)[Math.floor(bars.length * 0.5)] ?? -30;
    for (const bar of bars) {
      if (bar.start < startAt || bar.end > endAt || inSilence(bar.start + 0.1)) continue;
      if (bar.loud < loudRef - 20) continue;
      if (spacing.countIn(bar.start - 0.05, bar.end - 0.05) > 0) continue;
      const len = Math.min(2, meter) * beatDurAt(bar.start);
      if (spacing.gap(bar.start) < p.minGap * 2 || spacing.countIn(bar.start, bar.start + len + p.minGap) > 0) continue;
      const c: Cand = { t: bar.start, pos: bar.beat, level: DOWNBEAT, bar: 0, slot: 0, s: 0.3, rel: 1, cls: TONAL, mix: [0, 0, 0, 1], sustain: len, pc: 0, pcClarity: 0, sal: 0.3, triplet: false, synthetic: true };
      spacing.add(c.t);
      chosen.push(c);
      holdOf.set(c, len);
    }
    chosen.sort((a, b) => a.t - b.t);
  }

  // ── 5. chords ──
  const chordSize = new Map<Cand, number>();
  if (p.chordRate > 0 && p.lanes >= 3) {
    const maxChords = Math.round(p.chordRate * chosen.length);
    const sectionStarts = new Set(sections.map((s) => s.start.toFixed(2)));
    const eligible = chosen
      .map((c, i) => ({ c, i }))
      .filter(({ c, i }) => {
        if (c.synthetic || holdOf.has(c) || c.level > BEAT) return false;
        const prev = chosen[i - 1];
        const next = chosen[i + 1];
        const room = p.minGap * 1.6;
        return (!prev || c.t - prev.t >= room) && (!next || next.t - c.t >= room) && intensityAt(c.t) >= 0.45;
      })
      .map(({ c }) => {
        const broad = c.mix.filter((m) => m >= 0.22).length - 1;
        const accent = (c.level === DOWNBEAT ? 0.3 : 0) + (sectionStarts.has(c.t.toFixed(2)) ? 0.6 : 0);
        return { c, score: c.sal * (1 + 0.5 * broad) + accent + intensityAt(c.t) * 0.3 };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, maxChords);
    const maxTriples = p.lanes >= 4 ? Math.round(p.tripleRate * eligible.length) : 0;
    eligible.forEach(({ c }, k) => chordSize.set(c, k < maxTriples && intensityAt(c.t) > 0.75 ? 3 : 2));
  }

  // ── 6. lanes ──
  const assigner = new LaneAssigner(p, rand);
  const lanesOfSlot = new Map<string, number[]>(); // `${bar}:${slot}` → lanes
  const notes: Note[] = [];
  let group = 0;
  for (const c of chosen) {
    const bar = bars[c.bar];
    const hint = bar && bar.repeatOf >= 0 ? (lanesOfSlot.get(`${bar.repeatOf}:${c.slot}`) ?? []) : [];
    const size = chordSize.get(c) ?? 1;
    const dur = holdOf.get(c) ?? 0;
    const lanes = assigner.assign({ t: c.t, size, cls: c.cls, pc: c.pc, pcClarity: c.pcClarity, hint, dur });
    if (!lanes) {
      spacing.remove(c.t);
      continue;
    }
    lanesOfSlot.set(`${c.bar}:${c.slot}`, lanes);
    const gid = lanes.length > 1 ? group++ : -1;
    for (const lane of lanes) notes.push({ t: c.t, lane, dur, kind: dur > 0 ? HOLD : TAP, chord: gid, w: Math.min(1.5, c.sal), cls: c.cls });
  }

  // ── 7. fairness check (belt and braces: every rule verified on the final notes) ──
  const fair = enforce(notes, p);
  const sec = sections.map((s) => ({ start: s.start, end: s.end, intensity: s.intensity, chorus: s.chorus }));
  return {
    version: CHART_VERSION,
    difficulty: opt.difficulty,
    params: p,
    notes: fair,
    beats,
    downbeat,
    meter,
    bpm: an.grid.bpm,
    sections: sec,
    duration: an.duration,
    source: an.source,
    stats: chartStats(fair, an.duration, opt.difficulty),
    seed: opt.seed,
  };
}

/** Removes whatever breaks a rule (weakest note first). Returns the notes sorted by time and lane. */
export function enforce(input: Note[], p: DifficultyParams): Note[] {
  let notes = input.slice().sort((a, b) => a.t - b.t || a.lane - b.lane);
  const drop = new Set<Note>();
  // same lane: gap, and never inside a long note
  const lastOn = new Map<number, Note>();
  for (const n of notes) {
    const prev = lastOn.get(n.lane);
    if (prev && !drop.has(prev)) {
      const freeAt = prev.t + prev.dur;
      if (n.t - prev.t < p.laneGap - 1e-6 || n.t < freeAt + 0.05) {
        drop.add(n.w > prev.w && prev.chord < 0 && n.t >= freeAt + 0.05 ? prev : n);
        if (drop.has(prev)) lastOn.set(n.lane, n);
        continue;
      }
    }
    lastOn.set(n.lane, n);
  }
  notes = notes.filter((n) => !drop.has(n));
  // different times: minimum gap (chords share a time); fingers held
  const out: Note[] = [];
  for (const n of notes) {
    const prev = out[out.length - 1];
    if (prev && n.t !== prev.t && n.t - prev.t < p.minGap - 1e-6) continue;
    let held = 0;
    let same = 0;
    for (let k = out.length - 1; k >= 0 && out[k].t > n.t - 10; k--) {
      const m = out[k];
      if (m.t === n.t) same++;
      else if (m.dur > 0 && m.t + m.dur > n.t) held++;
    }
    if (held + same + 1 > p.maxFingers) continue;
    out.push(n);
  }
  // notes per second: thin the densest windows
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0, j = 0; i < out.length; i++) {
      while (out[j].t < out[i].t - 1 + 1e-9) j++;
      const times = new Set<number>();
      for (let k = j; k <= i; k++) times.add(out[k].t);
      if (i - j + 1 > p.maxNps + 0.001) {
        let weakest = j;
        for (let k = j; k <= i; k++) if (out[k].w < out[weakest].w) weakest = k;
        out.splice(weakest, 1);
        changed = true;
        break;
      }
    }
  }
  // chords that lost a note are single notes again
  const count = new Map<number, number>();
  for (const n of out) if (n.chord >= 0) count.set(n.chord, (count.get(n.chord) ?? 0) + 1);
  for (const n of out) if (n.chord >= 0 && (count.get(n.chord) ?? 0) < 2) n.chord = -1;
  return out;
}

export function chartStats(notes: Note[], duration: number, difficulty: DifficultyId): ChartStats {
  const times = notes.map((n) => n.t);
  let peak = 0;
  for (let i = 0, j = 0; i < times.length; i++) {
    while (times[j] < times[i] - 1) j++;
    peak = Math.max(peak, i - j + 1);
  }
  const span = notes.length > 1 ? Math.max(1, notes[notes.length - 1].t - notes[0].t) : Math.max(1, duration);
  const nps = notes.length / span;
  const chords = new Set(notes.filter((n) => n.chord >= 0).map((n) => n.chord)).size;
  const holds = notes.filter((n) => n.dur > 0).length;
  const base = { easy: 1, normal: 4, hard: 8, expert: 12, custom: 5 }[difficulty];
  const level = Math.max(1, Math.min(20, Math.round(base + nps * 0.9 + peak * 0.25 + (chords / Math.max(1, notes.length)) * 6 - 2)));
  return { notes: notes.length, holds, chords, nps: Math.round(nps * 100) / 100, peakNps: peak, level };
}
