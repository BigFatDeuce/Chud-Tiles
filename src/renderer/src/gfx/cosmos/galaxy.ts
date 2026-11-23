import * as THREE from 'three';

// A distant spiral galaxy: logarithmic arms of stars and dust, a warm core, differential rotation
// computed in the vertex shader (inner stars turn faster), so it costs nothing on the CPU.

const VERT = /* glsl */ `
attribute float aR;
attribute float aA;
attribute float aH;
attribute float aSize;
attribute vec3 aColor;
uniform float uTime;
uniform float uProj;
uniform float uScale;
varying vec3 vColor;
void main() {
  float a = aA + uTime * 0.03 / (0.25 + aR);
  vec3 p = vec3(cos(a) * aR, aH, sin(a) * aR);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uScale * uProj / -mv.z, 1.0, 12.0);
  vColor = aColor;
}
`;
const FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float a = exp(-dot(p, p) * 3.5);
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Galaxy {
  readonly points: THREE.Points;
  private readonly mat: THREE.ShaderMaterial;

  constructor(position: THREE.Vector3, radius: number) {
    let seed = 0x9e3779b9;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const gauss = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;
    const N = 22000;
    const R = new Float32Array(N);
    const A = new Float32Array(N);
    const H = new Float32Array(N);
    const S = new Float32Array(N);
    const C = new Float32Array(N * 3);
    const core = new THREE.Color(1.0, 0.85, 0.62);
    const arm = new THREE.Color(0.45, 0.55, 1.0);
    const pink = new THREE.Color(1.0, 0.45, 0.8);
    const c = new THREE.Color();
    const ARMS = 2;
    for (let i = 0; i < N; i++) {
      const bulge = rnd() < 0.22;
      const r = bulge ? Math.abs(gauss()) * 0.22 : 0.08 + Math.pow(rnd(), 0.8) * 0.92;
      const armIdx = Math.floor(rnd() * ARMS);
      // log spiral: angle grows with log radius; stars scatter around the arm
      const spread = (bulge ? 3.14 : 0.32 + r * 0.25) * gauss();
      const a = armIdx * ((Math.PI * 2) / ARMS) + Math.log(r + 0.05) * 2.6 + spread;
      R[i] = r;
      A[i] = a;
      H[i] = gauss() * (bulge ? 0.07 : 0.018) * (1 - r * 0.5);
      const hot = Math.pow(rnd(), 6);
      S[i] = (0.004 + hot * 0.012) * (bulge ? 1.2 : 1);
      if (bulge) c.copy(core).multiplyScalar(0.55 + rnd() * 0.5);
      else {
        c.copy(arm).lerp(core, Math.max(0, 0.5 - r)).multiplyScalar(0.25 + rnd() * 0.45);
        // star-forming regions along the arms
        if (rnd() < 0.06) c.copy(pink).multiplyScalar(0.6 + rnd() * 0.4);
      }
      C.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('aR', new THREE.BufferAttribute(R, 1));
    g.setAttribute('aA', new THREE.BufferAttribute(A, 1));
    g.setAttribute('aH', new THREE.BufferAttribute(H, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(S, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(C, 3));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 }, uProj: { value: 1000 }, uScale: { value: radius } },
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.position.copy(position);
    this.points.scale.setScalar(radius);
    this.points.rotation.set(0.9, 0.4, -0.35);
  }

  /** proj: pixels per world unit at distance 1 (drawing-buffer height / 2 / tan(fov / 2)). */
  update(time: number, proj: number): void {
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uProj.value = proj;
  }
}
