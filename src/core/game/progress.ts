import type { DifficultyId } from '../chart/types.ts';
import type { Rank } from './judge.ts';

// Progression: experience, levels, achievements. Pure functions over plain records, so the same
// rules run in the desktop app, in the browser, and in the tests.

export interface PlayRecord {
  id: string;
  /** Stable song key: `local:<path>`, `yt:<videoId>`, `file:<name>:<size>`. */
  trackKey: string;
  title: string;
  artist: string | null;
  source: 'local' | 'youtube' | 'file';
  difficulty: DifficultyId;
  chartSource: 'offline' | 'learned' | 'live';
  chartLevel: number;
  lanes: number;
  score: number;
  accuracy: number;
  maxCombo: number;
  perfect: number;
  /** Dead-centre hits among the perfects, best streak of them (runs before 1.1 have none). */
  centre?: number;
  bestCentreStreak?: number;
  great: number;
  good: number;
  miss: number;
  holdOk: number;
  holdBreak: number;
  ghosts: number;
  stray: number;
  rank: Rank;
  stars: number;
  fullCombo: boolean;
  cleared: boolean;
  failed: boolean;
  /** Lowest energy reached during the run. */
  minEnergy: number;
  /** Seconds of the song played. */
  played: number;
  songDuration: number;
  playedAt: number;
  /** Mean hit offset (ms, + = late): drift hint for calibration. */
  meanOffsetMs: number;
  /** Practice runs (slowed down, section loop) never count for records. */
  practice: boolean;
  /** The game played itself (chart preview): counts for nothing at all. */
  autoplay?: boolean;
  rate: number;
}

export interface Profile {
  xp: number;
  plays: number;
  notesHit: number;
  perfects: number;
  secondsPlayed: number;
  bestCombo: number;
  /** Achievement id → unlock time. */
  achievements: Record<string, number>;
  /** Consecutive days with at least one run, and the last such day (YYYY-MM-DD). */
  streak: number;
  lastDay: string | null;
  /** Song keys played, per source (counts for achievements). */
  songs: { local: number; youtube: number };
  calibrated: boolean;
}

export const emptyProfile = (): Profile => ({ xp: 0, plays: 0, notesHit: 0, perfects: 0, secondsPlayed: 0, bestCombo: 0, achievements: {}, streak: 0, lastDay: null, songs: { local: 0, youtube: 0 }, calibrated: false });

const DIFF_XP: Record<DifficultyId, number> = { easy: 0.6, normal: 1, hard: 1.5, expert: 2.2, custom: 1 };

export function xpFor(r: PlayRecord): number {
  if (r.practice) return 0;
  const hits = r.perfect + r.great + r.good + r.holdOk;
  const base = hits * 2 * DIFF_XP[r.difficulty] * (0.5 + r.accuracy * 0.5);
  const bonus = (r.cleared ? 50 : 0) + (r.fullCombo ? base * 0.2 : 0) + r.stars * 15;
  return Math.round(base + bonus);
}

/** Experience needed to go from level L to L + 1. */
export const xpToNext = (level: number) => Math.round(400 * Math.pow(level, 1.35));

export function levelOf(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let rest = xp;
  while (rest >= xpToNext(level)) {
    rest -= xpToNext(level);
    level++;
  }
  return { level, into: rest, need: xpToNext(level) };
}

/** Ranks of a player, by level: the station's crew titles. */
export function titleOf(level: number): string {
  const titles = ['Cadet', 'Observateur', 'Navigateur', 'Pilote', 'Astronome', 'Commandant', 'Amiral stellaire', 'Légende cosmique'];
  return titles[Math.min(titles.length - 1, Math.floor((level - 1) / 5))];
}

export interface AchievementContext {
  record: PlayRecord;
  profile: Profile;
  /** Difficulties cleared on this song, including this run. */
  clearedOnSong: Set<DifficultyId>;
  hour: number;
}

export interface Achievement {
  id: string;
  title: string;
  desc: string;
  /** Lucide icon name used by the interface. */
  icon: string;
  test: (c: AchievementContext) => boolean;
}

const rec = (c: AchievementContext) => c.record;
const real = (c: AchievementContext) => !c.record.practice;

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-light', title: 'Première lumière', desc: 'Terminer un premier morceau.', icon: 'sunrise', test: (c) => real(c) && rec(c).cleared },
  { id: 'full-combo', title: 'Orbite parfaite', desc: 'Réussir un full combo.', icon: 'orbit', test: (c) => real(c) && rec(c).cleared && rec(c).fullCombo },
  { id: 'ss', title: 'Supernova', desc: 'Obtenir le rang SS.', icon: 'sparkles', test: (c) => real(c) && rec(c).rank === 'SS' },
  { id: 'combo-100', title: 'Ceinture d’astéroïdes', desc: 'Atteindre un combo de 100.', icon: 'circle-dot', test: (c) => rec(c).maxCombo >= 100 },
  { id: 'combo-500', title: 'Nébuleuse', desc: 'Atteindre un combo de 500.', icon: 'cloud', test: (c) => rec(c).maxCombo >= 500 },
  { id: 'combo-1000', title: 'Trou noir', desc: 'Atteindre un combo de 1 000.', icon: 'circle', test: (c) => rec(c).maxCombo >= 1000 },
  { id: 'hard-clear', title: 'Vitesse de libération', desc: 'Terminer un morceau en Hard.', icon: 'rocket', test: (c) => real(c) && rec(c).cleared && (rec(c).difficulty === 'hard' || rec(c).difficulty === 'expert') },
  { id: 'expert-clear', title: 'Horizon des événements', desc: 'Terminer un morceau en Expert.', icon: 'flame', test: (c) => real(c) && rec(c).cleared && rec(c).difficulty === 'expert' },
  { id: 'accuracy-99', title: 'Alignement planétaire', desc: '99 % de précision en Hard ou Expert.', icon: 'crosshair', test: (c) => real(c) && rec(c).cleared && rec(c).accuracy >= 0.99 && (rec(c).difficulty === 'hard' || rec(c).difficulty === 'expert') },
  { id: 'live', title: 'Signal capté', desc: 'Terminer un morceau analysé en direct.', icon: 'radio', test: (c) => rec(c).cleared && rec(c).chartSource === 'live' },
  { id: 'learned', title: 'Mémoire stellaire', desc: 'Jouer une partition apprise d’une écoute YouTube.', icon: 'brain', test: (c) => rec(c).chartSource === 'learned' },
  { id: 'local-10', title: 'Archiviste', desc: 'Jouer 10 morceaux différents de vos fichiers.', icon: 'archive', test: (c) => c.profile.songs.local >= 10 },
  { id: 'youtube-10', title: 'Radiotélescope', desc: 'Jouer 10 morceaux différents de YouTube Music.', icon: 'satellite-dish', test: (c) => c.profile.songs.youtube >= 10 },
  { id: 'plays-50', title: 'Voyageur', desc: '50 parties.', icon: 'compass', test: (c) => c.profile.plays >= 50 },
  { id: 'plays-200', title: 'Navigateur interstellaire', desc: '200 parties.', icon: 'telescope', test: (c) => c.profile.plays >= 200 },
  { id: 'notes-10k', title: 'Pluie de météores', desc: '10 000 notes jouées.', icon: 'zap', test: (c) => c.profile.notesHit >= 10000 },
  { id: 'night', title: 'Observateur nocturne', desc: 'Jouer entre minuit et 5 h.', icon: 'moon', test: (c) => c.hour >= 0 && c.hour < 5 },
  { id: 'marathon', title: 'Marathon cosmique', desc: 'Terminer un morceau de plus de 6 minutes.', icon: 'timer', test: (c) => rec(c).cleared && rec(c).songDuration >= 360 },
  { id: 'streak-7', title: 'Révolution', desc: 'Jouer 7 jours de suite.', icon: 'calendar-days', test: (c) => c.profile.streak >= 7 },
  { id: 'comeback', title: 'Assistance gravitationnelle', desc: 'Terminer après être descendu sous 10 % d’énergie.', icon: 'magnet', test: (c) => real(c) && rec(c).cleared && rec(c).minEnergy < 10 },
  { id: 'all-diff', title: 'Constellation complète', desc: 'Terminer un même morceau dans les 4 difficultés.', icon: 'star', test: (c) => ['easy', 'normal', 'hard', 'expert'].every((d) => c.clearedOnSong.has(d as DifficultyId)) },
  { id: 'calibrated', title: 'Synchronisé', desc: 'Calibrer la latence.', icon: 'gauge', test: (c) => c.profile.calibrated },
];

const day = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** The profile after a run, and the achievements it unlocked. */
export function applyRun(profile: Profile, record: PlayRecord, ctx: { clearedOnSong: Set<DifficultyId>; newSong: boolean }): { profile: Profile; xp: number; unlocked: Achievement[] } {
  if (record.autoplay) return { profile, xp: 0, unlocked: [] };
  const p: Profile = structuredClone(profile);
  const xp = xpFor(record);
  p.xp += xp;
  if (!record.practice) p.plays++;
  p.notesHit += record.perfect + record.great + record.good;
  p.perfects += record.perfect;
  p.secondsPlayed += record.played;
  if (!record.practice) p.bestCombo = Math.max(p.bestCombo, record.maxCombo);
  if (ctx.newSong) {
    if (record.source === 'youtube') p.songs.youtube++;
    else p.songs.local++;
  }
  const today = day(record.playedAt);
  if (p.lastDay !== today) {
    const yesterday = day(record.playedAt - 86400000);
    p.streak = p.lastDay === yesterday ? p.streak + 1 : 1;
    p.lastDay = today;
  }
  const c: AchievementContext = { record, profile: p, clearedOnSong: ctx.clearedOnSong, hour: new Date(record.playedAt).getHours() };
  // practice (slowed down, looped) trains but does not earn trophies
  const unlocked = record.practice ? [] : ACHIEVEMENTS.filter((a) => !p.achievements[a.id] && a.test(c));
  for (const a of unlocked) p.achievements[a.id] = record.playedAt;
  return { profile: p, xp, unlocked };
}
