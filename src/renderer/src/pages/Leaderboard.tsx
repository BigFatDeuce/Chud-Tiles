import { useEffect, useState } from 'react';
import { Globe, Loader2, Play, RefreshCw, Trophy, WifiOff } from 'lucide-react';
import { songKeyOf, type BoardDifficulty, type ScoreRow } from '@shared/leaderboard';
import type { TrackRef } from '@shared/types';
import { tr } from '../i18n';
import { recentScores } from '../online/leaderboard';
import { OnlineBoard } from '../components/OnlineBoard';
import { DIFF_COLOR, DIFF_LABEL, RankBadge, Seg, fmtPct, fmtScore, fmtWhen } from '../components/ui';
import { useLibrary } from '../store/library';
import { useSettings } from '../store/settings';
import { openTrack } from '../game/actions';

type Filter = BoardDifficulty | 'all';

/** The song of a score, playable when it is a YouTube song or a file of the library. */
function trackOf(r: ScoreRow, tracks: Record<string, TrackRef>): TrackRef | null {
  if (r.songKey.startsWith('yt:')) {
    const id = r.songKey.slice(3);
    return tracks[`yt:${id}`] ?? { key: `yt:${id}`, source: 'youtube', title: r.title, artist: r.artist, album: null, duration: r.duration, videoId: id, origin: 'youtube' };
  }
  return Object.values(tracks).find((t) => t.source !== 'youtube' && songKeyOf(t) === r.songKey) ?? null;
}

/** Online leaderboard: the latest scores published, and each song's board. */
export function Leaderboard() {
  const [filter, setFilter] = useState<Filter>('all');
  const [rows, setRows] = useState<ScoreRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [again, setAgain] = useState(0);
  const [sel, setSel] = useState<ScoreRow | null>(null);
  const tracks = useLibrary((s) => s.tracks);
  const me = useSettings((s) => s.pseudo);

  useEffect(() => {
    let alive = true;
    setRows(null);
    setError(null);
    recentScores(filter).then(
      (r) => {
        if (!alive) return;
        setRows(r);
        setSel((cur) => cur ?? r[0] ?? null);
      },
      (e: Error) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, [filter, again]);

  const selTrack = sel ? trackOf(sel, tracks) : null;

  return (
    <div className="page-enter stats leaderboard">
      <div className="page-head">
        <div>
          <div className="label" style={{ color: 'var(--gold)' }}>
            <Globe size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
            {tr('Classement en ligne')}
          </div>
          <h1 style={{ marginTop: 8 }}>{tr('Derniers exploits')}</h1>
          <div className="sub">{tr('Les 100 derniers scores publiés : morceaux terminés, difficultés Facile à Expert.')}</div>
        </div>
        <span className="grow" />
        <button className="btn small ghost" onClick={() => setAgain((n) => n + 1)} aria-label={tr('Actualiser')}>
          <RefreshCw size={14} /> {tr('Actualiser')}
        </button>
      </div>

      <div className="stats-main">
        <div className="panel pad">
          <div className="panel-title">
            <Trophy size={16} />
            <h3>{tr('Derniers scores')}</h3>
            <span className="grow" />
            <Seg<Filter>
              value={filter}
              onChange={setFilter}
              options={[
                { v: 'all', label: tr('Tout') },
                { v: 'easy', label: tr('F'), title: tr('Facile') },
                { v: 'normal', label: tr('N'), title: tr('Normal') },
                { v: 'hard', label: tr('D'), title: tr('Difficile') },
                { v: 'expert', label: tr('E'), title: tr('Expert') },
              ]}
            />
          </div>
          {error ? (
            <div className="board-empty">
              <WifiOff size={16} /> <span className="grow">{error}</span>
              <button className="btn small ghost" onClick={() => setAgain((n) => n + 1)}>
                <RefreshCw size={13} /> {tr('Réessayer')}
              </button>
            </div>
          ) : !rows ? (
            <div className="board-empty">
              <Loader2 size={16} className="spin" /> {tr('Chargement du classement…')}
            </div>
          ) : !rows.length ? (
            <div className="empty">
              <Trophy size={36} />
              <span>{tr('Aucun score publié pour l’instant : terminez un morceau et publiez le vôtre depuis l’écran de résultats.')}</span>
            </div>
          ) : (
            <div className="recent-scores">
              {rows.map((r) => (
                <button key={r.id} className={`recent-score ${sel?.id === r.id ? 'on' : ''}`} onClick={() => setSel(r)}>
                  <span className="who">
                    <b>{r.pseudo}</b>
                    <small>{fmtWhen(r.at)}</small>
                  </span>
                  <span className="song">
                    <b>{r.title}</b>
                    <small>{r.artist ?? (r.source === 'youtube' ? tr('YouTube') : tr('Fichier local'))}</small>
                  </span>
                  <span className="chip" style={{ borderColor: DIFF_COLOR[r.difficulty], color: DIFF_COLOR[r.difficulty] }}>
                    {DIFF_LABEL[r.difficulty]} · {r.lanes}
                  </span>
                  <RankBadge rank={r.rank} size={13} />
                  <span className="acc">{fmtPct(r.accuracy, 1)}</span>
                  <b className="pts">{fmtScore(r.score)}</b>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="panel pad">
          {sel ? (
            <>
              <div className="panel-title" style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }} className="grow">
                  <b className="display" style={{ fontSize: 17, display: 'block' }}>
                    {sel.title}
                  </b>
                  <small className="muted">
                    {sel.artist ?? ''} · {DIFF_LABEL[sel.difficulty]} · {tr('{n} colonnes', { n: sel.lanes })}
                  </small>
                </div>
                <button className="btn small primary" disabled={!selTrack} title={selTrack ? undefined : tr('Ce fichier n’est pas dans vos archives.')} onClick={() => selTrack && void openTrack(selTrack)}>
                  <Play size={14} /> {tr('Jouer')}
                </button>
              </div>
              <OnlineBoard songKey={sel.songKey} difficulty={sel.difficulty} lanes={sel.lanes} me={me} />
            </>
          ) : (
            <div className="empty">
              <Globe size={36} />
              <span>{tr('Choisissez un score pour voir le classement de son morceau.')}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
