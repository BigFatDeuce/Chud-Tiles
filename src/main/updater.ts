import { app, net, type BrowserWindow } from 'electron';
import { REPO, RELEASES_URL } from '@shared/project';
import type { UpdateInfo } from '@shared/types';

// Updates, checked at launch (Settings › About can turn it off):
//   · Windows installer and Linux AppImage: electron-updater downloads the new version from the
//     GitHub releases in the background and installs it when the app quits (or at once, on asking)
//   · portable exe, .deb, .rpm, .tar.gz, macOS: the latest release is looked up on GitHub and the
//     player is told where to download it
// The renderer starts the check (it knows the setting); results come back as `update:state`.

let win: BrowserWindow | null = null;
let state: UpdateInfo = { status: 'idle' };
let installer: { quitAndInstall: (silent?: boolean, forceRun?: boolean) => void } | null = null;

function send(next: UpdateInfo): void {
  state = next;
  if (win && !win.isDestroyed()) win.webContents.send('update:state', state);
}

/** This build can replace itself (NSIS install, AppImage). */
function selfUpdating(): boolean {
  if (!app.isPackaged) return false;
  if (process.platform === 'win32') return !process.env.PORTABLE_EXECUTABLE_DIR;
  if (process.platform === 'linux') return !!process.env.APPIMAGE;
  return false;
}

/** "1.10.0" > "1.9.2" */
export function newer(a: string, b: string): boolean {
  const pa = a.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

async function latestRelease(): Promise<{ version: string; url: string } | null> {
  const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'Chud-Tiles' } });
  if (!res.ok) return null;
  const j = (await res.json()) as { tag_name?: string; html_url?: string; draft?: boolean; prerelease?: boolean };
  if (!j.tag_name || j.draft || j.prerelease) return null;
  return { version: j.tag_name.replace(/^v/, ''), url: j.html_url ?? RELEASES_URL };
}

export function setUpdateWindow(w: BrowserWindow): void {
  win = w;
}

export const updateState = (): UpdateInfo => state;

export async function checkForUpdates(): Promise<UpdateInfo> {
  if (state.status === 'checking' || state.status === 'downloading' || state.status === 'ready') return state;
  send({ status: 'checking' });
  try {
    if (selfUpdating()) {
      const { autoUpdater } = await import('electron-updater');
      installer = autoUpdater;
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.removeAllListeners();
      autoUpdater.on('update-available', (i) => send({ status: 'downloading', version: i.version, progress: 0 }));
      autoUpdater.on('download-progress', (p) => send({ status: 'downloading', version: state.version, progress: p.percent / 100 }));
      autoUpdater.on('update-downloaded', (i) => send({ status: 'ready', version: i.version }));
      autoUpdater.on('update-not-available', () => send({ status: 'none' }));
      autoUpdater.on('error', (e) => send({ status: 'error', error: e.message }));
      await autoUpdater.checkForUpdates();
      return state;
    }
    const latest = await latestRelease();
    if (latest && newer(latest.version, app.getVersion())) send({ status: 'available', version: latest.version, url: latest.url });
    else send({ status: 'none' });
  } catch (e) {
    console.warn('[update]', e);
    send({ status: 'error', error: (e as Error).message });
  }
  return state;
}

/** Restarts into the downloaded version. */
export function installNow(): void {
  if (state.status === 'ready' && installer) installer.quitAndInstall(false, true);
}
