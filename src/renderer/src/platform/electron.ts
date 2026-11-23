import { lang, tr } from '../i18n';
import type { TrackRef } from '@shared/types';
import type { CtBridge } from '../../../preload/api';
import type { Picked, Platform } from './types';

// Desktop (Windows, Linux, macOS): everything goes through the preload bridge `window.ct`.

export function electronPlatform(ct: CtBridge): Platform {
  const os = ct.platform === 'win32' ? 'windows' : ct.platform === 'darwin' ? 'mac' : 'linux';
  ct.setLang(lang);
  return {
    kind: 'electron',
    os,
    version: ct.version,
    safeMode: ct.safeMode,
    restart: (mode, reason) => ct.restart(mode, reason),
    healthy: () => ct.healthy(),
    onGpuTrouble: (cb) => ct.onGpuTrouble(cb),
    caps: { youtube: 'full', liveAnalysis: 'frame', adblock: true, ffmpeg: true, folders: true, chudMusic: true, windowControls: true },
    async pickFiles(): Promise<Picked[]> {
      const refs = await ct.pickFiles();
      return refs.map((ref) => ({ ref }));
    },
    async readTrack(ref: TrackRef, file?: File): Promise<ArrayBuffer> {
      if (file) return file.arrayBuffer();
      if (!ref.path) throw new Error(tr('Chemin du fichier inconnu.'));
      const res = await fetch(ct.mediaUrl(ref.path));
      if (!res.ok) throw new Error(res.status === 404 ? tr('Fichier introuvable (déplacé ou supprimé ?).') : tr('Lecture impossible ({s}).', { s: res.status }));
      return res.arrayBuffer();
    },
    async transcode(ref: TrackRef, file?: File): Promise<ArrayBuffer> {
      const path = ref.path ?? (file ? ct.pathOf(file) : '');
      if (!path) throw new Error(tr('Conversion impossible : fichier sans chemin.'));
      return ct.transcode(path);
    },
    async canPlay(ref: TrackRef): Promise<boolean> {
      return !!ref.path || ref.source === 'youtube';
    },
    library: {
      folders: () => ct.library.folders(),
      addFolder: () => ct.library.addFolder(),
      removeFolder: (p) => ct.library.removeFolder(p),
      scan: () => ct.library.scan(),
      onScanProgress: (cb) => ct.library.onScanProgress(cb),
      fromDrop: (files) => ct.library.fromPaths(files.map((f) => ct.pathOf(f)).filter(Boolean)),
      chudMusic: () => ct.library.chudMusic(),
    },
    youtube: {
      search: (q, kind) => ct.yt.search(q, kind),
      suggestions: (q) => ct.yt.suggestions(q),
      playlist: (id) => ct.yt.playlist(id),
      album: (id) => ct.yt.album(id),
      video: (id) => ct.yt.video(id),
      mix: (id) => ct.yt.mix(id),
      blocked: () => ct.yt.blocked(),
      playerUrl: ct.yt.playerUrl,
      partition: ct.yt.partition,
      adblock: ct.yt.adblock,
    },
    window: {
      minimize: () => ct.win.minimize(),
      toggleMaximize: () => ct.win.toggleMaximize(),
      close: () => ct.win.close(),
      setFullscreen: (on) => ct.win.setFullscreen(on),
      isFullscreen: () => ct.win.isFullscreen(),
      onFullscreen: (cb) => ct.win.onFullscreen(cb),
    },
    openExternal: (url) => ct.openExternal(url),
  };
}
