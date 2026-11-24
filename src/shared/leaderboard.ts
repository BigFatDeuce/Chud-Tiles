// The online leaderboard: what a published score contains and the rules a score must follow to be
// accepted. Shared by the game (what it sends) and the server (server/src/index.ts, which checks).

export const LEADERBOARD_URL = 'https://chud-tiles.holy-c.men';

/** Only the predefined difficulties are ranked (Custom settings are not comparable). */
export const BOARD_DIFFICULTIES = ['easy', 'normal', 'hard', 'expert'] as const;
export type BoardDifficulty = (typeof BOARD_DIFFICULTIES)[number];

export type Rank = 'SS' | 'S' | 'A' | 'B' | 'C' | 'D';
const RANKS: Rank[] = ['SS', 'S', 'A', 'B', 'C', 'D'];

/** A score as sent by the game. */
export interface ScoreSubmission {
  pseudo: string;
  /** The song: `yt:<videoId>` for YouTube, `s:<artist>|<title>` (normalised) for a file. */
  songKey: string;
  title: string;
  artist: string | null;
  source: 'local' | 'youtube' | 'file';
  difficulty: BoardDifficulty;
  lanes: number;
  score: number;
  accuracy: number;
  maxCombo: number;
  centre: number;
  perfect: number;
  great: number;
  good: number;
  miss: number;
  holdOk: number;
  holdBreak: number;
  rank: Rank;
  fullCombo: boolean;
  chartLevel: number;
  /** Song duration, s. */
  duration: number;
  /** Game version. */
  version: string;
}

/** A score as listed by the server. */
export interface ScoreRow extends Omit<ScoreSubmission, 'version'> {
  id: string;
  /** Publication time, ms. */
  at: number;
}

export interface PublishResult {
  id: string;
  /** Place of the player's best score on this song's board (1 = first), and number of players. */
  place: number;
  players: number;
  /** This score is the player's new best on the board. */
  best: boolean;
}

/** Letters (any alphabet), digits, spaces and a few signs; 2 to 20 characters. */
export function cleanPseudo(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} _.\-']/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length >= 2 && s.length <= 20 ? s : null;
}

/** Same pseudo whatever the case or accents: one line per player on a board. */
export const pseudoKey = (p: string) =>
  p
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[([][^)\]]*(official|video|audio|lyric|clip|visuali[sz]er|hd|4k|remaster|music)[^)\]]*[)\]]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Board key of a song: its YouTube video, or its cleaned artist and title. */
export function songKeyOf(t: { title: string; artist: string | null; videoId?: string | null; source: string }): string {
  if (t.source === 'youtube' && t.videoId) return `yt:${t.videoId}`;
  const artist = fold((t.artist ?? '').replace(/\s*-\s*topic$/i, '').replace(/vevo$/i, ''));
  let title = fold(t.title);
  if (artist && title.startsWith(`${artist} `)) title = title.slice(artist.length + 1);
  return `s:${artist}|${title}`.slice(0, 200);
}

/**
 * The most a run can score: every head dead on with the full streak bonus at ×8, every long note
 * tail at ×8. Anything above is not a real run.
 */
export function maxScore(heads: number, holds: number): number {
  return heads * 1500 * 2 * 8 + holds * 500 * 8;
}

const int = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const str = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;

/** Checks a submission; returns the cleaned score or why it is refused. */
export function validateScore(b: unknown): { ok: true; value: ScoreSubmission } | { ok: false; error: string } {
  if (!b || typeof b !== 'object') return { ok: false, error: 'body' };
  const x = b as Record<string, unknown>;
  const pseudo = cleanPseudo(x.pseudo);
  if (!pseudo) return { ok: false, error: 'pseudo' };
  if (!str(x.songKey, 200) || !/^(yt:[\w-]{11}|s:.*\|.+)$/.test(x.songKey as string)) return { ok: false, error: 'song' };
  if (!str(x.title, 200)) return { ok: false, error: 'title' };
  if (x.artist !== null && !(typeof x.artist === 'string' && x.artist.length <= 200)) return { ok: false, error: 'artist' };
  if (!['local', 'youtube', 'file'].includes(x.source as string)) return { ok: false, error: 'source' };
  if (!BOARD_DIFFICULTIES.includes(x.difficulty as BoardDifficulty)) return { ok: false, error: 'difficulty' };
  if (!int(x.lanes, 3, 7)) return { ok: false, error: 'lanes' };
  for (const k of ['maxCombo', 'centre', 'perfect', 'great', 'good', 'miss', 'holdOk', 'holdBreak'] as const) if (!int(x[k], 0, 100_000)) return { ok: false, error: k };
  if (!int(x.score, 0, 1e12)) return { ok: false, error: 'score' };
  if (!num(x.accuracy, 0, 1)) return { ok: false, error: 'accuracy' };
  if (!RANKS.includes(x.rank as Rank)) return { ok: false, error: 'rank' };
  if (typeof x.fullCombo !== 'boolean') return { ok: false, error: 'fullCombo' };
  if (!int(x.chartLevel, 1, 20)) return { ok: false, error: 'chartLevel' };
  if (!num(x.duration, 5, 4 * 3600)) return { ok: false, error: 'duration' };
  if (!str(x.version, 20)) return { ok: false, error: 'version' };
  const v = { ...(x as unknown as ScoreSubmission), pseudo };
  // consistency: the counts must make a real run
  const heads = v.perfect + v.great + v.good + v.miss;
  const holds = v.holdOk + v.holdBreak;
  if (heads < 1 || v.centre > v.perfect || holds > heads) return { ok: false, error: 'counts' };
  if (v.maxCombo > heads + holds) return { ok: false, error: 'combo' };
  if (v.score > maxScore(heads, holds)) return { ok: false, error: 'score' };
  if (v.fullCombo !== (v.miss === 0 && v.holdBreak === 0)) return { ok: false, error: 'fullCombo' };
  // a song is played to its end: notes must fill it (at most 30 notes a second)
  if (heads > v.duration * 30) return { ok: false, error: 'density' };
  return { ok: true, value: v };
}
