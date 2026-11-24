import { fmtNum, tr } from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { Award, Home as HomeIcon, ListMusic, RotateCcw, SkipForward, Star, TrendingUp } from 'lucide-react';
import { useQueue } from '../store/queue';
import { levelOf } from '@core/game/progress';
import { go, type ResultParams } from '../store/nav';
import { useProfile } from '../store/profile';
import { useSettings } from '../store/settings';
import { engine } from '../gfx/engine';
import { playSfx } from '../audio/sfx';
import { PublishScore } from '../components/PublishScore';
import { AchIcon, DIFF_COLOR, DIFF_LABEL, RANK_COLOR, fmtPct, fmtScore } from '../components/ui';

function useCountUp(target: number, ms = 1400): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      setV(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

export function Results({ result }: { result: ResultParams }) {
  const r = result.record;
  const profile = useProfile((s) => s.profile);
  const score = useCountUp(r.score);
  const prev = result.previousBest;
  const newBest = !r.practice && r.cleared && (!prev || r.score > prev.score);
  const lvAfter = levelOf(profile.xp);
  const lvBefore = levelOf(Math.max(0, profile.xp - result.xp));
  const levelUp = lvAfter.level > lvBefore.level;
  const queueName = useQueue((s) => s.name);
  const nextUp = useQueue((s) => (s.items[s.index]?.key === result.track.key ? s.peek() : null));

  useEffect(() => {
    // the universe celebrates: a supernova for a record, a calmer pulse otherwise
    const t = setTimeout(() => {
      if (newBest) {
        engine.cosmos.milestone(1.4, new THREE.Color(1, 0.78, 0.45));
        for (let i = 0; i < 6; i++) setTimeout(() => engine.cosmos.shootingStar(), 200 + i * 160);
        playSfx('record', 0.9);
      } else if (r.cleared) {
        engine.cosmos.milestone(0.6, new THREE.Color(0.55, 0.7, 1));
        playSfx('milestone', 0.6);
      }
    }, 700);
    return () => clearTimeout(t);
  }, [newBest, r.cleared]);

  // timing histogram: −135 … +135 ms in 27 bins
  const hist = useMemo(() => {
    const bins = new Array(27).fill(0);
    for (const o of result.offsets) {
      const b = Math.round((o * 1000) / 10) + 13;
      if (b >= 0 && b < 27) bins[b]++;
    }
    const max = Math.max(1, ...bins);
    return bins.map((v) => v / max);
  }, [result.offsets]);
  const mean = r.meanOffsetMs;
  const hint = Math.abs(mean) >= 12 && result.offsets.length >= 30;

  const replay = () => {
    playSfx('go', 0.7);
    go({ id: 'game', game: result.game }, { replace: true });
  };
  const applyHint = () => {
    const s = useSettings.getState();
    s.set({ audioOffsetMs: Math.round(s.audioOffsetMs + mean) });
    playSfx('click');
  };

  return (
    <div className="results page-enter">
      <div className="col" style={{ gap: 14 }}>
        <div className="panel pad brackets" style={{ textAlign: 'center' }}>
          <div className="label">{r.failed ? tr('Échec') : r.practice ? tr('Entraînement terminé') : tr('Morceau terminé')}</div>
          <div className="rank" style={{ ['--c' as string]: RANK_COLOR[r.rank] }}>
            {r.rank}
          </div>
          <div className="stars">
            {[0, 1, 2].map((i) => (
              <Star key={i} className={i < r.stars ? 'on' : ''} fill={i < r.stars ? 'currentColor' : 'none'} style={{ animationDelay: `${0.9 + i * 0.18}s` }} />
            ))}
          </div>
          <div className="big-score">{fmtScore(score)}</div>
          {newBest && (
            <div className="record-banner">
              <Award size={16} /> {tr('Nouveau record')} {prev ? `(+${fmtScore(r.score - prev.score)})` : ''}
            </div>
          )}
          {!newBest && prev && !r.practice && (
            <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
              {tr('Record : {score} ({rank})', { score: fmtScore(prev.score), rank: prev.rank })}
            </div>
          )}
          {r.fullCombo && <div className="chip gold" style={{ marginTop: 10 }}>{tr('Full combo')}</div>}
        </div>
        <div className="panel pad">
          <div className="row">
            <b className="display" style={{ letterSpacing: '0.1em' }}>
              +{result.xp} {tr('XP')}
            </b>
            <span className="grow" />
            {levelUp && <span className="chip gold">{tr('Niveau {n} !', { n: lvAfter.level })}</span>}
            <span className="muted num" style={{ fontSize: 12 }}>
              {tr('Niv. {n}', { n: lvAfter.level })} · {Math.round(lvAfter.into)}/{lvAfter.need}
            </span>
          </div>
          <div className="xpbar" style={{ marginTop: 10 }}>
            <i style={{ width: `${(lvAfter.into / lvAfter.need) * 100}%` }} />
          </div>
        </div>
        {result.unlocked.map((a, i) => (
          <div key={a.id} className="ach" style={{ animationDelay: `${1 + i * 0.25}s` }}>
            <AchIcon name={a.icon} size={22} />
            <div>
              <b>{tr(a.title)}</b>
              <small>{tr(a.desc)}</small>
            </div>
          </div>
        ))}
      </div>
      <div className="col" style={{ gap: 14 }}>
        <div className="panel pad">
          <div className="row" style={{ marginBottom: 14 }}>
            <div style={{ minWidth: 0 }}>
              <div className="display" style={{ fontSize: 22, fontWeight: 700 }}>
                {result.track.title}
              </div>
              <div className="muted">{result.track.artist ?? ''}</div>
            </div>
            <span className="grow" />
            <span className="chip" style={{ borderColor: DIFF_COLOR[r.difficulty], color: DIFF_COLOR[r.difficulty] }}>
              {DIFF_LABEL[r.difficulty]} · {tr('niv. {lv} · {l} col.', { lv: r.chartLevel, l: r.lanes })}
            </span>
          </div>
          <div className="stat-grid">
            <div className="stat"><small>{tr('Précision')}</small><b>{fmtPct(r.accuracy)}</b></div>
            <div className="stat"><small>{tr('Combo max')}</small><b>{r.maxCombo}</b></div>
            {r.centre !== undefined && <div className="stat"><small>{tr('Pile au centre')}</small><b style={{ color: '#fff6dc', textShadow: '0 0 14px rgba(255, 204, 102, 0.8)' }}>{r.centre}</b></div>}
            {r.bestCentreStreak !== undefined && <div className="stat"><small>{tr('Meilleure série pile')}</small><b style={{ color: 'var(--gold)' }}>{r.bestCentreStreak}</b></div>}
            <div className="stat"><small>{tr('Parfait')}</small><b style={{ color: '#ffe3a8' }}>{r.perfect}</b></div>
            <div className="stat"><small>{tr('Super')}</small><b style={{ color: 'var(--cyan)' }}>{r.great}</b></div>
            <div className="stat"><small>{tr('Bien')}</small><b style={{ color: 'var(--violet)' }}>{r.good}</b></div>
            <div className="stat"><small>{tr('Ratés')}</small><b style={{ color: '#ff9db5' }}>{r.miss}</b></div>
            <div className="stat"><small>{tr('Longues')}</small><b>{r.holdOk}<span className="muted" style={{ fontSize: 14 }}> / {r.holdOk + r.holdBreak}</span></b></div>
            <div className="stat"><small>{tr('Hors note')}</small><b>{r.stray}</b></div>
          </div>
        </div>
        <PublishScore record={r} track={result.track} />
        <div className="panel pad">
          <div className="panel-title">
            <TrendingUp size={16} />
            <h3>{tr('Précision du rythme')}</h3>
            <span className="grow" />
            <span className="muted" style={{ fontSize: 12 }}>
              {tr('moyenne {ms} ms ({side})', { ms: `${mean > 0 ? '+' : ''}${fmtNum(mean, 1)}`, side: mean > 0 ? tr('en retard') : mean < 0 ? tr('en avance') : tr('centré') })}
            </span>
          </div>
          <div className="histo">
            {hist.map((v, i) => (
              <i key={i} className={i === 13 ? 'c' : ''} style={{ height: `${Math.max(2, v * 100)}%` }} title={`${(i - 13) * 10} ms`} />
            ))}
          </div>
          <div className="row muted" style={{ fontSize: 11, marginTop: 6 }}>
            <span>{tr('−130 ms (tôt)')}</span>
            <span className="grow" />
            <span>0</span>
            <span className="grow" />
            <span>{tr('+130 ms (tard)')}</span>
          </div>
          {hint && (
            <div className="row" style={{ marginTop: 12 }}>
              <span className="tip grow">{mean > 0 ? tr('Vos appuis sont en moyenne {ms} ms en retard : un décalage audio corrigerait cela.', { ms: Math.abs(Math.round(mean)) }) : tr('Vos appuis sont en moyenne {ms} ms en avance : un décalage audio corrigerait cela.', { ms: Math.abs(Math.round(mean)) })}</span>
              <button className="btn small" onClick={applyHint}>
                {tr('Appliquer {ms} ms', { ms: `${mean > 0 ? '+' : ''}${Math.round(mean)}` })}
              </button>
            </div>
          )}
        </div>
        <div className="row wrap">
          <button className="btn primary big" onClick={replay}>
            <RotateCcw size={18} /> {tr('Rejouer')}
          </button>
          {nextUp && (
            <button
              className="btn big"
              title={`${queueName ?? tr('File')} · ${nextUp.title}`}
              onClick={() => {
                const n = useQueue.getState().next();
                if (n) go({ id: 'song', track: n }, { replace: true });
              }}
            >
              <SkipForward size={18} /> {tr('Morceau suivant')}
            </button>
          )}
          <button className="btn big" onClick={() => go({ id: 'song', track: result.track }, { replace: true })}>
            <ListMusic size={18} /> {tr('Changer de difficulté')}
          </button>
          <button className="btn big ghost" onClick={() => go({ id: 'home' }, { replace: true })}>
            <HomeIcon size={18} /> {tr('Pont')}
          </button>
        </div>
      </div>
    </div>
  );
}
