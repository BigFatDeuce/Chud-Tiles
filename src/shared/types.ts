// Types shared by the main process, the preload bridge and the interface.

export type TrackSource = 'local' | 'file' | 'youtube';

/** A song, wherever it comes from. Plain data (stored in IndexedDB, sent over IPC). */
export interface TrackRef {
  /** Stable key: `local:<path>` (desktop file), `file:<name>:<size>:<mtime>` (picked file), `yt:<videoId>`. */
  key: string;
  source: TrackSource;
  title: string;
  artist: string | null;
  album: string | null;
  /** Seconds, when known. */
  duration: number | null;
  /** Desktop: absolute path of the file. */
  path?: string;
  videoId?: string;
  /** Cover image URL (ct-media:, blob:, https:), when known. */
  cover?: string | null;
  /** File size and modification time (cache invalidation). */
  size?: number;
  mtime?: number;
  /** Where it was found: a scanned folder, the Chud Music library, a pick. */
  origin?: 'folder' | 'chud-music' | 'pick' | 'youtube';
  lastPlayed?: number;
  plays?: number;
  favorite?: boolean;
}

export interface Playlist {
  id: string;
  name: string;
  /** Track keys, in order. */
  tracks: string[];
  origin: 'chud-tiles' | 'chud-music' | 'youtube';
  cover?: string | null;
}

/** What a YouTube Music search looks for. */
export type YtSearchKind = 'song' | 'video' | 'album' | 'playlist';

/** A YouTube Music search result. */
export interface YtItem {
  kind: 'song' | 'video' | 'album' | 'playlist' | 'artist';
  id: string;
  title: string;
  subtitle: string;
  artist: string | null;
  album?: string | null;
  duration: number | null;
  thumbnail: string | null;
}

export interface LibraryScan {
  tracks: TrackRef[];
  folders: string[];
  /** Files found but not readable as music. */
  skipped: number;
}

export interface ChudMusicLibrary {
  found: boolean;
  path: string | null;
  tracks: TrackRef[];
  playlists: Playlist[];
}

/** One filter list of the ad blocker (uBlock Origin's catalogue, as in Chud Music). */
export interface AdblockList {
  id: string;
  title: string;
  /** When this list was last downloaded (i.e. last changed upstream). */
  updatedAt: number | null;
}

/** State of the ad blocker (same principle, lists and report as Chud Music). */
export interface AdblockStatus {
  enabled: boolean;
  /** Filter engine loaded and attached to the YouTube session. */
  active: boolean;
  /** Why it is not active (offline on first run, load error…). */
  error: string | null;
  /** Requests blocked in the YouTube session since launch. */
  blocked: number;
  /** Times YouTube's own player reported an ad playing (diagnostic, since launch). */
  adsSeen: number;
  listsUpdatedAt: number | null;
  listsCheckedAt: number | null;
  lists: AdblockList[];
  /** Network + cosmetic filters in the engine. */
  filters: number;
  checking: boolean;
  /** Never built yet: lists are downloaded the first time YouTube is used. */
  waiting: boolean;
}

/** A YouTube or YouTube Music link pasted by the user. */
export interface YtLink {
  kind: 'video' | 'playlist';
  id: string;
  /** A playlist link opened from one of its videos. */
  videoId?: string;
}

/** Messages of the YouTube player page (and of the analyser inside YouTube's frame). */
/** yt-dlp (optional download mode for YouTube songs, desktop only). */
export interface YtdlpStatus {
  found: boolean;
  version: string | null;
  /** Installed by Chud Tiles (in its profile), or found on the system. */
  own: boolean;
  /** Songs downloaded so far, and their size (bytes). */
  songs: number;
  bytes: number;
}

export interface YtDownloaded {
  path: string;
  size: number;
  mtime: number;
}

export type YtEvent =
  | { type: 'ready' }
  | { type: 'state'; state: number }
  | { type: 'time'; t: number; d: number; loaded: number }
  | { type: 'error'; code: number }
  | { type: 'log'; message: string }
  /** Clock pair: media time heard at that instant (epoch ms, high resolution), playback state. */
  | { type: 'clock'; ct: number; at: number; paused: boolean; ad: boolean; rate: number; buffering: boolean; /** The analyser's audio clock (diagnostic). */ ac?: number }
  /** Feature frames measured in YouTube's frame: their media times and FRAME_SIZE floats each. */
  | { type: 'frames'; times: number[]; data: number[]; sampleRate: number }
  | { type: 'analyser'; ok: boolean; reason?: string };

export type YtCommand =
  | { op: 'load'; id: string; start?: number; autoplay?: boolean }
  | { op: 'play' }
  | { op: 'pause' }
  | { op: 'stop' }
  | { op: 'seek'; t: number }
  | { op: 'volume'; v: number; muted: boolean }
  | { op: 'rate'; rate: number };

/** Desktop updates (checked at launch). */
export interface UpdateInfo {
  status: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error';
  version?: string;
  /** Download page (builds that cannot update themselves). */
  url?: string;
  /** 0–1 while downloading. */
  progress?: number;
  error?: string;
}
