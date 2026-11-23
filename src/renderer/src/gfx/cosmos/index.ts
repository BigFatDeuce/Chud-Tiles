import * as THREE from 'three';
import { Nebula } from './nebula';
import { Stars } from './stars';
import { Planet, PLANET_R } from './planet';
import { Galaxy } from './galaxy';
import { Streaks } from './streaks';
import { Asteroids } from './asteroids';

// The universe behind every screen. Each page is a place in it; changing page is a flight between
// places (a curved path around the planet, field of view and warp lines swelling mid-way). The
// sky keeps living on its own (drift, twinkle, constellations, shooting stars, comets) and, in a
// game, follows the music.

export type PlaceId = 'home' | 'library' | 'search' | 'playlists' | 'settings' | 'stats' | 'song' | 'game' | 'results' | 'calibration';

interface Place {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
  /** Nebula colour shift. */
  hue: number;
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
export const SUN_DIR = v3(-0.9, 0.3, 0.25).normalize();
const GALAXY_POS = v3(0.587, 0.342, -0.733).multiplyScalar(1500);

const PLACES: Record<PlaceId, Place> = {
  home: { pos: v3(-78, 22, 150), target: v3(-26, -2, 0), fov: 44, hue: 0 },
  song: { pos: v3(-120, 40, 150), target: v3(-110, 55, 0), fov: 44, hue: 0.15 },
  library: { pos: v3(150, 70, 120), target: v3(420, 230, -360), fov: 50, hue: 0.4 },
  playlists: { pos: v3(170, 40, 40), target: v3(430, 160, -420), fov: 48, hue: 0.55 },
  search: { pos: v3(150, -40, 130), target: v3(-36, 23, 91), fov: 42, hue: -0.2 },
  settings: { pos: v3(90, 140, 120), target: v3(-27, -21, 101), fov: 46, hue: -0.35 },
  calibration: { pos: v3(60, 120, 150), target: v3(-106, 35, 79), fov: 46, hue: -0.35 },
  stats: { pos: v3(-190, 44, -130), target: v3(-119, 72, 55), fov: 44, hue: 0.3 },
  game: { pos: v3(-250, 74, 470), target: v3(-196, 58, 0), fov: 50, hue: 0 },
  results: { pos: v3(275, -86, -74), target: v3(0, 95, 10), fov: 40, hue: 0.2 },
};

export interface React {
  /** 0–1 loudness of the music (smoothed). */
  energy: number;
  /** 0–1 decaying pulse on each beat. */
  beat: number;
  /** 0–1 low-frequency level. */
  bass: number;
}

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export class Cosmos {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(44, 1, 0.1, 6500);
  readonly nebula = new Nebula();
  readonly stars = new Stars(SUN_DIR);
  readonly planet = new Planet(SUN_DIR);
  readonly galaxy = new Galaxy(GALAXY_POS, 380);
  readonly streaks = new Streaks();
  readonly asteroids = new Asteroids(SUN_DIR);
  readonly react: React = { energy: 0.25, beat: 0, bass: 0 };
  /** Effects scale (settings): 1 full, 0.5 reduced, 0 minimal. */
  effects = 1;
  reducedMotion = false;
  place: PlaceId = 'home';

  private readonly from = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 44, hue: 0 };
  private readonly ctrl = new THREE.Vector3();
  private flightT = 1;
  private flightDur = 1.6;
  /** Flights follow the wall clock: a slow or hidden window still arrives on time. */
  private flightStart = 0;
  private warpAmp = 0;
  private readonly curPos = new THREE.Vector3();
  private readonly curTarget = new THREE.Vector3();
  private curFov = 44;
  private curHue = 0;
  private readonly pointer = new THREE.Vector2();
  private readonly pointerS = new THREE.Vector2();
  private flash = 0;
  private readonly viewport = new THREE.Vector2(1, 1);

  constructor() {
    this.scene.add(this.nebula.backdrop, this.stars.group, this.galaxy.points, this.planet.group, this.asteroids.mesh, this.streaks.mesh, this.streaks.shock);
    this.scene.add(this.camera);
    this.camera.add(this.streaks.warp);
    const p = PLACES.home;
    this.curPos.copy(p.pos);
    this.curTarget.copy(p.target);
    this.camera.position.copy(p.pos);
    this.camera.lookAt(p.target);
  }

  /** Flies to a place (instant when reduced motion or asked). */
  goTo(id: PlaceId, instant = false): void {
    if (id === this.place && this.flightT >= 1) return;
    const to = PLACES[id];
    this.place = id;
    this.from.pos.copy(this.curPos);
    this.from.target.copy(this.curTarget);
    this.from.fov = this.curFov;
    this.from.hue = this.curHue;
    const dist = this.from.pos.distanceTo(to.pos);
    if (instant || this.reducedMotion || dist < 1) {
      this.flightT = 1;
      this.curPos.copy(to.pos);
      this.curTarget.copy(to.target);
      this.curFov = to.fov;
      this.curHue = to.hue;
      return;
    }
    // the path bends away from the planet so the flight never crosses it
    const mid = this.from.pos.clone().add(to.pos).multiplyScalar(0.5);
    const out = mid.clone().normalize();
    const clearance = PLANET_R * 3.2;
    const push = Math.max(0, clearance - mid.length()) + dist * 0.18;
    this.ctrl.copy(mid).addScaledVector(out, push);
    this.flightT = 0;
    this.flightStart = this.time;
    this.flightDur = Math.min(2.2, 1.1 + dist / 600);
    this.warpAmp = Math.min(1, 0.35 + dist / 500);
  }

  /** Pointer position in [-1, 1]², for a little parallax in menus. */
  setPointer(x: number, y: number): void {
    this.pointer.set(x, y);
  }

  /** Big moment (combo milestone, record): shockwave and a brief brightening of the sky. */
  milestone(strength = 1, color = new THREE.Color(1, 0.8, 0.5)): void {
    if (this.effects <= 0) return;
    this.streaks.shockwave(this.camera, this.time, color);
    this.flash = Math.min(1.5, this.flash + strength);
  }

  shootingStar(): void {
    this.streaks.spawn(this.camera, this.time, 'shooting', true);
  }

  get flying(): boolean {
    return this.flightT < 1;
  }

  /** Current warp (0–1), for the interface (it may blur or fade during a jump). */
  get warp(): number {
    if (this.flightT >= 1) return 0;
    return Math.pow(Math.sin(Math.PI * this.flightT), 2) * this.warpAmp;
  }

  private time = 0;

  resize(w: number, h: number, dpr: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.nebula.resize(w * dpr, h * dpr);
    this.viewport.set(w * dpr, h * dpr);
  }

  update(time: number, dt: number): void {
    this.time = time;
    const slow = this.reducedMotion ? 0.3 : 1;
    // flight
    if (this.flightT < 1) {
      this.flightT = Math.min(1, Math.max(this.flightT, (time - this.flightStart) / this.flightDur));
      const to = PLACES[this.place];
      const u = ease(this.flightT);
      const a = this.from.pos;
      // quadratic Bézier through the control point
      this.curPos.set(
        (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * this.ctrl.x + u * u * to.pos.x,
        (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * this.ctrl.y + u * u * to.pos.y,
        (1 - u) * (1 - u) * a.z + 2 * (1 - u) * u * this.ctrl.z + u * u * to.pos.z,
      );
      this.curTarget.lerpVectors(this.from.target, to.target, ease(Math.min(1, this.flightT * 1.15)));
      this.curFov = THREE.MathUtils.lerp(this.from.fov, to.fov, u) + this.warp * 18;
      this.curHue = THREE.MathUtils.lerp(this.from.hue, to.hue, u);
    } else {
      const to = PLACES[this.place];
      this.curFov += (to.fov - this.curFov) * Math.min(1, dt * 3);
    }
    // idle drift and pointer parallax: the station floats
    const inGame = this.place === 'game';
    this.pointerS.lerp(this.pointer, Math.min(1, dt * 2.5));
    const drift = inGame ? 0.6 : 1;
    const dx = (Math.sin(time * 0.05) * 3 + Math.sin(time * 0.017) * 2) * drift * slow + (inGame ? 0 : this.pointerS.x * 3.5);
    const dy = Math.sin(time * 0.037) * 1.6 * drift * slow + (inGame ? 0 : this.pointerS.y * 2.2);
    this.camera.position.set(this.curPos.x + dx, this.curPos.y + dy, this.curPos.z);
    this.camera.lookAt(this.curTarget.x + dx * 0.4, this.curTarget.y + dy * 0.4, this.curTarget.z);
    if (Math.abs(this.camera.fov - this.curFov) > 0.01) {
      this.camera.fov = this.curFov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();

    // reactivity decays toward calm
    this.flash = Math.max(0, this.flash - dt * 1.2);
    const r = this.react;
    const warp = this.warp;
    const pixel = this.viewport.y / 1000;
    const proj = this.viewport.y / 2 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const fx = this.effects;
    const nu = this.nebula.uniforms;
    nu.uEnergy.value = r.energy * fx;
    nu.uBeat.value = r.beat * fx;
    nu.uHue.value = this.curHue;
    nu.uWarp.value = warp;
    nu.uFlash.value = this.flash * fx;
    this.stars.update(time * slow, dt, this.camera.position, pixel, { beat: r.beat * fx, warp, energy: r.energy * fx });
    this.planet.update(time * slow, { bass: r.bass * fx, beat: r.beat * fx });
    this.galaxy.update(time * slow, proj);
    this.asteroids.update(time * slow);
    this.streaks.update(time, this.camera, this.viewport, warp, fx > 0 && !this.reducedMotion ? (inGame ? 0.4 : 1) : 0);
  }

  renderNebula(renderer: THREE.WebGLRenderer): void {
    this.nebula.render(renderer, this.camera, this.time * (this.reducedMotion ? 0.3 : 1));
  }
}
