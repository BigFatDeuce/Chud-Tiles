import { fmtNum, tr } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, FlaskConical, Pause, Play, Redo2, RotateCcw, Save, Undo2 } from 'lucide-react';
import type { TrackRef } from '@shared/types';
import type { Chart, DifficultyId, Note } from '@core/chart/types';
import { chartStats } from '@core/chart/generate';
import { laneColors } from '../gfx/playfield';
import type { SongPlayer } from '../audio/player';
import { LocalPlayer } from '../audio/local-player';
import { YouTubePlayer } from '../yt/player';
import { currentHost } from '../yt/host';
import { useSettings } from '../store/settings';
import { useNav, go } from '../store/nav';
import { loadEdit, normalizeNotes, removeEdit, saveEdit, withEdit } from '../store/edits';
import { toast, toastError } from '../store/toasts';
import { DIFF_COLOR, DIFF_LABEL, Seg, fmtTime } from '../components/ui';
import { playHit, playSfx } from '../audio/sfx';

// The chart workshop: the notes of one difficulty on a vertical score (time goes up, like in the
// game), the beat grid of the song, the music to check by ear. Click to add a note, drag to move
// it or to draw a long note, right click to remove. The edit is saved over the generated chart,
// which can be restored at any time.

export interface EditorParams {
  track: TrackRef;
  difficulty: DifficultyId;
  /** The generated chart (the edit is loaded over it). */
  chart: Chart;
  buffer?: AudioBuffer;
}

type Snap = 1 | 2 | 3 | 4;
const SNAPS: { v: Snap; label: string; title: string }[] = [
  { v: 1, label: '1/1', title: tr('Temps') },
  { v: 2, label: '1/2', title: tr('Croches') },
  { v: 3, label: '1/3', title: tr('Triolets') },
  { v: 4, label: '1/4', title: tr('Doubles croches') },
];
const HIT_Y = 0.82;
const HELP: [string, string][] = [
  [tr('Clic'), tr('ajouter une note')],
  [tr('Glisser sur une piste'), tr('note longue')],
  [tr('Glisser une note'), tr('déplacer')],
  [tr('Clic droit'), tr('supprimer')],
  [tr('Maj+clic'), tr('sélection multiple')],
  ['H', tr('tenue ⇄ frappe')],
  ['↑ ↓ ← →', tr('déplacer la sélection')],
  [tr('Molette'), tr('défiler')],
  [tr('Ctrl+molette'), tr('zoom')],
  ['1–4', tr('grille')],
  [tr('Espace'), tr('écouter')],
];
const NOTE_H = 14;

type Drag =
  | { kind: 'move'; idx: number[]; origin: { t: number; lane: number }[]; t0: number; lane0: number; moved: boolean }
  | { kind: 'draw'; lane: number; t0: number; t1: number };

export function Editor({ p }: { p: EditorParams }) {
  const { track, difficulty, chart } = p;
  const lanes = chart.params.lanes;
  const back = useNav((s) => s.back);
  const canvas = useRef<HTMLCanvasElement>(null);
  // editing state lives in refs (drawn every frame); `bump` re-renders the toolbar
  const notes = useRef<Note[]>(chart.notes.map((n) => ({ ...n })));
  const sel = useRef<Set<number>>(new Set());
  const undo = useRef<Note[][]>([]);
  const redo = useRef<Note[][]>([]);
  const view = useRef(0);
  const pps = useRef(220);
  const hover = useRef<{ lane: number; t: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const player = useRef<SongPlayer | null>(null);
  const lastTick = useRef(0);
  const [, setV] = useState(0);
  const bump = () => setV((v) => v + 1);
  const [snap, setSnap] = useState<Snap>(chart.params.triplets ? 4 : 2);
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [dirty, setDirty] = useState(false);
  const [edited, setEdited] = useState(false);
  const s = useSettings.getState();
  const isYt = track.source === 'youtube' && !!track.videoId && !p.buffer;
  const offset = (s.audioOffsetMs + (isYt ? s.ytOffsetMs : 0)) / 1000;
  const duration = chart.duration || track.duration || 0;

  // the saved edit, if any
  useEffect(() => {
    void loadEdit(track, difficulty, lanes).then((e) => {
      if (!e) return;
      notes.current = e.notes.map((n) => ({ ...n }));
      setEdited(true);
      bump();
    });
  }, [track, difficulty, lanes]);

  // automated tests read and steer the workshop through this hook
  useEffect(() => {
    const ct = (window as unknown as { __ct?: Record<string, unknown> }).__ct;
    if (!ct) return;
    ct.editor = {
      notes: () => notes.current,
      setView: (t: number) => (view.current = t),
      geometry: () => ({ view: view.current, pps: pps.current, hitY: HIT_Y, lanes }),
    };
    return () => {
      delete ct.editor;
    };
  }, [lanes]);

  // the music
  useEffect(() => {
    const st = useSettings.getState();
    const volume = st.volume.master * st.volume.music;
    let pl: SongPlayer | null = null;
    if (isYt) {
      const host = currentHost();
      if (host) {
        pl = new YouTubePlayer(host, track.videoId!, duration, volume);
        host.place({ kind: 'corner' });
        host.setVolume(volume);
      }
    } else if (p.buffer) pl = new LocalPlayer(p.buffer);
    if (pl) pl.onEnded = () => setPlaying(false);
    player.current = pl;
    return () => {
      pl?.stop();
      pl?.dispose();
      if (isYt) currentHost()?.place({ kind: 'hidden' });
    };
  }, [isYt, p.buffer, track.videoId, duration]);

  // ── time grid ───────────────────────────────────────────────────────────────────────────────
  const beats = chart.beats;
  const period = beats.length > 1 ? (beats[beats.length - 1] - beats[0]) / (beats.length - 1) : 60 / (chart.bpm || 120);
  /** Beat index (fractional) of time t. */
  const beatPos = (t: number): number => {
    if (beats.length < 2) return t / period;
    if (t <= beats[0]) return (t - beats[0]) / (beats[1] - beats[0]);
    const last = beats.length - 1;
    if (t >= beats[last]) return last + (t - beats[last]) / (beats[last] - beats[last - 1]);
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (beats[m] <= t) lo = m;
      else hi = m;
    }
    return lo + (t - beats[lo]) / (beats[lo + 1] - beats[lo]);
  };
  const timeOf = (pos: number): number => {
    if (beats.length < 2) return pos * period;
    const last = beats.length - 1;
    if (pos <= 0) return beats[0] + pos * (beats[1] - beats[0]);
    if (pos >= last) return beats[last] + (pos - last) * (beats[last] - beats[last - 1]);
    const i = Math.floor(pos);
    return beats[i] + (pos - i) * (beats[i + 1] - beats[i]);
  };
  const snapT = (t: number): number => {
    const d = snapRef.current;
    return Math.max(0, timeOf(Math.round(beatPos(t) * d) / d));
  };
  const step = (t: number, dir: number): number => {
    const d = snapRef.current;
    return Math.max(0, timeOf((Math.round(beatPos(t) * d) + dir) / d));
  };

  // ── edits ───────────────────────────────────────────────────────────────────────────────────
  const snapshot = () => {
    undo.current.push(notes.current.map((n) => ({ ...n })));
    if (undo.current.length > 200) undo.current.shift();
    redo.current = [];
    setDirty(true);
  };
  const restore = (from: Note[][], to: Note[][]) => {
    const prev = from.pop();
    if (!prev) return;
    to.push(notes.current);
    notes.current = prev;
    sel.current.clear();
    setDirty(true);
    bump();
  };
  const noteAt = (lane: number, t: number, tolS: number): number => {
    const ns = notes.current;
    for (let i = 0; i < ns.length; i++) {
      const n = ns[i];
      if (n.lane !== lane) continue;
      if (Math.abs(n.t - t) <= tolS || (n.dur > 0 && t >= n.t && t <= n.t + n.dur)) return i;
    }
    return -1;
  };
  const addNote = (lane: number, t: number, dur = 0): number => {
    const n: Note = { t, lane, dur, kind: dur > 0 ? 1 : 0, chord: -1, w: 0.6, cls: -1 };
    notes.current.push(n);
    return notes.current.length - 1;
  };
  const removeSelected = () => {
    if (!sel.current.size) return;
    snapshot();
    notes.current = notes.current.filter((_, i) => !sel.current.has(i));
    sel.current.clear();
    bump();
  };

  // ── drawing ───────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let raf = 0;
    const colors = laneColors(lanes).map((c) => `#${c.getHexString()}`);
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvas.current;
      if (!c) return;
      const pl = player.current;
      if (pl?.playing) {
        const now = pl.timeAt(performance.now()) - offset;
        // a tick on each note crossed, to check the chart by ear
        for (const n of notes.current) if (n.t > lastTick.current && n.t <= now) {
          playHit(0.55);
          break;
        }
        lastTick.current = now;
        view.current = Math.max(0, now);
      }
      const dpr = window.devicePixelRatio || 1;
      const W = c.clientWidth;
      const H = c.clientHeight;
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
        c.width = Math.round(W * dpr);
        c.height = Math.round(H * dpr);
      }
      const g = c.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const lw = Math.min(96, (W - 140) / lanes);
      const x0 = (W - lw * lanes) / 2;
      const yHit = H * HIT_Y;
      const k = pps.current;
      const y = (t: number) => yHit - (t - view.current) * k;
      const tTop = view.current + yHit / k;
      const tBot = view.current - (H - yHit) / k;
      // sections, on the left
      for (const sec of chart.sections) {
        if (sec.end < tBot || sec.start > tTop) continue;
        g.fillStyle = sec.chorus ? 'rgba(255,204,102,0.5)' : `rgba(150,162,255,${0.15 + sec.intensity * 0.35})`;
        g.fillRect(x0 - 26, y(sec.end), 6, y(sec.start) - y(sec.end));
      }
      // lanes
      for (let l = 0; l < lanes; l++) {
        g.fillStyle = l % 2 ? 'rgba(20,24,60,0.55)' : 'rgba(26,30,72,0.55)';
        g.fillRect(x0 + l * lw, 0, lw, H);
      }
      // grid: bars, beats, subdivisions of the snap
      const d = snapRef.current;
      const p0 = Math.floor(beatPos(Math.max(0, tBot)) * d);
      const p1 = Math.ceil(beatPos(tTop) * d);
      g.font = '11px "Space Grotesk", system-ui, sans-serif';
      g.textAlign = 'right';
      for (let q = p0; q <= p1; q++) {
        const pos = q / d;
        const t = timeOf(pos);
        if (t < 0) continue;
        const yy = Math.round(y(t)) + 0.5;
        const onBeat = q % d === 0;
        const bi = Math.round(pos);
        const bar = onBeat && (bi - chart.downbeat) % chart.meter === 0;
        g.strokeStyle = bar ? 'rgba(180,190,255,0.55)' : onBeat ? 'rgba(150,162,255,0.25)' : 'rgba(150,162,255,0.09)';
        g.lineWidth = bar ? 1.5 : 1;
        g.beginPath();
        g.moveTo(x0, yy);
        g.lineTo(x0 + lw * lanes, yy);
        g.stroke();
        if (bar) {
          g.fillStyle = 'rgba(180,190,255,0.6)';
          g.fillText(String(Math.floor((bi - chart.downbeat) / chart.meter) + 1), x0 - 34, yy + 4);
        }
      }
      // time labels on the right
      g.textAlign = 'left';
      g.fillStyle = 'rgba(180,190,255,0.45)';
      for (let t = Math.ceil(Math.max(0, tBot) / 5) * 5; t <= tTop; t += 5) g.fillText(fmtTime(t), x0 + lw * lanes + 14, y(t) + 4);
      // before the start and after the end of the song
      if (tBot < 0) {
        g.fillStyle = 'rgba(3,4,12,0.6)';
        g.fillRect(x0, y(0), lw * lanes, H - y(0));
      }
      if (duration && duration < tTop) {
        g.fillStyle = 'rgba(3,4,12,0.6)';
        g.fillRect(x0, 0, lw * lanes, y(duration));
      }
      // notes
      const ns = notes.current;
      for (let i = 0; i < ns.length; i++) {
        const n = ns[i];
        if (n.t + n.dur < tBot - 0.1 || n.t > tTop + 0.1) continue;
        const xx = x0 + n.lane * lw + 5;
        const ww = lw - 10;
        const col = colors[n.lane] ?? '#a77bff';
        if (n.dur > 0) {
          g.fillStyle = col + '55';
          g.fillRect(xx + ww * 0.3, y(n.t + n.dur), ww * 0.4, y(n.t) - y(n.t + n.dur));
          g.fillStyle = col;
          g.fillRect(xx + ww * 0.25, y(n.t + n.dur) - 3, ww * 0.5, 4);
        }
        g.fillStyle = col;
        roundRect(g, xx, y(n.t) - NOTE_H / 2, ww, NOTE_H, 5);
        g.fill();
        if (n.chord >= 0) {
          g.fillStyle = 'rgba(255,255,255,0.75)';
          g.fillRect(xx + ww / 2 - 6, y(n.t) - 1, 12, 2);
        }
        if (sel.current.has(i)) {
          g.strokeStyle = '#fff';
          g.lineWidth = 2;
          roundRect(g, xx - 2, y(n.t) - NOTE_H / 2 - 2, ww + 4, NOTE_H + 4, 6);
          g.stroke();
        }
      }
      // the long note being drawn, or where a click would put a note
      const dr = drag.current;
      if (dr?.kind === 'draw') {
        const xx = x0 + dr.lane * lw + 5;
        const a = Math.min(dr.t0, dr.t1);
        const b = Math.max(dr.t0, dr.t1);
        g.fillStyle = 'rgba(255,255,255,0.25)';
        g.fillRect(xx, y(b) - NOTE_H / 2, lw - 10, y(a) - y(b) + NOTE_H);
      } else if (hover.current && !dr) {
        const h = hover.current;
        g.strokeStyle = 'rgba(255,255,255,0.35)';
        g.setLineDash([4, 4]);
        roundRect(g, x0 + h.lane * lw + 5, y(h.t) - NOTE_H / 2, lw - 10, NOTE_H, 5);
        g.stroke();
        g.setLineDash([]);
      }
      // the line of the present
      g.strokeStyle = '#4fd6ff';
      g.lineWidth = 2;
      g.shadowColor = '#4fd6ff';
      g.shadowBlur = 10;
      g.beginPath();
      g.moveTo(x0 - 10, yHit);
      g.lineTo(x0 + lw * lanes + 10, yHit);
      g.stroke();
      g.shadowBlur = 0;
      g.fillStyle = '#4fd6ff';
      g.textAlign = 'right';
      g.fillText(fmtTime(view.current) + `.${String(Math.floor((view.current % 1) * 10))}`, x0 - 34, yHit - 6);
    };
    draw();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lanes, chart]);

  // ── pointer ───────────────────────────────────────────────────────────────────────────────
  const where = (e: { clientX: number; clientY: number }) => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    const W = c.clientWidth;
    const H = c.clientHeight;
    const lw = Math.min(96, (W - 140) / lanes);
    const x0 = (W - lw * lanes) / 2;
    const lane = Math.floor((e.clientX - r.left - x0) / lw);
    const t = view.current + (H * HIT_Y - (e.clientY - r.top)) / pps.current;
    return { lane: lane >= 0 && lane < lanes ? lane : -1, t };
  };
  const stopPlay = () => {
    if (!player.current?.playing) return;
    player.current.pause();
    setPlaying(false);
  };

  const onDown = (e: React.PointerEvent) => {
    const w = where(e);
    if (w.lane < 0 || w.t < 0) return;
    stopPlay();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const tol = 9 / pps.current;
    const hit = noteAt(w.lane, w.t, tol);
    if (e.button === 2) {
      if (hit >= 0) {
        snapshot();
        notes.current.splice(hit, 1);
        sel.current.clear();
        bump();
      }
      return;
    }
    if (hit >= 0) {
      if (e.shiftKey) {
        if (sel.current.has(hit)) sel.current.delete(hit);
        else sel.current.add(hit);
      } else if (!sel.current.has(hit)) sel.current = new Set([hit]);
      const idx = [...sel.current];
      drag.current = { kind: 'move', idx, origin: idx.map((i) => ({ t: notes.current[i].t, lane: notes.current[i].lane })), t0: w.t, lane0: w.lane, moved: false };
      bump();
      return;
    }
    const t = snapT(w.t);
    drag.current = { kind: 'draw', lane: w.lane, t0: t, t1: t };
  };
  const onMove = (e: React.PointerEvent) => {
    const w = where(e);
    const dr = drag.current;
    if (!dr) {
      hover.current = w.lane >= 0 && w.t >= 0 && noteAt(w.lane, w.t, 9 / pps.current) < 0 ? { lane: w.lane, t: snapT(w.t) } : null;
      return;
    }
    if (dr.kind === 'draw') {
      dr.t1 = snapT(Math.max(dr.t0, w.t));
      return;
    }
    const dLane = w.lane >= 0 ? w.lane - dr.lane0 : 0;
    const anchor = dr.origin[0];
    const dt = snapT(anchor.t + (w.t - dr.t0)) - anchor.t;
    if (!dr.moved && Math.abs(dt) < 1e-4 && dLane === 0) return;
    if (!dr.moved) {
      snapshot();
      dr.moved = true;
    }
    dr.idx.forEach((i, k) => {
      const o = dr.origin[k];
      const n = notes.current[i];
      n.t = Math.max(0, o.t + dt);
      n.lane = Math.max(0, Math.min(lanes - 1, o.lane + dLane));
    });
  };
  const onUp = () => {
    const dr = drag.current;
    drag.current = null;
    if (!dr) return;
    if (dr.kind === 'draw') {
      const len = dr.t1 - dr.t0;
      snapshot();
      const i = addNote(dr.lane, dr.t0, len >= period / snapRef.current - 1e-3 ? len : 0);
      sel.current = new Set([i]);
      playHit(0.5);
      bump();
    } else if (dr.moved) {
      notes.current = normalizeKeepSel(notes.current, sel);
      bump();
    }
  };
  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey) {
      pps.current = Math.max(60, Math.min(900, pps.current * Math.exp(-e.deltaY * 0.0015)));
      return;
    }
    stopPlay();
    view.current = Math.max(0, Math.min(duration || Infinity, view.current - (e.deltaY / pps.current) * 0.8));
  };

  // ── transport and keys ──────────────────────────────────────────────────────────────────────
  const togglePlay = () => {
    const pl = player.current;
    if (!pl) return toast({ kind: 'error', title: tr('Lecture indisponible'), text: tr('Revenez à la page du morceau pour charger la musique.') });
    if (pl.playing) {
      pl.pause();
      setPlaying(false);
      return;
    }
    lastTick.current = view.current;
    pl.setRate(rate);
    pl.play(Math.max(0, view.current + offset), 0);
    setPlaying(true);
  };

  const save = async (quiet = false) => {
    try {
      const e = await saveEdit(track, difficulty, lanes, notes.current);
      notes.current = e.notes.map((n) => ({ ...n }));
      sel.current.clear();
      setDirty(false);
      setEdited(true);
      if (!quiet) toast({ kind: 'info', title: tr('Partition enregistrée'), text: `${DIFF_LABEL[difficulty]} · ${e.notes.length} notes` });
      bump();
      return e;
    } catch (err) {
      toastError(err, tr('Enregistrement impossible'));
      return null;
    }
  };
  const restoreGenerated = async () => {
    if (!window.confirm(tr('Revenir à la partition générée ? Les modifications seront perdues.'))) return;
    snapshot();
    await removeEdit(track, difficulty, lanes);
    notes.current = chart.notes.map((n) => ({ ...n }));
    sel.current.clear();
    setEdited(false);
    setDirty(false);
    bump();
  };
  const test = async () => {
    const e = await save(true);
    if (!e) return;
    stopPlay();
    const from = Math.max(0, view.current - 2);
    playSfx('go', 0.7);
    go({ id: 'game', game: { track, chart: withEdit(chart, e), buffer: p.buffer, practice: { from, to: duration, loop: false, rate: 1 } } });
  };
  const leave = () => {
    if (dirty && !window.confirm(tr('Quitter sans enregistrer les modifications ?'))) return;
    back();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (ctrl && e.code === 'KeyZ' && !e.shiftKey) {
        e.preventDefault();
        restore(undo.current, redo.current);
      } else if (ctrl && (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey))) {
        e.preventDefault();
        restore(redo.current, undo.current);
      } else if (ctrl && e.code === 'KeyS') {
        e.preventDefault();
        void save();
      } else if (e.code === 'Delete' || e.code === 'Backspace') {
        removeSelected();
      } else if (e.code === 'KeyH' && sel.current.size) {
        // tap ⇄ long note (one beat)
        snapshot();
        for (const i of sel.current) {
          const n = notes.current[i];
          n.dur = n.dur > 0 ? 0 : period;
          n.kind = n.dur > 0 ? 1 : 0;
        }
        bump();
      } else if ((e.code === 'ArrowUp' || e.code === 'ArrowDown') && sel.current.size) {
        e.preventDefault();
        snapshot();
        for (const i of sel.current) notes.current[i].t = step(notes.current[i].t, e.code === 'ArrowUp' ? 1 : -1);
        notes.current = normalizeKeepSel(notes.current, sel);
        bump();
      } else if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && sel.current.size) {
        e.preventDefault();
        snapshot();
        for (const i of sel.current) notes.current[i].lane = Math.max(0, Math.min(lanes - 1, notes.current[i].lane + (e.code === 'ArrowRight' ? 1 : -1)));
        notes.current = normalizeKeepSel(notes.current, sel);
        bump();
      } else if (e.code === 'ArrowUp' || e.code === 'PageUp') {
        e.preventDefault();
        stopPlay();
        view.current = step(view.current, e.code === 'PageUp' ? snapRef.current * chart.meter : 1);
      } else if (e.code === 'ArrowDown' || e.code === 'PageDown') {
        e.preventDefault();
        stopPlay();
        view.current = step(view.current, e.code === 'PageDown' ? -snapRef.current * chart.meter : -1);
      } else if (e.code === 'Home') {
        stopPlay();
        view.current = 0;
      } else if (/^Digit[1-4]$/.test(e.code)) {
        setSnap(Number(e.code.slice(5)) as Snap);
      } else if (e.code === 'KeyA' && ctrl) {
        e.preventDefault();
        sel.current = new Set(notes.current.map((_, i) => i));
        bump();
      } else if (e.code === 'Escape') {
        if (sel.current.size) {
          sel.current.clear();
          bump();
        } else leave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const stats = chartStats(notes.current, duration, difficulty);

  return (
    <div className="page-enter editor">
      <div className="editor-bar panel">
        <button className="btn small ghost" onClick={leave}>
          <ArrowLeft size={15} /> {tr('Retour')}
        </button>
        <div className="editor-title">
          <b>{track.title}</b>
          <small>
            <span style={{ color: DIFF_COLOR[difficulty] }}>{DIFF_LABEL[difficulty]}</span> · {tr('{l} pistes · {n} notes · {nps} n/s · niveau {lv}', { l: lanes, n: stats.notes, nps: fmtNum(stats.nps, 1), lv: stats.level })}
            {edited ? tr(' · modifiée') : tr(' · générée')}
            {dirty ? tr(' · non enregistrée') : ''}
          </small>
        </div>
        <span className="grow" />
        <Seg value={snap} options={SNAPS} onChange={setSnap} />
        <Seg
          value={rate}
          options={[
            { v: 0.5, label: `×${fmtNum(0.5)}` },
            { v: 0.75, label: `×${fmtNum(0.75)}` },
            { v: 1, label: '×1' },
          ]}
          onChange={(r) => {
            setRate(r);
            player.current?.setRate(r);
          }}
        />
        <button className="btn small icon" aria-label={tr('Annuler')} title={tr('Annuler (Ctrl+Z)')} disabled={!undo.current.length} onClick={() => restore(undo.current, redo.current)}>
          <Undo2 size={15} />
        </button>
        <button className="btn small icon" aria-label={tr('Rétablir')} title={tr('Rétablir (Ctrl+Y)')} disabled={!redo.current.length} onClick={() => restore(redo.current, undo.current)}>
          <Redo2 size={15} />
        </button>
        <button className="btn small cyan" onClick={togglePlay} title={tr('Lecture / pause (Espace)')}>
          {playing ? <Pause size={15} /> : <Play size={15} />} {playing ? tr('Pause') : tr('Écouter')}
        </button>
        <button className="btn small" onClick={() => void test()} title={tr('Jouer la partition à partir d’ici')}>
          <FlaskConical size={15} /> {tr('Tester')}
        </button>
        <button className="btn small primary" disabled={!dirty} onClick={() => void save()} title={tr('Enregistrer (Ctrl+S)')}>
          <Save size={15} /> {tr('Enregistrer')}
        </button>
        {edited && (
          <button className="btn small ghost icon" aria-label={tr('Revenir à la partition générée')} title={tr('Revenir à la partition générée')} onClick={() => void restoreGenerated()}>
            <RotateCcw size={15} />
          </button>
        )}
      </div>
      <div className="editor-stage panel">
        <canvas
          ref={canvas}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={() => (hover.current = null)}
          onWheel={onWheel}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>
      <div className="editor-help">
        {HELP.map(([k, what]) => (
          <span key={k}>
            <b>{k}</b> {what}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Normalizes the notes and keeps the selection on the same notes. */
function normalizeKeepSel(ns: Note[], sel: React.MutableRefObject<Set<number>>): Note[] {
  const tagged = ns.map((n, i) => ({ ...n, __sel: sel.current.has(i) }) as Note & { __sel: boolean });
  const sorted = normalizeNotes(tagged) as (Note & { __sel: boolean })[];
  const next = new Set<number>();
  const out = sorted.map((n, i) => {
    if (n.__sel) next.add(i);
    const { __sel: _drop, ...rest } = n;
    return rest as Note;
  });
  sel.current = next;
  return out;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
