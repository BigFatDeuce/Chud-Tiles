import * as THREE from 'three';

// An asteroid belt around the planet: one instanced mesh, orbits and tumbling computed in the
// vertex shader (no per-frame CPU work), rough rocks displaced once at start-up.

const VERT = /* glsl */ `
attribute vec4 aOrbit;   // radius, start angle, height, angular speed
attribute vec4 aSpin;    // axis (xyz), speed
attribute float aScale;
uniform float uTime;
uniform mat4 uBelt;
varying vec3 vN;
varying vec3 vWorld;
varying float vShade;
vec3 rotate(vec3 v, vec3 k, float a) {
  float c = cos(a), s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}
void main() {
  float a = aOrbit.y + uTime * aOrbit.w;
  vec3 centre = (uBelt * vec4(cos(a) * aOrbit.x, aOrbit.z, sin(a) * aOrbit.x, 1.0)).xyz;
  float spin = uTime * aSpin.w;
  vec3 p = rotate(position, aSpin.xyz, spin) * aScale;
  vN = rotate(normal, aSpin.xyz, spin);
  vWorld = centre + p;
  vShade = 0.7 + 0.3 * fract(aSpin.w * 91.7);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;
const FRAG = /* glsl */ `
varying vec3 vN;
varying vec3 vWorld;
varying float vShade;
uniform vec3 uSun;
void main() {
  vec3 n = normalize(vN);
  float l = max(dot(n, uSun), 0.0);
  vec3 v = normalize(cameraPosition - vWorld);
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 base = vec3(0.2, 0.18, 0.22) * vShade;
  vec3 c = base * (0.03 + 0.9 * l) + vec3(0.2, 0.25, 0.6) * rim * 0.15;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Asteroids {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;

  constructor(sunDir: THREE.Vector3, count = 320) {
    let seed = 0x7f4a7c15;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    // one rough rock: an icosphere pushed in and out
    const base = new THREE.IcosahedronGeometry(1, 2);
    const pos = base.getAttribute('position') as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const k = 0.75 + 0.3 * Math.sin(v.x * 3.1 + 1.3) * Math.sin(v.y * 2.7 + 0.4) * Math.sin(v.z * 3.7 + 2.1) + 0.12 * Math.sin(v.x * 9 + v.y * 7);
      v.multiplyScalar(k);
      v.x *= 1.25;
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    base.computeVertexNormals();
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('normal', base.getAttribute('normal'));
    const orbit = new Float32Array(count * 4);
    const spin = new Float32Array(count * 4);
    const scale = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = 165 + (rnd() + rnd()) * 28;
      orbit.set([r, rnd() * Math.PI * 2, (rnd() + rnd() - 1) * 5, 0.012 * Math.pow(150 / r, 1.5) * (0.9 + rnd() * 0.2)], i * 4);
      const ax = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
      spin.set([ax.x, ax.y, ax.z, 0.1 + rnd() * 0.6], i * 4);
      scale[i] = 0.25 + Math.pow(rnd(), 3) * 2.2;
    }
    g.setAttribute('aOrbit', new THREE.InstancedBufferAttribute(orbit, 4));
    g.setAttribute('aSpin', new THREE.InstancedBufferAttribute(spin, 4));
    g.setAttribute('aScale', new THREE.InstancedBufferAttribute(scale, 1));
    g.instanceCount = count;
    const belt = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.1, 0, 0.3));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 }, uBelt: { value: belt }, uSun: { value: sunDir.clone().normalize() } },
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
  }

  update(time: number): void {
    this.mat.uniforms.uTime.value = time;
  }
}
