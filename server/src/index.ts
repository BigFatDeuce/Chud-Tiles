// Chud Tiles' site (chud-tiles.holy-c.men): the browser version of the game (static files) and the
// online leaderboard API. Scores live in a D1 (SQLite) database; see server/schema.sql.
//   GET  /api/scores/recent?difficulty=     the 100 latest scores (finished songs, ranked difficulties)
//   GET  /api/scores/song?key=&difficulty=&lanes=   a song's board: best score of each player
//   POST /api/scores                        publishes a score (checked by validateScore)
// Players are not identified: a pseudo is a name, nothing more. The address of the sender is only
// kept as a salted hash, for one hour, to limit how often scores can be sent.

import { BOARD_DIFFICULTIES, pseudoKey, validateScore, type PublishResult, type ScoreRow } from '../../src/shared/leaderboard';

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
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS, ...extra } });

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
  // how often: per sender address (salted hash, forgotten after an hour)
  const now = Date.now();
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
  const who = await sha256(`${env.SALT ?? 'chud-tiles'}|${ip}`);
  const recentPosts = await env.DB.prepare('SELECT COUNT(*) AS n FROM posts WHERE who = ? AND at > ?').bind(who, now - 3600_000).first<{ n: number }>();
  if ((recentPosts?.n ?? 0) >= POSTS_PER_HOUR) return json({ error: 'rate' }, 429, { 'retry-after': '600' });
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
      if (req.method === 'GET' && url.pathname === '/api/health') return json({ ok: true });
      return json({ error: 'not found' }, 404);
    } catch (e) {
      console.error('api', e);
      return json({ error: 'server' }, 500);
    }
  },
};
