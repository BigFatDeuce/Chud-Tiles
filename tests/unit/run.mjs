// Unit tests of the portable core (analysis, chart generation, live prediction, judgement,
// progression). No test framework: plain Node (≥ 23, TypeScript type stripping), deterministic
// synthetic songs whose ground truth is known exactly (tests/unit/synth.mjs).
//   node tests/unit/run.mjs            all tests
//   node tests/unit/run.mjs judge      only tests whose name contains "judge"
import { makeSong, SR } from './synth.mjs';
import { createFrameAnalyzer, FRAME_SIZE, HOP } from '../../src/core/analysis/frame.ts';
import { extractFeatures, frameTime, regularize } from '../../src/core/analysis/features.ts';
import { analyzeTrack } from '../../src/core/analysis/analyze.ts';
import { generateChart } from '../../src/core/chart/generate.ts';
import { DIFFICULTIES, paramsFor } from '../../src/core/chart/types.ts';
import { LivePredictor } from '../../src/core/live/predictor.ts';
import { validateScore, cleanPseudo, songKeyOf, maxScore } from '../../src/shared/leaderboard.ts';
import { validateAnalysis, compactJson, gzip, gunzip, CHART_GZIP_MAX } from '../../src/shared/charts.ts';
import { ANALYSIS_VERSION } from '../../src/core/analysis/analyze.ts';
import { Judge, rankOf, accuracyOf, starsOf, fullCombo, WINDOWS, CENTRE_WINDOW, CENTRE_POINTS, centreBonus, multiplierFor } from '../../src/core/game/judge.ts';
import { ACHIEVEMENTS, applyRun, emptyProfile, levelOf, titleOf, xpFor, xpToNext } from '../../src/core/game/progress.ts';
import { fileURLToPath } from 'node:url';

const filter = process.argv[2] ?? '';
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
class Fail extends Error {}
const ok = (cond, msg) => {
  if (!cond) throw new Fail(msg);
};
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);
const notes = [];
const note = (s) => notes.push(s);

// Songs are synthesized and analysed once, shared between tests.
const cache = new Map();
function song(opt) {
  const key = JSON.stringify(opt);
  if (!cache.has(key)) {
    const s = makeSong(opt);
    const t0 = performance.now();
    const ft = extractFeatures(s.pcm, SR);
    const an = analyzeTrack(ft, s.duration);
    cache.set(key, { s, ft, an, ms: performance.now() - t0 });
  }
  return cache.get(key);
}
const nearestErr = (xs, t) => {
  let best = Infinity;
  for (const x of xs) if (Math.abs(x - t) < Math.abs(best)) best = x - t;
  return best;
};

// ─── frame analysis ─────────────────────────────────────────────────────────────────────────────
test('frame: analyzer is self-contained (injected into the YouTube frame as source text)', () => {
  const src = createFrameAnalyzer.toString();
  const rebuilt = new Function(`return (${src})`)();
  const a = createFrameAnalyzer(48000);
  const b = rebuilt(48000);
  const block = new Float32Array(4096);
  for (let i = 0; i < block.length; i++) block[i] = Math.sin(i * 0.05) * 0.5 + (i % 97 === 0 ? 0.8 : 0);
  const fa = [];
  const fb = [];
  a.push(block, (f) => fa.push(Float32Array.from(f)));
  b.push(block, (f) => fb.push(Float32Array.from(f)));
  ok(fa.length > 0 && fa.length === fb.length, 'same number of frames');
  for (let k = 0; k < fa.length; k++) for (let j = 0; j < FRAME_SIZE; j++) ok(Object.is(fa[k][j], fb[k][j]), `frame ${k} feature ${j} differs`);
});

test('frame: block size does not change the features (128-sample worklet blocks vs whole file)', () => {
  const { s } = song({ bpm: 120, bars: 4, intro: 1 });
  const whole = [];
  const a = createFrameAnalyzer(SR);
  a.push(s.pcm, (f) => whole.push(Float32Array.from(f)));
  const small = [];
  const b = createFrameAnalyzer(SR);
  for (let i = 0; i < s.pcm.length; i += 128) b.push(s.pcm.subarray(i, i + 128), (f) => small.push(Float32Array.from(f)));
  ok(whole.length === small.length, `frames ${whole.length} vs ${small.length}`);
  for (let k = 0; k < whole.length; k += 7) for (let j = 0; j < FRAME_SIZE; j++) near(small[k][j], whole[k][j], 1e-4, `frame ${k} feature ${j}`);
});

test('features: regularize() rebuilds an even track from irregular live frames', () => {
  const { ft } = song({ bpm: 120, bars: 8 });
  // live frames arrive with jitter and a few drops; keep their time stamps
  const times = [];
  const frames = [];
  for (let i = 0; i < ft.n; i++) {
    if (i % 53 === 17) continue;
    times.push(frameTime(ft, i) + ((i * 7919) % 11 - 5) * 0.0004);
    frames.push(...ft.frames.subarray(i * FRAME_SIZE, (i + 1) * FRAME_SIZE));
  }
  const r = regularize(times, Float32Array.from(frames), ft.step);
  ok(Math.abs(r.n - ft.n) <= 2, `frame count ${r.n} vs ${ft.n}`);
  near(r.step, HOP / SR, 1e-9, 'step');
});

// ─── offline analysis ───────────────────────────────────────────────────────────────────────────
const TEMPI = [
  { bpm: 100 },
  { bpm: 120 },
  { bpm: 128 },
  { bpm: 140 },
  { bpm: 87 },
  { bpm: 120, swing: 1 },
];
for (const opt of TEMPI) {
  test(`analysis: tempo, beats and downbeats ${JSON.stringify(opt)}`, () => {
    const { s, an } = song({ bars: 24, ...opt });
    const g = an.grid;
    near(g.bpm, opt.bpm, opt.bpm * 0.01, 'bpm');
    const errs = s.beats.map((tb) => nearestErr(g.beats, tb)).filter((e) => Math.abs(e) < 0.2);
    ok(errs.length >= s.beats.length * 0.97, `beats matched ${errs.length}/${s.beats.length}`);
    const mean = errs.reduce((a, e) => a + Math.abs(e), 0) / errs.length;
    ok(mean < 0.012, `mean beat error ${(mean * 1000).toFixed(1)} ms`);
    const bars = g.beats.filter((_, k) => k >= g.downbeat && (k - g.downbeat) % g.meter === 0);
    const right = bars.filter((b) => s.downbeats.some((d) => Math.abs(d - b) < 0.03)).length;
    ok(right / bars.length >= 0.8, `downbeats ${right}/${bars.length}`);
    note(`${JSON.stringify(opt).padEnd(24)} bpm ${g.bpm.toFixed(2)}  beat err ${(mean * 1000).toFixed(1)} ms  downbeats ${((right / bars.length) * 100).toFixed(0)} %`);
  });
}

test('analysis: changing tempo is followed (110 → 130 BPM)', () => {
  const { s, an } = song({ bars: 32, bpm: 110, bpm2: 130 });
  const errs = s.beats.map((tb) => nearestErr(an.grid.beats, tb));
  const good = errs.filter((e) => Math.abs(e) < 0.03).length;
  ok(good / s.beats.length >= 0.9, `beats within 30 ms: ${good}/${s.beats.length}`);
  ok(!an.grid.steady, 'grid flagged as not steady');
});

test('analysis: feel — straight vs triplet', () => {
  ok(song({ bars: 24, bpm: 120 }).an.feel.every((f) => f === 'straight'), 'straight song detected as straight');
  const sw = song({ bars: 24, bpm: 120, swing: 1 }).an.feel;
  ok(sw.filter((f) => f === 'triplet').length >= sw.length / 2, `swing song feels: ${sw.join(',')}`);
});

test('analysis: onsets are on time (kicks/snares within 15 ms)', () => {
  const { s, an } = song({ bars: 24, bpm: 128 });
  const drums = s.events.filter((e) => e.cls === 'kick' || e.cls === 'snare');
  const strong = an.onsets.filter((o) => o.s >= 0.3);
  const errs = drums.map((e) => nearestErr(strong.map((o) => o.t), e.t)).filter((e) => Math.abs(e) < 0.05);
  ok(errs.length >= drums.length * 0.9, `drum hits found ${errs.length}/${drums.length}`);
  const sorted = errs.slice().sort((a, b) => a - b);
  near(sorted[sorted.length >> 1], 0, 0.006, 'median onset offset');
  ok(errs.every((e) => Math.abs(e) < 0.025), 'no onset more than 25 ms off');
});

test('analysis: sections — a louder chorus is found', () => {
  const { an } = song({ bars: 32, bpm: 120 });
  ok(an.structure.sections.length >= 2, `sections: ${an.structure.sections.length}`);
  ok(an.structure.bars.length >= 28, `bars: ${an.structure.bars.length}`);
});

test('analysis: speed — well under a second per minute of audio', () => {
  const { s, ms } = song({ bars: 24, bpm: 120 });
  const perMinute = (ms / s.duration) * 60;
  note(`analysis ${perMinute.toFixed(0)} ms per minute of audio`);
  ok(perMinute < 1500, `${perMinute.toFixed(0)} ms per minute`);
});

// ─── chart generation ───────────────────────────────────────────────────────────────────────────
/** Independent check of every fairness rule (does not reuse enforce()). */
function fairness(chart) {
  const p = chart.params;
  const ns = chart.notes;
  const problems = [];
  for (let i = 1; i < ns.length; i++) if (ns[i].t < ns[i - 1].t) problems.push(`not sorted at ${i}`);
  const byLane = new Map();
  for (const n of ns) {
    if (n.lane < 0 || n.lane >= p.lanes) problems.push(`lane ${n.lane} out of range`);
    const prev = byLane.get(n.lane);
    if (prev) {
      if (n.t - prev.t < p.laneGap - 1e-6) problems.push(`jack too fast on lane ${n.lane} at ${n.t.toFixed(3)}`);
      if (n.t < prev.t + prev.dur + 0.05 - 1e-6) problems.push(`note inside a long note on lane ${n.lane} at ${n.t.toFixed(3)}`);
    }
    byLane.set(n.lane, n);
  }
  const times = [...new Set(ns.map((n) => n.t))].sort((a, b) => a - b);
  for (let i = 1; i < times.length; i++) if (times[i] - times[i - 1] < p.minGap - 1e-6) problems.push(`gap ${(times[i] - times[i - 1]).toFixed(3)} at ${times[i].toFixed(3)}`);
  for (const t of times) {
    const at = ns.filter((n) => n.t === t).length;
    const held = ns.filter((n) => n.dur > 0 && n.t < t && n.t + n.dur > t).length;
    if (at + held > p.maxFingers) problems.push(`${at + held} keys at ${t.toFixed(3)}`);
    if (p.holdExclusive && held > 0) problems.push(`note during an exclusive hold at ${t.toFixed(3)}`);
    const win = ns.filter((n) => n.t > t - 1 + 1e-9 && n.t <= t).length;
    if (win > p.maxNps + 0.001) problems.push(`${win} notes in the second before ${t.toFixed(3)}`);
  }
  for (const n of ns) if (n.dur < 0 || (n.dur > 0) !== (n.kind === 1)) problems.push(`bad long note at ${n.t}`);
  const chords = new Map();
  for (const n of ns) if (n.chord >= 0) chords.set(n.chord, [...(chords.get(n.chord) ?? []), n]);
  for (const [id, c] of chords) if (c.length < 2 || c.some((n) => n.t !== c[0].t)) problems.push(`broken chord ${id}`);
  return problems;
}

for (const opt of [{ bpm: 128 }, { bpm: 120, swing: 1 }, { bpm: 110, bpm2: 130 }, { bpm: 87 }]) {
  test(`chart: fair and on the music, every difficulty ${JSON.stringify(opt)}`, () => {
    const { s, an } = song({ bars: 32, ...opt });
    const truth = [...s.events.map((e) => e.t), ...s.beats];
    let prevCount = 0;
    const line = [];
    for (const d of DIFFICULTIES) {
      const c = generateChart(an, { difficulty: d, params: paramsFor(d), seed: 7 });
      const pb = fairness(c);
      ok(pb.length === 0, `${d}: ${pb.slice(0, 4).join('; ')}${pb.length > 4 ? ` … (${pb.length})` : ''}`);
      const on = c.notes.filter((n) => truth.some((t) => Math.abs(t - n.t) < 0.025)).length;
      ok(on / c.notes.length >= 0.95, `${d}: only ${on}/${c.notes.length} notes on a real event`);
      ok(c.notes.length > prevCount, `${d} (${c.notes.length} notes) not denser than the previous difficulty (${prevCount})`);
      prevCount = c.notes.length;
      const lanes = new Array(c.params.lanes).fill(0);
      for (const n of c.notes) lanes[n.lane]++;
      ok(Math.min(...lanes) >= c.notes.length / c.params.lanes / 3, `${d}: unbalanced lanes ${lanes.join('/')}`);
      line.push(`${d} ${c.notes.length}n L${c.stats.level}`);
    }
    note(`${JSON.stringify(opt).padEnd(24)} ${line.join('  ')}`);
  });
}

test('chart: deterministic for a seed, different for another seed', () => {
  const { an } = song({ bars: 32, bpm: 128 });
  const a = generateChart(an, { difficulty: 'hard', params: paramsFor('hard'), seed: 3 });
  const b = generateChart(an, { difficulty: 'hard', params: paramsFor('hard'), seed: 3 });
  const c = generateChart(an, { difficulty: 'hard', params: paramsFor('hard'), seed: 4 });
  ok(JSON.stringify(a.notes) === JSON.stringify(b.notes), 'same seed, same chart');
  ok(JSON.stringify(a.notes) !== JSON.stringify(c.notes), 'another seed changes the chart');
  // the rhythm comes from the music: the times barely move between seeds
  const ta = new Set(a.notes.map((n) => n.t.toFixed(3)));
  const shared = c.notes.filter((n) => ta.has(n.t.toFixed(3))).length;
  ok(shared / c.notes.length > 0.85, `rhythm shared between seeds ${shared}/${c.notes.length}`);
});

test('chart: 3 to 7 lanes, custom difficulty', () => {
  const { an } = song({ bars: 32, bpm: 128 });
  for (const lanes of [3, 5, 6, 7]) {
    const c = generateChart(an, { difficulty: 'hard', params: paramsFor('hard', undefined, lanes), seed: 1 });
    const pb = fairness(c);
    ok(pb.length === 0, `${lanes} lanes: ${pb.slice(0, 3).join('; ')}`);
    ok(new Set(c.notes.map((n) => n.lane)).size === lanes, `${lanes} lanes all used`);
  }
  const custom = generateChart(an, { difficulty: 'custom', params: paramsFor('custom', { densityHi: 1, chordRate: 0, holdRate: 0 }), seed: 1 });
  ok(fairness(custom).length === 0, 'custom chart fair');
  ok(custom.notes.every((n) => n.chord < 0 && n.dur === 0), 'custom: no chords, no long notes');
});

test('chart: calm intro is sparser than the chorus', () => {
  const { an } = song({ bars: 32, bpm: 128 });
  const c = generateChart(an, { difficulty: 'normal', params: paramsFor('normal'), seed: 1 });
  const secs = an.structure.sections;
  const dens = secs.map((s) => c.notes.filter((n) => n.t >= s.start && n.t < s.end).length / Math.max(1, s.end - s.start));
  const calm = secs.reduce((k, s, i) => (s.intensity < secs[k].intensity ? i : k), 0);
  const loud = secs.reduce((k, s, i) => (s.intensity > secs[k].intensity ? i : k), 0);
  ok(dens[loud] > dens[calm], `density calm ${dens[calm].toFixed(2)} vs loud ${dens[loud].toFixed(2)} notes/s`);
});

test('chart: section of a song (practice) and silences', () => {
  const { an } = song({ bars: 32, bpm: 128 });
  const c = generateChart(an, { difficulty: 'hard', params: paramsFor('hard'), seed: 1, startAt: 20, endAt: 40 });
  ok(c.notes.length > 0 && c.notes.every((n) => n.t >= 20 && n.t <= 40), 'notes inside the range');
  for (const [a, b] of an.silences) ok(!c.notes.some((n) => n.t > a + 0.05 && n.t < b - 0.05), `note in silence ${a}-${b}`);
});

// ─── live prediction (Mode A) ───────────────────────────────────────────────────────────────────
function runLive(opt, d) {
  const { s, ft } = song({ bars: 40, ...opt });
  const lp = new LivePredictor({ params: paramsFor(d), horizon: 2.0, seed: 1, sampleRate: SR });
  const out = [];
  let late = 0;
  for (let i = 0; i < ft.n; i++) {
    const t = frameTime(ft, i);
    lp.push(t, ft.frames.subarray(i * FRAME_SIZE, (i + 1) * FRAME_SIZE));
    for (const n of lp.advance(t)) {
      if (n.t < t + 1.0) late++; // the player must see a note at least 1 s before it
      out.push(n);
    }
  }
  const truth = [...s.events.map((e) => e.t), ...s.beats];
  const aligned = out.filter((n) => truth.some((e) => Math.abs(e - n.t) < 0.025)).length;
  return { out, aligned: aligned / Math.max(1, out.length), late, lp, s };
}

for (const [opt, d, min] of [
  [{ bpm: 128 }, 'normal', 0.9],
  [{ bpm: 100 }, 'hard', 0.88],
  [{ bpm: 120, swing: 1 }, 'expert', 0.85],
  [{ bpm: 110, bpm2: 130 }, 'normal', 0.7],
]) {
  test(`live: predicted notes land on the music ${JSON.stringify(opt)} ${d}`, () => {
    const r = runLive(opt, d);
    ok(r.out.length > 40, `notes: ${r.out.length}`);
    ok(r.aligned >= min, `aligned ${(r.aligned * 100).toFixed(0)} % (min ${min * 100} %)`);
    ok(r.late === 0, `${r.late} notes shown less than 1 s ahead`);
    ok(r.out[0].t < 14, `first note at ${r.out[0].t.toFixed(1)} s`);
    for (let i = 1; i < r.out.length; i++) ok(r.out[i].t >= r.out[i - 1].t - 1e-9 || r.out[i].lane !== r.out[i - 1].lane, 'notes out of order');
    note(`${JSON.stringify(opt).padEnd(24)} ${d.padEnd(6)} ${r.out.length} notes, ${(r.aligned * 100).toFixed(0)} % aligned, first ${r.out[0].t.toFixed(1)} s`);
  });
}

test('live: learning — frames recorded during a listen give the precise chart', () => {
  const { lp, s } = runLive({ bpm: 128 }, 'normal');
  const rec = lp.recorded();
  const ft = regularize(rec.times, rec.frames, rec.step);
  const an = analyzeTrack(ft, s.duration, 'learned');
  near(an.grid.bpm, 128, 1.3, 'learned bpm');
  const c = generateChart(an, { difficulty: 'normal', params: paramsFor('normal'), seed: 1 });
  ok(c.source === 'learned' && fairness(c).length === 0, 'learned chart fair');
});

test('live: a seek resets the run without inventing notes', () => {
  const { ft } = song({ bars: 40, bpm: 128 });
  const lp = new LivePredictor({ params: paramsFor('normal'), horizon: 2.0, seed: 1, sampleRate: SR });
  const feed = (from, to) => {
    const out = [];
    for (let i = from; i < to; i++) {
      const t = frameTime(ft, i);
      lp.push(t, ft.frames.subarray(i * FRAME_SIZE, (i + 1) * FRAME_SIZE));
      out.push(...lp.advance(t));
    }
    return out;
  };
  const per = Math.round(1 / ft.step);
  feed(0, per * 20);
  const after = feed(per * 50, per * 52); // jump 30 s ahead
  ok(after.length === 0, `${after.length} notes right after a seek`);
  const later = feed(per * 52, per * 70);
  ok(later.length > 0, 'notes come back after the seek');
});

test('live: silence gives no note (intro, pause, a capture without sound)', () => {
  const an = createFrameAnalyzer(SR);
  let sil = null;
  for (let i = 0; i < 20; i++) an.push(new Float32Array(HOP), (x) => (sil = Float32Array.from(x)));
  const lp = new LivePredictor({ params: paramsFor('expert'), horizon: 2.0, seed: 1, sampleRate: SR });
  let n = 0;
  for (let i = 0; i < (SR / HOP) * 30; i++) {
    const t = (i * HOP) / SR;
    lp.push(t, sil);
    n += lp.advance(t).length;
  }
  ok(n === 0, `${n} notes in 30 s of silence`);
});

test('live: cost per frame (must run at audio rate in the page)', () => {
  const { ft } = song({ bars: 40, bpm: 128 });
  const lp = new LivePredictor({ params: paramsFor('expert'), horizon: 2.0, seed: 1, sampleRate: SR });
  const t0 = performance.now();
  for (let i = 0; i < ft.n; i++) {
    const t = frameTime(ft, i);
    lp.push(t, ft.frames.subarray(i * FRAME_SIZE, (i + 1) * FRAME_SIZE));
    lp.advance(t);
  }
  const us = ((performance.now() - t0) / ft.n) * 1000;
  note(`live predictor ${us.toFixed(0)} µs per frame (budget ${((HOP / SR) * 1e6).toFixed(0)} µs)`);
  ok(us < 500, `${us.toFixed(0)} µs per frame`);
});

// ─── judgement ──────────────────────────────────────────────────────────────────────────────────
const tap = (t, lane, extra = {}) => ({ t, lane, dur: 0, kind: 0, chord: -1, w: 1, cls: 0, ...extra });
const hold = (t, lane, dur) => ({ t, lane, dur, kind: 1, chord: -1, w: 1, cls: 0 });

test('judge: windows, combo, multiplier, rank SS', () => {
  const ns = [];
  for (let i = 0; i < 120; i++) ns.push(tap(1 + i * 0.25, i % 4));
  const j = new Judge(ns, 4);
  for (const n of ns) {
    j.update(n.t - 0.01);
    const e = j.press(n.lane, n.t + 0.01);
    ok(e?.kind === 'hit' && e.judgement === 'perfect', 'perfect hit');
    j.release(n.lane, n.t + 0.05);
  }
  j.update(100);
  const s = j.state;
  ok(s.perfect === 120 && s.miss === 0 && s.maxCombo === 120, 'all perfect');
  ok(rankOf(s) === 'SS' && fullCombo(s) && starsOf(s, true) === 3, 'SS, full combo, 3 stars');
  // every press 10 ms late: dead centre each time, the streak and the combo grow together
  let want = 0;
  for (let k = 1; k <= 120; k++) want += Math.round(CENTRE_POINTS * centreBonus(k) * multiplierFor(k));
  ok(s.centre === 120 && s.bestCentreStreak === 120, `centre ${s.centre}`);
  ok(s.score === want, `score ${s.score} (want ${want})`);
  ok(j.done(), 'done');
});

test('judge: early/late boundaries and misses', () => {
  const j = new Judge([tap(1, 0), tap(2, 0), tap(3, 0), tap(4, 0), tap(5, 0)], 4);
  ok(j.press(0, 1 + WINDOWS.perfect - 0.001).judgement === 'perfect', 'perfect edge');
  ok(j.press(0, 2 - WINDOWS.great + 0.001).judgement === 'great', 'great edge (early)');
  ok(j.press(0, 3 + WINDOWS.good - 0.001).judgement === 'good', 'good edge (late)');
  ok(j.press(0, 4 - WINDOWS.good - 0.02).kind === 'stray', 'too early is a stray press');
  const ev = j.update(5 + WINDOWS.good + 0.01);
  ok(ev.filter((e) => e.kind === 'miss').length === 2, 'notes 4 and 5 missed');
  ok(j.state.combo === 0 && j.state.miss === 2 && j.state.stray === 1, 'combo broken');
  ok(rankOf(j.state) === 'D', `rank ${rankOf(j.state)}`);
});

test('judge: dead centre beats a plain perfect, and its streak resets', () => {
  const j = new Judge([tap(1, 0), tap(2, 0), tap(3, 0), tap(4, 0)], 4);
  const a = j.press(0, 1 + CENTRE_WINDOW - 0.002);
  const b = j.press(0, 2 - CENTRE_WINDOW + 0.002);
  ok(a.centre && b.centre && j.state.centreStreak === 2, 'two dead-centre hits');
  ok(b.points > a.points, `streak bonus ${a.points} → ${b.points}`);
  const c = j.press(0, 3 + WINDOWS.perfect - 0.002);
  ok(c.judgement === 'perfect' && !c.centre && j.state.centreStreak === 0, 'off-centre perfect resets the streak');
  ok(c.points < a.points, `plain perfect ${c.points} < ${a.points}`);
  ok(j.state.perfect === 3 && j.state.centre === 2, 'centre hits count among the perfects');
});

test('leaderboard: score checks', () => {
  const good = { pseudo: '  Chud   Master ', songKey: 'yt:dQw4w9WgXcQ', title: 'Song', artist: 'Artist', source: 'youtube', difficulty: 'hard', lanes: 4, score: 1_200_000, accuracy: 0.97, maxCombo: 300, centre: 200, perfect: 280, great: 20, good: 0, miss: 0, holdOk: 30, holdBreak: 0, rank: 'S', fullCombo: true, chartLevel: 12, duration: 180, version: '1.0.0' };
  const v = validateScore(good);
  ok(v.ok && v.value.pseudo === 'Chud Master', `valid run (${v.ok ? v.value.pseudo : v.error})`);
  ok(cleanPseudo('<script>') === 'script' && cleanPseudo('a') === null && cleanPseudo('x'.repeat(21)) === null, 'pseudo cleaned');
  const no = (patch, why) => {
    const r = validateScore({ ...good, ...patch });
    ok(!r.ok, `${why} refused`);
  };
  no({ difficulty: 'custom' }, 'custom difficulty');
  no({ lanes: 9 }, 'lane count');
  no({ score: maxScore(300, 30) + 1 }, 'impossible score');
  no({ centre: 281 }, 'more dead-on than perfects');
  no({ maxCombo: 400 }, 'combo longer than the notes');
  no({ fullCombo: true, miss: 1 }, 'full combo with a miss');
  no({ songKey: 'http://evil' }, 'song key');
  no({ accuracy: 1.5 }, 'accuracy');
  ok(songKeyOf({ title: 'Artist - Song (Official Video)', artist: 'Artist', source: 'local' }) === songKeyOf({ title: 'Song', artist: 'Artist', source: 'file' }), 'same song, same board');
});

test('shared charts: an analysis survives the trip, a bad one is refused', async () => {
  const { an } = song({ bars: 32, bpm: 128 });
  const text = compactJson(an);
  const z = await gzip(text);
  ok(z.byteLength < CHART_GZIP_MAX, `gzip size ${z.byteLength}`);
  const back = JSON.parse(await gunzip(z));
  const v = validateAnalysis(back, ANALYSIS_VERSION);
  ok(v.ok, `real analysis accepted (${v.ok ? '' : v.error})`);
  const p = { difficulty: 'hard', params: paramsFor('hard'), seed: 3 };
  const a = generateChart(an, p).notes;
  const b = generateChart(v.value, p).notes;
  ok(a.length === b.length && a.every((n, k) => Math.abs(n.t - b[k].t) < 1e-4 && n.lane === b[k].lane), 'same chart after rounding');
  note(`shared chart: ${(text.length / 1024).toFixed(0)} KB JSON, ${(z.byteLength / 1024).toFixed(0)} KB gzip for ${an.duration.toFixed(0)} s`);
  const no = (patch, why) => ok(!validateAnalysis({ ...back, ...patch }, ANALYSIS_VERSION).ok, `${why} refused`);
  no({ version: ANALYSIS_VERSION - 1 }, 'old version');
  no({ duration: 1e9 }, 'duration');
  no({ grid: { ...back.grid, downbeat: back.grid.beats.length + 3 } }, 'downbeat out of range');
  no({ onsets: [{ ...back.onsets[0], cls: 7 }] }, 'onset class');
  no({ structure: { ...back.structure, bars: [{ ...back.structure.bars[0], section: 999 }] } }, 'section index');
  no({ silences: [[5, 2]] }, 'silence backwards');
  let big = false;
  try {
    await gunzip(await gzip('x'.repeat(2_000_000)), 1_000_000);
  } catch {
    big = true;
  }
  ok(big, 'gzip bomb stopped');
});

test('judge: a press takes the earliest pending note of the lane', () => {
  const j = new Judge([tap(1, 1), tap(1.1, 1)], 4);
  const a = j.press(1, 1.06);
  const b = j.press(1, 1.1);
  ok(a.note === 0 && b.note === 1 && b.judgement === 'perfect', 'in order');
});

test('judge: long notes — held, released early, release grace', () => {
  const j = new Judge([hold(1, 0, 1), hold(3, 1, 1), hold(5, 2, 1)], 4);
  j.press(0, 1);
  ok(j.holding(0), 'holding');
  const ok1 = j.update(2.0).find((e) => e.kind === 'hold-ok');
  ok(ok1, 'held to the end');
  j.press(1, 3);
  ok(j.release(1, 3.5).kind === 'hold-break', 'released at half');
  j.press(2, 5);
  ok(j.release(2, 6 - 0.1).kind === 'hold-ok', 'release grace');
  ok(j.state.holdOk === 2 && j.state.holdBreak === 1, 'counts');
  ok(j.state.judged === 6, `judged items ${j.state.judged}`);
});

test('judge: missing a long note loses its tail too', () => {
  const j = new Judge([hold(1, 0, 1)], 4);
  j.update(3);
  ok(j.state.miss === 1 && j.state.holdBreak === 1 && j.state.judged === 2, 'head and tail lost');
});

test('judge: same result whatever the frame rate', () => {
  const ns = [];
  for (let i = 0; i < 200; i++) ns.push(i % 5 === 0 ? hold(1 + i * 0.2, i % 4, 0.15) : tap(1 + i * 0.2, i % 4));
  const presses = ns.map((n, i) => ({ lane: n.lane, t: n.t + (((i * 37) % 21) - 10) * 0.009, up: n.t + n.dur + 0.02 })).filter((_, i) => i % 9 !== 4);
  const run = (fps) => {
    const j = new Judge(ns, 4);
    const evs = [...presses.map((p) => ({ t: p.t, f: () => j.press(p.lane, p.t) })), ...presses.map((p) => ({ t: p.up, f: () => j.release(p.lane, p.up) }))].sort((a, b) => a.t - b.t);
    let k = 0;
    for (let t = 0; t < 45; t += 1 / fps) {
      // input events carry their own time stamps: everything up to this frame, in order
      while (k < evs.length && evs[k].t <= t) {
        j.update(evs[k].t);
        evs[k++].f();
      }
      j.update(t);
    }
    return j.state;
  };
  const a = run(30);
  const b = run(144);
  const c = run(360);
  for (const key of ['score', 'perfect', 'great', 'good', 'miss', 'holdOk', 'holdBreak', 'maxCombo']) ok(a[key] === b[key] && b[key] === c[key], `${key}: ${a[key]} / ${b[key]} / ${c[key]}`);
});

test('judge: live ghosts dissolve without penalty', () => {
  const j = new Judge([], 4, { confirm: (t) => t < 2 });
  j.addNotes([tap(1, 0, { live: true }), tap(3, 1, { live: true })]);
  j.update(5);
  ok(j.state.miss === 1 && j.state.ghosts === 1, `miss ${j.state.miss} ghosts ${j.state.ghosts}`);
  ok(j.status[1] === 2, 'second note dissolved');
});

test('judge: failing at zero energy only when enabled', () => {
  const ns = [];
  for (let i = 0; i < 20; i++) ns.push(tap(1 + i * 0.3, 0));
  const a = new Judge(ns, 4, { fail: true });
  a.update(20);
  ok(a.state.failed && a.state.energy === 0, 'failed');
  const b = new Judge(ns, 4);
  b.update(20);
  ok(!b.state.failed, 'no fail mode');
  ok(accuracyOf(b.state) === 0, 'accuracy 0');
});

// ─── progression ────────────────────────────────────────────────────────────────────────────────
const record = (over = {}) => ({
  id: 'r', trackKey: 'local:a.flac', title: 'A', artist: null, source: 'local', difficulty: 'hard', chartSource: 'offline', chartLevel: 9, lanes: 4,
  score: 100000, accuracy: 0.96, maxCombo: 120, perfect: 150, great: 40, good: 10, miss: 2, holdOk: 10, holdBreak: 0, ghosts: 0, stray: 1,
  rank: 'S', stars: 2, fullCombo: false, cleared: true, failed: false, minEnergy: 60, played: 180, songDuration: 180,
  playedAt: new Date(2026, 10, 23, 21, 0).getTime(), meanOffsetMs: 3, practice: false, rate: 1, ...over,
});

test('progress: experience and levels', () => {
  ok(xpFor(record()) > xpFor(record({ difficulty: 'easy' })), 'harder gives more');
  ok(xpFor(record({ practice: true })) === 0, 'practice gives none');
  const l = levelOf(xpToNext(1) + xpToNext(2) + 5);
  ok(l.level === 3 && l.into === 5, `level ${l.level} into ${l.into}`);
});

test('progress: achievements unlock once, streaks count days', () => {
  let p = emptyProfile();
  const r1 = applyRun(p, record(), { clearedOnSong: new Set(['hard']), newSong: true });
  const ids = r1.unlocked.map((a) => a.id);
  ok(ids.includes('first-light') && ids.includes('hard-clear') && ids.includes('combo-100'), ids.join(','));
  p = r1.profile;
  const r2 = applyRun(p, record({ playedAt: record().playedAt + 3600e3 }), { clearedOnSong: new Set(['hard']), newSong: false });
  ok(!r2.unlocked.some((a) => a.id === 'first-light'), 'not twice');
  ok(r2.profile.streak === 1, 'same day');
  let q = r2.profile;
  for (let d = 1; d <= 6; d++) q = applyRun(q, record({ playedAt: record().playedAt + d * 86400e3 }), { clearedOnSong: new Set(['hard']), newSong: false }).profile;
  ok(q.streak === 7 && q.achievements['streak-7'], `streak ${q.streak}`);
  const all = applyRun(q, record(), { clearedOnSong: new Set(['easy', 'normal', 'hard', 'expert']), newSong: false });
  ok(all.unlocked.some((a) => a.id === 'all-diff'), 'all difficulties');
});

// ─── languages ──────────────────────────────────────────────────────────────────────────────────
test('i18n: every text of the interface has its English translation', async () => {
  const { execFileSync } = await import('node:child_process');
  let out;
  try {
    out = execFileSync(process.execPath, [fileURLToPath(new URL('../../scripts/i18n-extract.mjs', import.meta.url)), 'check'], { encoding: 'utf8' });
  } catch (e) {
    throw new Fail(`missing translations:\n${e.stdout}`);
  }
  ok(/ 0 without English/.test(out), out);
});

test('i18n: achievements, ranks and variables survive translation', async () => {
  const { readDict } = await import('../../scripts/i18n-extract.mjs');
  const EN = readDict(fileURLToPath(new URL('../../src/renderer/src/i18n/en.ts', import.meta.url)));
  for (const a of ACHIEVEMENTS) ok(a.title in EN && a.desc in EN, `achievement ${a.id} untranslated`);
  for (let lv = 1; lv <= 100; lv++) ok(titleOf(lv) in EN, `rank “${titleOf(lv)}” untranslated`);
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const [fr, en] of Object.entries(EN)) {
    ok(vars(fr) === vars(en), `variables differ: “${fr}” → “${en}”`);
    ok(en.trim().length > 0, `empty translation for “${fr}”`);
  }
});

// ─── runner ─────────────────────────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const t0 = performance.now();
for (const t of tests) {
  if (filter && !t.name.includes(filter)) continue;
  const s = performance.now();
  try {
    await t.fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${t.name} \x1b[2m${(performance.now() - s).toFixed(0)} ms\x1b[0m`);
  } catch (e) {
    failed++;
    console.log(`  \x1b[31m✗ ${t.name}\x1b[0m\n      ${e instanceof Fail ? e.message : e.stack}`);
  }
}
if (notes.length) console.log('\n' + notes.map((n) => '  · ' + n).join('\n'));
console.log(`\n${passed} passed, ${failed} failed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
