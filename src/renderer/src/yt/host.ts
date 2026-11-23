import { tr } from '../i18n';
import type { YtCommand, YtEvent } from '@shared/types';
import { platform } from '../platform';

// The official YouTube player, as the game sees it. Two implementations:
//   · desktop: YouTube's IFrame player inside a <webview> on its own session (main/chud/yt-player.ts),
//     with the rhythm analyser running inside YouTube's own frame (clock pairs + feature frames);
//   · browser: the same IFrame player embedded in the page (web-host.ts), clock read from the API.
// Nothing is downloaded and the stream is never touched: YouTube plays it in its own player, which
// stays visible (≥ 200×200, nothing drawn over it) whenever it plays.

/** YT.PlayerState */
export const YT_UNSTARTED = -1;
export const YT_ENDED = 0;
export const YT_PLAYING = 1;
export const YT_PAUSED = 2;
export const YT_BUFFERING = 3;
export const YT_CUED = 5;

export interface MediaClock {
  /** Media time heard (s). */
  t: number;
  /** Advancing (not paused, not buffering, not in an ad). */
  playing: boolean;
  ad: boolean;
  buffering: boolean;
  rate: number;
}

export type Placement =
  /** Over an element of the page (Song page). */
  | { kind: 'slot'; el: HTMLElement }
  /** In a corner of the game screen. */
  | { kind: 'corner' }
  /** Out of sight: only while nothing plays. */
  | { kind: 'hidden' };

export interface FramesBatch {
  times: number[];
  data: number[];
  sampleRate: number;
}

export interface YtHost {
  readonly kind: 'webview' | 'iframe';
  /** Feature frames come from inside the player (desktop) — or from a tab capture (browser). */
  readonly analysis: 'frame' | 'capture' | 'none';
  readonly videoId: string | null;
  readonly state: number;
  readonly duration: number;
  readonly error: { code: number; message: string } | null;
  /** The analyser inside the player reported in (desktop). */
  readonly analyserOk: boolean | null;
  mediaAt(perf: number): MediaClock;
  on(cb: (e: YtEvent) => void): () => void;
  onFrames(cb: (b: FramesBatch) => void): () => void;
  /**
   * Browser: asks to share the tab's sound so the song can be analysed (tab capture). Must be
   * called first thing in the click that asked for it. Returns why it failed, or null.
   */
  enableCapture?(): Promise<string | null>;
  /** Loads a video and leaves it paused at `start`, sound ready: `play()` then starts at once. */
  prime(id: string, start?: number): Promise<void>;
  play(): void;
  pause(): void;
  seek(t: number): void;
  stop(): void;
  setRate(r: number): void;
  /** 0–1, from the game's music volume. */
  setVolume(v: number): void;
  place(p: Placement): void;
}

export const YT_ERRORS: Record<number, string> = {
  2: tr('Lien YouTube invalide.'),
  5: tr('Le lecteur YouTube n’a pas pu lire cette vidéo.'),
  100: tr('Vidéo introuvable (supprimée ou privée).'),
  101: tr('Le propriétaire de cette vidéo n’autorise pas sa lecture dans d’autres applications.'),
  150: tr('Le propriétaire de cette vidéo n’autorise pas sa lecture dans d’autres applications.'),
  153: tr('Le lecteur YouTube a refusé la lecture (identification de l’application).'),
};

interface WebviewEl extends HTMLElement {
  send(channel: string, ...args: unknown[]): void;
  src: string;
}

/** Shared by both hosts: clock smoothing, events, placement of the player's box. */
export abstract class BaseHost {
  videoId: string | null = null;
  state = YT_UNSTARTED;
  duration = 0;
  error: { code: number; message: string } | null = null;
  analyserOk: boolean | null = null;
  protected readonly listeners = new Set<(e: YtEvent) => void>();
  protected readonly frameListeners = new Set<(b: FramesBatch) => void>();
  protected volume = window.ct?.testing ? 0 : 0.8;
  protected rate = 1;
  // clock: media time = perf / 1000 * rate + off while playing
  protected off = NaN;
  /** Clock smoothing: a pair further than `snapS` from the line restarts it, else it is eased by `alpha`. */
  protected snapS = 0.04;
  protected alpha = 0.08;
  protected last: { ct: number; perf: number; playing: boolean; ad: boolean; buffering: boolean; rate: number } | null = null;
  private primeP: Promise<void> | null = null;
  private primeId: string | null = null;
  protected primed = false;
  readonly box: HTMLDivElement;
  private placement: Placement = { kind: 'hidden' };
  private raf = 0;

  constructor() {
    this.box = document.createElement('div');
    this.box.className = 'yt-dock hidden';
    this.box.setAttribute('aria-label', tr('Lecteur YouTube'));
    document.body.appendChild(this.box);
  }

  on(cb: (e: YtEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  onFrames(cb: (b: FramesBatch) => void): () => void {
    this.frameListeners.add(cb);
    return () => this.frameListeners.delete(cb);
  }

  protected emit(e: YtEvent): void {
    for (const l of this.listeners) l(e);
  }

  /** A clock pair: the media time `ct` heard at performance instant `perf`. */
  protected clock(ct: number, perf: number, paused: boolean, ad: boolean, buffering: boolean, rate: number): void {
    const playing = !paused && !ad && !buffering;
    if (playing) {
      const raw = ct - (perf / 1000) * rate;
      const was = this.last;
      if (Number.isNaN(this.off) || !was || !was.playing || was.rate !== rate || Math.abs(raw - this.off) > this.snapS) this.off = raw;
      else this.off += (raw - this.off) * this.alpha;
    }
    this.last = { ct, perf, playing, ad, buffering, rate };
  }

  mediaAt(perf: number): MediaClock {
    const l = this.last;
    if (!l) return { t: 0, playing: false, ad: false, buffering: false, rate: this.rate };
    // extrapolate between pairs while playing; a silent pipe (no pair for 0.6 s) holds the time
    if (l.playing && perf - l.perf < 600) return { t: (perf / 1000) * l.rate + this.off, playing: true, ad: false, buffering: false, rate: l.rate };
    return { t: l.ct, playing: false, ad: l.ad, buffering: l.buffering, rate: l.rate };
  }

  protected abstract command(c: YtCommand): void;

  setVolume(v: number): void {
    // automated tests: the player is silent (and its page is not muted: see main/index.ts)
    this.volume = window.ct?.testing ? 0 : Math.max(0, Math.min(1, v));
    if (this.primed || !this.primeP) this.command({ op: 'volume', v: Math.round(this.volume * 100), muted: this.volume <= 0 });
  }

  play(): void {
    this.command({ op: 'play' });
  }
  pause(): void {
    this.command({ op: 'pause' });
  }
  seek(t: number): void {
    this.command({ op: 'seek', t });
  }
  stop(): void {
    this.command({ op: 'stop' });
    this.primeId = null;
    this.primeP = null;
    this.primed = false;
  }
  setRate(r: number): void {
    this.rate = r;
    this.command({ op: 'rate', rate: r });
  }

  /**
   * Loads the video and leaves it paused at `start` with sound buffered: it plays muted until
   * YouTube really plays it (after a possible ad), then pauses and goes back to `start`.
   */
  prime(id: string, start = 0): Promise<void> {
    if (this.primeId === id && this.primeP) return this.primeP;
    this.primeId = id;
    this.primed = false;
    this.videoId = id;
    this.error = null;
    this.state = YT_UNSTARTED;
    this.last = null;
    this.off = NaN;
    this.duration = 0;
    const p = new Promise<void>((resolve, reject) => {
      this.command({ op: 'volume', v: 0, muted: true });
      this.command({ op: 'rate', rate: 1 });
      this.command({ op: 'load', id, start, autoplay: true });
      let phase: 'starting' | 'settling' = 'starting';
      let settleAt = 0;
      const t0 = performance.now();
      const done = (err?: Error) => {
        clearInterval(timer);
        off();
        if (this.primeId !== id) return reject(new Error(tr('remplacé')));
        if (err) {
          this.primeP = null;
          this.primeId = null;
          return reject(err);
        }
        this.primed = true;
        this.command({ op: 'volume', v: Math.round(this.volume * 100), muted: this.volume <= 0 });
        this.command({ op: 'rate', rate: this.rate });
        resolve();
      };
      const off = this.on((e) => {
        if (e.type === 'error') done(new Error(YT_ERRORS[e.code] ?? tr('Erreur du lecteur YouTube ({c}).', { c: e.code })));
      });
      const timer = setInterval(() => {
        if (this.primeId !== id) return done();
        const m = this.mediaAt(performance.now());
        if (phase === 'starting' && m.playing && !m.ad && m.t > start + 0.05) {
          phase = 'settling';
          this.command({ op: 'pause' });
          this.command({ op: 'seek', t: start });
          settleAt = performance.now();
        } else if (phase === 'settling' && performance.now() - settleAt > 350 && !m.playing && Math.abs(m.t - start) < 0.15) done();
        else if (phase === 'settling' && performance.now() - settleAt > 4000) done();
        else if (performance.now() - t0 > (this.state === YT_UNSTARTED ? 25000 : 60000)) done(new Error(tr('Le lecteur YouTube ne démarre pas (connexion lente, ou lecture refusée).')));
      }, 30);
    });
    this.primeP = p;
    return p;
  }

  get isPrimed(): boolean {
    return this.primed;
  }

  // ── placement ─────────────────────────────────────────────────────────────────────────────

  place(p: Placement): void {
    this.placement = p;
    this.box.classList.toggle('hidden', p.kind === 'hidden');
    this.box.classList.toggle('corner', p.kind === 'corner');
    this.box.classList.toggle('slot', p.kind === 'slot');
    cancelAnimationFrame(this.raf);
    if (p.kind === 'slot') {
      // follows its slot (page transitions, scrolling, resizing)
      const follow = () => {
        if (this.placement !== p) return;
        const r = p.el.getBoundingClientRect();
        if (!p.el.isConnected) {
          this.place({ kind: 'hidden' });
          return;
        }
        const s = this.box.style;
        s.left = `${r.left}px`;
        s.top = `${r.top}px`;
        s.width = `${Math.max(200, r.width)}px`;
        s.height = `${Math.max(200, r.height)}px`;
        this.raf = requestAnimationFrame(follow);
      };
      follow();
    } else {
      const s = this.box.style;
      s.left = s.top = s.width = s.height = '';
    }
  }
}

/** Desktop: the player page in a <webview> (main/chud/yt-player.ts enforces its session). */
export class WebviewHost extends BaseHost implements YtHost {
  readonly kind = 'webview' as const;
  readonly analysis = 'frame' as const;
  private readonly view: WebviewEl;
  private guestReady = false;
  private queue: YtCommand[] = [];

  constructor(playerUrl: string, partition: string) {
    super();
    const view = document.createElement('webview') as WebviewEl;
    view.setAttribute('partition', partition);
    view.setAttribute('src', playerUrl);
    view.className = 'yt-view';
    view.addEventListener('dom-ready', () => {
      this.guestReady = true;
      const q = this.queue;
      this.queue = [];
      q.forEach((c) => this.command(c));
    });
    view.addEventListener('ipc-message', (e) => {
      const ev = e as unknown as { channel: string; args: YtEvent[] };
      if (ev.channel === 'yt' && ev.args[0]) this.onGuest(ev.args[0]);
    });
    // a crashed or reloaded player page starts over
    view.addEventListener('did-start-loading', () => (this.guestReady = false));
    this.view = view;
    this.box.appendChild(view);
  }

  protected command(c: YtCommand): void {
    if (this.guestReady) {
      this.view.send('yt-cmd', c);
      return;
    }
    if (c.op === 'load') this.queue = [...this.queue.filter((q) => q.op !== 'load'), c];
    else if (c.op === 'stop') this.queue = this.queue.filter((q) => q.op === 'volume' || q.op === 'rate');
    else if (c.op === 'volume' || c.op === 'rate') this.queue = [...this.queue.filter((q) => q.op !== c.op), c];
  }

  private onGuest(m: YtEvent): void {
    switch (m.type) {
      case 'clock':
        this.clock(m.ct, m.at - performance.timeOrigin, m.paused, m.ad, m.buffering, m.rate);
        break;
      case 'frames':
        if (this.isPrimed) for (const l of this.frameListeners) l(m);
        return; // frequent: not re-emitted
      case 'time':
        if (m.d > 0) this.duration = m.d;
        break;
      case 'state':
        this.state = m.state;
        break;
      case 'error':
        this.error = { code: m.code, message: YT_ERRORS[m.code] ?? tr('Erreur du lecteur YouTube ({c}).', { c: m.code }) };
        break;
      case 'analyser':
        this.analyserOk = m.ok;
        if (!m.ok) console.warn('[yt] analyser', m.reason);
        break;
    }
    this.emit(m);
  }
}

let host: YtHost | null | undefined;

/** The one YouTube player of the application (created on first use). Null where YouTube cannot play. */
export async function ytHost(): Promise<YtHost | null> {
  if (host !== undefined) return host;
  const yt = platform.youtube;
  if (yt) {
    yt.adblock.needed();
    host = new WebviewHost(yt.playerUrl, yt.partition);
  } else {
    const { IframeHost } = await import('./web-host');
    host = new IframeHost();
  }
  return host;
}

/** The host if it exists already (no creation). */
export const currentHost = (): YtHost | null => host ?? null;

/** The song's sound can be analysed here (asking for the tab's sound in the browser if needed). */
export function canAnalyse(host: YtHost | null): boolean {
  return !!host && (host.analysis !== 'none' || !!host.enableCapture);
}

/** Makes sure frames will come: call first thing in a click. Returns an error message or null. */
export function ensureAnalysis(host: YtHost): Promise<string | null> {
  if (host.analysis !== 'none') return Promise.resolve(null);
  if (host.enableCapture) return host.enableCapture();
  return Promise.resolve(tr('L’analyse du son de YouTube n’est pas disponible ici.'));
}
