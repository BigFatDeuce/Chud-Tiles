import type { YtCommand } from '@shared/types';
import { BaseHost, YT_ERRORS, YT_PLAYING, type YtHost } from './host';
import { requestTabAudio, TabCapture } from './capture';
import { tr } from '../i18n';

// Browser: YouTube's IFrame player embedded in the page itself. The clock is read from the
// player API (getCurrentTime, polled). The player's sound cannot be read from inside its frame
// here: when the user shares the tab with its sound, it is analysed from that capture (capture.ts).

interface YTPlayer {
  loadVideoById(o: { videoId: string; startSeconds?: number }): void;
  cueVideoById(o: { videoId: string; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(t: number, allow: boolean): void;
  setVolume(v: number): void;
  mute(): void;
  unMute(): void;
  setPlaybackRate(r: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  getVideoLoadedFraction(): number;
  getPlayerState(): number;
  getPlaybackRate(): number;
}
type YTNamespace = { Player: new (el: HTMLElement, o: unknown) => YTPlayer };

function loadApi(): Promise<YTNamespace> {
  const w = window as unknown as { YT?: YTNamespace & { loaded?: number }; onYouTubeIframeAPIReady?: () => void };
  if (w.YT?.Player) return Promise.resolve(w.YT);
  return new Promise((resolve) => {
    w.onYouTubeIframeAPIReady = () => resolve(w.YT!);
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  });
}

export class IframeHost extends BaseHost implements YtHost {
  readonly kind = 'iframe' as const;
  private cap: TabCapture | null = null;
  private player: YTPlayer | null = null;
  private ready = false;
  private queue: YtCommand[] = [];

  get analysis(): 'capture' | 'none' {
    return this.cap?.alive ? 'capture' : 'none';
  }

  enableCapture(): Promise<string | null> {
    if (this.cap?.alive) return Promise.resolve(null);
    // getDisplayMedia is called synchronously here, inside the user's click
    return requestTabAudio().then((r) => {
      if (!(r instanceof MediaStream)) return r.error;
      this.cap?.dispose();
      this.cap = new TabCapture(
        r,
        () => this.mediaAt(performance.now()),
        (b) => {
          for (const l of this.frameListeners) l(b);
        },
        () => {
          this.cap = null;
          this.analyserOk = null;
        },
      );
      this.analyserOk = true;
      return null;
    });
  }

  constructor() {
    super();
    // the API's clock comes through messages: wider tolerance, gentler easing
    this.snapS = 0.25;
    this.alpha = 0.03;
    const el = document.createElement('div');
    el.className = 'yt-view';
    this.box.appendChild(el);
    void loadApi().then((YT) => {
      this.player = new YT.Player(el, {
        width: '100%',
        height: '100%',
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, playsinline: 1, rel: 0, iv_load_policy: 3, cc_load_policy: 0, origin: location.origin },
        events: {
          onReady: () => {
            this.ready = true;
            this.emit({ type: 'ready' });
            const q = this.queue;
            this.queue = [];
            q.forEach((c) => this.command(c));
          },
          onStateChange: (e: { data: number }) => {
            this.state = e.data;
            this.emit({ type: 'state', state: e.data });
          },
          onError: (e: { data: number }) => {
            this.error = { code: e.data, message: YT_ERRORS[e.data] ?? tr('Erreur du lecteur YouTube ({c}).', { c: e.data }) };
            this.emit({ type: 'error', code: e.data });
          },
        },
      });
    });
    // clock: the API's time, polled (less precise than the desktop's analyser clock)
    setInterval(() => {
      const p = this.player;
      if (!p || !this.ready) return;
      const st = p.getPlayerState();
      const d = p.getDuration();
      if (d > 0) this.duration = d;
      this.loaded = p.getVideoLoadedFraction() || 0;
      this.clock(p.getCurrentTime() || 0, performance.now(), st !== YT_PLAYING, false, st === 3, p.getPlaybackRate() || 1);
    }, 50);
  }

  protected command(c: YtCommand): void {
    const p = this.player;
    if (!p || !this.ready) {
      this.queue.push(c);
      return;
    }
    switch (c.op) {
      case 'load':
        if (c.autoplay === false) p.cueVideoById({ videoId: c.id, startSeconds: c.start ?? 0 });
        else p.loadVideoById({ videoId: c.id, startSeconds: c.start ?? 0 });
        break;
      case 'play':
        p.playVideo();
        break;
      case 'pause':
        p.pauseVideo();
        break;
      case 'stop':
        p.stopVideo();
        break;
      case 'seek':
        p.seekTo(c.t, true);
        break;
      case 'volume':
        p.setVolume(c.v);
        if (c.muted || c.v === 0) p.mute();
        else p.unMute();
        break;
      case 'rate':
        p.setPlaybackRate(c.rate);
        break;
    }
  }
}
