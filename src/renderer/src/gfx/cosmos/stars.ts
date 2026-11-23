import * as THREE from 'three';
import { STAR_COLOR_GLSL } from '../noise';

// Stars: three shells at different distances (the camera moves between places: near shells shift
// more, that is the parallax), twinkling, the brightest with diffraction spikes. Constellations
// link a handful of bright stars, draw themselves stroke by stroke, then fade. Dust floats around
// the camera in an endless wrapped box.

let seed = 0x51f15e;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const randDir = (v = new THREE.Vector3()) => {
  const z = rnd() * 2 - 1;
  const a = rnd() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return v.set(r * Math.cos(a), z, r * Math.sin(a));
};

const STAR_VERT = /* glsl */ `
attribute float aSize;
attribute float aTemp;
attribute float aPhase;
uniform float uTime;
uniform float uPixel;
uniform float uTwinkle;
uniform float uBeat;
uniform float uWarp;
varying vec3 vColor;
varying float vBright;
varying float vSpikes;
${STAR_COLOR_GLSL}
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = 1.0 + uTwinkle * (0.35 * sin(uTime * (1.3 + aPhase * 2.7) + aPhase * 40.0) + 0.2 * sin(uTime * (3.1 + aPhase) + aPhase * 13.0));
  float size = aSize * tw * (1.0 + uBeat * 0.25 * step(1.6, aSize));
  vBright = clamp(size / 2.2, 0.15, 1.6);
  vSpikes = step(2.4, aSize);
  vColor = starColor(aTemp);
  gl_PointSize = max(1.0, size * uPixel * (vSpikes > 0.5 ? 4.0 : 1.6) * (1.0 + uWarp * 0.6));
}
`;

const STAR_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vBright;
varying float vSpikes;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  float a;
  if (vSpikes > 0.5) {
    // bright star: small hot core, halo, thin cross spikes
    float core = exp(-r * r * 60.0);
    float halo = exp(-r * 5.0) * 0.35;
    float spikes = (exp(-abs(p.x) * 40.0) + exp(-abs(p.y) * 40.0)) * pow(max(0.0, 1.0 - r), 3.0) * 0.6;
    a = core + halo + spikes;
  } else {
    a = exp(-r * r * 7.0);
  }
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * a * vBright, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const LINE_VERT = /* glsl */ `
attribute float aOrder;
uniform float uReveal;
uniform float uFade;
varying float vA;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vA = clamp(uReveal - aOrder, 0.0, 1.0) * uFade;
}
`;
const LINE_FRAG = /* glsl */ `
varying float vA;
uniform vec3 uColor;
void main() {
  if (vA <= 0.001) discard;
  gl_FragColor = vec4(uColor * vA, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const DUST_VERT = /* glsl */ `
attribute vec3 aVel;
attribute float aSize;
uniform float uTime;
uniform vec3 uCam;
uniform float uBox;
uniform float uPixel;
uniform float uWarp;
varying float vA;
void main() {
  vec3 p = position + aVel * uTime;
  // wrap around the camera: an endless field
  p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = -mv.z;
  vA = smoothstep(uBox * 0.5, uBox * 0.2, d) * smoothstep(0.5, 3.0, d);
  gl_PointSize = clamp(aSize * uPixel * 30.0 / max(d, 0.1), 1.0, 6.0) * (1.0 + uWarp * 2.0);
}
`;
const DUST_FRAG = /* glsl */ `
varying float vA;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float a = exp(-dot(p, p) * 4.0) * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.55, 0.62, 0.9) * a * 0.55, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const SUN_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform float uPulse;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float ang = atan(p.y, p.x);
  float core = smoothstep(0.075, 0.06, r) * 3.0;
  float glow = exp(-r * 7.0) * 1.3 + exp(-r * 2.6) * 0.35;
  float rays = pow(max(0.0, cos(ang * 6.0 + uTime * 0.05)), 18.0) * exp(-r * 3.5) * 0.5;
  rays += pow(max(0.0, cos(ang * 11.0 - uTime * 0.03)), 30.0) * exp(-r * 5.0) * 0.35;
  float a = (core + glow + rays) * (1.0 + uPulse * 0.25) * smoothstep(1.0, 0.7, r);
  gl_FragColor = vec4(vec3(1.0, 0.86, 0.68) * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
const SPRITE_VERT = /* glsl */ `
varying vec2 vUv;
uniform float uScale;
void main() {
  vUv = uv;
  // camera-facing quad
  vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  c.xy += position.xy * uScale;
  gl_Position = projectionMatrix * c;
}
`;

export interface StarInfo {
  pos: THREE.Vector3;
  size: number;
}

export class Stars {
  readonly group = new THREE.Group();
  private readonly mats: THREE.ShaderMaterial[] = [];
  private readonly dustMat: THREE.ShaderMaterial;
  private readonly lineMat: THREE.ShaderMaterial;
  private readonly lines: THREE.LineSegments;
  private readonly bright: StarInfo[] = [];
  readonly sun: THREE.Mesh;
  private readonly sunMat: THREE.ShaderMaterial;
  /** Constellation cycle: drawing → shown → fading → pause. */
  private cState = 0;
  private cTime = 0;
  private cSegments = 0;

  constructor(sunDir: THREE.Vector3) {
    const shells: [number, number, number][] = [
      // count, radius, size scale
      [5200, 3400, 0.8],
      [2600, 2600, 1.05],
      [700, 1900, 1.35],
    ];
    const v = new THREE.Vector3();
    for (const [count, radius, scale] of shells) {
      const pos = new Float32Array(count * 3);
      const size = new Float32Array(count);
      const temp = new Float32Array(count);
      const phase = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        // denser near the nebula's galactic plane
        randDir(v);
        if (rnd() < 0.45) {
          const n = new THREE.Vector3(0.25, 1, 0.35).normalize();
          v.addScaledVector(n, -v.dot(n) * (0.6 + rnd() * 0.35)).normalize();
        }
        pos.set([v.x * radius, v.y * radius, v.z * radius], i * 3);
        // a few bright stars, many faint ones
        const m = Math.pow(rnd(), 9);
        size[i] = (0.7 + m * 3.4) * scale;
        temp[i] = Math.min(1, Math.max(0, 0.55 + (rnd() - 0.5) * 0.9));
        phase[i] = rnd();
        if (size[i] > 2.4 && this.bright.length < 120) this.bright.push({ pos: v.clone().multiplyScalar(radius), size: size[i] });
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
      g.setAttribute('aTemp', new THREE.BufferAttribute(temp, 1));
      g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
      const m = new THREE.ShaderMaterial({
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
        uniforms: { uTime: { value: 0 }, uPixel: { value: 1 }, uTwinkle: { value: 0.6 }, uBeat: { value: 0 }, uWarp: { value: 0 } },
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      });
      this.mats.push(m);
      const pts = new THREE.Points(g, m);
      pts.frustumCulled = false;
      this.group.add(pts);
    }

    // constellations: up to 9 strokes between neighbouring bright stars
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9 * 2 * 3), 3));
    lg.setAttribute('aOrder', new THREE.BufferAttribute(new Float32Array(9 * 2), 1));
    this.lineMat = new THREE.ShaderMaterial({
      vertexShader: LINE_VERT,
      fragmentShader: LINE_FRAG,
      uniforms: { uReveal: { value: 0 }, uFade: { value: 0 }, uColor: { value: new THREE.Color(0.45, 0.62, 1.0).multiplyScalar(0.55) } },
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    this.lines = new THREE.LineSegments(lg, this.lineMat);
    this.lines.frustumCulled = false;
    this.group.add(this.lines);

    // dust
    const N = 700;
    const BOX = 60;
    const dp = new Float32Array(N * 3);
    const dv = new Float32Array(N * 3);
    const ds = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      dp.set([(rnd() - 0.5) * BOX, (rnd() - 0.5) * BOX, (rnd() - 0.5) * BOX], i * 3);
      dv.set([(rnd() - 0.5) * 0.25, (rnd() - 0.5) * 0.12, (rnd() - 0.5) * 0.25], i * 3);
      ds[i] = 0.4 + rnd() * 1.2;
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    dg.setAttribute('aVel', new THREE.BufferAttribute(dv, 3));
    dg.setAttribute('aSize', new THREE.BufferAttribute(ds, 1));
    this.dustMat = new THREE.ShaderMaterial({
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: BOX }, uPixel: { value: 1 }, uWarp: { value: 0 } },
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    const dust = new THREE.Points(dg, this.dustMat);
    dust.frustumCulled = false;
    this.group.add(dust);

    // the sun, far away
    this.sunMat = new THREE.ShaderMaterial({
      vertexShader: SPRITE_VERT,
      fragmentShader: SUN_FRAG,
      uniforms: { uTime: { value: 0 }, uPulse: { value: 0 }, uScale: { value: 900 } },
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    this.sun = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.sunMat);
    this.sun.position.copy(sunDir).multiplyScalar(4200);
    this.sun.frustumCulled = false;
    this.sun.renderOrder = -10;
    this.group.add(this.sun);
  }

  private newConstellation(): void {
    // a random bright star, then a walk through its nearest bright neighbours
    const pos = this.lines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const ord = this.lines.geometry.getAttribute('aOrder') as THREE.BufferAttribute;
    const start = this.bright[Math.floor(rnd() * this.bright.length)];
    if (!start) return;
    const used = new Set<StarInfo>([start]);
    const chain: StarInfo[] = [start];
    const dirOf = (s: StarInfo) => s.pos.clone().normalize();
    const segs: [StarInfo, StarInfo][] = [];
    let cur = start;
    const count = 4 + Math.floor(rnd() * 5);
    for (let k = 0; k < count; k++) {
      const d0 = dirOf(cur);
      let best: StarInfo | null = null;
      let bestA = Infinity;
      for (const s of this.bright) {
        if (used.has(s)) continue;
        const a = d0.angleTo(dirOf(s));
        if (a > 0.04 && a < 0.32 && a < bestA) {
          bestA = a;
          best = s;
        }
      }
      if (!best) break;
      // sometimes branch from an earlier star, like real figures
      const from = k > 1 && rnd() < 0.3 ? chain[Math.floor(rnd() * chain.length)] : cur;
      segs.push([from, best]);
      used.add(best);
      chain.push(best);
      cur = best;
    }
    for (let k = 0; k < 9; k++) {
      const s = segs[k];
      const a = s ? s[0].pos : start.pos;
      const b = s ? s[1].pos : start.pos;
      // slightly in front of the shell so the line sits on its stars
      pos.setXYZ(k * 2, a.x * 0.99, a.y * 0.99, a.z * 0.99);
      pos.setXYZ(k * 2 + 1, b.x * 0.99, b.y * 0.99, b.z * 0.99);
      ord.setX(k * 2, k);
      ord.setX(k * 2 + 1, k + 0.0001);
    }
    pos.needsUpdate = true;
    ord.needsUpdate = true;
    this.cSegments = segs.length;
  }

  update(time: number, dt: number, camPos: THREE.Vector3, pixel: number, react: { beat: number; warp: number; energy: number }): void {
    for (const m of this.mats) {
      m.uniforms.uTime.value = time;
      m.uniforms.uPixel.value = pixel;
      m.uniforms.uBeat.value = react.beat;
      m.uniforms.uWarp.value = react.warp;
      m.uniforms.uTwinkle.value = 0.5 + react.energy * 0.5;
    }
    this.dustMat.uniforms.uTime.value = time;
    this.dustMat.uniforms.uCam.value.copy(camPos);
    this.dustMat.uniforms.uPixel.value = pixel;
    this.dustMat.uniforms.uWarp.value = react.warp;
    this.sunMat.uniforms.uTime.value = time;
    this.sunMat.uniforms.uPulse.value = react.beat;
    // the stars sit around the camera (they are "at infinity"), only the shells' radii differ
    this.group.position.set(0, 0, 0);
    // constellation cycle
    this.cTime += dt;
    const u = this.lineMat.uniforms;
    if (this.cState === 0) {
      if (this.cTime > 4) {
        this.newConstellation();
        this.cState = 1;
        this.cTime = 0;
      }
      u.uFade.value = 0;
    } else if (this.cState === 1) {
      u.uReveal.value = this.cTime * 1.1;
      u.uFade.value = 1;
      if (u.uReveal.value > this.cSegments + 1) {
        this.cState = 2;
        this.cTime = 0;
      }
    } else if (this.cState === 2) {
      u.uFade.value = 1;
      if (this.cTime > 6) {
        this.cState = 3;
        this.cTime = 0;
      }
    } else {
      u.uFade.value = Math.max(0, 1 - this.cTime / 2.5);
      if (this.cTime > 2.5) {
        this.cState = 0;
        this.cTime = 0;
      }
    }
  }
}
