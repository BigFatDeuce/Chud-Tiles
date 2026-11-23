import type { AdblockStatus, ChudMusicLibrary, LibraryScan, Playlist, TrackRef, YtDownloaded, YtdlpStatus, YtItem, YtSearchKind } from '@shared/types';

// What the game asks of the system it runs on. Two implementations: Electron (Windows, Linux,
// macOS: everything) and the browser (local files, YouTube by link). The interface shows or hides
// features from `caps`, never from the platform's name.

export interface Picked {
  ref: TrackRef;
  /** The file itself (browser, drag and drop); desktop picks only carry a path. */
  file?: File;
}

export interface PlatformCaps {
  /** 'full': search YouTube Music; 'link': paste a link (or search with an API key). */
  youtube: 'full' | 'link';
  /** How YouTube songs are analysed: inside the player frame, by tab capture, or not at all. */
  liveAnalysis: 'frame' | 'tab-capture' | 'none';
  adblock: boolean;
  /** FFmpeg for the formats the browser engine cannot decode (ALAC, WMA, AIFF…). */
  ffmpeg: boolean;
  /** Music folders scanned on disk. */
  folders: boolean;
  /** Reads the library and playlists of Chud Music. */
  chudMusic: boolean;
  /** Frameless window with its own buttons. */
  windowControls: boolean;
}

export interface Platform {
  kind: 'electron' | 'web';
  os: 'windows' | 'linux' | 'mac' | 'web';
  caps: PlatformCaps;
  version: string;
  /** Safe mode: software rendering and minimal effects (after display crashes, or asked). */
  safeMode: { on: boolean; reason: 'asked' | 'crash' | null };
  restart?(mode: 'normal' | 'safe', reason?: 'asked' | 'crash'): void;
  /** Tells the system side the interface works (crash detection at start). */
  healthy?(): void;
  onGpuTrouble?(cb: () => void): () => void;
  /** Asks the user for music files. */
  pickFiles(): Promise<Picked[]>;
  /** Raw bytes of a local track (picked file or path). */
  readTrack(ref: TrackRef, file?: File): Promise<ArrayBuffer>;
  /** FFmpeg: any audio file → FLAC bytes (desktop only). */
  transcode?(ref: TrackRef, file?: File): Promise<ArrayBuffer>;
  /** Can a stored track still be played without asking the user again? */
  canPlay(ref: TrackRef): Promise<boolean>;
  library?: {
    folders(): Promise<string[]>;
    addFolder(): Promise<string | null>;
    removeFolder(path: string): Promise<void>;
    scan(): Promise<LibraryScan>;
    onScanProgress(cb: (p: { done: number; total: number }) => void): () => void;
    /** Dropped files (with a path on disk) and folders → their music. */
    fromDrop(files: File[]): Promise<TrackRef[]>;
    chudMusic(): Promise<ChudMusicLibrary>;
  };
  /** YouTube Music's catalogue and the official player's session (desktop). */
  youtube?: {
    search(query: string, kind: YtSearchKind): Promise<YtItem[]>;
    suggestions(query: string): Promise<string[]>;
    playlist(id: string): Promise<{ title: string; items: YtItem[] }>;
    album(id: string): Promise<{ title: string; items: YtItem[] }>;
    video(id: string): Promise<YtItem | null>;
    mix(videoId: string): Promise<YtItem[]>;
    blocked(): Promise<'signin' | 'error' | null>;
    playerUrl: string;
    partition: string;
    adblock: {
      status(): Promise<AdblockStatus>;
      setEnabled(on: boolean): Promise<AdblockStatus>;
      check(): Promise<void>;
      needed(): void;
      onStatus(cb: (s: AdblockStatus) => void): () => void;
    };
  };
  /** Desktop: optional download of YouTube songs with yt-dlp (then played as local files). */
  ytdlp?: {
    status(): Promise<YtdlpStatus>;
    install(): Promise<YtdlpStatus>;
    /** Installs yt-dlp if missing, or updates Chud Tiles' copy (at launch). */
    prepare(): Promise<void>;
    download(id: string, onProgress: (p: number) => void): Promise<YtDownloaded>;
    clear(): Promise<void>;
  };
  window?: {
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
    setFullscreen(on: boolean): void;
    isFullscreen(): Promise<boolean>;
    onFullscreen(cb: (on: boolean) => void): () => void;
    /** The window was minimised or hidden (false), or shown again (true). */
    onVisible?(cb: (visible: boolean) => void): () => void;
  };
  openExternal(url: string): void;
  playlists?: {
    list(): Promise<Playlist[]>;
  };
}
