import * as THREE from 'three';
import type { Chart, Note } from '@core/chart/types';
import { Judge, accuracyOf, fullCombo, rankOf, starsOf, type JudgeEvent, type ScoreState } from '@core/game/judge';
import type { PlayRecord } from '@core/game/progress';
import type { TrackRef } from '@shared/types';
import type { SongPlayer } from '../audio/player';
import { musicLevels } from '../audio/context';
import { engine, type FrameInfo } from '../gfx/engine';
import { NOTE_BROKEN, NOTE_DONE, NOTE_GHOST, NOTE_HOLDING, NOTE_MISSED } from '../gfx/playfield';
import { InputRouter, type LaneInput } from './input';
import { playHit } from '../audio/sfx';
import type { LiveFeed } from './live';

// A run: the chart, the player's clock, the judge, the playfield and the HUD tied together.
// Times: song time = player clock − audio offset. Presses are judged at their own time stamps;
// the image shows the song time at which it will reach the screen.

export type SessionState = 'intro' | 'countdown' | 'playing' | 'paused' | 'failed' | 'ended';

export interface SessionConfig {
  chart: Chart;
  player: SongPlayer;
  track: TrackRef;
  lanes: number;
  keys: string[][];
  pad: number[][];
  audioOffsetMs: number;
  visualOffsetMs: number;
  approach: number;
  tilt: number;
  fail: boolean;
  hitSounds: boolean;
  /** Practice: play only this range, possibly looping, never recorded as a record. */
  practice?: { from: number; to: number; loop: boolean; rate: number } | null;
  /** Live notes: was the predicted note real? */
  confirm?: (t: number) => boolean;
  /** The game plays itself (chart preview, tests). Never recorded. */
  autoplay?: boolean;
  /** Mode A: notes predicted while the song plays (the chart starts empty). */
  live?: LiveFeed | null;
  /** Levels of the music when it is not played through the game's audio graph (YouTube). */
  levels?: () => { energy: number; bass: number };
}

/** The run in progress (tests, debug tools). */
export let currentSession: GameSession | null = null;

export type HudEvent =
  | { type: 'judge'; e: JudgeEvent; s: ScoreState }
  | { type: 'milestone'; combo: number }
  | { type: 'state'; state: SessionState }
  | { type: 'countdown'; n: number }
  | { type: 'reset'; s: ScoreState }
  | { type: 'end'; record: PlayRecord; offsets: number[] };

const MILESTONES = [50, 100, 200, 300, 400, 500, 750, 1000, 1500, 2000];
const LEAD_IN = 2.6;

export class GameSession {
  readonly cfg: SessionConfig;
  judge: Judge;
  state: SessionState = 'intro';
  private readonly input = new InputRouter();
  private readonly listeners = new Set<(e: HudEvent) => void>();
  private unhook: (() => void) | null = null;
  private beatIdx = 0;
  private beat = 0;
  private energy = 0.3;
  private bass = 0;
  private minEnergy = 100;
  private countdownEnd = 0;
  private lastCount = -1;
  private failedAt = 0;
  private lastT = -10;
  private endAt: number;
  private readonly milestonesDone = new Set<number>();
  /** Lanes currently holding a long note → their note index. */
  private readonly holdNote = new Map<number, number>();
  private holdSparkT = 0;
  private startedAt = 0;
  private autoIdx = 0;
  private readonly autoRelease: { lane: number; at: number }[] = [];

  constructor(cfg: SessionConfig) {
    this.cfg = cfg;
    if (cfg.live) cfg.confirm = (t) => cfg.live!.confirm(t);
    this.judge = this.newJudge();
    const last = cfg.chart.notes.reduce((m, n) => Math.max(m, n.t + n.dur), 0);
    this.endAt = Math.min(cfg.player.duration, Math.max(last + 1.5, cfg.practice ? cfg.practice.to : 0));
  }

  /** Live mode: the song ends with the music (its duration may only be known once it plays). */
  private get end(): number {
    if (!this.cfg.live) return this.endAt;
    const d = this.cfg.player.duration;
    return d > 1 ? d - 0.25 : Infinity;
  }

  private liveBeats: number[] = [];
  private liveBeatsAt = -10;

  private newJudge(): Judge {
    const notes = this.notesInRange();
    return new Judge(notes, this.cfg.lanes, { windowScale: this.cfg.chart.params.windowScale, fail: this.cfg.fail && !this.cfg.practice, confirm: this.cfg.confirm });
  }

  private notesInRange(): Note[] {
    const p = this.cfg.practice;
    return p ? this.cfg.chart.notes.filter((n) => n.t >= p.from - 0.01 && n.t <= p.to) : this.cfg.chart.notes;
  }

  on(cb: (e: HudEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(e: HudEvent): void {
    for (const l of this.listeners) l(e);
  }

  private setState(s: SessionState): void {
    this.state = s;
    engine.inGame = s === 'playing' || s === 'countdown' || s === 'intro';
    this.emit({ type: 'state', state: s });
  }

  /** Song time heard at performance instant `perf`. */
  songTime(perf: number): number {
    return this.cfg.player.timeAt(perf) - this.cfg.audioOffsetMs / 1000;
  }

  start(surface: HTMLElement): void {
    const pf = engine.playfield;
    const c = this.cfg.chart;
    pf.setup({ lanes: this.cfg.lanes, approach: this.cfg.approach * (this.cfg.practice?.rate ?? 1), tilt: this.cfg.tilt, notes: this.judge.notes, beats: c.beats, downbeat: c.downbeat, meter: c.meter });
    pf.setIntro(true);
    this.input.configure({ lanes: this.cfg.lanes, keys: this.cfg.keys, pad: this.cfg.pad });
    this.input.laneAt = (x, y) => pf.laneAt(x, y);
    this.input.onLane = (e) => this.onLane(e);
    this.input.onAction = (a) => {
      if (a === 'pause') this.togglePause();
      if (a === 'restart' && (this.state === 'paused' || this.state === 'playing')) this.restart();
    };
    this.input.attach(surface);
    currentSession = this;
    this.unhook = engine.onFrame((f) => this.frame(f));
    // the end of the file ends the run, whatever the offsets say
    this.cfg.player.onEnded = () => {
      if (this.state !== 'playing') return;
      this.handle(this.judge.update(1e9));
      this.finish();
    };
    this.begin();
  }

  private begin(): void {
    const first = this.judge.notes[0]?.t ?? 0;
    const p = this.cfg.practice;
    const from = p ? Math.max(0, p.from - 2) : 0;
    // enough lead-in for the first note to travel the whole track
    const lead = Math.max(LEAD_IN, this.cfg.approach + 1 - (first - from));
    if (p) this.cfg.player.setRate(p.rate);
    this.cfg.player.play(from - lead);
    this.startedAt = performance.now();
    this.beatIdx = 0;
    this.autoIdx = 0;
    this.autoRelease.length = 0;
    this.setState('playing');
  }

  private onLane(e: LaneInput): void {
    const pf = engine.playfield;
    pf.pressLane(e.lane, e.down);
    if (this.state !== 'playing') return;
    const t = this.songTime(e.at);
    if (e.down) {
      this.handle(this.judge.update(t));
      const ev = this.judge.press(e.lane, t);
      if (ev) this.handle([ev]);
    } else {
      const ev = this.judge.release(e.lane, t);
      if (ev) this.handle([ev]);
    }
  }

  private handle(events: JudgeEvent[]): void {
    if (!events.length) return;
    const pf = engine.playfield;
    for (const e of events) {
      switch (e.kind) {
        case 'hit': {
          const n = this.judge.notes[e.note];
          const held = n.dur > 0;
          pf.setState(e.note, held ? NOTE_HOLDING : NOTE_DONE, e.t);
          pf.hit(e.lane, e.judgement as 'perfect' | 'great' | 'good', n.chord >= 0);
          if (held) {
            this.holdNote.set(e.lane, e.note);
            pf.setHolding(e.lane, true);
          }
          if (this.cfg.hitSounds) playHit(e.judgement === 'perfect' ? 1 : 0.7);
          break;
        }
        case 'hold-ok':
          pf.setState(e.note, NOTE_DONE, e.t);
          pf.hit(e.lane, 'great');
          this.holdNote.delete(e.lane);
          pf.setHolding(e.lane, false);
          break;
        case 'hold-break':
          pf.setState(e.note, NOTE_BROKEN, e.t);
          this.holdNote.delete(e.lane);
          pf.setHolding(e.lane, false);
          break;
        case 'miss':
          pf.setState(e.note, NOTE_MISSED, e.t);
          pf.miss(e.lane);
          break;
        case 'ghost':
          pf.setState(e.note, NOTE_GHOST, e.t);
          break;
        case 'stray':
          break;
      }
      this.emit({ type: 'judge', e, s: this.judge.state });
    }
    const s = this.judge.state;
    this.minEnergy = Math.min(this.minEnergy, s.energy);
    for (const m of MILESTONES) {
      if (s.combo >= m && !this.milestonesDone.has(m)) {
        this.milestonesDone.add(m);
        this.emit({ type: 'milestone', combo: m });
        const big = m >= 500;
        engine.cosmos.milestone(big ? 1.3 : 0.8, big ? new THREE.Color(1, 0.75, 0.4) : new THREE.Color(0.6, 0.75, 1));
      }
    }
    if (s.combo === 0) this.milestonesDone.clear();
  }

  private frame(f: FrameInfo): void {
    this.input.pollPads();
    const pf = engine.playfield;
    const now = performance.now();
    const t = this.songTime(now);
    // the image will be seen about one frame later
    const tView = this.songTime(f.now + engine.stats.frameMs + this.cfg.visualOffsetMs);
    if (this.state === 'playing' && this.cfg.autoplay) this.autoplay(t);
    if (this.state === 'playing') {
      // misses are decided 50 ms late: a press may still arrive with an earlier time stamp
      this.handle(this.judge.update(t - 0.05));
      if (this.judge.state.failed && this.state === 'playing') this.fail(now);
      const p = this.cfg.practice;
      if (p && t > p.to + 0.6) {
        if (p.loop) this.restart();
        else this.finish();
      } else if (t > this.end && this.judge.done()) this.finish();
      if (this.cfg.live) this.addLiveNotes(this.cfg.live.advance(t));
    }
    if (this.cfg.live && Math.abs(t - this.liveBeatsAt) > 0.5) {
      // beat lines follow the tempo found so far
      this.liveBeatsAt = t;
      this.liveBeats = this.cfg.live.beatsBetween(t - 1, t + this.cfg.approach * 2 + 2);
      engine.playfield.setBeats(this.liveBeats, 0, 4);
      this.beatIdx = 0;
    }
    if (this.state === 'countdown') {
      const left = Math.ceil((this.countdownEnd - now) / 1000);
      if (left !== this.lastCount && left > 0) {
        this.lastCount = left;
        this.emit({ type: 'countdown', n: left });
      }
      if (now >= this.countdownEnd) {
        this.emit({ type: 'countdown', n: 0 });
        this.setState('playing');
      }
    }
    if (this.state === 'failed' && now - this.failedAt > 2200) this.finish(true);
    // music → universe and track: levels of what is heard, pulse on each beat
    const lv = this.cfg.levels ? this.cfg.levels() : musicLevels();
    this.energy += (lv.energy - this.energy) * Math.min(1, f.dt * 6);
    this.bass += (lv.bass - this.bass) * Math.min(1, f.dt * 12);
    const beats = this.cfg.live ? this.liveBeats : this.cfg.chart.beats;
    if (t < this.lastT - 0.5) this.beatIdx = 0;
    this.lastT = t;
    while (this.beatIdx < beats.length && beats[this.beatIdx] <= tView) {
      const down = this.cfg.live ? false : (this.beatIdx - this.cfg.chart.downbeat) % this.cfg.chart.meter === 0;
      if (tView - beats[this.beatIdx] < 0.15) this.beat = down ? 1 : 0.6;
      this.beatIdx++;
    }
    this.beat *= Math.exp(-f.dt * 6);
    const r = engine.cosmos.react;
    r.energy = this.energy;
    r.bass = this.bass;
    r.beat = this.beat;
    // sparks rise from held long notes
    this.holdSparkT += f.dt;
    if (this.holdSparkT > 0.03) {
      this.holdSparkT = 0;
      for (const lane of this.holdNote.keys()) pf.holdSparks(lane);
    }
    const danger = this.cfg.fail && !this.cfg.practice ? Math.max(0, (30 - this.judge.state.energy) / 30) : 0;
    pf.update(tView, f.dt, { beat: this.beat, energy: this.energy, danger });
  }

  /**
   * Presses every note exactly on time (and releases long notes at their end). Presses and
   * releases are replayed in time order, so a long frame (hidden window, hitch) cannot release a
   * lane before a press that came earlier.
   */
  private autoplay(t: number): void {
    const notes = this.judge.notes;
    const pf = engine.playfield;
    const rel = this.autoRelease;
    for (;;) {
      let ri = -1;
      for (let k = 0; k < rel.length; k++) if (rel[k].at <= t && (ri < 0 || rel[k].at < rel[ri].at)) ri = k;
      const n = this.autoIdx < notes.length && notes[this.autoIdx].t <= t ? notes[this.autoIdx] : null;
      if (ri >= 0 && (!n || rel[ri].at <= n.t)) {
        const r = rel.splice(ri, 1)[0];
        pf.pressLane(r.lane, false);
        const ev = this.judge.release(r.lane, r.at);
        if (ev) this.handle([ev]);
        continue;
      }
      if (!n) break;
      this.autoIdx++;
      this.handle(this.judge.update(n.t));
      pf.pressLane(n.lane, true);
      const ev = this.judge.press(n.lane, n.t);
      if (ev) this.handle([ev]);
      rel.push({ lane: n.lane, at: n.t + (n.dur > 0 ? n.dur : 0.05) });
    }
  }

  private fail(now: number): void {
    this.failedAt = now;
    this.setState('failed');
    const p = this.cfg.player as SongPlayer & { windDown?: (s: number) => void };
    p.windDown?.(1.8);
    engine.cosmos.milestone(0.6, new THREE.Color(0.9, 0.2, 0.35));
  }

  togglePause(): void {
    if (this.state === 'playing') this.pause();
    else if (this.state === 'paused') this.resume();
  }

  pause(): void {
    if (this.state !== 'playing' && this.state !== 'countdown') return;
    this.cfg.player.pause();
    this.input.releaseAll(performance.now());
    for (const lane of [...this.holdNote.keys()]) engine.playfield.setHolding(lane, false);
    this.setState('paused');
  }

  /** Resumes after a 3-second countdown (the notes wait; the music starts exactly where it stopped). */
  resume(): void {
    if (this.state !== 'paused') return;
    this.countdownEnd = performance.now() + 3000;
    this.lastCount = -1;
    this.cfg.player.resume(3);
    this.setState('countdown');
  }

  restart(): void {
    this.cfg.player.pause();
    this.cfg.live?.reset();
    this.liveBeats = [];
    this.liveBeatsAt = -10;
    this.judge = this.newJudge();
    this.holdNote.clear();
    this.milestonesDone.clear();
    this.minEnergy = 100;
    const c = this.cfg.chart;
    engine.playfield.setup({ lanes: this.cfg.lanes, approach: this.cfg.approach * (this.cfg.practice?.rate ?? 1), tilt: this.cfg.tilt, notes: this.judge.notes, beats: c.beats, downbeat: c.downbeat, meter: c.meter });
    engine.playfield.setIntro(true, true);
    this.begin();
    this.emit({ type: 'reset', s: this.judge.state });
  }

  /** Live mode: notes predicted while the song plays. */
  addLiveNotes(notes: Note[]): void {
    if (!notes.length) return;
    this.judge.addNotes(notes);
    engine.playfield.addNotes(notes);
  }

  private finish(failed = false): void {
    if (this.state === 'ended') return;
    const s = this.judge.state;
    const p = this.cfg.practice;
    const cleared = !failed && !s.failed;
    const offs = s.offsets;
    const mean = offs.length ? (offs.reduce((a, b) => a + b, 0) / offs.length) * 1000 : 0;
    const t = this.songTime(performance.now());
    const record: PlayRecord = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      trackKey: this.cfg.track.key,
      title: this.cfg.track.title,
      artist: this.cfg.track.artist,
      source: this.cfg.track.source,
      difficulty: this.cfg.chart.difficulty,
      chartSource: this.cfg.chart.source,
      chartLevel: this.cfg.chart.stats.level,
      lanes: this.cfg.lanes,
      score: s.score,
      accuracy: accuracyOf(s),
      maxCombo: s.maxCombo,
      perfect: s.perfect,
      great: s.great,
      good: s.good,
      miss: s.miss,
      holdOk: s.holdOk,
      holdBreak: s.holdBreak,
      ghosts: s.ghosts,
      stray: s.stray,
      rank: rankOf(s),
      stars: starsOf(s, cleared),
      fullCombo: cleared && fullCombo(s),
      cleared,
      failed: !cleared,
      minEnergy: this.minEnergy,
      played: Math.max(0, Math.min(t, this.cfg.player.duration)),
      songDuration: this.cfg.player.duration,
      playedAt: Date.now(),
      meanOffsetMs: Math.round(mean * 10) / 10,
      practice: !!p || !!this.cfg.autoplay,
      autoplay: !!this.cfg.autoplay,
      rate: p?.rate ?? 1,
    };
    this.cfg.player.pause();
    this.setState('ended');
    engine.playfield.setIntro(false);
    this.emit({ type: 'end', record, offsets: offs.slice() });
  }

  /** Leaves the run (quit or after results). */
  dispose(): void {
    this.unhook?.();
    this.unhook = null;
    if (currentSession === this) currentSession = null;
    this.input.detach();
    this.cfg.player.stop();
    engine.playfield.setIntro(false);
    engine.inGame = false;
    const r = engine.cosmos.react;
    r.beat = 0;
    r.bass = 0;
    r.energy = 0.25;
  }

  get elapsed(): number {
    return (performance.now() - this.startedAt) / 1000;
  }

  /** Song progress 0–1 (HUD). */
  progress(): number {
    const t = this.songTime(performance.now());
    const p = this.cfg.practice;
    if (p) return Math.max(0, Math.min(1, (t - p.from) / (p.to - p.from)));
    return Math.max(0, Math.min(1, t / this.cfg.player.duration));
  }
}
