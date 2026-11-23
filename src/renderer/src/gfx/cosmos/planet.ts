import * as THREE from 'three';
import { NOISE_GLSL, noiseTexture } from '../noise';

// The planet of the station: a banded gas giant (bands flow at different speeds, storms turn),
// a scattering atmosphere that breathes with the bass, rings with the planet's shadow cast on
// them and their own shadow on the planet, and two moons whose shadows cross the clouds
// (eclipses). Everything is lit by the same far sun.

export const PLANET_R = 30;

const PLANET_VERT = /* glsl */ `
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vObj = position / ${PLANET_R.toFixed(1)};
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const SHADOWS_GLSL = /* glsl */ `
uniform vec3 uSun;
uniform vec4 uMoon[2];       // xyz centre, w radius (world)
uniform vec3 uPlanetC;
uniform float uPlanetR;
uniform vec3 uRingN;
uniform vec2 uRingR;         // inner, outer radius
float sphereShadow(vec3 p, vec4 s) {
  vec3 oc = s.xyz - p;
  float along = dot(oc, uSun);
  if (along <= 0.0) return 1.0;
  float d = length(oc - uSun * along);
  // penumbra grows with distance
  float pen = s.w * 0.25 + along * 0.004;
  return smoothstep(s.w - pen, s.w + pen, d);
}
float ringDensity(float r) {
  float x = (r - uRingR.x) / (uRingR.y - uRingR.x);
  if (x < 0.0 || x > 1.0) return 0.0;
  float d = 0.6 + 0.18 * sin(x * 37.0) + 0.1 * sin(x * 113.0 + 1.3) + 0.06 * sin(x * 291.0);
  d *= smoothstep(0.0, 0.06, x) * smoothstep(1.0, 0.85, x);
  d *= 1.0 - 0.85 * smoothstep(0.012, 0.0, abs(x - 0.62)); // the great gap
  d *= 1.0 - 0.5 * smoothstep(0.01, 0.0, abs(x - 0.31));
  return clamp(d, 0.0, 1.0);
}
`;

const PLANET_FRAG = /* glsl */ `
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vNormal;
uniform float uTime;
uniform float uBass;
uniform vec3 uBandA;
uniform vec3 uBandB;
uniform vec3 uBandC;
uniform vec3 uStorm;
${NOISE_GLSL}
${SHADOWS_GLSL}
void main() {
  vec3 n = normalize(vNormal);
  vec3 p = normalize(vObj);
  float lat = p.y;
  // differential rotation: each latitude turns at its own speed
  float lon = atan(p.z, p.x) + uTime * (0.018 + 0.012 * sin(lat * 9.0));
  vec3 q = vec3(cos(lon) * sqrt(1.0 - lat * lat), lat, sin(lon) * sqrt(1.0 - lat * lat));
  float turb = fbm(q * 3.0 + vec3(0.0, uTime * 0.01, 0.0));
  float bands = sin(lat * 15.0 + turb * 3.2) * 0.5 + 0.5;
  float fine = fbm(vec3(lat * 40.0, q.x * 2.0 + turb, q.z * 2.0));
  vec3 col = mix(uBandA, uBandB, smoothstep(0.2, 0.8, bands));
  col = mix(col, uBandC, smoothstep(0.55, 0.9, fine) * 0.55);
  // a great storm, turning
  vec2 sc = vec2(lon - 1.2 - uTime * 0.004, (lat + 0.32) * 2.6);
  sc.x = mod(sc.x + 3.14159, 6.28318) - 3.14159;
  float sd = length(sc * vec2(1.0, 1.7));
  float swirl = fbm(vec3(sc * 4.0 + vec2(sin(sd * 9.0 - uTime * 0.3), cos(sd * 9.0 - uTime * 0.3)) * 0.4, 3.0));
  col = mix(col, uStorm * (0.8 + 0.4 * swirl), smoothstep(0.42, 0.18, sd) * 0.85);
  // lighting: soft terminator, ring and moon shadows
  float ndl = dot(n, uSun);
  float light = smoothstep(-0.12, 0.45, ndl);
  float sh = sphereShadow(vWorld, uMoon[0]) * sphereShadow(vWorld, uMoon[1]);
  float tr = -dot(vWorld - uPlanetC, uRingN) / dot(uSun, uRingN);
  if (tr > 0.0) {
    vec3 hit = vWorld + uSun * tr;
    sh *= 1.0 - 0.75 * ringDensity(length(hit - uPlanetC));
  }
  vec3 c = col * light * sh * 0.95;
  // night side: faint aurora around the poles, pulsing with the bass
  float aur = smoothstep(0.78, 0.92, abs(lat)) * (0.5 + 0.5 * sin(lon * 6.0 + uTime * 0.7)) * (0.25 + uBass);
  c += vec3(0.15, 0.85, 0.7) * aur * (1.0 - light) * 0.35;
  // limb darkening on the day side
  vec3 v = normalize(cameraPosition - vWorld);
  float mu = max(dot(n, v), 0.0);
  c *= 0.55 + 0.45 * pow(mu, 0.5);
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const ATMO_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const ATMO_FRAG = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
uniform vec3 uSun;
uniform float uBass;
uniform vec3 uColor;
uniform vec3 uRim;
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(cameraPosition - vWorld);
  // seen from inside the shell (back faces): glow strongest at the limb
  float rim = 1.0 - abs(dot(n, v));
  float glow = pow(rim, 5.0);
  float day = smoothstep(-0.35, 0.6, dot(n, uSun));
  // forward scattering: the sun behind the planet lights a bright crescent (eclipse)
  float fwd = pow(max(dot(-v, uSun), 0.0), 8.0) * pow(rim, 2.0) * 2.5;
  vec3 c = mix(uColor, uRim, rim) * glow * (0.1 + day * 0.65) * (1.0 + uBass * 0.8) + uRim * fwd * 0.8;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const RING_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vLocal;
void main() {
  vLocal = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const RING_FRAG = /* glsl */ `
varying vec3 vWorld;
varying vec3 vLocal;
uniform float uTime;
uniform float uBeat;
${NOISE_GLSL}
${SHADOWS_GLSL}
void main() {
  float r = length(vLocal.xy);
  float d = ringDensity(r);
  if (d < 0.01) discard;
  float x = (r - uRingR.x) / (uRingR.y - uRingR.x);
  float a = atan(vLocal.y, vLocal.x);
  // clumps travelling along the ring
  float clump = noise(vec3(cos(a - uTime * 0.02 / (0.6 + x)) * 6.0, sin(a - uTime * 0.02 / (0.6 + x)) * 6.0, x * 30.0));
  d *= 0.75 + 0.5 * clump;
  vec3 col = mix(vec3(0.5, 0.38, 0.26), vec3(0.3, 0.26, 0.5), smoothstep(0.2, 0.9, x));
  col = mix(col, vec3(0.5, 0.26, 0.4), smoothstep(0.55, 0.75, sin(x * 23.0) * 0.5 + 0.5) * 0.35);
  // the planet's shadow on the rings
  vec3 oc = uPlanetC - vWorld;
  float along = dot(oc, uSun);
  float shadow = 1.0;
  if (along > 0.0) shadow = smoothstep(uPlanetR * 0.97, uPlanetR * 1.04, length(oc - uSun * along));
  // seen against the sun: forward scattering makes thin rings glow
  vec3 v = normalize(cameraPosition - vWorld);
  float fwd = pow(max(dot(-v, uSun), 0.0), 6.0) * 1.4;
  vec3 c = col * d * (0.12 + 0.88 * shadow) * (0.75 + fwd + uBeat * 0.2);
  gl_FragColor = vec4(c, d * 0.7);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const MOON_FRAG = /* glsl */ `
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vNormal;
uniform vec3 uSun;
uniform vec3 uTint;
uniform vec3 uPlanetC;
uniform float uPlanetR;
${NOISE_GLSL}
void main() {
  vec3 n = normalize(vNormal);
  vec3 p = normalize(vObj);
  float h = fbm(p * 4.0);
  // craters: rings in a cellular-looking noise
  float cr = noise(p * 9.0);
  float crater = smoothstep(0.62, 0.7, cr) - smoothstep(0.7, 0.8, cr) * 0.6;
  vec3 col = uTint * (0.55 + 0.6 * h) * (1.0 - crater * 0.35);
  float light = smoothstep(-0.05, 0.5, dot(n, uSun));
  // the planet's shadow on the moon (lunar eclipse)
  vec3 oc = uPlanetC - vWorld;
  float along = dot(oc, uSun);
  if (along > 0.0) light *= smoothstep(uPlanetR * 0.95, uPlanetR * 1.08, length(oc - uSun * along)) * 0.9 + 0.1;
  gl_FragColor = vec4(col * light, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
const MOON_VERT = /* glsl */ `
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vObj = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

interface Moon {
  mesh: THREE.Mesh;
  radius: number;
  orbit: number;
  period: number;
  incl: number;
  phase: number;
}

export class Planet {
  readonly group = new THREE.Group();
  private readonly tilt = new THREE.Group();
  private readonly surface: THREE.ShaderMaterial;
  private readonly atmo: THREE.ShaderMaterial;
  private readonly ring: THREE.ShaderMaterial;
  private readonly moons: Moon[] = [];
  private readonly shared: Record<string, THREE.IUniform>;

  constructor(sunDir: THREE.Vector3) {
    const R = PLANET_R;
    this.group.add(this.tilt);
    this.tilt.rotation.set(0.12, 0, 0.36);
    const ringN = new THREE.Vector3(0, 1, 0).applyEuler(this.tilt.rotation);
    this.shared = {
      uSun: { value: sunDir.clone().normalize() },
      uMoon: { value: [new THREE.Vector4(0, 0, 0, 1), new THREE.Vector4(0, 0, 0, 1)] },
      uPlanetC: { value: new THREE.Vector3() },
      uPlanetR: { value: R },
      uRingN: { value: ringN },
      uRingR: { value: new THREE.Vector2(R * 1.42, R * 2.35) },
      uNoise: { value: noiseTexture() },
      uTime: { value: 0 },
      uBass: { value: 0 },
      uBeat: { value: 0 },
    };
    this.surface = new THREE.ShaderMaterial({
      vertexShader: PLANET_VERT,
      fragmentShader: PLANET_FRAG,
      uniforms: {
        ...this.shared,
        uBandA: { value: new THREE.Color(0.045, 0.035, 0.15) },
        uBandB: { value: new THREE.Color(0.2, 0.1, 0.42) },
        uBandC: { value: new THREE.Color(0.12, 0.38, 0.6) },
        uStorm: { value: new THREE.Color(0.6, 0.16, 0.42) },
      },
    });
    const body = new THREE.Mesh(new THREE.SphereGeometry(R, 128, 96), this.surface);
    this.tilt.add(body);

    this.atmo = new THREE.ShaderMaterial({
      vertexShader: ATMO_VERT,
      fragmentShader: ATMO_FRAG,
      uniforms: { ...this.shared, uColor: { value: new THREE.Color(0.25, 0.35, 0.95) }, uRim: { value: new THREE.Color(0.45, 0.85, 1.0) } },
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.075, 96, 64), this.atmo);
    this.tilt.add(atmo);

    this.ring = new THREE.ShaderMaterial({
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      uniforms: { ...this.shared },
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    const ringGeo = new THREE.RingGeometry(R * 1.42, R * 2.35, 256, 1);
    const ring = new THREE.Mesh(ringGeo, this.ring);
    ring.rotation.x = -Math.PI / 2; // ring geometry lies in XY: put it in the equatorial plane
    ring.renderOrder = 2;
    this.tilt.add(ring);

    const moonDefs: [number, number, number, number, number, THREE.Color][] = [
      // radius, orbit, period (s), inclination, phase, tint
      [3.6, 92, 140, 0.16, 0.8, new THREE.Color(0.75, 0.72, 0.8)],
      [2.2, 128, 230, -0.32, 3.4, new THREE.Color(0.85, 0.66, 0.55)],
    ];
    for (const [radius, orbit, period, incl, phase, tint] of moonDefs) {
      const m = new THREE.ShaderMaterial({ vertexShader: MOON_VERT, fragmentShader: MOON_FRAG, uniforms: { ...this.shared, uTint: { value: tint } } });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), m);
      this.group.add(mesh);
      this.moons.push({ mesh, radius, orbit, period, incl, phase });
    }
  }

  /** World position of a moon (camera targets, tests). */
  moonPosition(i: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.moons[i].mesh.position);
  }

  update(time: number, react: { bass: number; beat: number }): void {
    this.shared.uTime.value = time;
    this.shared.uBass.value = react.bass;
    this.shared.uBeat.value = react.beat;
    for (let i = 0; i < this.moons.length; i++) {
      const m = this.moons[i];
      const a = m.phase + (time / m.period) * Math.PI * 2;
      m.mesh.position.set(Math.cos(a) * m.orbit, Math.sin(a) * Math.sin(m.incl) * m.orbit, Math.sin(a) * Math.cos(m.incl) * m.orbit);
      m.mesh.rotation.y = a * 0.5;
      (this.shared.uMoon.value as THREE.Vector4[])[i].set(m.mesh.position.x, m.mesh.position.y, m.mesh.position.z, m.radius);
    }
  }
}
