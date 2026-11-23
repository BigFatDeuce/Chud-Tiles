import * as THREE from 'three';
import { NOISE_GLSL, noiseTexture } from '../noise';

// The sky: a domain-warped fractal nebula attached to view directions (it turns with the camera
// like a real sky), rendered into a small target (it is soft by nature) and drawn behind
// everything. Colour, brightness and slow flow react to the music.

const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const NEBULA_FRAG = /* glsl */ `
precision highp float;
varying vec2 vNdc;
uniform mat4 uInvProj;
uniform mat3 uCamRot;
uniform float uTime;
uniform float uEnergy;
uniform float uBeat;
uniform float uHue;
uniform float uWarp;
uniform float uFlash;
${NOISE_GLSL}

void main() {
  vec4 v = uInvProj * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize(uCamRot * normalize(v.xyz / v.w));
  float t = uTime * (0.012 + 0.02 * uEnergy);
  vec3 p = dir * 2.4 + vec3(4.0, 1.0, 2.0);
  // domain warp: the nebula folds on itself, slowly
  vec3 q = vec3(fbm3(p + vec3(0.0, 0.0, t)), fbm3(p + vec3(5.2, 1.3, -t)), fbm3(p * 1.3 + vec3(-3.1, 7.7, t * 0.7)));
  float d = fbm(p * 1.7 + q * 2.6);
  // a "galactic plane": the nebula gathers along a great circle of the sky
  vec3 planeN = normalize(vec3(0.25, 1.0, 0.35));
  float band = exp(-pow(dot(dir, planeN) * 2.1, 2.0));
  // clouds live mostly along the band; elsewhere only thin wisps over deep space
  float dens = smoothstep(0.5, 0.92, d * 0.78 + band * 0.42) * (0.25 + 0.75 * band);
  dens = dens * dens;
  // dark dust lanes cut through the glow
  float dust = smoothstep(0.48, 0.72, fbm3(p * 3.4 + q * 3.0 + 11.0));
  vec3 deep = vec3(0.03, 0.04, 0.16);
  vec3 violet = vec3(0.26, 0.07, 0.55);
  vec3 magenta = vec3(0.55, 0.05, 0.34);
  vec3 cyan = vec3(0.03, 0.32, 0.52);
  vec3 col = mix(deep, violet, smoothstep(0.3, 0.75, q.x));
  col = mix(col, magenta, smoothstep(0.52, 0.85, q.y + uHue * 0.25) * 0.75);
  col = mix(col, cyan, smoothstep(0.55, 0.92, q.z - uHue * 0.15) * 0.65);
  vec3 c = col * dens * 1.15 * (1.0 - 0.8 * dust);
  // fine bright filaments along density ridges
  float ridge = 1.0 - abs(d - 0.62) * 9.0;
  c += max(ridge, 0.0) * max(ridge, 0.0) * band * mix(cyan, vec3(0.8, 0.5, 1.0), q.y) * 0.16 * (1.0 - dust) * smoothstep(0.3, 0.7, dens + 0.3);
  // music: breathing brightness, beat pulse, milestone flash
  c *= 0.62 + 0.5 * uEnergy + 0.3 * uBeat;
  c += col * uFlash * 0.8 * dens;
  // base sky and a faint zodiacal glow along the band
  c += vec3(0.004, 0.005, 0.014) + band * vec3(0.006, 0.006, 0.02);
  // warp: the view narrows to a tunnel of light
  float r = length(vNdc);
  c = mix(c, c * (1.0 - 0.6 * r) + vec3(0.15, 0.2, 0.45) * pow(max(0.0, 1.0 - r), 2.0) * 0.6, uWarp);
  gl_FragColor = vec4(c, 1.0);
}
`;

const COMPOSITE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vNdc;
uniform sampler2D uTex;
void main() {
  vec3 c = texture(uTex, vNdc * 0.5 + 0.5).rgb;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Nebula {
  readonly backdrop: THREE.Mesh;
  private readonly target: THREE.WebGLRenderTarget;
  private readonly scene = new THREE.Scene();
  private readonly cam = new THREE.Camera();
  private readonly mat: THREE.ShaderMaterial;
  scale = 0.4;
  /** Render every n-th frame (menus on modest GPUs). */
  every = 1;
  private frame = 0;

  constructor() {
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter });
    this.mat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: NEBULA_FRAG,
      uniforms: {
        uNoise: { value: noiseTexture() },
        uInvProj: { value: new THREE.Matrix4() },
        uCamRot: { value: new THREE.Matrix3() },
        uTime: { value: 0 },
        uEnergy: { value: 0.3 },
        uBeat: { value: 0 },
        uHue: { value: 0 },
        uWarp: { value: 0 },
        uFlash: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(tri, this.mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
    const comp = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: { uTex: { value: this.target.texture } },
      depthTest: false,
      depthWrite: false,
    });
    this.backdrop = new THREE.Mesh(tri, comp);
    this.backdrop.frustumCulled = false;
    this.backdrop.renderOrder = -1000;
  }

  get uniforms() {
    return this.mat.uniforms;
  }

  resize(w: number, h: number): void {
    this.target.setSize(Math.max(2, Math.round(w * this.scale)), Math.max(2, Math.round(h * this.scale)));
    this.frame = 0;
  }

  render(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, time: number): void {
    if (this.frame++ % this.every !== 0) return;
    const u = this.mat.uniforms;
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    u.uCamRot.value.setFromMatrix4(camera.matrixWorld);
    u.uTime.value = time;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.cam);
    renderer.setRenderTarget(prev);
  }

  dispose(): void {
    this.target.dispose();
  }
}
