import { createFrameAnalyzer, FRAME_SIZE, HOP, type FrameAnalyzer } from '@core/analysis/frame';
import type { FramesBatch, MediaClock } from './host';
import { tr } from '../i18n';

// Browser: the sound of the official player is heard through a capture of the game's own tab,
// shared by the user (getDisplayMedia, "share tab audio"). Nothing is recorded or saved: the
// samples only feed the same rhythm analyser as the desktop build, frame by frame, and are
// dropped. Frame times follow the samples and are locked onto the player's media clock (the same
// phase-locked loop as inside the desktop player, with more tolerance: the IFrame API's clock is
// read through messages).

const BUF = 2048;

export class TabCapture {
  private ctx: AudioContext;
  private node: ScriptProcessorNode;
  private src: MediaStreamAudioSourceNode;
  private an: FrameAnalyzer;
  private times: number[] = [];
  private data: number[] = [];
  private lastSend = 0;
  private pll: { m: number; k: number; rate: number } | null = null;
  private lastEnd: number | null = null;
  private silentFor = 0;
  private ended = false;

  private readonly stream: MediaStream;
  private readonly media: () => MediaClock;
  private readonly emit: (b: FramesBatch) => void;
  private readonly onEnd: () => void;

  constructor(stream: MediaStream, media: () => MediaClock, emit: (b: FramesBatch) => void, onEnd: () => void) {
    this.stream = stream;
    this.media = media;
    this.emit = emit;
    this.onEnd = onEnd;
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.an = createFrameAnalyzer(this.ctx.sampleRate);
    this.node = this.ctx.createScriptProcessor(BUF, 1, 1);
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    this.node.connect(sink);
    sink.connect(this.ctx.destination);
    this.src = this.ctx.createMediaStreamSource(stream);
    this.src.connect(this.node);
    this.node.onaudioprocess = (e) => this.process(e);
    for (const t of stream.getAudioTracks()) t.addEventListener('ended', () => this.dispose());
  }

  get alive(): boolean {
    return !this.ended && this.stream.getAudioTracks().some((t) => t.readyState === 'live');
  }

  /** Seconds of total silence while the player plays (sharing without the tab's audio). */
  get silence(): number {
    return this.silentFor;
  }

  private process(e: AudioProcessingEvent): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    const m = this.media();
    if (!m.playing) {
      this.pll = null;
      return;
    }
    const rate = m.rate || 1;
    const sr = this.ctx.sampleRate;
    const dur = BUF / sr;
    // media time at the end of this block, as the player's clock says
    const obs = m.t - (this.ctx.currentTime - (e.playbackTime - dur)) * rate;
    if (!this.pll || this.pll.rate !== rate) {
      if (this.lastEnd === null || Math.abs(obs - dur * rate - this.lastEnd) > 0.3) this.an.reset();
      this.pll = { m: obs - dur * rate, k: rate, rate };
    }
    const start = this.pll.m;
    const k = this.pll.k;
    let end = start + dur * k;
    const err = obs - end;
    if (Math.abs(err) > 0.3) {
      this.pll = null;
      this.lastEnd = null;
      this.an.reset();
      return;
    }
    end += err * 0.03;
    this.pll.k = Math.min(rate * 1.08, Math.max(rate * 0.92, k + err * 0.02));
    this.pll.m = end;
    this.lastEnd = end;
    // a mono mix of the tab's sound
    const ch = e.inputBuffer.numberOfChannels;
    const x = new Float32Array(BUF);
    for (let c = 0; c < ch; c++) {
      const d = e.inputBuffer.getChannelData(c);
      for (let i = 0; i < BUF; i++) x[i] += d[i] / ch;
    }
    let peak = 0;
    for (let i = 0; i < BUF; i += 8) peak = Math.max(peak, Math.abs(x[i]));
    this.silentFor = peak < 1e-6 ? this.silentFor + dur : 0;
    for (let j = 0; j < BUF; j += HOP) {
      const tEnd = start + ((j + HOP) / sr) * k;
      this.an.push(x.subarray(j, j + HOP), (f) => {
        this.times.push(tEnd - this.an.lag * k);
        for (let i = 0; i < FRAME_SIZE; i++) this.data.push(f[i]);
      });
    }
    if (performance.now() - this.lastSend > 45) this.flush();
  }

  private flush(): void {
    if (this.times.length) this.emit({ times: this.times, data: this.data, sampleRate: this.ctx.sampleRate });
    this.times = [];
    this.data = [];
    this.lastSend = performance.now();
  }

  dispose(): void {
    if (this.ended) return;
    this.ended = true;
    this.node.onaudioprocess = null;
    try {
      this.src.disconnect();
      this.node.disconnect();
    } catch {
      /* already gone */
    }
    for (const t of this.stream.getTracks()) t.stop();
    void this.ctx.close().catch(() => undefined);
    this.onEnd();
  }
}

/**
 * Asks the user to share this tab with its sound. Must run inside the click that asked for it.
 * Returns the stream, or a reason it cannot be used.
 */
export async function requestTabAudio(): Promise<MediaStream | { error: string }> {
  const md = navigator.mediaDevices;
  if (!md?.getDisplayMedia) return { error: tr('Ce navigateur ne permet pas de partager le son d’un onglet. Utilisez Chrome ou Edge, ou l’application de bureau.') };
  let stream: MediaStream;
  try {
    stream = await md.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false } as MediaTrackConstraints,
      // the game's own tab, offered first; its sound keeps playing for the player
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
      surfaceSwitching: 'exclude',
      systemAudio: 'exclude',
    } as DisplayMediaStreamOptions);
  } catch (e) {
    const name = (e as DOMException)?.name;
    if (name === 'NotAllowedError') return { error: tr('Partage refusé. Sans le son de l’onglet, les notes ne peuvent pas être écrites.') };
    return { error: tr('Partage impossible : {m}', { m: (e as Error)?.message ?? String(e) }) };
  }
  // only the sound is used: the picture is dropped at once
  for (const t of stream.getVideoTracks()) t.stop();
  if (!stream.getAudioTracks().length) {
    for (const t of stream.getTracks()) t.stop();
    return { error: tr('Aucun son partagé : choisissez cet onglet et cochez « Partager aussi l’audio de l’onglet ».') };
  }
  return stream;
}
