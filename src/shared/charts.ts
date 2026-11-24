// Shared charts: the analysis of a YouTube song (beats, attacks, sections; never any audio), kept by
// the site so that a song learned or downloaded once is ready for every player of the browser
// version. Charts are rebuilt from it the same way on every machine. Shared by the game (what it
// sends) and the server (server/src/index.ts, which checks it before keeping it).

/** Size limits: a 10-minute song is about 150 KB of JSON, 40 KB gzipped. */
export const CHART_GZIP_MAX = 768 * 1024;
export const CHART_JSON_MAX = 6 * 1024 * 1024;
const DURATION_MAX = 3 * 3600;
const ONSETS_MAX = 200_000;
const BEATS_MAX = 50_000;

export const VIDEO_ID = /^[\w-]{11}$/;

export type ChartSource = 'offline' | 'learned';

/** A downloaded song (whole audio analysed) beats one learned by ear from the player. */
export const betterSource = (next: ChartSource, prev: ChartSource) => next === 'offline' && prev === 'learned';

type Check = { ok: true; value: Record<string, unknown> } | { ok: false; error: string };

const num = (x: unknown, lo = -Infinity, hi = Infinity): x is number => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
const int = (x: unknown, lo: number, hi: number): x is number => Number.isInteger(x) && (x as number) >= lo && (x as number) <= hi;
const arr = (x: unknown, max: number): x is unknown[] => Array.isArray(x) && x.length <= max;
const obj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * Checks an analysis (the game's `Analysis`) field by field: every number finite and in range,
 * every index pointing inside its array, so that a bad upload cannot break the chart generator.
 * Unknown fields are dropped.
 */
export function validateAnalysis(x: unknown, version: number): Check {
  const bad = (error: string): Check => ({ ok: false, error });
  if (!obj(x)) return bad('shape');
  if (x.version !== version) return bad('version');
  if (x.source !== 'offline' && x.source !== 'learned') return bad('source');
  const duration = x.duration;
  if (!num(duration, 1, DURATION_MAX)) return bad('duration');
  const T = duration + 5;

  const g = x.grid;
  if (!obj(g) || !arr(g.beats, BEATS_MAX)) return bad('grid');
  const beats = g.beats;
  for (let i = 0; i < beats.length; i++) if (!num(beats[i], -5, T) || (i > 0 && (beats[i] as number) < (beats[i - 1] as number))) return bad('beats');
  if ((g.meter !== 3 && g.meter !== 4) || !int(g.downbeat, 0, Math.max(0, beats.length - 1)) || !num(g.bpm, 0, 1000) || typeof g.steady !== 'boolean' || !num(g.confidence, 0, 1)) return bad('grid');

  if (!arr(x.onsets, ONSETS_MAX)) return bad('onsets');
  const onsets: Record<string, unknown>[] = [];
  for (const o of x.onsets) {
    if (!obj(o)) return bad('onset');
    const { t, i, s, rel, cls, mix, sustain, pc, pcClarity, bright } = o;
    if (!num(t, -1, T) || !int(i, 0, 1e8) || !num(s, 0, 100) || !num(rel, 0, 1000) || !int(cls, 0, 3) || !num(sustain, 0, T) || !int(pc, 0, 11) || !num(pcClarity, 0, 1) || !num(bright, 0, 100)) return bad('onset');
    if (!Array.isArray(mix) || mix.length !== 4 || !mix.every((m) => num(m, 0, 1))) return bad('onset');
    onsets.push({ t, i, s, rel, cls, mix: [...mix], sustain, pc, pcClarity, bright });
  }

  const st = x.structure;
  if (!obj(st) || !arr(st.bars, BEATS_MAX) || !arr(st.sections, BEATS_MAX)) return bad('structure');
  const nb = st.bars.length;
  const ns = st.sections.length;
  const bars: Record<string, unknown>[] = [];
  for (const [k, b] of st.bars.entries()) {
    if (!obj(b)) return bad('bar');
    const { start, end, beat, intensity, loud, repeatOf, section } = b;
    if (!num(start, -5, T) || !num(end, -5, T) || (end as number) < (start as number) || !int(beat, 0, Math.max(0, beats.length - 1)) || !num(intensity, 0, 1) || !num(loud, -400, 100) || !int(repeatOf, -1, k - 1) || !int(section, 0, Math.max(0, ns - 1))) return bad('bar');
    bars.push({ start, end, beat, intensity, loud, repeatOf, section });
  }
  const sections: Record<string, unknown>[] = [];
  for (const sc of st.sections) {
    if (!obj(sc)) return bad('section');
    const { startBar, endBar, start, end, label, intensity, chorus } = sc;
    if (!int(startBar, 0, nb) || !int(endBar, startBar as number, nb) || !num(start, -5, T) || !num(end, -5, T) || !int(label, 0, 1000) || !num(intensity, 0, 1) || typeof chorus !== 'boolean') return bad('section');
    sections.push({ startBar, endBar, start, end, label, intensity, chorus });
  }

  if (!arr(x.feel, BEATS_MAX) || !x.feel.every((f) => f === 'straight' || f === 'triplet')) return bad('feel');
  if (!arr(x.silences, BEATS_MAX)) return bad('silences');
  for (const s of x.silences) if (!Array.isArray(s) || s.length !== 2 || !num(s[0], -5, T) || !num(s[1], s[0] as number, T)) return bad('silences');

  return {
    ok: true,
    value: {
      version,
      duration,
      grid: { beats: [...beats], downbeat: g.downbeat, meter: g.meter, bpm: g.bpm, steady: g.steady, confidence: g.confidence },
      onsets,
      structure: { bars, sections },
      feel: [...x.feel],
      silences: x.silences.map((s) => [...(s as number[])]),
      source: x.source,
    },
  };
}

/** Five decimals are enough for every field (10 µs on times) and halve the size of the JSON. */
export const compactJson = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1e5) / 1e5 : v));

export async function gzip(text: string): Promise<Uint8Array> {
  const s = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/** Gunzips, refusing to inflate past `max` bytes. */
export async function gunzip(bytes: Uint8Array | ArrayBuffer, max = CHART_JSON_MAX): Promise<string> {
  const reader = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      await reader.cancel().catch(() => undefined);
      throw new Error('too large');
    }
    parts.push(value);
  }
  const all = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.byteLength;
  }
  return new TextDecoder().decode(all);
}
