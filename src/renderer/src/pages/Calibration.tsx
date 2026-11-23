import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Check, Ear, Eye, RotateCcw } from 'lucide-react';
import { audio } from '../audio/context';
import { LocalPlayer } from '../audio/local-player';
import { engine } from '../gfx/engine';
import { useSettings } from '../store/settings';
import { useProfile } from '../store/profile';
import { useNav } from '../store/nav';
import { toast } from '../store/toasts';
import { playSfx } from '../audio/sfx';
import { tr, trn } from '../i18n';

// Latency calibration, through the very clock the game uses (a LocalPlayer on a click track):
// 1. sound: taps on clicks heard, eyes closed if you like → audio offset;
// 2. image: silent notes falling onto a line, tapped when they touch it → visual offset.
// The median of the taps is kept (a few stray taps do not matter); the spread says how steady
// the taps were, and a run too unsteady is not proposed.

const INTERVAL = 0.5;
const FIRST = 1.6;
const COUNT_IN = 4;
const N = 20;
const CLICKS = Array.from({ length: N }, (_, k) => FIRST + k * INTERVAL);
const APPROACH = 1.1;

type Phase = 'intro' | 'audio' | 'audio-done' | 'visual' | 'visual-done';

interface Result {
  ms: number;
  spread: number;
  n: number;
}

/** Test hook: the calibration in progress. */
export const calibration: { player: LocalPlayer | null; clicks: number[]; phase: Phase } = { player: null, clicks: CLICKS, phase: 'intro' };

function clickTrack(silent: boolean): AudioBuffer {
  const ctx = audio();
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.ceil((FIRST + N * INTERVAL + 0.8) * sr), sr);
  if (silent) return buf;
  const d = buf.getChannelData(0);
  CLICKS.forEach((t, k) => {
    const accent = k % 4 === 0;
    const f = accent ? 2100 : 1400;
    const s0 = Math.round(t * sr);
    const len = Math.round(0.05 * sr);
    for (let i = 0; i < len && s0 + i < d.length; i++) {
      const tt = i / sr;
      // the attack is the instant: full level on the first sample
      const env = Math.exp(-tt / 0.009);
      d[s0 + i] += (Math.sin(2 * Math.PI * f * tt) * 0.65 + (tt < 0.0012 ? (Math.random() * 2 - 1) * 0.45 : 0)) * env * (accent ? 0.95 : 0.75);
    }
  });
  return buf;
}

function summarize(taps: number[]): Result | null {
  const ds: number[] = [];
  for (const t of taps) {
    let best = Infinity;
    for (let k = COUNT_IN; k < CLICKS.length; k++) {
      const d = t - CLICKS[k];
      if (Math.abs(d) < Math.abs(best)) best = d;
    }
    if (Math.abs(best) < 0.22) ds.push(best * 1000);
  }
  if (ds.length < 6) return null;
  const s = [...ds].sort((a, b) => a - b);
  const med = s[Math.floor(s.length / 2)];
  const mad = [...s.map((x) => Math.abs(x - med))].sort((a, b) => a - b)[Math.floor(s.length / 2)];
  return { ms: Math.round(med), spread: Math.round(mad * 1.4826), n: ds.length };
}

export function Calibration() {
  const [phase, setPhase] = useState<Phase>('intro');
  const [audioRes, setAudioRes] = useState<Result | null>(null);
  const [visualRes, setVisualRes] = useState<Result | null>(null);
  const [failed, setFailed] = useState(false);
  const [taps, setTaps] = useState<number[]>([]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const run = useRef<{ player: LocalPlayer; taps: number[]; audioOffset: number } | null>(null);
  const s = useSettings();

  calibration.phase = phase;

  const stop = () => {
    const r = run.current;
    if (r) {
      r.player.onEnded = null;
      r.player.dispose();
    }
    run.current = null;
    calibration.player = null;
    engine.inGame = false;
  };
  useEffect(() => stop, []);

  const start = (kind: 'audio' | 'visual') => {
    stop();
    setFailed(false);
    setTaps([]);
    const player = new LocalPlayer(clickTrack(kind === 'visual'));
    // the visual test runs with the audio offset just measured (or the current one)
    const audioOffset = kind === 'visual' ? (audioRes?.ms ?? useSettings.getState().audioOffsetMs) : 0;
    run.current = { player, taps: [], audioOffset };
    calibration.player = player;
    engine.inGame = kind === 'visual';
    player.onEnded = () => {
      const r = run.current;
      if (!r) return;
      const res = summarize(r.taps);
      if (kind === 'audio') setAudioRes(res);
      else setVisualRes(res);
      setFailed(!res || res.spread > 45);
      setPhase(kind === 'audio' ? 'audio-done' : 'visual-done');
      stop();
    };
    player.play(0);
    setPhase(kind);
  };

  // taps: any key (Escape leaves), click or touch on the stage
  useEffect(() => {
    if (phase !== 'audio' && phase !== 'visual') return;
    const tap = (perf: number) => {
      const r = run.current;
      if (!r) return;
      const t = r.player.timeAt(perf) - r.audioOffset / 1000;
      r.taps.push(t);
      setTaps(r.taps.slice());
    };
    const key = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'Escape') {
        stop();
        setPhase('intro');
        return;
      }
      e.preventDefault();
      tap(e.timeStamp);
    };
    const pointer = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('button')) return;
      tap(e.timeStamp);
    };
    window.addEventListener('keydown', key, { capture: true });
    const stage = document.querySelector('.calib-stage');
    stage?.addEventListener('pointerdown', pointer as EventListener);
    return () => {
      window.removeEventListener('keydown', key, { capture: true });
      stage?.removeEventListener('pointerdown', pointer as EventListener);
    };
  }, [phase]);

  // the visual test: notes falling onto a line, drawn with the game's own clock rules
  useEffect(() => {
    if (phase !== 'visual') return;
    const cv = canvas.current;
    if (!cv) return;
    const g = cv.getContext('2d')!;
    return engine.onFrame((f) => {
      const r = run.current;
      if (!r) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (cv.width !== Math.round(w * dpr)) cv.width = Math.round(w * dpr);
      if (cv.height !== Math.round(h * dpr)) cv.height = Math.round(h * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const rt = r.player.timeAt(f.now + engine.stats.frameMs) - r.audioOffset / 1000;
      const hitY = h * 0.82;
      const top = h * 0.04;
      const lw = Math.min(160, w * 0.5);
      const x0 = (w - lw) / 2;
      // lane
      const grad = g.createLinearGradient(0, top, 0, hitY);
      grad.addColorStop(0, 'rgba(79,214,255,0)');
      grad.addColorStop(1, 'rgba(79,214,255,0.10)');
      g.fillStyle = grad;
      g.fillRect(x0, top, lw, h - top);
      g.strokeStyle = 'rgba(150,162,255,0.25)';
      g.lineWidth = 1;
      g.strokeRect(x0 + 0.5, top, lw - 1, h - top);
      // hit line and flash
      let flash = 0;
      for (const c of CLICKS) if (rt >= c) flash = Math.max(flash, Math.exp(-(rt - c) * 9));
      g.fillStyle = `rgba(255,255,255,${0.55 + 0.45 * flash})`;
      g.shadowColor = '#4fd6ff';
      g.shadowBlur = 12 + 30 * flash;
      g.fillRect(x0 - 10, hitY - 2, lw + 20, 4);
      g.shadowBlur = 0;
      // notes
      for (const c of CLICKS) {
        const dt = c - rt;
        if (dt < -0.05 || dt > APPROACH) continue;
        const y = hitY - (dt / APPROACH) * (hitY - top);
        g.fillStyle = 'rgba(167,123,255,0.95)';
        g.shadowColor = '#a77bff';
        g.shadowBlur = 16;
        const nh = 18;
        g.beginPath();
        g.roundRect(x0 + 8, y - nh / 2, lw - 16, nh, 6);
        g.fill();
        g.shadowBlur = 0;
      }
    });
  }, [phase]);

  const applyAudio = () => {
    if (!audioRes) return;
    s.set({ audioOffsetMs: audioRes.ms });
    playSfx('click');
    start('visual');
  };
  const finish = async () => {
    if (visualRes && !failed) s.set({ visualOffsetMs: visualRes.ms });
    s.set({ calibrated: true });
    const unlocked = await useProfile.getState().markCalibrated();
    for (const a of unlocked) toast({ kind: 'gold', title: tr('Succès : {title}', { title: tr(a.title) }), text: tr(a.desc) });
    toast({ kind: 'info', title: tr('Calibration enregistrée'), text: tr('Audio {a} · image {v}', { a: fmt(useSettings.getState().audioOffsetMs), v: fmt(useSettings.getState().visualOffsetMs) }) });
    useNav.getState().back();
  };

  const running = phase === 'audio' || phase === 'visual';
  const judged = taps.length;
  const progress = run.current ? Math.min(1, Math.max(0, run.current.player.timeAt(performance.now()) / (FIRST + N * INTERVAL))) : 0;

  return (
    <div className="page-enter calibration">
      <div className="page-head">
        <button className="btn small ghost" onClick={() => (stop(), useNav.getState().back())}>
          <ArrowLeft size={15} /> {tr('Retour')}
        </button>
      </div>
      <div className="calib">
        <div className="panel pad calib-info brackets">
          <div className="label" style={{ color: 'var(--cyan)' }}>
            {tr('Synchronisation')}
          </div>
          <h1 className="display" style={{ margin: '8px 0 14px', fontSize: 30 }}>
            {tr('Calibration')}
          </h1>
          <div className={`calib-step ${phase === 'audio' || phase === 'audio-done' ? 'on' : ''} ${audioRes && phase !== 'audio' ? 'done' : ''}`}>
            <Ear size={20} />
            <div>
              <b>{tr('1 · Le son')}</b>
              <small>{tr('Tapez une touche (ou l’écran) sur chaque clic, en écoutant seulement. Les quatre premiers servent de décompte.')}</small>
            </div>
          </div>
          <div className={`calib-step ${phase === 'visual' || phase === 'visual-done' ? 'on' : ''} ${visualRes && phase === 'visual-done' ? 'done' : ''}`}>
            <Eye size={20} />
            <div>
              <b>{tr('2 · L’image')}</b>
              <small>{tr('Sans son : tapez quand chaque note touche la ligne.')}</small>
            </div>
          </div>
          <div className="sep" />
          <div className="row">
            <span className="muted">{tr('Actuel')}</span>
            <span className="grow" />
            <span className="num">{tr('audio {v}', { v: fmt(s.audioOffsetMs) })}</span>
            <span className="num">{tr('image {v}', { v: fmt(s.visualOffsetMs) })}</span>
          </div>
        </div>

        <div className="panel calib-stage">
          {phase === 'visual' && <canvas ref={canvas} className="calib-canvas" />}
          <div className="calib-center">
            {phase === 'intro' && (
              <>
                <Ear size={46} color="var(--cyan)" />
                <p>{tr('Mettez votre casque ou vos enceintes habituels, puis lancez le test : vingt clics réguliers.')}</p>
                <button className="btn primary big" onClick={() => start('audio')}>
                  {tr('Commencer')}
                </button>
              </>
            )}
            {phase === 'audio' && (
              <>
                <div className="calib-pulse" />
                <div className="display" style={{ fontSize: 22, letterSpacing: '0.3em' }}>
                  {tr('ÉCOUTEZ · TAPEZ')}
                </div>
                <TapDots taps={taps} />
                <div className="muted num">{trn(judged, '{n} frappe', '{n} frappes')}</div>
              </>
            )}
            {phase === 'visual' && (
              <div className="calib-overlay">
                <TapDots taps={taps} />
              </div>
            )}
            {phase === 'audio-done' && (
              <ResultCard
                title={tr('Latence du son')}
                res={audioRes}
                failed={failed}
                hint={audioRes ? (audioRes.ms > 0 ? tr('Le son vous parvient en retard : les notes seront jugées en conséquence.') : audioRes.ms < 0 ? tr('Vous tapez en avance sur le son : le jeu en tiendra compte.') : tr('Parfaitement aligné.')) : ''}
              >
                <button className="btn ghost" onClick={() => start('audio')}>
                  <RotateCcw size={15} /> {tr('Refaire')}
                </button>
                <button className="btn primary" disabled={failed || !audioRes} onClick={applyAudio}>
                  <Check size={16} /> {tr('Appliquer et tester l’image')}
                </button>
              </ResultCard>
            )}
            {phase === 'visual-done' && (
              <ResultCard title={tr('Décalage de l’image')} res={visualRes} failed={failed} hint={visualRes ? (visualRes.ms > 0 ? tr('L’image arrive un peu après le son : les notes seront dessinées en avance.') : visualRes.ms < 0 ? tr('L’image arrive un peu avant le son : les notes seront retardées.') : tr('Image et son sont alignés.')) : ''}>
                <button className="btn ghost" onClick={() => start('visual')}>
                  <RotateCcw size={15} /> {tr('Refaire')}
                </button>
                <button className="btn primary" onClick={() => void finish()}>
                  <Check size={16} /> {failed ? tr('Garder le son seulement') : tr('Terminer')}
                </button>
              </ResultCard>
            )}
          </div>
          {running && (
            <div className="calib-progress">
              <i style={{ width: `${progress * 100}%` }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const fmt = (ms: number) => `${ms > 0 ? '+' : ''}${ms} ms`;

function TapDots({ taps }: { taps: number[] }) {
  // where the last taps fell around the beat (−150 … +150 ms)
  const ds = taps
    .map((t) => {
      let best = Infinity;
      for (const c of CLICKS) if (Math.abs(t - c) < Math.abs(best)) best = t - c;
      return best * 1000;
    })
    .filter((d) => Math.abs(d) < 150)
    .slice(-12);
  return (
    <div className="tapdots" aria-hidden>
      <span className="mid" />
      {ds.map((d, i) => (
        <i key={i} style={{ left: `${50 + (d / 150) * 50}%`, opacity: 0.3 + (0.7 * (i + 1)) / ds.length }} />
      ))}
      <small style={{ left: 0 }}>{tr('tôt')}</small>
      <small style={{ right: 0 }}>{tr('tard')}</small>
    </div>
  );
}

function ResultCard({ title, res, failed, hint, children }: { title: string; res: Result | null; failed: boolean; hint: string; children: ReactNode }) {
  return (
    <div className="calib-result">
      <div className="label">{title}</div>
      {res ? (
        <>
          <div className="display big-ms">{fmt(res.ms)}</div>
          <div className="muted">
            {tr('{n} frappes retenues · régularité ±{s} ms', { n: res.n, s: res.spread })}
          </div>
          {failed ? <p className="tip" style={{ color: '#ffb3c6' }}>{tr('Les frappes étaient trop irrégulières pour une mesure fiable. Réessayez calmement, en suivant le tempo.')}</p> : <p className="tip">{hint}</p>}
        </>
      ) : (
        <p className="tip" style={{ color: '#ffb3c6' }}>{tr('Pas assez de frappes pour mesurer. Tapez sur chaque clic après le décompte.')}</p>
      )}
      <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
        {children}
      </div>
    </div>
  );
}
