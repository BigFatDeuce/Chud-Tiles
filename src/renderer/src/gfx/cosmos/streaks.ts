import * as THREE from 'three';

// Moving light: shooting stars and comets (a pool of instanced quads, spawned now and then),
// the warp lines of a jump between places, and the shockwave of a combo milestone.

const STREAK_VERT = /* glsl */ `
attribute vec2 corner;          // x: 0 tail … 1 head, y: -1 … 1 across
attribute vec3 aStart;
attribute vec3 aVel;
attribute vec4 aTime;           // birth, life, width (px), length (s of travel)
attribute vec3 aColor;
uniform float uTime;
uniform vec2 uViewport;
varying vec2 vC;
varying vec3 vColor;
varying float vFade;
void main() {
  float age = uTime - aTime.x;
  float life = aTime.y;
  vFade = (age < 0.0 || age > life) ? 0.0 : smoothstep(0.0, 0.15 * life, age) * smoothstep(life, 0.6 * life, age);
  vec3 head = aStart + aVel * age;
  vec3 tail = head - aVel * aTime.w;
  vec4 h = projectionMatrix * viewMatrix * vec4(head, 1.0);
  vec4 t = projectionMatrix * viewMatrix * vec4(tail, 1.0);
  if (h.w <= 0.0 || t.w <= 0.0 || vFade <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 hs = h.xy / h.w;
  vec2 ts = t.xy / t.w;
  vec2 dir = normalize((hs - ts) * uViewport + 1e-5);
  vec2 n = vec2(-dir.y, dir.x);
  vec4 p = mix(t, h, corner.x);
  // width tapers from the head to the tail
  float w = aTime.z * (0.25 + 0.75 * corner.x);
  p.xy += n * corner.y * w / uViewport * 2.0 * p.w;
  // the head extends a little beyond its point (round cap)
  p.xy += dir * step(0.999, corner.x) * w / uViewport * 2.0 * p.w;
  gl_Position = p;
  vC = corner;
  vColor = aColor;
}
`;
const STREAK_FRAG = /* glsl */ `
varying vec2 vC;
varying vec3 vColor;
varying float vFade;
void main() {
  float across = exp(-vC.y * vC.y * 5.0);
  float along = pow(vC.x, 2.2);
  float a = across * along * vFade;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * a * 1.6, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const WARP_VERT = /* glsl */ `
attribute vec3 aLine;           // angle, radius, phase
attribute float aEnd;           // 0 front, 1 back
uniform float uTime;
uniform float uWarp;
varying float vA;
void main() {
  float depth = 400.0;
  float z = -mod(aLine.z * depth - uTime * 900.0, depth) - 5.0;
  float len = 6.0 + uWarp * 160.0;
  float zz = z + aEnd * len;
  vec3 p = vec3(cos(aLine.x) * aLine.y, sin(aLine.x) * aLine.y, min(zz, -1.0));
  gl_Position = projectionMatrix * vec4(p, 1.0);
  vA = uWarp * (1.0 - aEnd) * smoothstep(-depth, -depth * 0.6, z);
}
`;
const WARP_FRAG = /* glsl */ `
varying float vA;
void main() {
  if (vA < 0.003) discard;
  gl_FragColor = vec4(vec3(0.6, 0.75, 1.0) * vA * 1.4, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const RING_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uAge;
uniform vec3 uColor;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float R = 0.08 + uAge * 0.9;
  float w = 0.015 + uAge * 0.08;
  float ring = exp(-pow((r - R) / w, 2.0));
  float fade = smoothstep(1.0, 0.0, uAge);
  float core = exp(-r * r * 40.0) * smoothstep(0.35, 0.0, uAge) * 2.0;
  float a = (ring + core) * fade;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
const SPRITE_VERT = /* glsl */ `
varying vec2 vUv;
uniform float uScale;
void main() {
  vUv = uv;
  vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  c.xy += position.xy * uScale;
  gl_Position = projectionMatrix * c;
}
`;

const POOL = 24;

export class Streaks {
  readonly mesh: THREE.Mesh;
  readonly warp: THREE.LineSegments;
  readonly shock: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private readonly warpMat: THREE.ShaderMaterial;
  private readonly shockMat: THREE.ShaderMaterial;
  private readonly start: THREE.InstancedBufferAttribute;
  private readonly vel: THREE.InstancedBufferAttribute;
  private readonly time: THREE.InstancedBufferAttribute;
  private readonly color: THREE.InstancedBufferAttribute;
  private next = 0;
  private nextShooting = 3;
  private nextComet = 25;
  private shockAt = -100;
  private rnd: () => number;

  constructor() {
    let seed = 0x1234abcd;
    this.rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('corner', new THREE.Float32BufferAttribute([0, -1, 1, -1, 1, 1, 0, 1], 2));
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.start = new THREE.InstancedBufferAttribute(new Float32Array(POOL * 3), 3);
    this.vel = new THREE.InstancedBufferAttribute(new Float32Array(POOL * 3), 3);
    this.time = new THREE.InstancedBufferAttribute(new Float32Array(POOL * 4).fill(-1000), 4);
    this.color = new THREE.InstancedBufferAttribute(new Float32Array(POOL * 3), 3);
    for (const a of [this.start, this.vel, this.time, this.color]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aStart', this.start);
    g.setAttribute('aVel', this.vel);
    g.setAttribute('aTime', this.time);
    g.setAttribute('aColor', this.color);
    g.instanceCount = POOL;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: STREAK_VERT,
      fragmentShader: STREAK_FRAG,
      uniforms: { uTime: { value: 0 }, uViewport: { value: new THREE.Vector2(1, 1) } },
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;

    const N = 360;
    const line = new Float32Array(N * 2 * 3);
    const end = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const a = this.rnd() * Math.PI * 2;
      const r = 4 + Math.pow(this.rnd(), 0.6) * 70;
      const ph = this.rnd();
      line.set([a, r, ph, a, r, ph], i * 6);
      end[i * 2] = 0;
      end[i * 2 + 1] = 1;
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
    wg.setAttribute('aLine', new THREE.BufferAttribute(line, 3));
    wg.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.warpMat = new THREE.ShaderMaterial({
      vertexShader: WARP_VERT,
      fragmentShader: WARP_FRAG,
      uniforms: { uTime: { value: 0 }, uWarp: { value: 0 } },
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      transparent: true,
    });
    this.warp = new THREE.LineSegments(wg, this.warpMat);
    this.warp.frustumCulled = false;
    this.warp.renderOrder = 50;

    this.shockMat = new THREE.ShaderMaterial({
      vertexShader: SPRITE_VERT,
      fragmentShader: RING_FRAG,
      uniforms: { uAge: { value: 2 }, uScale: { value: 160 }, uColor: { value: new THREE.Color(1, 0.8, 0.5) } },
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    this.shock = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.shockMat);
    this.shock.frustumCulled = false;
    this.shock.visible = false;
  }

  /** A shooting star (fast, short) or a comet (slow, long tail) somewhere in view. */
  spawn(camera: THREE.PerspectiveCamera, time: number, kind: 'shooting' | 'comet', burst = false): void {
    const r = this.rnd;
    const i = this.next;
    this.next = (this.next + 1) % POOL;
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const dist = kind === 'comet' ? 900 + r() * 600 : 250 + r() * 400;
    const spreadX = (r() - 0.5) * 1.6;
    const spreadY = (r() - 0.1) * 0.9;
    const p = camera.position.clone().addScaledVector(fwd, dist).addScaledVector(right, spreadX * dist * 0.6).addScaledVector(up, spreadY * dist * 0.4);
    const ang = (r() - 0.5) * 1.2 + (spreadX > 0 ? Math.PI : 0);
    const speed = kind === 'comet' ? 6 + r() * 6 : 160 + r() * 220;
    const v = right.clone().multiplyScalar(Math.cos(ang)).addScaledVector(up, -Math.abs(Math.sin(ang)) - 0.3).normalize().multiplyScalar(speed);
    this.start.setXYZ(i, p.x, p.y, p.z);
    this.vel.setXYZ(i, v.x, v.y, v.z);
    const life = kind === 'comet' ? 22 + r() * 10 : 0.7 + r() * 0.8;
    const width = kind === 'comet' ? 3.5 : burst ? 2.8 : 1.8 + r() * 1.2;
    const len = kind === 'comet' ? 9 + r() * 4 : 0.12 + r() * 0.12;
    this.time.setXYZW(i, time, life, width, len);
    const c = kind === 'comet' ? [0.55, 0.85, 1.0] : burst ? [1.0, 0.82, 0.55] : [0.85, 0.9, 1.0];
    this.color.setXYZ(i, c[0], c[1], c[2]);
    for (const a of [this.start, this.vel, this.time, this.color]) a.needsUpdate = true;
  }

  /** Combo milestone: a ring of light expanding behind the playfield, and a rain of stars. */
  shockwave(camera: THREE.PerspectiveCamera, time: number, color: THREE.Color): void {
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    this.shock.position.copy(camera.position).addScaledVector(fwd, 300);
    this.shockMat.uniforms.uColor.value.copy(color);
    this.shockAt = time;
    this.shock.visible = true;
    for (let k = 0; k < 5; k++) this.spawn(camera, time + k * 0.06, 'shooting', true);
  }

  update(time: number, camera: THREE.PerspectiveCamera, viewport: THREE.Vector2, warp: number, ambient: number): void {
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uViewport.value.copy(viewport);
    this.warpMat.uniforms.uTime.value = time;
    this.warpMat.uniforms.uWarp.value = warp;
    this.warp.visible = warp > 0.002;
    const age = (time - this.shockAt) / 1.6;
    this.shockMat.uniforms.uAge.value = age;
    this.shock.visible = age >= 0 && age < 1;
    if (ambient > 0) {
      if (time > this.nextShooting) {
        this.spawn(camera, time, 'shooting');
        this.nextShooting = time + (4 + this.rnd() * 9) / ambient;
      }
      if (time > this.nextComet) {
        this.spawn(camera, time, 'comet');
        this.nextComet = time + 50 + this.rnd() * 60;
      }
    }
  }
}
