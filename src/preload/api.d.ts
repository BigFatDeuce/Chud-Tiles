import type { AdblockStatus, ChudMusicLibrary, LibraryScan, TrackRef, YtItem, YtSearchKind } from '../shared/types';

// The bridge the preload script exposes to the interface as `window.ct` (desktop only).

export interface CtBridge {
  platform: 'win32' | 'linux' | 'darwin';
  version: string;
  /** Safe mode of this start: software rendering, minimal effects. */
  safeMode: { on: boolean; reason: 'asked' | 'crash' | null };
  /** Restarts the game, in safe mode or normally. */
  restart(mode: 'normal' | 'safe', reason?: 'asked' | 'crash'): void;
  /** The interface runs fine (crash detection at start). */
  healthy(): void;
  /** The graphics driver crashed repeatedly: the next start will be in safe mode. */
  onGpuTrouble(cb: () => void): () => void;
  /** Automated tests (muted, invisible window). */
  testing: boolean;
  /** Native file dialog; tags read by the main process. */
  pickFiles(): Promise<TrackRef[]>;
  /** URL serving a local file to the page (ct-media: protocol, range requests supported). */
  mediaUrl(path: string): string;
  /** Path of a dropped File (Electron's webUtils); '' when it has none. */
  pathOf(file: File): string;
  /** Any audio file → FLAC bytes (bundled FFmpeg). */
  transcode(path: string): Promise<ArrayBuffer>;
  hasFfmpeg(): Promise<boolean>;
  library: {
    folders(): Promise<string[]>;
    addFolder(): Promise<string | null>;
    removeFolder(path: string): Promise<void>;
    scan(): Promise<LibraryScan>;
    onScanProgress(cb: (p: { done: number; total: number }) => void): () => void;
    /** Dropped files and folders → their music. */
    fromPaths(paths: string[]): Promise<TrackRef[]>;
    chudMusic(): Promise<ChudMusicLibrary>;
  };
  yt: {
    search(query: string, kind: YtSearchKind): Promise<YtItem[]>;
    suggestions(query: string): Promise<string[]>;
    playlist(id: string): Promise<{ title: string; items: YtItem[] }>;
    album(id: string): Promise<{ title: string; items: YtItem[] }>;
    video(id: string): Promise<YtItem | null>;
    /** YouTube Music's radio of a song (what plays next). */
    mix(videoId: string): Promise<YtItem[]>;
    /** Does YouTube's player show its error screen, or ask to sign in? */
    blocked(): Promise<'signin' | 'error' | null>;
    /** The page the <webview> loads, and its session partition (enforced by the main process). */
    playerUrl: string;
    partition: string;
    adblock: {
      status(): Promise<AdblockStatus>;
      setEnabled(on: boolean): Promise<AdblockStatus>;
      check(): Promise<void>;
      /** YouTube is about to be used: build the engine if it never was. */
      needed(): void;
      onStatus(cb: (s: AdblockStatus) => void): () => void;
    };
  };
  win: {
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
    setFullscreen(on: boolean): void;
    isFullscreen(): Promise<boolean>;
    onFullscreen(cb: (on: boolean) => void): () => void;
  };
  openExternal(url: string): void;
  /** Language of the interface, for the texts of the system side (dialogs, errors). */
  setLang(lang: 'fr' | 'en'): void;
}

declare global {
  interface Window {
    ct?: CtBridge;
  }
  const __APP_VERSION__: string;
}
