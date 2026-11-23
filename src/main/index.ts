import { app, BrowserWindow, ipcMain, screen, shell } from 'electron';
import { join } from 'node:path';
import type { YtSearchKind } from '@shared/types';
import { addAllowSource, handleProtocol, flushAllowed, registerSchemePrivileges } from './protocol';
import * as store from './store';
import * as library from './library';
import { chudMusicHas, readChudMusic } from './chud-music';
import { hasFfmpeg, transcode } from './ffmpeg';
import * as youtube from './chud/youtube';
import { initYouTubeSession, YT_PARTITION, YT_PLAYER_URL, ytBlocked } from './chud/yt-player';
import { adblockNeeded, adblockStatus, checkLists, initAdblock, setAdblockEnabled } from './chud/adblock';
import { say, setLang } from './i18n';
import { initSafeMode, interfaceLost, restart, safe, startedFine, watchGpu } from './safe-mode';

// Chud Tiles' desktop shell (Windows, Linux, macOS). The game itself is the page (src/renderer);
// this process only does what a page cannot: files on disk, FFmpeg, Chud Music's library (read
// only), YouTube Music's catalogue, the official YouTube player's session and its ad blocker.

app.setName('Chud Tiles');
// Automated tests run against an isolated profile so they never touch real user data.
if (process.env.CT_USER_DATA) app.setPath('userData', process.env.CT_USER_DATA);
// Tests choose the system language the interface sees (its "Auto" language).
if (process.env.CT_LANG) app.commandLine.appendSwitch('lang', process.env.CT_LANG);
if (process.platform === 'win32') app.setAppUserModelId('app.chudtiles');
// Automated tests never disturb the person using the computer: muted, invisible, click-through.
const QUIET = !!process.env.CT_TEST_QUIET;
if (QUIET) {
  // The YouTube player is silenced by its own volume instead (see the interface's yt host): a muted
  // page plays its media on a fake audio clock, and the tests check the real timing.
  app.on('web-contents-created', (_e, wc) => {
    if (wc.getType() !== 'webview') wc.setAudioMuted(true);
  });
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,SuspendMutedAudio');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
}
// The game's clock and its frame pacing: never throttled, high-refresh screens unlocked.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-frame-rate-limit');

if (!app.requestSingleInstanceLock()) app.quit();
else start();

function start(): void {
  let win: BrowserWindow | null = null;
  initSafeMode();
  registerSchemePrivileges();

  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    startedFine();
    store.flush();
    flushAllowed();
  });

  void app.whenReady().then(() => {
    // songs of Chud Music's library stay playable after a restart (its list is read again on demand)
    addAllowSource(chudMusicHas);
    handleProtocol();
    const send = (channel: string, payload?: unknown) => {
      if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload);
    };
    registerIpc(() => win, send);
    win = createWindow();
    initAdblock(initYouTubeSession(win), store.load().adblock, (s) => send('adblock:status', s));
    win.on('closed', () => (win = null));
  });
}

function createWindow(): BrowserWindow {
  const saved = store.load().window;
  const onScreen =
    saved?.x !== undefined &&
    screen.getAllDisplays().some((d) => {
      const b = d.workArea;
      return saved.x! >= b.x - 50 && saved.y! >= b.y - 50 && saved.x! < b.x + b.width && saved.y! < b.y + b.height;
    });
  const win = new BrowserWindow({
    width: saved?.width ?? 1440,
    height: saved?.height ?? 900,
    ...(onScreen && !QUIET ? { x: saved!.x, y: saved!.y } : {}),
    ...(QUIET ? { skipTaskbar: true } : {}),
    minWidth: 760,
    minHeight: 540,
    frame: false,
    show: false,
    backgroundColor: '#03040c',
    title: 'Chud Tiles',
    ...(app.isPackaged && process.platform === 'win32' ? {} : { icon: app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '../../build/icons/png/icon-256.png') }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false, // the audio clock keeps running when the window is covered
      webviewTag: true, // only for the YouTube player page, enforced in chud/yt-player.ts
      spellcheck: false,
    },
  });
  if (saved?.maximized) win.maximize();
  if (saved?.fullscreen && !QUIET) win.setFullScreen(true);
  win.once('ready-to-show', () => {
    if (!QUIET) return win.show();
    if (!process.env.CT_TEST_SHOW) win.setOpacity(0);
    win.setIgnoreMouseEvents(true);
    win.showInactive();
  });

  const persist = () => {
    if (win.isDestroyed()) return;
    const maximized = win.isMaximized();
    const fullscreen = win.isFullScreen();
    const prev = store.load().window;
    const b = maximized || fullscreen ? (prev ?? win.getNormalBounds()) : win.getBounds();
    store.save({ window: { width: b.width, height: b.height, x: b.x, y: b.y, maximized, fullscreen } });
  };
  win.on('resized', persist);
  win.on('moved', persist);
  win.on('maximize', persist);
  win.on('unmaximize', persist);
  win.on('enter-full-screen', () => {
    persist();
    win.webContents.send('win:fullscreen', true);
  });
  win.on('leave-full-screen', () => {
    persist();
    win.webContents.send('win:fullscreen', false);
  });

  // External links open in the user's browser, never inside the game.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL)) return;
    // reloading the interface itself (changing the language) stays allowed
    if (url.split('#')[0] === win.webContents.getURL().split('#')[0]) return;
    e.preventDefault();
  });
  if (!app.isPackaged)
    win.webContents.on('console-message', (e) => {
      if (e.level === 'warning' || e.level === 'error') console.log(`[renderer:${e.level}] ${e.message}`);
    });
  // A crashed interface (GPU driver, out of memory…) is reloaded rather than left blank.
  const crashes: number[] = [];
  win.webContents.on('render-process-gone', (_e, d) => {
    if (d.reason === 'clean-exit' || win.isDestroyed()) return;
    const now = Date.now();
    crashes.push(now);
    while (crashes.length && now - crashes[0]! > 60_000) crashes.shift();
    if (crashes.length <= 3) load(win);
    else interfaceLost();
  });
  load(win);
  return win;
}

function load(win: BrowserWindow): void {
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
}

const str = (v: unknown, max = 4096): string => {
  if (typeof v !== 'string' || v.length > max) throw new Error(say('argument invalide', 'invalid argument'));
  return v;
};
const KINDS = new Set<YtSearchKind>(['song', 'video', 'album', 'playlist']);

function registerIpc(getWin: () => BrowserWindow | null, send: (channel: string, payload?: unknown) => void): void {
  ipcMain.on('app:info', (e) => (e.returnValue = { version: __APP_VERSION__, playerUrl: YT_PLAYER_URL, partition: YT_PARTITION, safe }));
  ipcMain.on('app:lang', (_e, l: unknown) => setLang(l));
  ipcMain.on('app:healthy', () => startedFine());
  ipcMain.on('app:restart', (_e, mode: unknown, reason: unknown) => restart(mode === 'safe' ? 'safe' : 'normal', reason === 'crash' ? 'crash' : 'asked'));
  ipcMain.on('app:open-external', (_e, url: unknown) => {
    if (typeof url === 'string' && /^https:\/\//.test(url)) void shell.openExternal(url);
  });

  // files
  ipcMain.handle('files:pick', () => library.pickFiles(getWin()));
  ipcMain.handle('files:transcode', async (_e, path: unknown) => {
    const p = str(path);
    if (!library.isAudioPath(p)) throw new Error(say('Ce fichier n’est pas un fichier audio.', 'This file is not an audio file.'));
    const buf = await transcode(p);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  });
  ipcMain.handle('files:has-ffmpeg', () => hasFfmpeg());

  // library
  ipcMain.handle('library:folders', () => library.folders());
  ipcMain.handle('library:add-folder', () => library.addFolder(getWin()));
  ipcMain.handle('library:remove-folder', (_e, dir: unknown) => library.removeFolder(str(dir)));
  ipcMain.handle('library:scan', () => library.scan((done, total) => send('library:scan-progress', { done, total })));
  ipcMain.handle('library:from-paths', (_e, paths: unknown) => {
    if (!Array.isArray(paths)) throw new Error(say('argument invalide', 'invalid argument'));
    return library.fromPaths(paths.filter((p): p is string => typeof p === 'string' && p.length < 4096));
  });
  ipcMain.handle('library:chud-music', () => readChudMusic());

  // YouTube Music catalogue (metadata only)
  const ytUsed = () => adblockNeeded();
  ipcMain.handle('yt:search', (_e, q: unknown, kind: unknown) => {
    ytUsed();
    return youtube.search(str(q, 300), KINDS.has(kind as YtSearchKind) ? (kind as YtSearchKind) : 'song');
  });
  ipcMain.handle('yt:suggest', (_e, q: unknown) => youtube.suggestions(str(q, 300)));
  ipcMain.handle('yt:playlist', (_e, id: unknown) => youtube.playlist(str(id, 200)));
  ipcMain.handle('yt:album', (_e, id: unknown) => youtube.album(str(id, 200)));
  ipcMain.handle('yt:video', (_e, id: unknown) => youtube.video(str(id, 20)));
  ipcMain.handle('yt:mix', (_e, id: unknown) => youtube.mix(str(id, 20)));
  ipcMain.handle('yt:blocked', () => ytBlocked());

  // ad blocker
  ipcMain.handle('adblock:status', () => adblockStatus());
  ipcMain.handle('adblock:set', (_e, on: unknown) => {
    const enabled = on === true;
    store.save({ adblock: enabled });
    return setAdblockEnabled(enabled);
  });
  ipcMain.handle('adblock:check', async () => {
    await checkLists();
  });
  ipcMain.on('adblock:needed', ytUsed);

  // window
  ipcMain.on('win:minimize', () => getWin()?.minimize());
  ipcMain.on('win:toggle-maximize', () => {
    const w = getWin();
    if (w) w.isMaximized() ? w.unmaximize() : w.maximize();
  });
  ipcMain.on('win:close', () => getWin()?.close());
  ipcMain.on('win:fullscreen', (_e, on: unknown) => getWin()?.setFullScreen(on === true));
  ipcMain.handle('win:is-fullscreen', () => getWin()?.isFullScreen() ?? false);
}
