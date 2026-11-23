import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { CtBridge } from './api';

// The desktop bridge (`window.ct`): each function is one IPC call handled in main/index.ts.

function subscribe<T>(channel: string, cb: (v: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, v: T) => cb(v);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const info = ipcRenderer.sendSync('app:info') as { version: string; playerUrl: string; partition: string; safe: CtBridge['safeMode'] };

const api: CtBridge = {
  platform: process.platform as CtBridge['platform'],
  version: info.version,
  safeMode: info.safe,
  restart: (mode, reason) => ipcRenderer.send('app:restart', mode, reason),
  healthy: () => ipcRenderer.send('app:healthy'),
  onGpuTrouble: (cb) => subscribe('app:gpu-trouble', cb),
  testing: !!process.env.CT_TEST_QUIET,
  pickFiles: () => ipcRenderer.invoke('files:pick'),
  mediaUrl: (path) => `ct-media://file/${encodeURIComponent(path)}`,
  pathOf: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  transcode: async (path) => {
    const u8 = (await ipcRenderer.invoke('files:transcode', path)) as Uint8Array;
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
  },
  hasFfmpeg: () => ipcRenderer.invoke('files:has-ffmpeg'),
  library: {
    folders: () => ipcRenderer.invoke('library:folders'),
    addFolder: () => ipcRenderer.invoke('library:add-folder'),
    removeFolder: (p) => ipcRenderer.invoke('library:remove-folder', p),
    scan: () => ipcRenderer.invoke('library:scan'),
    onScanProgress: (cb) => subscribe('library:scan-progress', cb),
    fromPaths: (paths) => ipcRenderer.invoke('library:from-paths', paths),
    chudMusic: () => ipcRenderer.invoke('library:chud-music'),
  },
  yt: {
    search: (q, kind) => ipcRenderer.invoke('yt:search', q, kind),
    suggestions: (q) => ipcRenderer.invoke('yt:suggest', q),
    playlist: (id) => ipcRenderer.invoke('yt:playlist', id),
    album: (id) => ipcRenderer.invoke('yt:album', id),
    video: (id) => ipcRenderer.invoke('yt:video', id),
    mix: (id) => ipcRenderer.invoke('yt:mix', id),
    blocked: () => ipcRenderer.invoke('yt:blocked'),
    playerUrl: info.playerUrl,
    partition: info.partition,
    adblock: {
      status: () => ipcRenderer.invoke('adblock:status'),
      setEnabled: (on) => ipcRenderer.invoke('adblock:set', on),
      check: () => ipcRenderer.invoke('adblock:check'),
      needed: () => ipcRenderer.send('adblock:needed'),
      onStatus: (cb) => subscribe('adblock:status', cb),
    },
  },
  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
    close: () => ipcRenderer.send('win:close'),
    setFullscreen: (on) => ipcRenderer.send('win:fullscreen', on),
    isFullscreen: () => ipcRenderer.invoke('win:is-fullscreen'),
    onFullscreen: (cb) => subscribe('win:fullscreen', cb),
  },
  openExternal: (url) => ipcRenderer.send('app:open-external', url),
  setLang: (l) => ipcRenderer.send('app:lang', l),
};

contextBridge.exposeInMainWorld('ct', api);
