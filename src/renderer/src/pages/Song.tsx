import { fmtNum, tr, trn } from '../i18n';
import { MusicVolume } from '../components/MusicVolume';
import { OnlineBoard } from '../components/OnlineBoard';
import { PreGamePublish } from '../components/PreGamePublish';
import { songKeyOf } from '@shared/leaderboard';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Globe, ArrowLeft, Dumbbell, Ear, Eye, Heart, Loader2, PenLine, Play, Radio, RotateCcw, Square, Zap } from 'lucide-react';
import type { TrackRef } from '@shared/types';
import type { Analysis } from '@core/analysis/analyze';
import { generateChart } from '@core/chart/generate';
import { CHART_VERSION, DIFFICULTIES, paramsFor, type Chart, type DifficultyId, type DifficultyParams } from '@core/chart/types';
import { hashString } from '@core/util/rng';
import type { PlayRecord } from '@core/game/progress';
import { loadLocal, type LoadProgress } from '../game/loader';
import { canAnalyse, ensureAnalysis, ytHost, YT_ENDED, type YtHost } from '../yt/host';
import { FrameRecorder, forgetLearned, learnedAnalysis, learnFrom, LEARN_COVERAGE } from '../yt/learn';
import { errorText, toast, toastError } from '../store/toasts';
import { keyName, useSettings } from '../store/settings';
import { useLibrary } from '../store/library';
import { useQueue } from '../store/queue';
import { loadEdits, withEdit, type EditedChart } from '../store/edits';
import { useShallow } from 'zustand/react/shallow';
import { go, useNav } from '../store/nav';
import { best, runsOf } from '../store/profile';
import { Cover, DIFF_COLOR, DIFF_LABEL, Range, RANK_COLOR, Seg, Toggle, fmtPct, fmtScore, fmtTime } from '../components/ui';
import { playSfx } from '../audio/sfx';
import { platform } from '../platform';

/** Nominal level of a live chart (its notes are only known while it plays). */
const LIVE_LEVEL: Record<DifficultyId, number> = { easy: 3, normal: 6, hard: 10, expert: 14, custom: 7 };

/** Mode A: a chart with no notes yet — they are predicted during the run. */
export function liveChart(track: TrackRef, d: DifficultyId, lanes: number, custom: Partial<DifficultyParams>, duration: number): Chart {
  const params = paramsFor(d, d === 'custom' ? custom : undefined, lanes);
  return {
    version: CHART_VERSION,
    difficulty: d,
    params,
    notes: [],
    beats: [],
    downbeat: 0,
    meter: 4,
    bpm: 0,
    sections: [],
    duration,
    source: 'live',
    stats: { notes: 0, holds: 0, chords: 0, nps: 0, peakNps: 0, level: LIVE_LEVEL[d] },
    seed: hashString(`${track.key}|${d}|${lanes}|live`),
  };
}

interface Prepared {
  analysis: Analysis;
  buffer: AudioBuffer | null;
  cached: boolean;
}

const STAGE: Record<LoadProgress['stage'], string> = {
  download: tr('Téléchargement du son (yt-dlp)'),
  read: tr('Lecture du fichier'),
  decode: tr('Décodage audio'),
  convert: tr('Conversion (FFmpeg)'),
  analyse: tr('Analyse : tempo, battements, structure'),
  ready: tr('Prêt'),
};

/** The same song, difficulty and lane count always give the same chart (records stay comparable). */
export function chartFor(track: TrackRef, an: Analysis, d: DifficultyId, lanes: number, custom: Partial<DifficultyParams>, range?: { from: number; to: number }): Chart {
  const params = paramsFor(d, d === 'custom' ? custom : undefined, lanes);
  const seed = hashString(`${track.key}|${d}|${lanes}`);
  return generateChart(an, { difficulty: d, params, seed, startAt: range?.from, endAt: range?.to });
}

function Timeline({ an, chart }: { an: Analysis; chart: Chart | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth * dpr;
    const H = c.clientHeight * dpr;
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, W, H);
    const dur = an.duration || 1;
    const x = (t: number) => (t / dur) * W;
    // bars: height = intensity, colour = section (chorus in gold)
    const palette = ['#4fd6ff', '#8f6bff', '#ff5fd2', '#5574ff', '#a77bff', '#5cf0b0'];
    const secOf = (t: number) => an.structure.sections.findIndex((s) => t >= s.start && t < s.end);
    for (const b of an.structure.bars) {
      const si = secOf(b.start);
      const s = an.structure.sections[si];
      const col = s?.chorus ? '#ffc861' : palette[(s ? s.label : 0) % palette.length];
      const h = Math.max(2, b.intensity * (H - 8));
      g.fillStyle = col;
      g.globalAlpha = 0.25 + b.intensity * 0.5;
      g.fillRect(x(b.start) + 0.5, H - h, Math.max(1, x(b.end) - x(b.start) - 1), h);
    }
    g.globalAlpha = 1;
    // section boundaries
    g.strokeStyle = 'rgba(236,238,255,0.35)';
    g.lineWidth = dpr;
    for (const s of an.structure.sections.slice(1)) {
      g.beginPath();
      g.moveTo(x(s.start), 0);
      g.lineTo(x(s.start), H);
      g.stroke();
    }
    // note density of the selected chart
    if (chart && chart.notes.length) {
      const bins = new Float32Array(Math.max(10, Math.round(W / (4 * dpr))));
      for (const n of chart.notes) bins[Math.min(bins.length - 1, Math.floor((n.t / dur) * bins.length))]++;
      const max = Math.max(...bins);
      g.beginPath();
      bins.forEach((v, i) => {
        const px = ((i + 0.5) / bins.length) * W;
        const py = H - 4 - (v / max) * (H - 12);
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      });
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = 1.5 * dpr;
      g.stroke();
    }
  }, [an, chart]);
  return (
    <div className="timeline">
      <canvas ref={ref} />
    </div>
  );
}

export function Song({ track, file }: { track: TrackRef; file?: File }) {
  const s = useSettings();
  const lib = useLibrary();
  const back = useNav((st) => st.back);
  const [progress, setProgress] = useState<LoadProgress>({ stage: 'read', p: 0 });
  const [song, setSong] = useState<Prepared | null>(null);
  // YouTube song in download mode (Settings › YouTube): its sound is fetched with yt-dlp and the
  // song is then handled as a local file; otherwise the official player plays it
  const [dl, setDl] = useState(() => track.source === 'youtube' && !!track.videoId && s.ytSource === 'download' && !!platform.ytdlp);
  const isYt = track.source === 'youtube' && !!track.videoId && !dl;
  /** The download failed and the player took over: the song page offers to try again. */
  const [dlFailed, setDlFailed] = useState(false);
  const slotRef = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<YtHost | null>(null);
  const [ytState, setYtState] = useState<'priming' | 'ready' | 'error'>('priming');
  const [preload, setPreload] = useState(0);
  const [ytDuration, setYtDuration] = useState(track.duration ?? 0);
  /** YouTube: not learned yet (live play or listen first). */
  const [unlearned, setUnlearned] = useState(false);
  const [listen, setListen] = useState<{ p: number; heard: number } | null>(null);
  /** "Play" asked while the song is still being downloaded or listened to: the run starts once ready. */
  const [pendingPlay, setPendingPlay] = useState(false);
  const [learning, setLearning] = useState(false);
  const listenRef = useRef<{ rec: FrameRecorder; off: () => void; timer: ReturnType<typeof setInterval>; offState: () => void } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<PlayRecord[]>([]);
  const [practice, setPractice] = useState(false);
  const [rate, setRate] = useState(1);
  const [section, setSection] = useState(-1);
  const [loop, setLoop] = useState(true);
  const diff = s.difficulty;
  const t = lib.tracks[track.key] ?? track;
  const queue = useQueue(useShallow((q) => (q.items[q.index]?.key === track.key ? { name: q.name, at: q.index + 1, of: q.items.length } : null)));

  // a song opened from elsewhere leaves the list being played
  useEffect(() => useQueue.getState().sync(track.key), [track.key]);

  useEffect(() => {
    let alive = true;
    setSong(null);
    setError(null);
    if (isYt) {
      // the official player shows in the page; it is loaded and paused at the start, ready to play
      let h: YtHost | null = null;
      void ytHost().then((got) => {
        if (!alive) return;
        if (!got) {
          setError(tr('YouTube n’est pas disponible ici.'));
          return;
        }
        h = got;
        setHost(got);
        if (slotRef.current) got.place({ kind: 'slot', el: slotRef.current });
        got.setVolume(s.volume.master * s.volume.music);
        got.prime(track.videoId!).then(
          () => {
            if (!alive) return;
            setYtState('ready');
            if (got.duration > 1) {
              setYtDuration(got.duration);
              if (!track.duration || Math.abs(track.duration - got.duration) > 1.5) void lib.add([{ ...track, duration: got.duration }]);
            }
          },
          (e: unknown) => {
            if (!alive) return;
            setYtState('error');
            setError(errorText(e));
          },
        );
      });
      learnedAnalysis(track).then(
        (a) => {
          if (!alive) return;
          if (a) setSong({ analysis: a, buffer: null, cached: true });
          else setUnlearned(true);
        },
        () => alive && setUnlearned(true),
      );
      runsOf(track.key).then((r) => alive && setRuns(r));
      return () => {
        alive = false;
        stopListen();
        if (h && useNav.getState().page.id !== 'game') {
          h.pause();
          h.place({ kind: 'hidden' });
        }
      };
    }
    const load = dl
      ? (setProgress({ stage: 'download', p: 0 }),
        platform.ytdlp!.download(track.videoId!, (p) => alive && setProgress({ stage: 'download', p })).then((d) =>
          // the analysis is cached apart from the one learned by ear (`yt:` key)
          loadLocal({ ...track, key: `ytdl:${track.videoId}`, path: d.path, size: d.size, mtime: d.mtime }, undefined, (p) => alive && setProgress(p)),
        ))
      : loadLocal(track, file, (p) => alive && setProgress(p));
    load
      .then((r) => {
        if (!alive) return;
        setSong({ analysis: r.analysis, buffer: r.buffer, cached: r.cached });
        if (!track.duration) void lib.add([{ ...track, duration: r.buffer.duration }]);
      })
      .catch((e) => {
        if (!alive) return;
        if (!dl) return setError(errorText(e));
        // download failed: the official player takes over (live notes, or listen first)
        toast({ kind: 'error', title: tr('Téléchargement impossible : lecteur YouTube'), text: errorText(e) }, 8000);
        setPendingPlay(false);
        setDlFailed(true);
        setDl(false);
      });
    runsOf(track.key).then((r) => alive && setRuns(r));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.key, dl]);

  const duration = song?.buffer?.duration ?? (isYt ? ytDuration || song?.analysis.duration || 0 : (song?.analysis.duration ?? t.duration ?? 0));

  // "listen first": the song plays once in the player, its frames are recorded, then analysed
  function stopListen(): void {
    const l = listenRef.current;
    if (!l) return;
    clearInterval(l.timer);
    l.off();
    l.offState();
    listenRef.current = null;
    setListen(null);
  }
  const finishListen = async () => {
    const l = listenRef.current;
    if (!l || !host) return;
    const d = host.duration || ytDuration;
    stopListen();
    host.pause();
    setLearning(true);
    try {
      const a = await learnFrom(track, l.rec, d);
      if (a) {
        setSong({ analysis: a, buffer: null, cached: false });
        setUnlearned(false);
        playSfx('record', 0.7);
        toast({ kind: 'gold', title: tr('Morceau appris'), text: tr('Toutes les difficultés sont prêtes.') });
      } else {
        setPendingPlay(false);
        toast({ kind: 'error', title: tr('Écoute incomplète'), text: tr('Il faut entendre au moins {p} % du morceau.', { p: Math.round(LEARN_COVERAGE * 100) }) });
      }
    } catch (e) {
      setPendingPlay(false);
      toastError(e, tr('Analyse impossible'));
    } finally {
      setLearning(false);
    }
  };
  const startListen = async () => {
    if (!host || listenRef.current) return;
    const err = await ensureAnalysis(host);
    if (err) {
      toast({ kind: 'error', title: tr('Écoute impossible'), text: err }, 8000);
      return;
    }
    try {
      await host.prime(track.videoId!);
    } catch (e) {
      toastError(e);
      return;
    }
    const rec = new FrameRecorder();
    const off = host.onFrames((b) => rec.add(b));
    const offState = host.on((e) => {
      if (e.type === 'state' && e.state === YT_ENDED) void finishListen();
    });
    const timer = setInterval(() => {
      const d = host.duration || ytDuration;
      setListen({ p: d ? rec.coverage(d) : 0, heard: rec.heard() });
    }, 400);
    listenRef.current = { rec, off, timer, offState };
    setListen({ p: 0, heard: 0 });
    host.setRate(1);
    host.seek(0);
    host.play();
  };
  const relearn = async () => {
    await forgetLearned(track);
    setSong(null);
    setUnlearned(true);
  };

  // YouTube: how much of the song is buffered before the run may start
  useEffect(() => {
    if (!host || ytState !== 'priming') return;
    const timer = setInterval(() => setPreload(host.preload), 300);
    return () => clearInterval(timer);
  }, [host, ytState]);
  // charts edited in the workshop replace the generated ones
  const [edits, setEdits] = useState<Partial<Record<DifficultyId, EditedChart>>>({});
  useEffect(() => {
    let alive = true;
    void loadEdits(track, [...DIFFICULTIES, 'custom'], s.lanes).then((e) => alive && setEdits(e));
    return () => {
      alive = false;
    };
  }, [track, s.lanes]);
  const generated = useMemo(() => {
    if (!song) return null;
    const out: Partial<Record<DifficultyId, Chart>> = {};
    for (const d of [...DIFFICULTIES, 'custom' as const]) out[d] = chartFor(track, song.analysis, d, s.lanes, s.custom);
    return out;
  }, [song, s.lanes, s.custom, track]);
  const charts = useMemo(() => {
    if (!generated) return null;
    const out: Partial<Record<DifficultyId, Chart>> = {};
    for (const d of [...DIFFICULTIES, 'custom' as const]) out[d] = withEdit(generated[d]!, edits[d]);
    return out;
  }, [generated, edits]);

  const an = song?.analysis;
  const sections = an?.structure.sections ?? [];
  const range = practice && section >= 0 && sections[section] ? { from: sections[section].start, to: sections[section].end } : null;

  const play = (autoplay = false) => {
    if (!song || !charts) return;
    playSfx('go', 0.7);
    void lib.touch(t);
    const chart = range ? (edits[diff] ? withEdit(generated![diff]!, edits[diff], range) : chartFor(track, song.analysis, diff, s.lanes, s.custom, range)) : charts[diff]!;
    stopListen();
    go({
      id: 'game',
      game: {
        track: isYt ? { ...t, duration: duration || t.duration } : t,
        chart,
        buffer: song.buffer ?? undefined,
        practice: practice ? { from: range?.from ?? 0, to: range?.to ?? duration, loop: !!range && loop, rate } : null,
        autoplay,
      },
    });
  };

  /** YouTube, Mode A: the notes are written while the song plays. */
  const playLive = async () => {
    if (!host || ytState !== 'ready') return;
    const err = await ensureAnalysis(host);
    if (err) return toast({ kind: 'error', title: tr('Son du morceau indisponible'), text: err }, 8000);
    playSfx('go', 0.7);
    stopListen();
    void lib.touch(t);
    go({ id: 'game', game: { track: { ...t, duration: duration || t.duration }, chart: liveChart(track, diff, s.lanes, s.custom, duration), live: true } });
  };
  const canPlay = !!song && (!isYt || ytState === 'ready');

  /**
   * YouTube song not learned yet, normal run: download it (desktop) or listen to it once (browser,
   * or when the download failed), then play the full chart.
   */
  const playNormal = () => {
    if (!isYt || listen) return;
    playSfx('click', 0.7);
    setPendingPlay(true);
    if (platform.ytdlp && !dlFailed && !dl) {
      setDl(true);
      return;
    }
    void startListen();
  };
  useEffect(() => {
    if (pendingPlay && canPlay && charts) {
      setPendingPlay(false);
      play();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPlay, canPlay, charts]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' && canPlay) play();
      else if (e.code === 'Enter' && isYt && unlearned && ytState === 'ready' && !listen) {
        if (s.ytMode === 'live') void playLive();
        else playNormal();
      }
      if (e.code === 'Escape') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const setCustom = (patch: Partial<DifficultyParams>) => s.set({ custom: { ...s.custom, ...patch } });
  const cp = paramsFor('custom', s.custom);

  return (
    <div className="page-enter">
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn small ghost" onClick={back}>
          <ArrowLeft size={15} /> {tr('Retour')}
        </button>
      </div>
      <div className="song">
        <div className="col" style={{ gap: 16 }}>
          <div className="song-id">
            <Cover src={t.cover ?? null} size="lg" />
            <div style={{ minWidth: 0 }}>
              <div className="label">
                {t.source === 'youtube' ? tr('YouTube Music') : t.origin === 'chud-music' ? tr('Chud Music') : tr('Fichier local')}
                {queue && (
                  <span style={{ color: 'var(--cyan)' }}>
                    {' '}
                    · {queue.name ?? tr('File')} {queue.at}/{queue.of}
                  </span>
                )}
              </div>
              <h1>{t.title}</h1>
              <div className="artist">{t.artist ?? tr('Artiste inconnu')}</div>
              <div className="facts">
                {an && <span className="chip">{Math.round(an.grid.bpm)} BPM</span>}
                {an && <span className="chip">{an.grid.meter}/4</span>}
                {an && an.feel.some((f) => f === 'triplet') && <span className="chip">{tr('swing')}</span>}
                {an && !an.grid.steady && <span className="chip">{tr('tempo variable')}</span>}
                <span className="chip">{fmtTime(duration || t.duration)}</span>
                <button className={`chip ${t.favorite ? 'gold' : ''}`} onClick={() => lib.toggleFavorite(t.key)} aria-label={tr('Favori')}>
                  <Heart size={13} fill={t.favorite ? 'currentColor' : 'none'} />
                </button>
              </div>
            </div>
          </div>
          {isYt && (
            <div className="yt-slot-wrap">
              {dlFailed && !listen && (
                <button
                  className="btn small"
                  style={{ marginBottom: 8 }}
                  onClick={() => {
                    setDlFailed(false);
                    setDl(true);
                  }}
                >
                  <RotateCcw size={14} /> {tr('Réessayer le téléchargement')}
                </button>
              )}
              <div className="yt-slot" ref={slotRef}>
                {ytState === 'priming' && (
                  <div className="yt-slot-wait">
                    <Loader2 className="spin" size={18} /> {preload > 0 ? tr('Préchargement {p} %', { p: Math.round(preload * 100) }) : tr('Lecteur YouTube')}
                  </div>
                )}
              </div>
            </div>
          )}
          {error ? (
            <div className="panel pad song-error" style={{ borderColor: 'rgba(255,79,122,0.5)' }}>
              <div className="row">
                <AlertTriangle color="var(--danger)" />
                <b>{tr('Impossible de préparer ce morceau')}</b>
              </div>
              <p className="tip">{error}</p>
              {dl && (
                <button className="btn small" onClick={() => setDl(false)}>
                  <Radio size={14} /> {tr('Jouer avec le lecteur YouTube')}
                </button>
              )}
            </div>
          ) : isYt && !song && learning ? (
            <div className="panel analysing">
              <div className="row">
                <Loader2 className="spin" size={18} color="var(--cyan)" />
                <b>{tr('Analyse de l’écoute : tempo, battements, structure')}</b>
              </div>
              <div className="progress">
                <i style={{ width: '70%' }} />
              </div>
            </div>
          ) : isYt && !song ? (
            unlearned ? (
              <div className="panel pad learn-panel">
                <div className="panel-title">
                  <h3>{tr('Première rencontre')}</h3>
                </div>
                <p className="tip" style={{ marginTop: 0 }}>
                  {tr('Ce morceau n’a encore jamais été entendu par la station. Partie normale : il est écouté une fois, puis vous jouez la partition complète, calée sur toute la chanson (et classée en ligne). En direct : les notes sont écrites pendant la lecture, avec un peu d’avance.')}
                </p>
                {listen ? (
                  <>
                    <div className="row">
                      <Ear size={16} color="var(--cyan)" />
                      <b>{tr('Écoute en cours')}</b>
                      <span className="grow" />
                      <span className="num muted">{Math.round(listen.p * 100)} %</span>
                    </div>
                    <div className="progress">
                      <i style={{ width: `${Math.round(listen.p * 100)}%` }} />
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      <button className="btn small" onClick={() => void finishListen()} disabled={listen.p < LEARN_COVERAGE}>
                        {tr('Analyser maintenant')}
                      </button>
                      <button
                        className="btn small ghost"
                        onClick={() => {
                          stopListen();
                          host?.pause();
                        }}
                      >
                        <Square size={13} /> {tr('Arrêter')}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                    <button className={`btn ${s.ytMode !== 'live' ? 'primary' : ''}`} disabled={ytState !== 'ready' || !canAnalyse(host)} onClick={playNormal}>
                      <Ear size={16} /> {tr('Partie normale')}
                    </button>
                    <button className={`btn ${s.ytMode === 'live' ? 'primary' : ''}`} disabled={ytState !== 'ready' || !canAnalyse(host)} onClick={() => void playLive()}>
                      <Radio size={16} /> {tr('Jouer en direct')}
                    </button>
                  </div>
                )}
                {host && host.kind === 'iframe' && host.analysis === 'none' && (
                  <p className="tip">
                    {canAnalyse(host)
                      ? tr('Dans le navigateur, la station écoute le morceau par le partage de cet onglet : choisissez « Cet onglet » et cochez « Partager aussi l’audio ». Rien n’est enregistré ; la version bureau n’a pas besoin de ce partage.')
                      : tr('Ce navigateur ne permet pas de partager le son d’un onglet : utilisez Chrome ou Edge, ou la version bureau (Windows, Linux, macOS).')}
                  </p>
                )}
              </div>
            ) : (
              <div className="panel analysing">
                <div className="row">
                  <Loader2 className="spin" size={18} color="var(--cyan)" />
                  <b>{tr('Recherche d’une partition apprise')}</b>
                </div>
              </div>
            )
          ) : !song ? (
            <div className="panel analysing">
              <div className="row">
                <Loader2 className="spin" size={18} color="var(--cyan)" />
                <b>{STAGE[progress.stage]}</b>
                <span className="grow" />
                {(progress.stage === 'analyse' || progress.stage === 'download') && <span className="num muted">{Math.round(progress.p * 100)} %</span>}
              </div>
              <div className="progress">
                <i style={{ width: `${progress.stage === 'download' ? progress.p * 100 : progress.stage === 'analyse' ? 10 + progress.p * 90 : progress.stage === 'decode' ? 6 : 2}%` }} />
              </div>
              <span className="tip">{tr('Le fichier original n’est jamais modifié. L’analyse est faite une seule fois puis gardée en mémoire.')}</span>
            </div>
          ) : (
            <>
              <div className="panel pad">
                <div className="panel-title">
                  <h3>{tr('Structure')}</h3>
                  <span className="grow" />
                  <span className="muted" style={{ fontSize: 12 }}>
                    {trn(sections.length, '{n} section', '{n} sections')}{sections.some((x) => x.chorus) ? tr(' · refrain en or') : ''}
                    {song.cached ? tr(' · analyse en cache') : ''}
                    {song.analysis.source === 'learned' ? tr(' · apprise à l’écoute') : ''}
                  </span>
                  {isYt && (
                    <button className="btn small ghost icon" title={tr('Oublier et réapprendre ce morceau')} onClick={() => void relearn()}>
                      <RotateCcw size={14} />
                    </button>
                  )}
                </div>
                <Timeline an={song.analysis} chart={charts?.[diff] ?? null} />
              </div>
              <div className="panel pad">
                <MusicVolume />
                <div className="opt-row">
                  <div className="what">
                    <b>{tr('Colonnes')}</b>
                    <small>{tr('Nombre de pistes de jeu')}</small>
                  </div>
                  <Seg value={s.lanes} options={[3, 4, 5, 6, 7].map((v) => ({ v, label: v }))} onChange={(v) => s.set({ lanes: v })} />
                </div>
                <div className="opt-row">
                  <div className="what">
                    <b>{tr('Vitesse de défilement')}</b>
                    <small>{tr('Temps pendant lequel une note est visible')}</small>
                  </div>
                  <div className="ctl">
                    <Range value={s.approach} min={0.5} max={2.5} step={0.05} onChange={(v) => s.set({ approach: v })} label={tr('Temps d\'approche')} />
                    <span className="val">{fmtNum(s.approach, 2)} s</span>
                  </div>
                </div>
                <div className="opt-row">
                  <div className="what">
                    <b>{tr('Échec possible')}</b>
                    <small>{tr('La partie s’arrête quand l’énergie tombe à zéro')}</small>
                  </div>
                  <Toggle on={s.fail} onChange={(v) => s.set({ fail: v })} label={tr('Échec possible')} />
                </div>
                <div className="opt-row">
                  <div className="what">
                    <b>
                      <Dumbbell size={14} style={{ verticalAlign: -2 }} /> {tr('Entraînement')}
                    </b>
                    <small>{tr('Ralenti, section en boucle — sans record')}</small>
                  </div>
                  <Toggle on={practice} onChange={setPractice} label={tr('Entraînement')} />
                </div>
                {practice && (
                  <>
                    <div className="opt-row">
                      <div className="what">
                        <b>{tr('Vitesse de la musique')}</b>
                      </div>
                      <Seg value={rate} options={(isYt ? [0.5, 0.75, 1] : [0.5, 0.65, 0.75, 0.9, 1]).map((v) => ({ v, label: `${Math.round(v * 100)} %` }))} onChange={setRate} />
                    </div>
                    <div className="opt-row">
                      <div className="what">
                        <b>{tr('Section')}</b>
                      </div>
                      <div className="ctl">
                        <select className="input" style={{ height: 34, width: 200 }} value={section} onChange={(e) => setSection(Number(e.target.value))}>
                          <option value={-1}>{tr('Tout le morceau')}</option>
                          {sections.map((x, i) => (
                            <option key={i} value={i}>
                              {fmtTime(x.start)} – {fmtTime(x.end)} {x.chorus ? tr('(refrain)') : ''}
                            </option>
                          ))}
                        </select>
                        {section >= 0 && (
                          <span className="row" style={{ gap: 6 }}>
                            <Toggle on={loop} onChange={setLoop} label={tr('Boucle')} />
                            <small className="muted">{tr('boucle')}</small>
                          </span>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
        <div className="col" style={{ gap: 14 }}>
          <div className="label">{tr('Difficulté')}</div>
          <div className="diffs">
            {[...DIFFICULTIES, 'custom' as const].map((d) => {
              const c = charts?.[d] ?? (isYt && unlearned ? liveChart(track, d, s.lanes, s.custom, duration) : undefined);
              const b = best(runs, d, s.lanes);
              return (
                <button
                  key={d}
                  className={`diff ${diff === d ? 'on' : ''}`}
                  style={{ ['--c' as string]: DIFF_COLOR[d] }}
                  onMouseEnter={() => playSfx('hover', 0.4)}
                  onClick={() => {
                    playSfx('click', 0.7);
                    s.set({ difficulty: d });
                  }}
                  onDoubleClick={() => (song ? play() : playLive())}
                >
                  <div>
                    <div className="name">{DIFF_LABEL[d]}</div>
                    <div className="meta">
                      {c ? (
                        <>
                          {c.source === 'live' ? <span>{tr('notes écrites en direct')}</span> : <span>{trn(c.stats.notes, '{n} note', '{n} notes')}</span>}
                          {edits[d] && <span style={{ color: 'var(--gold)' }}>{tr('modifiée')}</span>}
                          {c.source !== 'live' && <span>{fmtNum(c.stats.nps, 1)} n/s</span>}
                          {c.stats.holds > 0 && <span>{trn(c.stats.holds, '{n} longue', '{n} longues')}</span>}
                          {c.stats.chords > 0 && <span>{trn(c.stats.chords, '{n} accord', '{n} accords')}</span>}
                        </>
                      ) : (
                        <span>—</span>
                      )}
                    </div>
                    {b && (
                      <div className="meta best" style={{ marginTop: 4 }}>
                        <span style={{ color: RANK_COLOR[b.rank], fontWeight: 700 }}>{b.rank}</span>
                        <span className="num">{fmtScore(b.score)}</span>
                        <span>{fmtPct(b.accuracy, 1)}</span>
                        {b.fullCombo && <span style={{ color: 'var(--gold)' }}>{tr('FC')}</span>}
                      </div>
                    )}
                  </div>
                  <div className="lvl-n">{c ? c.stats.level : '–'}</div>
                </button>
              );
            })}
          </div>
          {diff === 'custom' && (
            <div className="panel pad">
              <div className="opt-row">
                <div className="what"><b>{tr('Densité')}</b><small>{tr('Notes par temps au plus fort')}</small></div>
                <div className="ctl"><Range value={cp.densityHi} min={0.5} max={4} step={0.1} onChange={(v) => setCustom({ densityHi: v, densityLo: Math.min(v, cp.densityLo) })} /><span className="val">{cp.densityHi.toFixed(1)}</span></div>
              </div>
              <div className="opt-row">
                <div className="what"><b>{tr('Subdivisions')}</b></div>
                <Seg value={cp.finest} options={[{ v: 1 as const, label: tr('Noires') }, { v: 2 as const, label: tr('Croches') }, { v: 4 as const, label: tr('Doubles') }]} onChange={(v) => setCustom({ finest: v, triplets: v === 4 })} />
              </div>
              <div className="opt-row">
                <div className="what"><b>{tr('Accords')}</b></div>
                <div className="ctl"><Range value={cp.chordRate} min={0} max={0.3} step={0.01} onChange={(v) => setCustom({ chordRate: v, maxFingers: Math.max(cp.maxFingers, v > 0 ? 2 : 1) })} /><span className="val">{Math.round(cp.chordRate * 100)} %</span></div>
              </div>
              <div className="opt-row">
                <div className="what"><b>{tr('Notes longues')}</b></div>
                <div className="ctl"><Range value={cp.holdRate} min={0} max={0.35} step={0.01} onChange={(v) => setCustom({ holdRate: v })} /><span className="val">{Math.round(cp.holdRate * 100)} %</span></div>
              </div>
              <div className="opt-row">
                <div className="what"><b>{tr('Écart minimal')}</b><small>{tr('Entre deux notes')}</small></div>
                <div className="ctl"><Range value={cp.minGap} min={0.06} max={0.4} step={0.005} onChange={(v) => setCustom({ minGap: v, laneGap: Math.max(v * 1.4, 0.1) })} /><span className="val">{Math.round(cp.minGap * 1000)} ms</span></div>
              </div>
              <div className="opt-row">
                <div className="what"><b>{tr('Fenêtres de jugement')}</b></div>
                <div className="ctl"><Range value={cp.windowScale} min={0.7} max={1.4} step={0.05} onChange={(v) => setCustom({ windowScale: v })} /><span className="val">×{cp.windowScale.toFixed(2)}</span></div>
              </div>
            </div>
          )}
          <div className="row">
            {isYt && unlearned && !song && s.ytMode !== 'live' ? (
              <button className="btn primary huge grow" disabled={ytState !== 'ready' || !!listen || !canAnalyse(host)} onClick={playNormal}>
                {listen ? <Loader2 size={22} className="spin" /> : <Play size={22} fill="currentColor" />} {listen ? tr('Écoute en cours…') : tr('Jouer')} <span className="kbd">{tr('Entrée')}</span>
              </button>
            ) : isYt && unlearned && !song ? (
              <button className="btn primary huge grow" disabled={ytState !== 'ready' || !!listen} onClick={playLive}>
                <Radio size={22} /> {tr('Jouer en direct')} <span className="kbd">{tr('Entrée')}</span>
              </button>
            ) : (
              <button className="btn primary huge grow" disabled={!canPlay} onClick={() => play()}>
                <Play size={22} fill="currentColor" /> {tr('Jouer')} <span className="kbd">{tr('Entrée')}</span>
              </button>
            )}
            <button className="btn huge icon" style={{ width: 64 }} disabled={!canPlay} onClick={() => play(true)} title={tr('Aperçu : regarder la partition jouée automatiquement')}>
              <Eye size={22} />
            </button>
            <button
              className="btn huge icon"
              style={{ width: 64 }}
              disabled={!canPlay || !generated}
              onClick={() => {
                stopListen();
                go({ id: 'editor', editor: { track: isYt ? { ...t, duration: duration || t.duration } : t, difficulty: diff, chart: generated![diff]!, buffer: song?.buffer ?? undefined } });
              }}
              title={tr('Atelier : modifier la partition de cette difficulté')}
              aria-label={tr('Modifier la partition')}
            >
              <PenLine size={22} />
            </button>
          </div>
          <div className="tip row" style={{ gap: 6 }}>
            <Zap size={13} /> {tr('Touches : {keys} — Échap pour la pause', { keys: s.keys[s.lanes]?.map((k) => keyName(k[0] ?? '')).join(' · ') ?? '' })}
          </div>
          {s.online && diff !== 'custom' && (
            <div className="panel pad">
              <div className="panel-title">
                <Globe size={16} />
                <h3>{tr('Classement en ligne')}</h3>
                <span className="grow" />
                <span className="muted" style={{ fontSize: 12 }}>
                  {DIFF_LABEL[diff]} · {tr('{n} colonnes', { n: s.lanes })}
                </span>
              </div>
              <PreGamePublish />
              <OnlineBoard songKey={songKeyOf(track)} difficulty={diff} lanes={s.lanes} me={s.pseudo} limit={10} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
