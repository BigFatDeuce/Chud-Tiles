import { useEffect, useState } from 'react';
import { Crown, Loader2, RefreshCw, WifiOff } from 'lucide-react';
import type { BoardDifficulty, ScoreRow } from '@shared/leaderboard';
import { pseudoKey } from '@shared/leaderboard';
import { tr } from '../i18n';
import { songBoard } from '../online/leaderboard';
import { RankBadge, fmtPct, fmtScore, fmtWhen } from './ui';

/** A song's online board: best score of each player, for one difficulty and lane count. */
export function OnlineBoard({ songKey, difficulty, lanes, me, refresh = 0, limit = 100 }: { songKey: string; difficulty: BoardDifficulty; lanes: number; me?: string; refresh?: number; limit?: number }) {
  const [rows, setRows] = useState<ScoreRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [again, setAgain] = useState(0);
  useEffect(() => {
    let alive = true;
    setRows(null);
    setError(null);
    songBoard(songKey, difficulty, lanes).then(
      (r) => alive && setRows(r),
      (e: Error) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, [songKey, difficulty, lanes, refresh, again]);

  if (error)
    return (
      <div className="board-empty">
        <WifiOff size={16} /> <span className="grow">{error}</span>
        <button className="btn small ghost" onClick={() => setAgain((n) => n + 1)}>
          <RefreshCw size={13} /> {tr('Réessayer')}
        </button>
      </div>
    );
  if (!rows)
    return (
      <div className="board-empty">
        <Loader2 size={16} className="spin" /> {tr('Chargement du classement…')}
      </div>
    );
  if (!rows.length) return <div className="board-empty">{tr('Personne n’a encore publié de score ici : la première place est libre.')}</div>;
  const mine = me ? pseudoKey(me) : null;
  return (
    <ol className="board">
      {rows.slice(0, limit).map((r, i) => (
        <li key={r.id} className={`${i < 3 ? `top top${i + 1}` : ''} ${mine && pseudoKey(r.pseudo) === mine ? 'me' : ''}`}>
          <span className="place">{i === 0 ? <Crown size={15} /> : i + 1}</span>
          <span className="who">
            <b>{r.pseudo}</b>
            <small>{fmtWhen(r.at)}</small>
          </span>
          <RankBadge rank={r.rank} size={13} />
          <span className="acc">{fmtPct(r.accuracy, 1)}</span>
          {r.fullCombo && <span className="chip gold fc">{tr('FC')}</span>}
          <b className="pts">{fmtScore(r.score)}</b>
        </li>
      ))}
    </ol>
  );
}
