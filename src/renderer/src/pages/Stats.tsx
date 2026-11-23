import { tr } from '../i18n';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Clock, Flame, History, Music, Target, Trophy, Zap } from 'lucide-react';
import { ACHIEVEMENTS, levelOf, titleOf, xpToNext, type PlayRecord } from '@core/game/progress';
import type { DifficultyId } from '@core/chart/types';
import { useProfile } from '../store/profile';
import { useLibrary } from '../store/library';
import * as db from '../storage/db';
import { openTrack } from '../game/actions';
import { AchIcon, DIFF_COLOR, DIFF_LABEL, RankBadge, Seg, fmtDuration, fmtPct, fmtScore, fmtWhen } from '../components/ui';
import { LevelRing } from './Home';

// The logbook: the crew member's level, totals, personal leaderboard, history and trophies.

type Diff = DifficultyId | 'all';

export function Stats() {
  const profile = useProfile((s) => s.profile);
  const recent = useProfile((s) => s.recent);
  const tracks = useLibrary((s) => s.tracks);
  const [all, setAll] = useState<PlayRecord[]>([]);
  const [diff, setDiff] = useState<Diff>('all');
  const [tab, setTab] = useState<'board' | 'history'>('board');

  useEffect(() => {
    void db.all<PlayRecord>('records').then((r) => setAll(r.filter((x) => !x.autoplay)));
  }, [recent]);

  const lv = levelOf(profile.xp);
  const real = useMemo(() => all.filter((r) => !r.practice), [all]);
  const cleared = real.filter((r) => r.cleared);
  const meanAcc = cleared.length ? cleared.reduce((a, r) => a + r.accuracy, 0) / cleared.length : 0;
  const fcs = cleared.filter((r) => r.fullCombo).length;
  const totalJudged = real.reduce((a, r) => a + r.perfect + r.great + r.good + r.miss, 0);
  const perfectRate = totalJudged ? real.reduce((a, r) => a + r.perfect, 0) / totalJudged : 0;

  // personal leaderboard: best run of each song (per difficulty when one is chosen)
  const board = useMemo(() => {
    const bestOf = new Map<string, PlayRecord>();
    for (const r of real) {
      if (diff !== 'all' && r.difficulty !== diff) continue;
      const k = diff === 'all' ? `${r.trackKey}|${r.difficulty}` : r.trackKey;
      const cur = bestOf.get(k);
      if (!cur || r.score > cur.score) bestOf.set(k, r);
    }
    return [...bestOf.values()].sort((a, b) => b.score - a.score).slice(0, 50);
  }, [real, diff]);

  const history = useMemo(() => [...all].sort((a, b) => b.playedAt - a.playedAt).slice(0, 80), [all]);
  const unlockedN = Object.keys(profile.achievements).length;

  const open = (r: PlayRecord) => {
    const t = tracks[r.trackKey];
    if (t) openTrack(t);
  };

  return (
    <div className="page-enter stats">
      <div className="page-head">
        <div>
          <div className="label" style={{ color: 'var(--gold)' }}>
            {tr('Carnet de bord')}
          </div>
          <h1 style={{ marginTop: 8 }}>{tr(titleOf(lv.level))}</h1>
          <div className="sub">
            {tr('Niveau {n} · {xp} XP au total · niveau suivant dans {left} XP', { n: lv.level, xp: fmtScore(profile.xp), left: fmtScore(lv.need - lv.into) })}
          </div>
        </div>
      </div>

      <div className="stats-top">
        <div className="panel pad profile-big brackets">
          <LevelRing xp={profile.xp} size={92} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="row">
              <b className="display" style={{ letterSpacing: '0.14em', textTransform: 'uppercase', fontSize: 18 }}>
                {tr('Niveau {n}', { n: lv.level })}
              </b>
              <span className="grow" />
              <span className="muted num">
                {fmtScore(lv.into)} / {fmtScore(lv.need)} {tr('XP')}
              </span>
            </div>
            <div className="xpbar" style={{ marginTop: 10, height: 8 }}>
              <i style={{ width: `${(lv.into / lv.need) * 100}%` }} />
            </div>
            <div className="tip" style={{ marginTop: 10 }}>
              {tr('Grade suivant : {grade} au niveau {at}. Le niveau {next} demande {xp} XP.', { grade: tr(titleOf(lv.level + (5 - ((lv.level - 1) % 5)))), at: lv.level + (5 - ((lv.level - 1) % 5)), next: lv.level + 1, xp: fmtScore(xpToNext(lv.level + 1)) })}
            </div>
          </div>
        </div>
        <div className="stat-grid totals">
          <Total icon={<Music size={16} />} label={tr('Parties')} value={fmtScore(profile.plays)} />
          <Total icon={<Clock size={16} />} label={tr('Temps de jeu')} value={fmtDuration(profile.secondsPlayed)} />
          <Total icon={<Zap size={16} />} label={tr('Notes jouées')} value={fmtScore(profile.notesHit)} />
          <Total icon={<Target size={16} />} label={tr('Précision')} value={cleared.length ? fmtPct(meanAcc, 1) : '–'} />
          <Total icon={<Trophy size={16} />} label={tr('Full combos')} value={String(fcs)} />
          <Total icon={<Flame size={16} />} label={tr('Meilleur combo')} value={fmtScore(profile.bestCombo)} />
          <Total icon={<Target size={16} />} label={tr('Parfaits')} value={totalJudged ? fmtPct(perfectRate, 1) : '–'} />
          <Total icon={<History size={16} />} label={tr('Série')} value={`${profile.streak} j`} />
        </div>
      </div>

      <div className="stats-main">
        <div className="panel pad">
          <div className="panel-title">
            <Seg
              value={tab}
              onChange={setTab}
              options={[
                { v: 'board', label: tr('Classement personnel') },
                { v: 'history', label: tr('Historique') },
              ]}
            />
            <span className="grow" />
            {tab === 'board' && (
              <Seg<Diff>
                value={diff}
                onChange={setDiff}
                options={[
                  { v: 'all', label: tr('Tout') },
                  { v: 'easy', label: tr('F'), title: tr('Facile') },
                  { v: 'normal', label: tr('N'), title: tr('Normal') },
                  { v: 'hard', label: tr('D'), title: tr('Difficile') },
                  { v: 'expert', label: tr('E'), title: tr('Expert') },
                  { v: 'custom', label: tr('P'), title: tr('Personnalisé') },
                ]}
              />
            )}
          </div>
          {tab === 'board' ? (
            board.length ? (
              <div className="runs">
                {board.map((r, i) => (
                  <RunRow key={r.id} r={r} pos={i + 1} onClick={() => open(r)} playable={!!tracks[r.trackKey]} />
                ))}
              </div>
            ) : (
              <div className="empty">
                <Trophy size={36} />
                <span>{diff !== 'all' ? tr('Aucune partie terminée en {diff} pour l’instant.', { diff: DIFF_LABEL[diff] }) : tr('Aucune partie terminée pour l’instant.')}</span>
              </div>
            )
          ) : history.length ? (
            <div className="runs">
              {history.map((r) => (
                <RunRow key={r.id} r={r} onClick={() => open(r)} playable={!!tracks[r.trackKey]} when />
              ))}
            </div>
          ) : (
            <div className="empty">
              <History size={36} />
              <span>{tr('Aucune partie jouée.')}</span>
            </div>
          )}
        </div>

        <div className="panel pad">
          <div className="panel-title">
            <Trophy size={16} color="var(--gold)" />
            <h3>{tr('Succès')}</h3>
            <span className="grow" />
            <span className="muted num">
              {unlockedN} / {ACHIEVEMENTS.length}
            </span>
          </div>
          <div className="ach-grid">
            {ACHIEVEMENTS.map((a) => {
              const at = profile.achievements[a.id];
              return (
                <div key={a.id} className={`ach-card ${at ? '' : 'locked'}`} title={at ? tr('Obtenu {when}', { when: fmtWhen(at) }) : tr('À découvrir')}>
                  <div className="ic">
                    <AchIcon name={a.icon} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <b>{tr(a.title)}</b>
                    <small>{tr(a.desc)}</small>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function Total({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="stat">
      <small className="row" style={{ gap: 6 }}>
        {icon}
        {label}
      </small>
      <b>{value}</b>
    </div>
  );
}

function RunRow({ r, pos, onClick, playable, when }: { r: PlayRecord; pos?: number; onClick: () => void; playable: boolean; when?: boolean }) {
  return (
    <div className={`run-row ${playable ? '' : 'gone'}`} onClick={playable ? onClick : undefined} title={playable ? tr('Ouvrir le morceau') : tr('Morceau retiré des archives')}>
      {pos !== undefined ? <span className={`pos num ${pos <= 3 ? 'top' : ''}`}>{pos}</span> : <RankBadge rank={r.cleared ? r.rank : '–'} size={18} />}
      <div className="t">
        <b>{r.title}</b>
        <small>
          {r.artist ? `${r.artist} · ` : ''}
          {when ? fmtWhen(r.playedAt) : tr('{n} colonnes', { n: r.lanes })}
          {r.practice ? tr(' · entraînement') : ''}
          {r.failed ? tr(' · échec') : ''}
        </small>
      </div>
      <span className="chip" style={{ borderColor: DIFF_COLOR[r.difficulty], color: DIFF_COLOR[r.difficulty] }}>
        {DIFF_LABEL[r.difficulty]} {r.chartLevel}
      </span>
      {pos !== undefined && <RankBadge rank={r.rank} size={18} />}
      <div className="score-col">
        <b className="num">{fmtScore(r.score)}</b>
        <small className="num">
          {fmtPct(r.accuracy)}
          {r.fullCombo ? tr(' · FC') : ''}
        </small>
      </div>
    </div>
  );
}
