import { useEffect, useState } from 'react';
import { Check, Globe, Loader2, Send } from 'lucide-react';
import type { PublishResult } from '@shared/leaderboard';
import { cleanPseudo, songKeyOf, type BoardDifficulty } from '@shared/leaderboard';
import type { PlayRecord } from '@core/game/progress';
import type { TrackRef } from '@shared/types';
import { tr } from '../i18n';
import { notRankable, publishScore, submissionOf } from '../online/leaderboard';
import { useSettings } from '../store/settings';
import { playSfx } from '../audio/sfx';
import { OnlineBoard } from './OnlineBoard';
import { DIFF_LABEL } from './ui';

/** Runs already published (a results screen shown again never sends the same run twice). */
const sent = new Set<string>();

/** Results screen: publish the run on the song's online board, then see the board. */
export function PublishScore({ record, track }: { record: PlayRecord; track: TrackRef }) {
  const s = useSettings();
  const [pseudo, setPseudo] = useState(s.pseudo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<PublishResult | null>(null);
  const why = notRankable(record);
  const clean = cleanPseudo(pseudo);
  // chosen before playing: the score goes out by itself
  useEffect(() => {
    if (s.online && s.autoPublish && !why && clean && !sent.has(record.id)) void publish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!s.online) return null;
  const songKey = songKeyOf({ title: track.title, artist: track.artist, videoId: track.videoId, source: track.source });

  const publish = async () => {
    if (!clean || busy || sent.has(record.id)) return;
    sent.add(record.id);
    setBusy(true);
    setError(null);
    try {
      const r = await publishScore(submissionOf(record, track, clean));
      s.set({ pseudo: clean });
      setDone(r);
      playSfx(r.place === 1 ? 'record' : 'milestone', 0.7);
    } catch (e) {
      sent.delete(record.id);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel pad publish">
      <div className="panel-title">
        <Globe size={16} />
        <h3>{tr('Classement en ligne')}</h3>
        <span className="grow" />
        {!why && (
          <span className="muted" style={{ fontSize: 12 }}>
            {DIFF_LABEL[record.difficulty]} · {tr('{n} colonnes', { n: record.lanes })}
          </span>
        )}
      </div>
      {why ? (
        <div className="tip">{why}</div>
      ) : done ? (
        <>
          <div className="publish-done">
            <Check size={18} />
            <span>
              {done.best
                ? tr('Publié ! Vous êtes {place}ᵉ sur {n}.', { place: done.place, n: done.players })
                : tr('Publié. Votre meilleur score reste devant : {place}ᵉ sur {n}.', { place: done.place, n: done.players })}
            </span>
          </div>
          <OnlineBoard songKey={songKey} difficulty={record.difficulty as BoardDifficulty} lanes={record.lanes} me={clean ?? undefined} refresh={1} limit={10} />
        </>
      ) : (
        <form
          className="publish-form"
          onSubmit={(e) => {
            e.preventDefault();
            void publish();
          }}
        >
          <input className="input grow" value={pseudo} maxLength={20} placeholder={tr('Votre pseudo')} aria-label={tr('Votre pseudo')} onChange={(e) => setPseudo(e.target.value)} />
          <button className="btn primary" type="submit" disabled={!clean || busy}>
            {busy ? <Loader2 size={15} className="spin" /> : <Send size={15} />} {tr('Publier mon score')}
          </button>
          {error && <div className="tip" style={{ color: '#ff9db5', flexBasis: '100%' }}>{error}</div>}
          {!error && pseudo && !clean && <div className="tip" style={{ flexBasis: '100%' }}>{tr('2 à 20 caractères : lettres, chiffres, espaces, _ - . \'')}</div>}
        </form>
      )}
    </div>
  );
}
