import { tr } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, LogOut, Minus, Plus } from 'lucide-react';
import { accuracyOf } from '@core/game/judge';
import { LocalPlayer } from '../audio/local-player';
import type { SongPlayer } from '../audio/player';
import { GameSession, type HudEvent, type SessionState } from '../game/session';
import { engine } from '../gfx/engine';
import { go, type GameParams } from '../store/nav';
import { useSettings } from '../store/settings';
import { useProfile } from '../store/profile';
import { playSfx } from '../audio/sfx';
import { DIFF_COLOR, DIFF_LABEL, fmtPct, fmtScore } from '../components/ui';
import { currentHost, type YtHost } from '../yt/host';
import { YouTubePlayer } from '../yt/player';
import { learnFrom, LEARN_COVERAGE } from '../yt/learn';
import { LiveFeed } from '../game/live';
import { hashString } from '@core/util/rng';
import { toast } from '../store/toasts';

export function Game({ game, player: external }: { game: GameParams; player?: SongPlayer }) {
  const surface = useRef<HTMLDivElement>(null);
  const scoreEl = useRef<HTMLDivElement>(null);
  const accEl = useRef<HTMLDivElement>(null);
  const multEl = useRef<HTMLDivElement>(null);
  const comboEl = useRef<HTMLDivElement>(null);
  const comboN = useRef<HTMLDivElement>(null);
  const judgeEl = useRef<HTMLDivElement>(null);
  const offEl = useRef<HTMLDivElement>(null);
  const barEl = useRef<HTMLElement>(null);
  const energyEl = useRef<HTMLDivElement>(null);
  const energyFill = useRef<HTMLElement>(null);
  const fpsEl = useRef<HTMLDivElement>(null);
  const waitEl = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<GameSession | null>(null);
  const [state, setState] = useState<SessionState>('intro');
  const [count, setCount] = useState<{ n: number; k: number } | null>(null);
  const [milestone, setMilestone] = useState<{ combo: number; k: number } | null>(null);
  const [intro, setIntro] = useState(true);
  const [offset, setOffset] = useState(useSettings.getState().audioOffsetMs);
  const settings = useSettings.getState();
  const lanes = game.chart.params.lanes;

  useEffect(() => {
    const st = useSettings.getState();
    const isYt = game.track.source === 'youtube' && !!game.track.videoId;
    const host: YtHost | null = isYt ? currentHost() : null;
    if (isYt && !host) {
      go({ id: 'song', track: game.track }, { replace: true });
      return;
    }
    const volume = st.volume.master * st.volume.music;
    const player = external ?? (host ? new YouTubePlayer(host, game.track.videoId!, game.track.duration ?? 0, volume) : new LocalPlayer(game.buffer!));
    // YouTube: the player stays visible in a corner while it plays; its frames feed the live notes,
    // the universe, and the learning of the song
    host?.place({ kind: 'corner' });
    host?.setVolume(volume);
    const rate = game.practice?.rate ?? 1;
    const feed = host && !game.autoplay ? new LiveFeed(host, game.chart.params, st.approach * rate + 0.7, hashString(`${game.track.key}|live|${game.chart.difficulty}`), () => 0, !!game.live) : null;
    const session = new GameSession({
      chart: game.chart,
      player,
      track: game.track,
      lanes,
      keys: st.keys[lanes] ?? [],
      pad: st.pad[lanes] ?? [],
      audioOffsetMs: st.audioOffsetMs + (isYt ? st.ytOffsetMs : 0),
      visualOffsetMs: st.visualOffsetMs,
      approach: st.approach,
      tilt: st.tilt,
      fail: st.fail,
      hitSounds: st.hitSounds,
      practice: game.practice ?? null,
      autoplay: game.autoplay,
      live: game.live ? feed : null,
      levels: feed ? () => feed.levels() : undefined,
    });
    // the song heard well enough (a live run, or a replay): its full chart is written for next time
    let learning = false;
    const learn = () => {
      if (!feed || learning || game.chart.source !== 'live' || game.practice) return;
      const d = player.duration;
      if (feed.recorder.coverage(d) < LEARN_COVERAGE) return;
      learning = true;
      void learnFrom(game.track, feed.recorder, d).then(
        (a) => a && toast({ kind: 'gold', title: tr('Morceau appris'), text: tr('La partition complète est prête : rejouez-le pour des notes calées sur toute la chanson.') }),
        () => undefined,
      );
    };
    sessionRef.current = session;
    const pf = engine.playfield;
    // HUD anchors follow the track on screen
    const place = () => {
      const mid = (lanes - 1) / 2;
      const c = pf.screenOf(mid, 4.2);
      const j = pf.screenOf(mid, 1.35);
      const half = pf.trackHalfWidthPx;
      const hit = pf.screenOf(mid, 0);
      const top = pf.screenOf(mid, 7.5);
      if (comboEl.current) Object.assign(comboEl.current.style, { left: `${c.x}px`, top: `${c.y}px` });
      if (judgeEl.current) Object.assign(judgeEl.current.style, { left: `${j.x}px`, top: `${j.y}px` });
      if (offEl.current) Object.assign(offEl.current.style, { left: `${j.x}px`, top: `${j.y + 22}px` });
      if (energyEl.current) Object.assign(energyEl.current.style, { left: `${hit.x + half + 22}px`, top: `${top.y}px`, height: `${Math.max(80, hit.y - top.y)}px` });
    };
    let comboShown = 0;
    let judgeKey = 0;
    const update = (e: HudEvent) => {
      if (e.type === 'judge' || e.type === 'reset') {
        const s = e.s;
        if (scoreEl.current) scoreEl.current.textContent = fmtScore(s.score);
        if (accEl.current) accEl.current.textContent = fmtPct(accuracyOf(s));
        if (multEl.current) multEl.current.textContent = s.multiplier > 1 ? `×${s.multiplier}` : '';
        if (comboN.current && comboEl.current) {
          if (s.combo !== comboShown) {
            comboShown = s.combo;
            comboN.current.textContent = String(s.combo);
            comboEl.current.style.opacity = s.combo >= 3 ? '1' : '0';
            comboEl.current.classList.remove('bump');
            void comboEl.current.offsetWidth;
            comboEl.current.classList.add('bump');
          }
        }
        if (energyFill.current && energyEl.current) {
          energyFill.current.style.height = `${s.energy}%`;
          energyEl.current.classList.toggle('low', s.energy < 25);
        }
        if (e.type === 'judge') {
          const ev = e.e;
          const j = ev.kind === 'hit' ? ev.judgement : ev.kind === 'miss' || ev.kind === 'hold-break' ? 'miss' : null;
          if (j && judgeEl.current) {
            const el = judgeEl.current;
            el.textContent = j === 'perfect' ? tr('Parfait') : j === 'great' ? tr('Super') : j === 'good' ? tr('Bien') : ev.kind === 'hold-break' ? tr('Lâché') : tr('Raté');
            el.className = `judgement ${j}`;
            void el.offsetWidth;
            el.className = `judgement ${j} show`;
            judgeKey++;
          }
          if (ev.kind === 'hit' && ev.offset !== undefined && offEl.current && useSettings.getState().showOffsets && ev.judgement !== 'perfect') {
            offEl.current.textContent = ev.offset < 0 ? tr('TÔT') : tr('TARD');
            offEl.current.style.opacity = '1';
            const k = judgeKey;
            setTimeout(() => {
              if (k === judgeKey && offEl.current) offEl.current.style.opacity = '0';
            }, 380);
          }
        }
      } else if (e.type === 'milestone') {
        setMilestone({ combo: e.combo, k: Date.now() });
        playSfx('milestone', 0.8);
      } else if (e.type === 'state') {
        setState(e.state);
        if (e.state === 'failed') playSfx('fail');
      } else if (e.type === 'countdown') {
        setCount(e.n > 0 ? { n: e.n, k: Date.now() } : null);
        playSfx(e.n > 0 ? 'count' : 'go', 0.7);
      } else if (e.type === 'end') {
        learn();
        const rec = e.record;
        void useProfile
          .getState()
          .saveRun(rec)
          .then(({ xp, unlocked, previousBest }) => {
            go({ id: 'results', result: { record: rec, offsets: e.offsets, chart: game.chart, track: game.track, xp, unlocked, previousBest, game } }, { replace: true });
          });
      }
    };
    const off = session.on(update);
    session.start(surface.current!);
    update({ type: 'reset', s: session.judge.state });
    place();
    const t1 = setTimeout(place, 50);
    const t2 = setTimeout(() => setIntro(false), 2600);
    window.addEventListener('resize', place);
    // progress bar and FPS without React
    let raf = 0;
    const tick = () => {
      if (barEl.current) barEl.current.style.width = `${session.progress() * 100}%`;
      if (fpsEl.current) fpsEl.current.textContent = tr('{fps} i/s · pire {ms} ms', { fps: engine.stats.fps.toFixed(0), ms: engine.stats.worstMs.toFixed(1) });
      if (waitEl.current) {
        let msg = '';
        if (player instanceof YouTubePlayer && session.state === 'playing') {
          const m = host!.mediaAt(performance.now());
          if (m.ad) msg = tr('Publicité YouTube — la partie reprend après');
          else if (player.waiting) msg = tr('Lecteur YouTube : chargement…');
          else if (game.live && feed) {
            const stt = feed.status();
            const t = session.songTime(performance.now());
            if (!feed.receiving && t > 2) msg = tr('Aucun son reçu du lecteur YouTube');
            else if (!stt || (!stt.locked && !stt.safe) || stt.heard < 6) msg = tr('Écoute du morceau — les notes arrivent…');
          }
        }
        if (waitEl.current.textContent !== msg) waitEl.current.textContent = msg;
        waitEl.current.style.opacity = msg ? '1' : '0';
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const blur = () => {
      if (useSettings.getState().autoPause) session.pause();
    };
    const vis = () => {
      if (document.hidden) session.pause();
    };
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', vis);
    return () => {
      off();
      clearTimeout(t1);
      clearTimeout(t2);
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', place);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', vis);
      learn();
      session.dispose();
      if (!external) player.dispose();
      feed?.dispose();
      if (host) {
        host.pause();
        host.place({ kind: 'hidden' });
      }
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const session = sessionRef.current;
  const quit = () => {
    playSfx('back');
    go({ id: 'song', track: game.track }, { replace: true });
  };
  const nudge = (d: number) => {
    const v = Math.round(offset + d);
    setOffset(v);
    useSettings.getState().set({ audioOffsetMs: v });
    if (sessionRef.current) sessionRef.current.cfg.audioOffsetMs = v;
  };

  return (
    <div className="hud">
      <div className="hud-surface" ref={surface} />
      <div className="bar">
        <i ref={barEl} />
      </div>
      <div className="tl">
        <div className="song-t">{game.track.title}</div>
        <div className="song-a">{game.track.artist ?? ''}</div>
        <div className="row" style={{ marginTop: 6, gap: 6 }}>
          <span className="chip" style={{ borderColor: DIFF_COLOR[game.chart.difficulty], color: DIFF_COLOR[game.chart.difficulty] }}>
            {DIFF_LABEL[game.chart.difficulty]} · {game.chart.stats.level}
          </span>
          {game.practice && <span className="chip gold">{tr('Entraînement {p} %', { p: Math.round(game.practice.rate * 100) })}</span>}
          {game.chart.source === 'live' && <span className="chip on">{tr('Direct')}</span>}
          {game.autoplay && <span className="chip on">{tr('Aperçu automatique')}</span>}
        </div>
      </div>
      <div className="tr">
        <div className="score" ref={scoreEl}>
          0
        </div>
        <div className="row" style={{ gap: 10 }}>
          <div className="mult" ref={multEl} />
          <div className="acc" ref={accEl}>
            100,00 %
          </div>
        </div>
      </div>
      <div className="combo" ref={comboEl} style={{ opacity: 0 }}>
        <div className="n" ref={comboN}>
          0
        </div>
        <div className="w">{tr('COMBO')}</div>
      </div>
      <div className="judgement" ref={judgeEl} />
      <div className="offset-tick" ref={offEl} style={{ opacity: 0, transition: 'opacity 0.15s' }} />
      {settings.fail && !game.practice && (
        <div className="energy" ref={energyEl}>
          <i ref={energyFill} style={{ height: '100%' }} />
        </div>
      )}
      {intro && state !== 'paused' && (
        <div className="milestone" style={{ top: '34%', fontSize: 34, letterSpacing: '0.18em', animationDuration: '2.6s' }}>
          {game.track.title}
          <small>{(game.track.artist ?? '') + ' · ' + DIFF_LABEL[game.chart.difficulty]}</small>
        </div>
      )}
      {milestone && (
        <div key={milestone.k} className="milestone" onAnimationEnd={() => setMilestone(null)}>
          {milestone.combo}
          <small>{tr('COMBO')}</small>
        </div>
      )}
      {count && (
        <div key={count.k} className="countdown">
          {count.n}
        </div>
      )}
      {state === 'failed' && <div className="failed-title" style={{ transform: 'translate(-50%,-50%)' }}>{tr('ÉCHEC')}</div>}
      {settings.showFps && <div className="fps" ref={fpsEl} />}
      <div className="live-wait" ref={waitEl} style={{ opacity: 0 }} />
      {state === 'playing' && (
        <button className="btn icon ghost pause-btn" aria-label={tr('Pause')} onClick={() => session?.pause()}>
          <Pause size={18} />
        </button>
      )}
      {state === 'paused' && (
        <div className="overlay" style={{ pointerEvents: 'auto' }}>
          <div className="panel solid menu brackets">
            <h2>{tr('Pause')}</h2>
            <button className="btn primary big" onClick={() => sessionRef.current?.resume()}>
              <Play size={18} /> {tr('Reprendre')} <span className="kbd">{tr('Échap')}</span>
            </button>
            <button className="btn big" onClick={() => sessionRef.current?.restart()}>
              <RotateCcw size={18} /> {tr('Recommencer')}
            </button>
            <div className="opt-row" style={{ borderTop: '1px solid var(--line)', marginTop: 8 }}>
              <div className="what">
                <b>{tr('Décalage audio')}</b>
                <small>{tr('Si les notes semblent en avance ou en retard')}</small>
              </div>
              <div className="ctl">
                <button className="btn small icon" onClick={() => nudge(-5)} aria-label={tr('Moins 5 ms')}>
                  <Minus size={14} />
                </button>
                <span className="val" style={{ minWidth: 64, textAlign: 'center' }}>
                  {offset > 0 ? '+' : ''}
                  {offset} ms
                </span>
                <button className="btn small icon" onClick={() => nudge(5)} aria-label={tr('Plus 5 ms')}>
                  <Plus size={14} />
                </button>
              </div>
            </div>
            <button className="btn big ghost" onClick={quit}>
              <LogOut size={18} /> {tr('Quitter')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
