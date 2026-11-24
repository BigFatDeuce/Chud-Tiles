// Chud Tiles' site (chud-tiles.holy-c.men): the browser version of the game (static files) and the
// online leaderboard API. Scores live in a D1 (SQLite) database; see server/schema.sql.
//   GET  /api/scores/recent?difficulty=     the 100 latest scores (finished songs, ranked difficulties)
//   GET  /api/scores/song?key=&difficulty=&lanes=   a song's board: best score of each player
//   POST /api/scores                        publishes a score (checked by validateScore)
//   GET  /api/yt/title?id=                  a YouTube video's title and channel (oEmbed): the browser
//                                           version cannot read them itself
//   GET  /api/charts/<videoId>?v=           a YouTube song's shared analysis (gzipped JSON), 404 if none
//   POST /api/charts/<videoId>              shares one (gzipped JSON body, checked by validateAnalysis);
//                                           kept if new, or if it replaces one learned by ear with a
//                                           downloaded one
// Players are not identified: a pseudo is a name, nothing more. The address of the sender is only
// kept as a salted hash, for one hour, to limit how often scores can be sent.

import { betterSource, CHART_GZIP_MAX, gunzip, validateAnalysis, VIDEO_ID, type ChartSource } from '../../src/shared/charts';
import { BOARD_DIFFICULTIES, isPlaceholderTitle, pseudoKey, validateScore, type PublishResult, type ScoreRow } from '../../src/shared/leaderboard';

interface D1Result<T> {
  results: T[];
}
interface D1Stmt {
  bind(...v: unknown[]): D1Stmt;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}
interface Env {
  DB: { prepare(sql: string): D1Stmt; batch(s: D1Stmt[]): Promise<unknown> };
  ASSETS: { fetch(req: Request): Promise<Response> };
  SALT?: string;
}

const POSTS_PER_HOUR = 30;
const BODY_MAX = 4096;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-chart-version',
  'access-control-max-age': '86400',
};

const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS, ...extra } });

const YT_ID = /^[\w-]{11}$/;

/** Title and channel of a YouTube video, from YouTube's public oEmbed (cached a day by Cloudflare). */
async function ytTitle(id: string): Promise<{ title: string; artist: string | null } | null> {
  if (!YT_ID.test(id)) return null;
  const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`, {
    cf: { cacheTtl: 86400, cacheEverything: true },
  } as RequestInit);
  if (!res.ok) return null;
  const j = (await res.json()) as { title?: string; author_name?: string };
  if (!j.title) return null;
  return { title: j.title.slice(0, 200), artist: j.author_name ? j.author_name.replace(/ - Topic$/, '').slice(0, 200) : null };
}

const COLS = 'id, pseudo, song_key AS songKey, title, artist, source, difficulty, lanes, score, accuracy, max_combo AS maxCombo, centre, perfect, great, good, miss, hold_ok AS holdOk, hold_break AS holdBreak, rank, full_combo AS fullCombo, chart_level AS chartLevel, duration, at';

type Raw = Omit<ScoreRow, 'fullCombo'> & { fullCombo: number };
const row = (r: Raw): ScoreRow => ({ ...r, fullCombo: !!r.fullCombo });

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function difficultyParam(url: URL): string | null | false {
  const d = url.searchParams.get('difficulty');
  if (!d || d === 'all') return null;
  return (BOARD_DIFFICULTIES as readonly string[]).includes(d) ? d : false;
}

async function recent(url: URL, env: Env): Promise<Response> {
  const d = difficultyParam(url);
  if (d === false) return json({ error: 'difficulty' }, 400);
  const q = d ? env.DB.prepare(`SELECT ${COLS} FROM scores WHERE difficulty = ? ORDER BY at DESC LIMIT 100`).bind(d) : env.DB.prepare(`SELECT ${COLS} FROM scores ORDER BY at DESC LIMIT 100`);
  const { results } = await q.all<Raw>();
  return json({ scores: results.map(row) }, 200, { 'cache-control': 'public, max-age=15' });
}

/** Best score of each player on a board (SQLite returns the row holding the MAX). */
const BOARD_SQL = `SELECT ${COLS}, MAX(score) AS best FROM scores WHERE song_key = ? AND difficulty = ? AND lanes = ? GROUP BY pseudo_key ORDER BY best DESC, at ASC LIMIT 100`;

async function board(url: URL, env: Env): Promise<Response> {
  const key = url.searchParams.get('key') ?? '';
  const d = difficultyParam(url);
  const lanes = Number(url.searchParams.get('lanes'));
  if (!key || key.length > 200 || !d || !Number.isInteger(lanes) || lanes < 3 || lanes > 7) return json({ error: 'query' }, 400);
  const { results } = await env.DB.prepare(BOARD_SQL).bind(key, d, lanes).all<Raw & { best: number }>();
  return json({ scores: results.map(({ best: _b, ...r }) => row(r)) }, 200, { 'cache-control': 'public, max-age=15' });
}

/** Counts a post by this sender; false when it sent too many in the last hour. */
async function allowPost(req: Request, env: Env, now: number): Promise<{ ok: boolean; who: string }> {
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
  const who = await sha256(`${env.SALT ?? 'chud-tiles'}|${ip}`);
  const recentPosts = await env.DB.prepare('SELECT COUNT(*) AS n FROM posts WHERE who = ? AND at > ?').bind(who, now - 3600_000).first<{ n: number }>();
  return { ok: (recentPosts?.n ?? 0) < POSTS_PER_HOUR, who };
}

async function getChart(id: string, url: URL, env: Env): Promise<Response> {
  const v = Number(url.searchParams.get('v'));
  if (!VIDEO_ID.test(id) || !Number.isInteger(v)) return json({ error: 'query' }, 400);
  const r = await env.DB.prepare('SELECT data, source FROM charts WHERE video_id = ? AND version = ?').bind(id, v).first<{ data: ArrayBuffer | number[]; source: string }>();
  if (!r) return json({ error: 'not found' }, 404, { 'cache-control': 'public, max-age=60' });
  const body = r.data instanceof ArrayBuffer ? r.data : new Uint8Array(r.data).buffer;
  return new Response(body, { headers: { 'content-type': 'application/octet-stream', 'x-chart-source': r.source, 'cache-control': 'public, max-age=300', ...CORS, 'access-control-expose-headers': 'x-chart-source' } });
}

async function putChart(id: string, req: Request, env: Env): Promise<Response> {
  const v = Number(req.headers.get('x-chart-version'));
  if (!VIDEO_ID.test(id) || !Number.isInteger(v)) return json({ error: 'query' }, 400);
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > CHART_GZIP_MAX) return json({ error: 'size' }, 413);
  let check;
  try {
    check = validateAnalysis(JSON.parse(await gunzip(bytes)), v);
  } catch {
    return json({ error: 'data' }, 400);
  }
  if (!check.ok) return json({ error: check.error }, 400);
  const source = check.value.source as ChartSource;
  const prev = await env.DB.prepare('SELECT source FROM charts WHERE video_id = ? AND version = ?').bind(id, v).first<{ source: ChartSource }>();
  if (prev && !betterSource(source, prev.source)) return json({ kept: false }, 200);
  const now = Date.now();
  const gate = await allowPost(req, env, now);
  if (!gate.ok) return json({ error: 'rate' }, 429, { 'retry-after': '600' });
  await env.DB.batch([
    env.DB.prepare('INSERT OR REPLACE INTO charts (video_id, version, source, duration, data, size, at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, v, source, check.value.duration, bytes, bytes.byteLength, now),
    env.DB.prepare('INSERT INTO posts (who, at) VALUES (?, ?)').bind(gate.who, now),
  ]);
  return json({ kept: true }, 201);
}

async function publish(req: Request, env: Env): Promise<Response> {
  const text = await req.text();
  if (text.length > BODY_MAX) return json({ error: 'size' }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: 'json' }, 400);
  }
  const v = validateScore(body);
  if (!v.ok) return json({ error: v.error }, 400);
  const s = v.value;
  // YouTube songs opened from a bare link (browser version) arrive without their title: ask YouTube
  if (s.songKey.startsWith('yt:') && isPlaceholderTitle(s.title)) {
    const info = await ytTitle(s.songKey.slice(3)).catch(() => null);
    if (info) {
      s.title = info.title;
      s.artist = s.artist ?? info.artist;
    }
  }
  // how often: per sender address (salted hash, forgotten after an hour)
  const now = Date.now();
  const { ok, who } = await allowPost(req, env, now);
  if (!ok) return json({ error: 'rate' }, 429, { 'retry-after': '600' });
  const pk = pseudoKey(s.pseudo);
  const prev = await env.DB.prepare('SELECT MAX(score) AS best FROM scores WHERE song_key = ? AND difficulty = ? AND lanes = ? AND pseudo_key = ?').bind(s.songKey, s.difficulty, s.lanes, pk).first<{ best: number | null }>();
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO scores (id, pseudo, pseudo_key, song_key, title, artist, source, difficulty, lanes, score, accuracy, max_combo, centre, perfect, great, good, miss, hold_ok, hold_break, rank, full_combo, chart_level, duration, version, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, s.pseudo, pk, s.songKey, s.title, s.artist, s.source, s.difficulty, s.lanes, s.score, s.accuracy, s.maxCombo, s.centre, s.perfect, s.great, s.good, s.miss, s.holdOk, s.holdBreak, s.rank, s.fullCombo ? 1 : 0, s.chartLevel, s.duration, s.version, now),
    env.DB.prepare('INSERT INTO posts (who, at) VALUES (?, ?)').bind(who, now),
    env.DB.prepare('DELETE FROM posts WHERE at < ?').bind(now - 3600_000),
  ]);
  const best = Math.max(prev?.best ?? 0, s.score);
  const above = await env.DB.prepare('SELECT COUNT(*) AS n FROM (SELECT MAX(score) AS b FROM scores WHERE song_key = ? AND difficulty = ? AND lanes = ? GROUP BY pseudo_key) WHERE b > ?').bind(s.songKey, s.difficulty, s.lanes, best).first<{ n: number }>();
  const players = await env.DB.prepare('SELECT COUNT(DISTINCT pseudo_key) AS n FROM scores WHERE song_key = ? AND difficulty = ? AND lanes = ?').bind(s.songKey, s.difficulty, s.lanes).first<{ n: number }>();
  const out: PublishResult = { id, place: (above?.n ?? 0) + 1, players: players?.n ?? 1, best: s.score > (prev?.best ?? -1) };
  return json(out, 201);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      if (req.method === 'GET' && url.pathname === '/api/scores/recent') return await recent(url, env);
      if (req.method === 'GET' && url.pathname === '/api/scores/song') return await board(url, env);
      if (req.method === 'POST' && url.pathname === '/api/scores') return await publish(req, env);
      const chart = /^\/api\/charts\/([^/]+)$/.exec(url.pathname);
      if (chart && req.method === 'GET') return await getChart(chart[1], url, env);
      if (chart && req.method === 'POST') return await putChart(chart[1], req, env);
      if (req.method === 'GET' && url.pathname === '/api/health') return json({ ok: true });
      if (req.method === 'GET' && url.pathname === '/api/yt/title') {
        const info = await ytTitle(url.searchParams.get('id') ?? '').catch(() => null);
        return info ? json(info, 200, { 'cache-control': 'public, max-age=86400' }) : json({ error: 'not found' }, 404);
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      console.error('api', e);
      return json({ error: 'server' }, 500);
    }
  },
};
