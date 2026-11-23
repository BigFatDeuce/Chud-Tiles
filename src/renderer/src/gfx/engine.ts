import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Cosmos } from './cosmos';
import { Playfield } from './playfield';

// One renderer for the whole application: the universe, then the playfield over it (depth
// cleared), bloom, output. A single requestAnimationFrame loop drives rendering and the game
// session (which registers a hook that runs before each image).

export type Quality = 'high' | 'medium' | 'low';

export interface FrameInfo {
  /** requestAnimationFrame time stamp (ms, performance.now timebase). */
  now: number;
  /** Seconds since the previous image. */
  dt: number;
  /** Seconds since start (animations). */
  time: number;
}

type Hook = (f: FrameInfo) => void;

const QUALITY: Record<Quality, { dpr: number; nebula: number; bloom: boolean; bloomScale: number; antialias: boolean }> = {
  high: { dpr: 2, nebula: 0.45, bloom: true, bloomScale: 0.5, antialias: true },
  medium: { dpr: 1.5, nebula: 0.33, bloom: true, bloomScale: 0.4, antialias: true },
  low: { dpr: 1, nebula: 0.25, bloom: false, bloomScale: 0.33, antialias: false },
};

export class Engine {
  renderer: THREE.WebGLRenderer | null = null;
  readonly cosmos = new Cosmos();
  readonly playfield = new Playfield();
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private playPass: RenderPass | null = null;
  private readonly hooks = new Set<Hook>();
  private quality: Quality = 'high';
  private raf = 0;
  private last = 0;
  private start = 0;
  private lastDrawn = 0;
  /** 0 = follow the display; otherwise images per second. */
  fpsCap = 0;
  /** Menus may render at 30 i/s to save power (the game always runs at full rate). */
  idleFps = 0;
  inGame = false;
  /** The window is minimised or hidden: nothing is drawn (a run keeps its clock, a few times a second). */
  hidden = false;
  private lastHook = 0;
  /** Rolling statistics for the FPS counter and adaptive quality. */
  readonly stats = { fps: 0, frameMs: 0, worstMs: 0, frames: 0 };
  private statT = 0;
  private statN = 0;
  private statWorst = 0;
  private w = 1;
  private h = 1;
  private dpr = 1;
  lost = false;

  mount(canvas: HTMLCanvasElement, quality: Quality): void {
    this.quality = quality;
    const q = QUALITY[quality];
    const r = new THREE.WebGLRenderer({ canvas, antialias: q.antialias, alpha: false, powerPreference: 'high-performance', stencil: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.setClearColor(0x02030a, 1);
    this.renderer = r;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
    });
    this.buildComposer();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.start = performance.now();
    this.last = this.start;
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private buildComposer(): void {
    const r = this.renderer;
    if (!r) return;
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
    const q = QUALITY[this.quality];
    this.cosmos.nebula.scale = q.nebula;
    if (!q.bloom) return;
    const c = new EffectComposer(r);
    c.addPass(new RenderPass(this.cosmos.scene, this.cosmos.camera));
    const play = new RenderPass(this.playfield.scene, this.playfield.camera);
    play.clear = false;
    play.clearDepth = true;
    this.playPass = play;
    c.addPass(play);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.55, 0.62);
    c.addPass(this.bloom);
    c.addPass(new OutputPass());
    this.composer = c;
  }

  setQuality(q: Quality): void {
    if (q === this.quality || !this.renderer) return;
    this.quality = q;
    this.buildComposer();
    this.resize();
  }

  get currentQuality(): Quality {
    return this.quality;
  }

  resize(): void {
    const r = this.renderer;
    if (!r) return;
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, QUALITY[this.quality].dpr);
    r.setPixelRatio(this.dpr);
    r.setSize(this.w, this.h, false);
    this.cosmos.resize(this.w, this.h, this.dpr);
    this.playfield.resize(this.w, this.h);
    if (this.composer) {
      this.composer.setPixelRatio(this.dpr);
      this.composer.setSize(this.w, this.h);
      const s = QUALITY[this.quality].bloomScale;
      this.bloom?.resolution.set(this.w * this.dpr * s, this.h * this.dpr * s);
    }
  }

  /** Runs before each image (the game session: clock, judgement, effects). */
  onFrame(h: Hook): () => void {
    this.hooks.add(h);
    return () => this.hooks.delete(h);
  }

  /** Draws one image now, outside requestAnimationFrame (tests drive a background page this way). */
  step(): void {
    this.frame(performance.now());
  }

  private frame(now: number): void {
    const r = this.renderer;
    if (!r || this.lost) return;
    if (this.hidden) {
      // no image; the session's hooks still run (pause, misses) about ten times a second
      if (now - this.lastHook < 100) return;
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = this.lastHook = now;
      this.playfield.driven = false;
      for (const h of this.hooks) h({ now, dt, time: (now - this.start) / 1000 });
      return;
    }
    // frame-rate cap (game setting) and power-saving rate in idle menus
    const menu = this.idleFps && !this.cosmos.flying ? this.idleFps : 0;
    const cap = this.inGame || !menu ? this.fpsCap : this.fpsCap ? Math.min(this.fpsCap, menu) : menu;
    if (cap > 0 && now - this.lastDrawn < 1000 / cap - 1.5) return;
    this.lastDrawn = now;
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const time = (now - this.start) / 1000;
    const f: FrameInfo = { now, dt, time };
    this.playfield.driven = false;
    for (const h of this.hooks) h(f);
    if (!this.playfield.driven && this.playfield.visible) this.playfield.idle(dt);
    this.cosmos.update(time, dt);
    this.cosmos.renderNebula(r);
    const showPlay = this.playfield.visible;
    if (this.composer) {
      if (this.playPass) this.playPass.enabled = showPlay;
      if (this.bloom) this.bloom.strength = this.inGame ? 0.75 : 0.6;
      this.composer.render(dt);
    } else {
      r.autoClear = false;
      r.clear();
      r.render(this.cosmos.scene, this.cosmos.camera);
      if (showPlay) {
        r.clearDepth();
        r.render(this.playfield.scene, this.playfield.camera);
      }
    }
    // statistics over half-second windows
    const ms = dt * 1000;
    this.statN++;
    this.statWorst = Math.max(this.statWorst, ms);
    if (now - this.statT > 500) {
      this.stats.fps = (this.statN * 1000) / (now - this.statT);
      this.stats.frameMs = (now - this.statT) / this.statN;
      this.stats.worstMs = this.statWorst;
      this.stats.frames += this.statN;
      this.statT = now;
      this.statN = 0;
      this.statWorst = 0;
    }
  }

  get size(): { w: number; h: number; dpr: number } {
    return { w: this.w, h: this.h, dpr: this.dpr };
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.composer?.dispose();
    this.renderer?.dispose();
  }
}

export const engine = new Engine();
