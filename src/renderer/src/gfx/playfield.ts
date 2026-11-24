import * as THREE from 'three';
import type { Note } from '@core/chart/types';

// The playfield: lanes on a tilted glass track, receptors at the hit line, notes falling toward it.
//   · track, lane lines, receptors, beat lines, press glow and hit flashes: one procedural shader
//   · notes (taps, long notes, chord links): one instanced mesh, positions computed in the vertex
//     shader from the song time; the CPU writes a note's attributes once, and again only when its
//     state changes (hit, missed, held, dissolved)
//   · sparks: a GPU particle ring buffer
// Nothing here depends on the frame rate: everything is a function of the song time.

export const NOTE_PENDING = 0;
export const NOTE_HOLDING = 1;
export const NOTE_DONE = 2;
export const NOTE_MISSED = 3;
export const NOTE_GHOST = 4;
export const NOTE_BROKEN = 5;

const MAX_LANES = 7;
const TRACK_LEN = 10;
// tiles: tall enough to aim at their centre line, which is the exact time of the note
const TILE = 0.6;

/** Lane colours, symmetrical from the edges inward: outer violet, then cyan, magenta, gold centre. */
export function laneColors(n: number): THREE.Color[] {
  const ring = [new THREE.Color('#a77bff'), new THREE.Color('#4fd6ff'), new THREE.Color('#ff63d2'), new THREE.Color('#ffcc66')];
  const out: THREE.Color[] = [];
  for (let i = 0; i < n; i++) {
    const d = Math.min(i, n - 1 - i);
    out.push(n % 2 === 1 && i === (n - 1) / 2 ? ring[3].clone() : ring[d % 3].clone());
  }
  return out;
}

/** Combo tiers: violet, magenta, orange, gold, white-hot. */
const HEAT_COLORS = ['#9d7bff', '#ff5fd0', '#ff9a3c', '#ffd25c', '#fff1c9'].map((c) => new THREE.Color(c));
export const heatColor = (tier: number) => HEAT_COLORS[Math.max(0, Math.min(HEAT_COLORS.length - 1, tier - 1))];

const COMMON = /* glsl */ `
uniform float uTime;        // song time (s)
uniform float uApproach;    // seconds a note is visible
uniform float uLaneW;
uniform float uLanes;
uniform float uIntro;       // 0 → 1 when the track unfolds
uniform vec3 uLaneColor[${MAX_LANES}];
uniform float uCentre;      // half-height of the dead-centre band at the hit line (world units)
float laneX(float lane) { return (lane - (uLanes - 1.0) * 0.5) * uLaneW; }
float yOf(float t) { return (t - uTime) / uApproach * ${TRACK_LEN.toFixed(1)}; }
`;

const TRACK_VERT = /* glsl */ `
varying vec2 vP;
uniform float uLaneW;
uniform float uLanes;
void main() {
  vec3 p = position;
  p.x *= uLanes * uLaneW * 0.5 + 0.6;
  vP = p.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;
const TRACK_FRAG = /* glsl */ `
${COMMON}
varying vec2 vP;
uniform float uPress[${MAX_LANES}];
uniform float uFlash[${MAX_LANES}];
uniform vec3 uFlashC[${MAX_LANES}];
uniform float uHold[${MAX_LANES}];
uniform float uBeats[24];
uniform float uDown[24];
uniform float uPulse;
uniform float uEnergy;
uniform float uDanger;
uniform float uHeat;        // combo heat 0…1
uniform vec3 uHeatC;
uniform float uShock;       // seconds since the last combo milestone
uniform vec3 uShockC;
uniform float uBreak;       // seconds since the combo broke
uniform float uBeam[${MAX_LANES}];
void main() {
  float half_ = uLanes * uLaneW * 0.5;
  float x = vP.x, y = vP.y;
  float L = ${TRACK_LEN.toFixed(1)};
  // the track unfolds from the hit line on entry
  float reveal = uIntro * (L + 2.0) - 1.0;
  if (y > reveal) discard;
  float inside = step(abs(x), half_);
  float lanef = (x + half_) / uLaneW;
  float lane = floor(lanef);
  float lx = fract(lanef);
  float far = clamp(y / L, 0.0, 1.0);
  float fadeFar = smoothstep(1.0, 0.72, far);
  vec3 c = vec3(0.0);
  float a = 0.0;
  // glass: dark, a little blue, more opaque near the hit line
  vec3 glass = mix(vec3(0.02, 0.025, 0.07), vec3(0.04, 0.03, 0.1), far);
  float ga = inside * mix(0.78, 0.42, far) * fadeFar;
  c += glass * ga; a += ga;
  // lane lines and glowing edges
  float px = fwidth(lanef);
  float line = (1.0 - smoothstep(0.0, px * 1.5, min(lx, 1.0 - lx))) * inside;
  float edge = exp(-abs(abs(x) - half_) * 9.0) * step(abs(x), half_ + 0.4);
  // combo heat: the edges take the tier's colour, flicker and burn
  vec3 edgeC = mix(vec3(0.45, 0.55, 1.0), uHeatC, smoothstep(0.0, 0.3, uHeat));
  float flick = 1.0 + uHeat * 0.45 * sin(y * 2.6 - uTime * 11.0 + sign(x) * 1.7);
  c += vec3(0.35, 0.4, 0.9) * line * (0.22 + uHeat * 0.18) * fadeFar + edgeC * edge * (0.55 + uPulse * 0.5 + uHeat * 1.1) * flick * fadeFar * (0.6 + 0.4 * (1.0 - far));
  a += line * 0.2 * fadeFar + edge * (0.5 + uHeat * 0.3) * fadeFar;
  if (uHeat > 0.01) {
    float outer = abs(x) - half_;
    float tongue = 0.5 + 0.5 * sin(y * 4.3 - uTime * 15.0 + sin(y * 1.7 + uTime * 3.1) * 2.2);
    float fire = exp(-max(outer, 0.0) * mix(9.0, 3.5, uHeat)) * step(0.0, outer) * tongue * uHeat * fadeFar * (1.0 - far * 0.6);
    c += mix(edgeC, vec3(1.0, 0.95, 0.8), tongue * 0.3) * fire * 0.9;
    a += fire * 0.5;
  }
  int li = int(lane);
  vec3 lc = vec3(1.0);
  float press = 0.0, flash = 0.0, hold = 0.0, beam = 9.0;
  vec3 fc = vec3(1.0);
  for (int i = 0; i < ${MAX_LANES}; i++) {
    if (i == li) { lc = uLaneColor[i]; press = uPress[i]; flash = uFlash[i]; fc = uFlashC[i]; hold = uHold[i]; beam = uBeam[i]; }
  }
  if (inside > 0.5 && y > -1.2) {
    // pressed lane: a column of light rising from the receptor
    float col = (press * 0.5 + hold * 0.4) * exp(-max(y, 0.0) * 0.35) * smoothstep(0.0, 0.18, lx) * smoothstep(1.0, 0.82, lx);
    c += lc * col * 0.55; a += col * 0.4;
    // dead centre: a beam of light shoots up the lane
    if (beam < 0.4 && y > -0.1) {
      float k = 1.0 - beam / 0.4;
      float bw = exp(-pow((lx - 0.5) * mix(9.0, 4.0, k), 2.0));
      float bc = bw * k * k * exp(-max(y, 0.0) * mix(0.5, 0.12, k));
      c += vec3(1.0, 0.92, 0.72) * bc * 1.5; a += bc * 0.7;
    }
    // receptor: a rounded frame on the hit line, as tall as a tile
    vec2 q = vec2((lx - 0.5) * uLaneW, y);
    vec2 b = vec2(uLaneW * 0.44, ${(TILE / 2).toFixed(3)});
    vec2 d = abs(q) - b + 0.08;
    float sd = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - 0.08;
    float frame = exp(-abs(sd) * 38.0);
    float fill = smoothstep(0.01, -0.02, sd);
    c += lc * (frame * (0.55 + press * 0.9 + uPulse * 0.25) + fill * (0.06 + press * 0.35 + hold * 0.3));
    a += frame * 0.6 + fill * (0.2 + press * 0.3);
    // the dead-centre band, and notches on both sides of the hit line: aim here
    float band = (1.0 - smoothstep(uCentre * 0.7, uCentre, abs(y))) * fill;
    float notch = exp(-pow(y / 0.035, 2.0)) * (exp(-lx * 26.0) + exp(-(1.0 - lx) * 26.0));
    c += vec3(1.0, 0.85, 0.55) * (band * (0.1 + uPulse * 0.08) + notch * 1.1);
    a += band * 0.12 + notch * 0.7;
    // hit flash: a ring expanding out of the receptor
    float age = flash;
    if (age < 0.45) {
      float r = length(q * vec2(1.0, 1.6));
      float R = 0.12 + age * 1.6;
      float ring = exp(-pow((r - R) / (0.04 + age * 0.15), 2.0)) * (1.0 - age / 0.45);
      float core = exp(-r * r * 18.0) * (1.0 - age / 0.2) * step(age, 0.2);
      c += fc * (ring * 1.4 + max(core, 0.0) * 1.8);
      a += ring + max(core, 0.0);
    }
  }
  // hit line: a soft glow and a sharp core, warmer with the combo heat
  float hl = exp(-abs(y) * 26.0) * inside;
  float hcore = exp(-abs(y) * 110.0) * inside;
  vec3 hcol = mix(mix(vec3(0.6, 0.7, 1.0), vec3(1.0, 0.85, 0.6), uPulse * 0.6), uHeatC, uHeat * 0.5);
  c += hcol * hl * (0.9 + uPulse * 0.8 + uEnergy * 0.3 + uHeat * 0.5) + vec3(1.0) * hcore * 0.7;
  a += hl * 0.7 + hcore * 0.5;
  // combo milestone: a shock wave races up the track
  if (uShock < 1.1) {
    float sy = uShock * 15.0;
    float k = 1.0 - uShock / 1.1;
    float wave = exp(-pow((y - sy) / (0.25 + uShock * 0.6), 2.0)) * k * step(abs(x), half_ + 0.5);
    c += uShockC * wave * 1.6; a += wave * 0.7;
  }
  // combo broken: a red flash on the glass and the edges
  if (uBreak < 0.6) {
    float k = 1.0 - uBreak / 0.6;
    c += vec3(1.0, 0.12, 0.3) * (edge * 1.6 + inside * 0.18 * (1.0 - far)) * k * k;
    a += inside * 0.1 * k;
  }
  // beat lines scroll with the music, downbeats brighter
  if (inside > 0.5 && y > 0.05) {
    for (int k = 0; k < 24; k++) {
      float by = yOf(uBeats[k]);
      if (by < 0.0 || by > L) continue;
      float w = fwidth(y) * 1.2;
      float bl = 1.0 - smoothstep(0.0, w, abs(y - by));
      float s = mix(0.07, 0.17, uDown[k]) * fadeFar;
      c += vec3(0.5, 0.55, 1.0) * bl * s; a += bl * s;
    }
  }
  // danger: low energy tints the edges
  c += vec3(0.9, 0.15, 0.3) * edge * uDanger * 0.8;
  gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const NOTE_VERT = /* glsl */ `
${COMMON}
attribute vec2 corner;        // x -0.5…0.5, y 0…1
attribute vec4 aNote;         // time, lane, duration, flags (1 chord, 2 live, 4 link)
attribute vec2 aState;        // state, time of the change (song time)
varying vec2 vL;              // local: x across (−0.5…0.5), y from the head (world units)
varying float vLen;
varying float vHold;
varying vec3 vColor;
varying float vState;
varying float vAge;
varying float vFar;
varying float vFlags;
varying float vYh;
void main() {
  float t = aNote.x;
  float lane = aNote.y;
  float dur = aNote.z;
  float flags = aNote.w;
  float state = aState.x;
  vState = state;
  vAge = uTime - aState.y;
  vFlags = flags;
  bool link = mod(floor(flags / 4.0), 2.0) > 0.5;
  float yh = yOf(t);
  float yt = yOf(t + dur);
  bool hidden = state == 2.0;
  if (state == 1.0) yh = max(yh, 0.0);
  if (state == 4.0 && vAge > 0.35) hidden = true;
  if (state == 3.0 && vAge > 0.6) hidden = true;
  float L = ${TRACK_LEN.toFixed(1)};
  float bottom = yh - ${(TILE / 2).toFixed(3)};
  float top = dur > 0.0 && !link ? max(yt, yh) + ${(TILE * 0.3).toFixed(3)} : yh + ${(TILE / 2).toFixed(3)};
  float reach = min(L + 0.2, uIntro * (L + 2.0) - 1.0);
  if (bottom > L + 0.2 || top < -1.4 || bottom > reach) hidden = true;
  // a long note longer than the visible track ends at its far end (or at the unfolding edge)
  top = min(top, max(reach, bottom + 0.05));
  if (hidden) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float w;
  float cx;
  if (link) {
    // chord link: a thin bar between two lanes (lane = left, dur = span in lanes)
    float span = dur;
    cx = laneX(lane + span * 0.5);
    w = span * uLaneW;
    top = yh + 0.035;
    bottom = yh - 0.035;
  } else {
    cx = laneX(lane);
    w = uLaneW * 0.88;
  }
  float y = mix(bottom, top, corner.y);
  vec3 p = vec3(cx + corner.x * w, y, 0.004);
  vL = vec2(corner.x, y - yh);
  vLen = top - bottom;
  vHold = dur > 0.0 && !link ? 1.0 : 0.0;
  vFar = clamp(yh / L, 0.0, 1.0);
  vYh = yh;
  vColor = uLaneColor[int(lane)];
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const NOTE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uLaneW;
uniform float uPulse;
uniform float uCentre;
varying float vYh;
varying vec2 vL;
varying float vLen;
varying float vHold;
varying vec3 vColor;
varying float vState;
varying float vAge;
varying float vFar;
varying float vFlags;
float sdRound(vec2 p, vec2 b, float r) { vec2 d = abs(p) - b + r; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r; }
void main() {
  bool chord = mod(vFlags, 2.0) > 0.5;
  bool live = mod(floor(vFlags / 2.0), 2.0) > 0.5;
  bool link = mod(floor(vFlags / 4.0), 2.0) > 0.5;
  float fade = smoothstep(1.0, 0.8, vFar);
  vec3 c = vec3(0.0);
  float a = 0.0;
  if (link) {
    float k = exp(-abs(vL.y) * 70.0);
    c = vec3(1.0, 0.82, 0.5) * k * 0.9;
    a = k * 0.8;
  } else {
    float W = uLaneW * 0.88;
    vec2 p = vec2(vL.x * W, vL.y);
    // long note body: a beam of flowing light from the head to the tail
    if (vHold > 0.5 && vL.y > 0.0) {
      float bw = W * 0.2;
      float edge = abs(p.x) / bw;
      float body = smoothstep(1.0, 0.75, edge);
      float flow = 0.65 + 0.35 * sin(vL.y * 7.0 - uTime * 9.0);
      float held = vState == 1.0 ? 1.0 : 0.0;
      float broken = vState == 5.0 ? 1.0 : 0.0;
      float endFade = smoothstep(vLen - 0.1, vLen - 0.45, vL.y + ${(TILE / 2).toFixed(3)});
      vec3 bc = mix(vColor * 0.55, vColor * 1.3 + 0.25, held) * flow;
      bc = mix(bc, vec3(0.3, 0.3, 0.38), broken);
      float rim = exp(-abs(edge - 0.85) * 10.0) * 0.6;
      c += (bc * body + vColor * rim) * mix(1.0, 0.6, broken);
      a += (body * 0.75 + rim * 0.5) * mix(1.0, 0.5, broken) * mix(1.0, endFade, 1.0);
      // tail cap
      float tailY = vLen - ${(TILE * 0.8).toFixed(3)};
      float cap = exp(-pow((vL.y - tailY) * 18.0, 2.0)) * smoothstep(bw * 1.6, 0.0, abs(p.x));
      c += vColor * cap * 0.8; a += cap * 0.6;
    }
    // head: a tile of glass with a bright core line
    if (vL.y < ${(TILE / 2 + 0.01).toFixed(3)}) {
      float sd = sdRound(p, vec2(W * 0.5, ${(TILE / 2).toFixed(3)}), 0.12);
      float fill = smoothstep(0.012, -0.012, sd);
      float rim = exp(-abs(sd) * 60.0);
      float inner = smoothstep(-0.02, -0.12, sd);
      float core = exp(-abs(p.y) * 38.0) * smoothstep(W * 0.48, W * 0.2, abs(p.x));
      vec3 edgeC = chord ? vec3(1.0, 0.82, 0.5) : vColor * 1.25 + 0.15;
      vec3 body = mix(vColor * 0.42, vColor * 0.14, inner) + vec3(0.02, 0.02, 0.05);
      // a soft highlight on the top edge, like light on a glass edge
      body += vec3(0.25) * smoothstep(0.06, 0.16, p.y) * fill * 0.5;
      // the centre line runs across the whole tile, with bright ticks at both ends: aim with it
      float tick = exp(-abs(p.y) * 60.0) * smoothstep(W * 0.3, W * 0.47, abs(p.x)) * fill;
      vec3 tc = body * fill + edgeC * rim * 1.3 + (vColor + 0.55) * core * 1.15 + vec3(1.0, 0.95, 0.85) * tick * 1.4;
      float ta = fill * 0.92 + rim * 0.8;
      // in the dead-centre band: the tile lights up gold
      if (vState == 0.0) {
        float sweet = 1.0 - smoothstep(uCentre, uCentre * 2.6, abs(vYh));
        tc += vec3(1.0, 0.82, 0.5) * sweet * (fill * 0.45 + rim * 0.9);
      }
      if (live) { ta *= 0.85 + 0.15 * sin(uTime * 10.0 + p.x * 8.0); }
      c = mix(c, tc, clamp(ta, 0.0, 1.0));
      a = max(a, ta);
    }
  }
  // states: missed notes grey out and sink, ghosts dissolve
  if (vState == 3.0) { c = mix(c, vec3(dot(c, vec3(0.33))) * 0.4, 0.85); a *= 1.0 - vAge / 0.6; }
  if (vState == 4.0) { a *= max(0.0, 1.0 - vAge / 0.35); c *= 0.6; }
  a *= fade;
  if (a < 0.004) discard;
  gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const SPARK_VERT = /* glsl */ `
attribute vec3 aOrigin;
attribute vec3 aVel;
attribute vec4 aInfo;         // birth (s, wall clock), life, size, colour index (lane) or -1 gold
uniform float uClock;
uniform float uPixel;
uniform vec3 uLaneColor[${MAX_LANES}];
varying vec3 vColor;
varying float vA;
void main() {
  float age = uClock - aInfo.x;
  float life = aInfo.y;
  if (age < 0.0 || age > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  float k = age / life;
  vec3 p = aOrigin + aVel * age * (1.0 - 0.45 * k) + vec3(0.0, -1.2, 0.0) * age * age;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aInfo.z * uPixel * (1.0 - k * 0.6) * 8.0 / -mv.z;
  int ci = int(aInfo.w);
  vColor = aInfo.w < 0.0 ? vec3(1.0, 0.85, 0.55) : uLaneColor[ci];
  vColor = mix(vec3(1.0), vColor, smoothstep(0.0, 0.3, k));
  vA = 1.0 - k;
}
`;
const SPARK_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vA;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float a = exp(-dot(p, p) * 3.0) * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * a * 1.8, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const SPARKS = 4096;

export interface PlayfieldSetup {
  lanes: number;
  /** Dead-centre half-window (s), drawn as a band at the hit line. */
  centre?: number;
  approach: number;
  /** Tilt of the track (degrees, 0 = flat). */
  tilt: number;
  notes: Note[];
  beats: number[];
  downbeat: number;
  meter: number;
}

export class Playfield {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  readonly group = new THREE.Group();
  private readonly trackMat: THREE.ShaderMaterial;
  private readonly noteMat: THREE.ShaderMaterial;
  private readonly sparkMat: THREE.ShaderMaterial;
  private noteGeo: THREE.InstancedBufferGeometry | null = null;
  private noteMesh: THREE.Mesh | null = null;
  private aNote: THREE.InstancedBufferAttribute | null = null;
  private aState: THREE.InstancedBufferAttribute | null = null;
  private count = 0;
  private capacity = 0;
  private readonly sparkO: THREE.BufferAttribute;
  private readonly sparkV: THREE.BufferAttribute;
  private readonly sparkI: THREE.BufferAttribute;
  private sparkNext = 0;
  private clock = 0;
  private lanes = 4;
  private beats: number[] = [];
  private beatDown: boolean[] = [];
  private beatCursor = 0;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly press = new Float32Array(MAX_LANES);
  private readonly pressTarget = new Float32Array(MAX_LANES);
  private readonly holdGlow = new Float32Array(MAX_LANES);
  private readonly flashT = new Float32Array(MAX_LANES).fill(9);
  private readonly beam = new Float32Array(MAX_LANES).fill(9);
  private heat = 0;
  private heatTarget = 0;
  private shake = 0;
  private punch = 0;
  /** Settings › reduced motion: no shaking. */
  reducedMotion = false;
  /** Dead-centre window (s), to draw its band at the hit line. */
  private centreWin = 0.02;
  private w = 1;
  private h = 1;
  private tilt = 28;
  private intro = 0;
  private introTarget = 0;
  /** Judge note index → instance index (chord links are interleaved after each batch). */
  private instanceOfNote: number[] = [];
  /** Instances that are chord links. */
  private links: number[] = [];

  constructor() {
    this.scene.add(this.group);
    const colors = Array.from({ length: MAX_LANES }, () => new THREE.Color(1, 1, 1));
    this.uniforms = {
      uTime: { value: 0 },
      uApproach: { value: 1.2 },
      uLaneW: { value: 1 },
      uLanes: { value: 4 },
      uIntro: { value: 0 },
      uLaneColor: { value: colors },
      uPulse: { value: 0 },
      uEnergy: { value: 0 },
      uCentre: { value: 0.1 },
    };
    this.trackMat = new THREE.ShaderMaterial({
      vertexShader: TRACK_VERT,
      fragmentShader: TRACK_FRAG,
      uniforms: {
        ...this.uniforms,
        uPress: { value: this.press },
        uFlash: { value: this.flashT },
        uFlashC: { value: Array.from({ length: MAX_LANES }, () => new THREE.Color(1, 1, 1)) },
        uHold: { value: this.holdGlow },
        uBeats: { value: new Float32Array(24).fill(-100) },
        uDown: { value: new Float32Array(24) },
        uDanger: { value: 0 },
        uHeat: { value: 0 },
        uHeatC: { value: new THREE.Color(0.45, 0.55, 1) },
        uShock: { value: 9 },
        uShockC: { value: new THREE.Color(1, 1, 1) },
        uBreak: { value: 9 },
        uBeam: { value: this.beam },
      },
      transparent: true,
      depthWrite: false,
    });
    const track = new THREE.Mesh(new THREE.PlaneGeometry(2, TRACK_LEN + 2.2, 1, 1).translate(0, (TRACK_LEN + 2.2) / 2 - 1.2, 0), this.trackMat);
    track.renderOrder = 0;
    track.frustumCulled = false;
    this.group.add(track);

    this.noteMat = new THREE.ShaderMaterial({ vertexShader: NOTE_VERT, fragmentShader: NOTE_FRAG, uniforms: { ...this.uniforms }, transparent: true, depthWrite: false });

    const sg = new THREE.BufferGeometry();
    this.sparkO = new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3);
    this.sparkV = new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3);
    this.sparkI = new THREE.BufferAttribute(new Float32Array(SPARKS * 4).fill(-100), 4);
    for (const a of [this.sparkO, this.sparkV, this.sparkI]) a.setUsage(THREE.DynamicDrawUsage);
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
    sg.setAttribute('aOrigin', this.sparkO);
    sg.setAttribute('aVel', this.sparkV);
    sg.setAttribute('aInfo', this.sparkI);
    this.sparkMat = new THREE.ShaderMaterial({
      vertexShader: SPARK_VERT,
      fragmentShader: SPARK_FRAG,
      uniforms: { uClock: { value: 0 }, uPixel: { value: 1 }, uLaneColor: this.uniforms.uLaneColor },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const sparks = new THREE.Points(sg, this.sparkMat);
    sparks.frustumCulled = false;
    sparks.renderOrder = 5;
    this.group.add(sparks);
  }

  setup(s: PlayfieldSetup): void {
    this.lanes = s.lanes;
    this.uniforms.uLanes.value = s.lanes;
    this.uniforms.uApproach.value = s.approach;
    const cols = laneColors(s.lanes);
    const u = this.uniforms.uLaneColor.value as THREE.Color[];
    for (let i = 0; i < MAX_LANES; i++) u[i].copy(cols[i] ?? cols[0]);
    this.tilt = s.tilt;
    this.beats = s.beats;
    this.beatDown = s.beats.map((_, k) => (k - s.downbeat) % s.meter === 0);
    this.beatCursor = 0;
    this.buildNotes(s.notes);
    this.flashT.fill(9);
    this.beam.fill(9);
    this.centreWin = s.centre ?? 0.02;
    this.heat = this.heatTarget = 0;
    this.shake = this.punch = 0;
    this.trackMat.uniforms.uShock.value = 9;
    this.trackMat.uniforms.uBreak.value = 9;
    this.press.fill(0);
    this.pressTarget.fill(0);
    this.holdGlow.fill(0);
    this.layout();
  }

  setApproach(seconds: number): void {
    this.uniforms.uApproach.value = seconds;
  }

  /** Combo tier (0–5): the track heats up, from blue to violet, magenta, orange, gold, white. */
  setHeat(tier: number): void {
    this.heatTarget = Math.min(1, tier * 0.21);
    if (tier > 0) (this.trackMat.uniforms.uHeatC.value as THREE.Color).copy(heatColor(tier));
  }

  /** Combo milestone: a shock wave up the track, a jolt. */
  shockwave(tier: number, strength = 1): void {
    this.trackMat.uniforms.uShock.value = 0;
    (this.trackMat.uniforms.uShockC.value as THREE.Color).copy(heatColor(tier));
    this.kick(0.8 * strength);
    this.punch = Math.min(1.5, this.punch + strength);
  }

  /** The combo broke: a red flash and a jolt. */
  comboBreak(strength = 1): void {
    this.trackMat.uniforms.uBreak.value = 0;
    this.kick(0.55 * strength);
  }

  /** Shakes the track (decays by itself). */
  kick(amount: number): void {
    if (this.reducedMotion) return;
    this.shake = Math.min(1.4, this.shake + amount);
  }

  private buildNotes(notes: Note[]): void {
    if (this.noteMesh) {
      this.group.remove(this.noteMesh);
      this.noteGeo?.dispose();
    }
    // capacity for live notes added during play
    this.capacity = Math.max(512, notes.length * 2 + 256);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('corner', new THREE.Float32BufferAttribute([-0.5, 0, 0.5, 0, 0.5, 1, -0.5, 1], 2));
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aNote = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 4), 4);
    this.aState = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 2), 2);
    this.aState.setUsage(THREE.DynamicDrawUsage);
    this.aNote.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aNote', this.aNote);
    g.setAttribute('aState', this.aState);
    this.noteGeo = g;
    this.count = 0;
    this.instanceOfNote = [];
    this.links = [];
    this.noteMesh = new THREE.Mesh(g, this.noteMat);
    this.noteMesh.frustumCulled = false;
    this.noteMesh.renderOrder = 2;
    this.group.add(this.noteMesh);
    this.addNotes(notes);
  }

  /** Appends notes (live mode); returns the index of the first one. Chord links are added too. */
  addNotes(notes: Note[]): number {
    if (!this.aNote || !this.aState || !this.noteGeo) return 0;
    const from = this.count;
    const need = this.count + notes.length * 2;
    if (need > this.capacity) {
      // grow: rebuild with the notes kept
      const old = this.aNote.array as Float32Array;
      const oldS = this.aState.array as Float32Array;
      const n = this.count;
      this.capacity = need * 2;
      const an = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 4), 4);
      const as = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 2), 2);
      (an.array as Float32Array).set(old.subarray(0, n * 4));
      (as.array as Float32Array).set(oldS.subarray(0, n * 2));
      an.setUsage(THREE.DynamicDrawUsage);
      as.setUsage(THREE.DynamicDrawUsage);
      this.noteGeo.setAttribute('aNote', an);
      this.noteGeo.setAttribute('aState', as);
      this.aNote = an;
      this.aState = as;
    }
    const A = this.aNote.array as Float32Array;
    const S = this.aState.array as Float32Array;
    for (const n of notes) {
      const i = this.count++;
      A[i * 4] = n.t;
      A[i * 4 + 1] = n.lane;
      A[i * 4 + 2] = n.dur;
      A[i * 4 + 3] = (n.chord >= 0 ? 1 : 0) + (n.live ? 2 : 0);
      S[i * 2] = NOTE_PENDING;
      S[i * 2 + 1] = 0;
    }
    // chord links: one bar from the leftmost to the rightmost note of each chord
    const byChord = new Map<number, Note[]>();
    for (const n of notes) if (n.chord >= 0) byChord.set(n.chord, [...(byChord.get(n.chord) ?? []), n]);
    for (const group of byChord.values()) {
      if (group.length < 2) continue;
      const lo = Math.min(...group.map((n) => n.lane));
      const hi = Math.max(...group.map((n) => n.lane));
      const i = this.count++;
      A[i * 4] = group[0].t;
      A[i * 4 + 1] = lo;
      A[i * 4 + 2] = hi - lo;
      A[i * 4 + 3] = 4;
      S[i * 2] = NOTE_PENDING;
      this.links.push(i);
    }
    this.aNote.needsUpdate = true;
    this.aState.needsUpdate = true;
    this.noteGeo.instanceCount = this.count;
    this.instanceOfNote.push(...notes.map((_, k) => from + k));
    return from;
  }

  /** A note changed state (index in the judge's list). */
  setState(note: number, state: number, t: number): void {
    const i = this.instanceOfNote[note];
    if (i === undefined || !this.aState) return;
    const S = this.aState.array as Float32Array;
    S[i * 2] = state;
    S[i * 2 + 1] = t;
    this.aState.needsUpdate = true;
  }

  /** Chord links disappear with their chord: hide links whose time has passed. */
  private updateLinks(t: number): void {
    if (!this.aNote || !this.aState) return;
    const A = this.aNote.array as Float32Array;
    const S = this.aState.array as Float32Array;
    let dirty = false;
    for (const i of this.links) {
      if (S[i * 2] === NOTE_PENDING && A[i * 4] < t - 0.02) {
        S[i * 2] = NOTE_DONE;
        dirty = true;
      }
    }
    if (dirty) this.aState.needsUpdate = true;
  }

  pressLane(lane: number, down: boolean): void {
    if (lane < 0 || lane >= MAX_LANES) return;
    this.pressTarget[lane] = down ? 1 : 0;
    if (down) this.press[lane] = 1;
  }

  setHolding(lane: number, on: boolean): void {
    if (lane >= 0 && lane < MAX_LANES) this.holdGlow[lane] = on ? 1 : 0;
  }

  /** Hit feedback: ring flash on the receptor and sparks. */
  hit(lane: number, quality: 'centre' | 'perfect' | 'great' | 'good', big = false): void {
    if (lane < 0 || lane >= MAX_LANES) return;
    this.flashT[lane] = 0;
    const fc = (this.trackMat.uniforms.uFlashC.value as THREE.Color[])[lane];
    const lc = (this.uniforms.uLaneColor.value as THREE.Color[])[lane];
    if (quality === 'centre') fc.setRGB(1.5, 1.35, 1.05);
    else if (quality === 'perfect') fc.setRGB(1, 0.9, 0.7);
    else fc.copy(lc).multiplyScalar(quality === 'great' ? 1 : 0.6);
    if (quality === 'centre') this.beam[lane] = 0;
    const n = quality === 'centre' ? 34 : quality === 'perfect' ? 20 : quality === 'great' ? 12 : 6;
    // the hotter the combo, the bigger the bursts
    const heat = 1 + this.heat * 0.8;
    const gold = quality === 'centre' || quality === 'perfect';
    this.emit(lane, n * (big ? 1.6 : 1) * heat, gold ? -1 : lane, (quality === 'centre' ? 1.55 : quality === 'perfect' ? 1.2 : 1) * (1 + this.heat * 0.25));
  }

  /** Sparks while a long note is held. */
  holdSparks(lane: number): void {
    this.emit(lane, 1, lane, 0.6);
  }

  miss(lane: number): void {
    if (lane < 0 || lane >= MAX_LANES) return;
    this.flashT[lane] = 0.3; // a short, dim flash only
    (this.trackMat.uniforms.uFlashC.value as THREE.Color[])[lane].setRGB(0.5, 0.15, 0.25);
  }

  private emit(lane: number, n: number, color: number, power: number): void {
    const x0 = (lane - (this.lanes - 1) / 2) * (this.uniforms.uLaneW.value as number);
    const w = this.uniforms.uLaneW.value as number;
    const O = this.sparkO.array as Float32Array;
    const V = this.sparkV.array as Float32Array;
    const I = this.sparkI.array as Float32Array;
    const start = this.sparkNext;
    for (let k = 0; k < n; k++) {
      const i = this.sparkNext;
      this.sparkNext = (this.sparkNext + 1) % SPARKS;
      const a = Math.random() * Math.PI;
      const sp = (1.2 + Math.random() * 3.2) * power;
      O[i * 3] = x0 + (Math.random() - 0.5) * w * 0.7;
      O[i * 3 + 1] = (Math.random() - 0.5) * 0.25;
      O[i * 3 + 2] = 0.05;
      V[i * 3] = Math.cos(a) * sp * 0.6;
      V[i * 3 + 1] = Math.sin(a) * sp;
      V[i * 3 + 2] = Math.random() * 1.5;
      I[i * 4] = this.clock;
      I[i * 4 + 1] = 0.35 + Math.random() * 0.4;
      I[i * 4 + 2] = 0.6 + Math.random() * 1.1;
      I[i * 4 + 3] = color;
    }
    const count = (this.sparkNext - start + SPARKS) % SPARKS || SPARKS;
    for (const [attr, size] of [[this.sparkO, 3], [this.sparkV, 3], [this.sparkI, 4]] as const) {
      if (start + count <= SPARKS) attr.addUpdateRange(start * size, count * size);
      else {
        attr.addUpdateRange(start * size, (SPARKS - start) * size);
        attr.addUpdateRange(0, (start + count - SPARKS) * size);
      }
      attr.needsUpdate = true;
    }
  }

  /** The track unfolds (1) or folds back (0). */
  setIntro(on: boolean, instant = false): void {
    this.introTarget = on ? 1 : 0;
    if (instant) this.intro = this.introTarget;
  }

  get visible(): boolean {
    return this.intro > 0.001 || this.introTarget > 0;
  }

  /** Set by update(): the engine lets the track fold away by itself once no run drives it. */
  driven = false;

  /** No run drives the track any more (results, quit): the time stands still, the track folds away. */
  idle(dt: number): void {
    this.update(this.uniforms.uTime.value as number, dt, { beat: 0, energy: 0.3, danger: 0 });
  }

  update(songTime: number, dt: number, react: { beat: number; energy: number; danger: number }): void {
    this.driven = true;
    this.clock += dt;
    this.intro += (this.introTarget - this.intro) * Math.min(1, dt * (this.introTarget > this.intro ? 2.2 : 4));
    if (Math.abs(this.introTarget - this.intro) < 0.001) this.intro = this.introTarget;
    const u = this.uniforms;
    u.uTime.value = songTime;
    u.uIntro.value = this.intro;
    u.uPulse.value = react.beat;
    u.uEnergy.value = react.energy;
    this.trackMat.uniforms.uDanger.value = react.danger;
    for (let l = 0; l < MAX_LANES; l++) {
      // press glow: instant on, smooth release
      this.press[l] = Math.max(this.pressTarget[l], this.press[l] - dt * 5);
      this.flashT[l] = Math.min(9, this.flashT[l] + dt);
      this.beam[l] = Math.min(9, this.beam[l] + dt);
    }
    const tu = this.trackMat.uniforms;
    tu.uShock.value = Math.min(9, (tu.uShock.value as number) + dt);
    tu.uBreak.value = Math.min(9, (tu.uBreak.value as number) + dt);
    this.heat += (this.heatTarget - this.heat) * Math.min(1, dt * (this.heatTarget > this.heat ? 3 : 8));
    tu.uHeat.value = this.heat;
    const approach = u.uApproach.value as number;
    u.uCentre.value = (this.centreWin / Math.max(0.1, approach)) * TRACK_LEN;
    // shake and punch: a jolt that dies out fast (never with reduced motion)
    this.shake *= Math.exp(-dt * 10);
    this.punch *= Math.exp(-dt * 7);
    if (this.shake < 0.002) this.shake = 0;
    const lw = u.uLaneW.value as number;
    const amp = this.reducedMotion ? 0 : this.shake * lw * 0.09;
    this.group.position.set((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp, 0);
    this.group.scale.setScalar(1 + (this.reducedMotion ? 0 : this.punch * 0.012));
    this.sparkMat.uniforms.uClock.value = this.clock;
    this.sparkMat.uniforms.uPixel.value = this.h / 100;
    // the next 24 beats for the beat lines
    while (this.beatCursor < this.beats.length && this.beats[this.beatCursor] < songTime - 0.5) this.beatCursor++;
    while (this.beatCursor > 0 && this.beats[this.beatCursor - 1] >= songTime - 0.5) this.beatCursor--;
    const B = this.trackMat.uniforms.uBeats.value as Float32Array;
    const D = this.trackMat.uniforms.uDown.value as Float32Array;
    for (let k = 0; k < 24; k++) {
      const b = this.beats[this.beatCursor + k];
      B[k] = b ?? -100;
      D[k] = this.beatDown[this.beatCursor + k] ? 1 : 0;
    }
    this.updateLinks(songTime);
  }

  /** Live mode: replaces the beat list (the grid grows while the song plays). */
  setBeats(beats: number[], downbeat: number, meter: number): void {
    this.beats = beats;
    this.beatDown = beats.map((_, k) => (k - downbeat) % meter === 0);
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.camera.aspect = w / h;
    this.layout();
  }

  setTilt(deg: number): void {
    this.tilt = deg;
    this.layout();
  }

  /** Frames the track: hit line low on the screen, far end near the top, lanes a comfortable width. */
  private layout(): void {
    const th = THREE.MathUtils.degToRad(this.tilt);
    const fov = 40;
    const k = Math.tan(THREE.MathUtils.degToRad(fov / 2));
    const portrait = this.h > this.w;
    const h0 = portrait ? -0.72 : -0.66;
    const h1 = 0.98;
    const L = TRACK_LEN;
    const cz = (L * (Math.cos(th) - h1 * k * Math.sin(th))) / (k * (h1 - h0));
    const cy = -h0 * cz * k;
    this.camera.fov = fov;
    this.camera.position.set(0, cy, cz);
    this.camera.lookAt(0, cy, 0);
    this.camera.updateProjectionMatrix();
    this.group.rotation.x = -th;
    // lane width in pixels: comfortable, never wider than the screen allows
    const px = Math.min(Math.max(this.h * 0.145, 64), 200, (this.w * (portrait ? 0.97 : 0.72)) / this.lanes);
    const pxPerUnit = this.w / 2 / (cz * k * this.camera.aspect);
    this.uniforms.uLaneW.value = px / pxPerUnit;
  }

  /** Lane under a screen point (touch, mouse), −1 outside the track. */
  laneAt(clientX: number, clientY: number): number {
    const nx = (clientX / this.w) * 2 - 1;
    const ny = -((clientY / this.h) * 2 - 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1).applyQuaternion(this.group.quaternion), 0);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, hit)) return -1;
    const local = this.group.worldToLocal(hit.clone());
    const w = this.uniforms.uLaneW.value as number;
    const lane = Math.floor(local.x / w + this.lanes / 2);
    // generous: anywhere in the lower part of the screen counts
    return lane >= 0 && lane < this.lanes ? lane : -1;
  }

  /** Screen position (CSS px) of a point of the track: HUD placement. */
  screenOf(lane: number, y: number): { x: number; y: number } {
    const w = this.uniforms.uLaneW.value as number;
    const p = new THREE.Vector3((lane - (this.lanes - 1) / 2) * w, y, 0);
    this.group.updateMatrixWorld();
    p.applyMatrix4(this.group.matrixWorld).project(this.camera);
    return { x: ((p.x + 1) / 2) * this.w, y: ((1 - p.y) / 2) * this.h };
  }

  /** Half width of the track at the hit line, in CSS px. */
  get trackHalfWidthPx(): number {
    const a = this.screenOf(-0.5, 0);
    const b = this.screenOf(this.lanes - 0.5, 0);
    return Math.abs(b.x - a.x) / 2;
  }
}
