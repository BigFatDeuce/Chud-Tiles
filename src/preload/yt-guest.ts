import { contextBridge, ipcRenderer } from 'electron';

// Copied from Chud Music (src/preload/yt-guest.ts). Preload of the YouTube player page (inside the
// <webview>): a two-way pipe to the host page, nothing else. The page never gets Node or the app API.
contextBridge.exposeInMainWorld('ctHost', {
  send: (msg: unknown) => ipcRenderer.sendToHost('yt', msg),
  onCommand: (cb: (cmd: unknown) => void) => {
    ipcRenderer.on('yt-cmd', (_e, cmd: unknown) => cb(cmd));
  },
});
