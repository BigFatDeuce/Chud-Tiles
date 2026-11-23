// Feature frames: the single description of sound that every part of Chud Tiles works from.
//
// The same function runs in three places:
//   · the analysis worker (local files, whole track, Mode B)
//   · inside YouTube's own player frame (Mode A / learning), injected through its source text
//   · Node, for the unit tests
// That is why `createFrameAnalyzer` must stay SELF-CONTAINED: no import, no reference to anything
// outside its own body (its `toString()` is what gets injected), plain ES2020 syntax only.
//
// Frame layout (FRAME_SIZE floats):
//   0..7    spectral flux per band (SuperFlux: log magnitude, max-filtered reference two hops back)
//   8..15   band energy, dB (relative, ~0 dB = full-scale sine)
//   16..27  chroma (12 pitch classes, 110 Hz – 5 kHz), sums to 1 (0 when silent)
//   28      RMS of the window (linear)
//   29      spectral centroid (kHz)
//   30      spectral flatness (0 tonal … 1 noise)
//   31      total flux (all bands)

export const FRAME_SIZE = 32;
export const WIN = 2048;
export const HOP = 512;
export const NBANDS = 8;
export const F_FLUX = 0;
export const F_ENERGY = 8;
export const F_CHROMA = 16;
export const F_RMS = 28;
export const F_CENTROID = 29;
export const F_FLAT = 30;
export const F_TFLUX = 31;
/** Band edges in Hz: sub, kick, bass, low-mid, mid, presence (snare crack), cymbals, air. */
export const BAND_EDGES = [20, 60, 150, 400, 1000, 2500, 6000, 12000, 20000];

export interface FrameAnalyzer {
  /** Feeds samples (any length); calls `onFrame` for every completed hop. */
  push(block: Float32Array, onFrame: (frame: Float32Array) => void): void;
  readonly sampleRate: number;
  readonly hop: number;
  readonly win: number;
  /** Seconds between the last pushed sample and the centre of the frame just emitted. */
  readonly lag: number;
  reset(): void;
}

export function createFrameAnalyzer(sampleRate: number): FrameAnalyzer {
  const N = 2048;
  const H = 512;
  const HALF = N / 2;
  const NB = 8;
  const SIZE = 32;
  const edges = [20, 60, 150, 400, 1000, 2500, 6000, 12000, 20000];
  const LAMBDA = 300;
  const binHz = sampleRate / N;

  // ── FFT tables (radix-2, in place) ──
  const levels = Math.round(Math.log2(N));
  const rev = new Uint32Array(N);
  for (let i = 0; i < N; i++) {
    let r = 0;
    for (let b = 0; b < levels; b++) r |= ((i >> b) & 1) << (levels - 1 - b);
    rev[i] = r;
  }
  const cosT = new Float64Array(HALF);
  const sinT = new Float64Array(HALF);
  for (let i = 0; i < HALF; i++) {
    cosT[i] = Math.cos((2 * Math.PI * i) / N);
    sinT[i] = Math.sin((2 * Math.PI * i) / N);
  }
  const hann = new Float64Array(N);
  for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  // amplitude of a full-scale sine after the Hann window: N/4
  const norm = 4 / N;

  // ── bin maps ──
  const bandOf = new Int8Array(HALF + 1).fill(-1);
  for (let k = 1; k <= HALF; k++) {
    const f = k * binHz;
    for (let b = 0; b < NB; b++) if (f >= edges[b] && f < edges[b + 1]) bandOf[k] = b;
  }
  const chromaOf = new Int8Array(HALF + 1).fill(-1);
  for (let k = 1; k <= HALF; k++) {
    const f = k * binHz;
    if (f >= 110 && f <= 5000) chromaOf[k] = ((Math.round(12 * Math.log2(f / 440) + 69) % 12) + 12) % 12;
  }
  const flatLo = Math.max(1, Math.floor(200 / binHz));
  const flatHi = Math.min(HALF, Math.floor(12000 / binHz));

  // ── state ──
  const ring = new Float32Array(N);
  let filled = 0; // samples written since the last frame
  let pos = 0; // write position in the ring
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const mag = new Float64Array(HALF + 1);
  const logm = new Float64Array(HALF + 1);
  // log spectra of the two previous frames (SuperFlux compares with t-2, max-filtered over ±1 bin)
  const prev1 = new Float64Array(HALF + 1);
  const prev2 = new Float64Array(HALF + 1);
  const out = new Float32Array(SIZE);
  const bandE = new Float64Array(NB);
  const bandF = new Float64Array(NB);
  const chroma = new Float64Array(12);

  function fft(): void {
    for (let i = 0; i < N; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1;
      const step = N / size;
      for (let start = 0; start < N; start += size) {
        for (let k = 0; k < half; k++) {
          const c = cosT[k * step];
          const s = sinT[k * step];
          const a = start + k;
          const b = a + half;
          const tr = re[b] * c + im[b] * s;
          const ti = im[b] * c - re[b] * s;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }

  function frame(): Float32Array {
    // window the last N samples, oldest first
    let sumSq = 0;
    for (let i = 0; i < N; i++) {
      const v = ring[(pos + i) % N];
      sumSq += v * v;
      re[i] = v * hann[i];
      im[i] = 0;
    }
    fft();
    let cNum = 0;
    let cDen = 0;
    let logSum = 0;
    let linSum = 0;
    let flatN = 0;
    bandE.fill(0);
    bandF.fill(0);
    chroma.fill(0);
    for (let k = 1; k <= HALF; k++) {
      const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]) * norm;
      mag[k] = m;
      logm[k] = Math.log(1 + LAMBDA * m);
      const b = bandOf[k];
      if (b >= 0) {
        bandE[b] += m * m;
        // SuperFlux: rise against the max of the neighbouring bins two hops back (vibrato-proof)
        const ref = Math.max(prev2[k - 1], prev2[k], k < HALF ? prev2[k + 1] : 0);
        const d = logm[k] - ref;
        if (d > 0) bandF[b] += d;
      }
      const c = chromaOf[k];
      if (c >= 0) chroma[c] += m;
      const f = k * binHz;
      if (f >= 60 && f <= 12000) {
        cNum += f * m;
        cDen += m;
      }
      if (k >= flatLo && k <= flatHi) {
        const p = m * m + 1e-12;
        logSum += Math.log(p);
        linSum += p;
        flatN++;
      }
    }
    let tflux = 0;
    for (let b = 0; b < NB; b++) {
      out[b] = bandF[b];
      tflux += bandF[b];
      out[NB + b] = 10 * Math.log10(bandE[b] + 1e-10);
    }
    let cs = 0;
    for (let c = 0; c < 12; c++) cs += chroma[c];
    for (let c = 0; c < 12; c++) out[16 + c] = cs > 1e-6 ? chroma[c] / cs : 0;
    out[28] = Math.sqrt(sumSq / N);
    out[29] = cDen > 1e-9 ? cNum / cDen / 1000 : 0;
    out[30] = flatN > 0 && linSum > 0 ? Math.exp(logSum / flatN) / (linSum / flatN) : 1;
    out[31] = tflux;
    // shift the log spectra
    prev2.set(prev1);
    prev1.set(logm);
    return out;
  }

  return {
    sampleRate,
    hop: H,
    win: N,
    lag: (N / 2) / sampleRate,
    push(block, onFrame) {
      for (let i = 0; i < block.length; i++) {
        ring[pos] = block[i];
        pos = (pos + 1) % N;
        if (++filled === H) {
          filled = 0;
          onFrame(frame());
        }
      }
    },
    reset() {
      ring.fill(0);
      prev1.fill(0);
      prev2.fill(0);
      filled = 0;
      pos = 0;
    },
  };
}
