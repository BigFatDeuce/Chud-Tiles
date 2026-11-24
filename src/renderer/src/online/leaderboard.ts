import { BOARD_DIFFICULTIES, LEADERBOARD_URL, songKeyOf, type BoardDifficulty, type PublishResult, type ScoreRow, type ScoreSubmission } from '@shared/leaderboard';
import type { PlayRecord } from '@core/game/progress';
import type { TrackRef } from '@shared/types';
import { tr } from '../i18n';
import { useSettings } from '../store/settings';

// The online leaderboard (chud-tiles.holy-c.men): reading boards and publishing a score. Nothing is
// sent unless the player asks (publish), and nothing at all when Settings › Online is off.

/** The site itself talks to its own address; the desktop app and other hosts to the public one. */
const base = () => (typeof location !== 'undefined' && location.hostname === new URL(LEADERBOARD_URL).hostname ? '' : LEADERBOARD_URL);

/** Automated tests never reach the real server. */
const offline = () => {
  if (!useSettings.getState().online) return true;
  return typeof window !== 'undefined' && (!!window.ct?.testing || navigator.webdriver);
};

export const onlineEnabled = () => !offline();

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  if (offline()) throw new Error(tr('Classement en ligne désactivé.'));
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10_000);
  try {
    const res = await fetch(base() + path, { ...init, signal: ctl.signal, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
    const body = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(errorText(res.status, body.error));
    return body;
  } catch (e) {
    if ((e as Error).name === 'AbortError' || e instanceof TypeError) throw new Error(tr('Serveur du classement injoignable.'));
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function errorText(status: number, code?: string): string {
  if (status === 429) return tr('Trop de scores envoyés : réessayez dans quelques minutes.');
  if (code === 'pseudo') return tr('Pseudo invalide : 2 à 20 lettres, chiffres, espaces, _ - . \'');
  if (status === 400) return tr('Score refusé par le serveur ({code}).', { code: code ?? '?' });
  return tr('Erreur du serveur du classement ({status}).', { status });
}

export const recentScores = (difficulty: BoardDifficulty | 'all') => call<{ scores: ScoreRow[] }>(`/api/scores/recent?difficulty=${difficulty}`).then((r) => r.scores);

export const songBoard = (songKey: string, difficulty: BoardDifficulty, lanes: number) =>
  call<{ scores: ScoreRow[] }>(`/api/scores/song?key=${encodeURIComponent(songKey)}&difficulty=${difficulty}&lanes=${lanes}`).then((r) => r.scores);

/** Title and channel of a YouTube video (the browser version cannot read them from YouTube itself). */
export const ytTitle = (id: string) => call<{ title: string; artist: string | null }>(`/api/yt/title?id=${encodeURIComponent(id)}`);

export const publishScore = (s: ScoreSubmission) => call<PublishResult>('/api/scores', { method: 'POST', body: JSON.stringify(s) });

/** Why a run cannot be published, or null when it can. */
export function notRankable(r: PlayRecord): string | null {
  if (r.autoplay) return tr('L’aperçu automatique ne compte pas.');
  if (r.practice) return tr('Les entraînements ne comptent pas.');
  if (!r.cleared) return tr('Seuls les morceaux terminés comptent.');
  if (!(BOARD_DIFFICULTIES as readonly string[]).includes(r.difficulty)) return tr('Seules les difficultés prédéfinies sont classées.');
  if (r.chartSource === 'live') return tr('Les parties en direct (notes prédites) ne sont pas classées : rejouez le morceau appris ou téléchargé.');
  return null;
}

export function submissionOf(r: PlayRecord, track: TrackRef, pseudo: string): ScoreSubmission {
  return {
    pseudo,
    songKey: songKeyOf({ title: track.title, artist: track.artist, videoId: track.videoId, source: track.source }),
    title: track.title.slice(0, 200),
    artist: track.artist?.slice(0, 200) ?? null,
    source: r.source,
    difficulty: r.difficulty as BoardDifficulty,
    lanes: r.lanes,
    score: Math.round(r.score),
    accuracy: Math.max(0, Math.min(1, r.accuracy)),
    maxCombo: r.maxCombo,
    centre: r.centre ?? 0,
    perfect: r.perfect,
    great: r.great,
    good: r.good,
    miss: r.miss,
    holdOk: r.holdOk,
    holdBreak: r.holdBreak,
    rank: r.rank,
    fullCombo: r.fullCombo,
    chartLevel: Math.max(1, Math.min(20, Math.round(r.chartLevel))),
    duration: Math.round(r.songDuration * 10) / 10,
    version: __APP_VERSION__,
  };
}
