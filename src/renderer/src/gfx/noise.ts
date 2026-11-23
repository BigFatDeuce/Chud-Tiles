import * as THREE from 'three';

// One small tileable 3D noise texture shared by every procedural shader (nebula, planet, rings,
// moons, asteroids). Sampling it with hardware trilinear filtering costs one texture fetch per
// octave, where computing gradient noise in the shader costs dozens of instructions: the univers
// stays cheap enough for integrated GPUs.

let tex: THREE.Data3DTexture | null = null;

/** 64³ texels, smooth value noise with 8 lattice cells per repeat (quintic interpolation). */
export function noiseTexture(): THREE.Data3DTexture {
  if (tex) return tex;
  const N = 64;
  const L = 8;
  const C = N / L;
  let seed = 0x2f6b3a1d;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const lat = new Float32Array(L * L * L);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  const at = (x: number, y: number, z: number) => lat[((z % L) * L + (y % L)) * L + (x % L)];
  const q = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const data = new Uint8Array(N * N * N);
  let k = 0;
  for (let z = 0; z < N; z++) {
    const iz = Math.floor(z / C);
    const tz = q(z / C - iz);
    for (let y = 0; y < N; y++) {
      const iy = Math.floor(y / C);
      const ty = q(y / C - iy);
      for (let x = 0; x < N; x++) {
        const ix = Math.floor(x / C);
        const tx = q(x / C - ix);
        const a = at(ix, iy, iz) + (at(ix + 1, iy, iz) - at(ix, iy, iz)) * tx;
        const b = at(ix, iy + 1, iz) + (at(ix + 1, iy + 1, iz) - at(ix, iy + 1, iz)) * tx;
        const c = at(ix, iy, iz + 1) + (at(ix + 1, iy, iz + 1) - at(ix, iy, iz + 1)) * tx;
        const d = at(ix, iy + 1, iz + 1) + (at(ix + 1, iy + 1, iz + 1) - at(ix, iy + 1, iz + 1)) * tx;
        const e = a + (b - a) * ty;
        const f = c + (d - c) * ty;
        data[k++] = Math.round((e + (f - e) * tz) * 255);
      }
    }
  }
  tex = new THREE.Data3DTexture(data, N, N, N);
  tex.format = THREE.RedFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

/** GLSL: `noise(p)` in [0, 1] (p in lattice units, repeats every 8), `fbm(p)` 5 octaves, `fbm3` 3. */
export const NOISE_GLSL = /* glsl */ `
uniform highp sampler3D uNoise;
float noise(vec3 p) { return texture(uNoise, p * 0.125).r; }
float fbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + vec3(0.37, 0.71, 0.19); a *= 0.5; }
  return s * 1.0323;
}
float fbm3(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * noise(p); p = p * 2.03 + vec3(0.37, 0.71, 0.19); a *= 0.5; }
  return s * 1.1429;
}
`;

/** Star colour from a temperature-like parameter (0 red-orange … 0.5 white … 1 blue). */
export const STAR_COLOR_GLSL = /* glsl */ `
vec3 starColor(float k) {
  vec3 warm = vec3(1.0, 0.72, 0.45);
  vec3 white = vec3(1.0, 0.96, 0.92);
  vec3 cool = vec3(0.62, 0.76, 1.0);
  return k < 0.5 ? mix(warm, white, k * 2.0) : mix(white, cool, (k - 0.5) * 2.0);
}
`;
