import { app, dialog, type BrowserWindow } from 'electron';
import * as store from './store';
import { say } from './i18n';

// Safe mode: the game draws without the graphics card (software rendering, WebGL on the processor)
// and with minimal effects. The player asks for it (Settings › Display, or the --safe-mode
// argument), or it starts by itself after the display crashed: two starts in a row that never
// reached a working interface, the interface crashing again and again, or the graphics driver
// failing repeatedly.

export type SafeReason = 'asked' | 'crash';
export let safe: { on: boolean; reason: SafeReason | null } = { on: false, reason: null };

/** Before the app is ready: chooses the mode of this start. */
export function initSafeMode(): void {
  const st = store.load();
  const unfinished = st.starting ?? 0; // starts that never reached a working interface
  const asked = process.argv.includes('--safe-mode') || process.env.CT_SAFE_MODE === '1' || st.safeNext === 'asked';
  const crashed = st.safeNext === 'crash' || unfinished >= 2;
  safe = { on: asked || crashed, reason: asked ? 'asked' : crashed ? 'crash' : null };
  if (safe.on) {
    app.disableHardwareAcceleration();
    // WebGL keeps working on the processor (SwiftShader): the game's track is drawn with it
    app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  }
  store.save({ safeNext: null, starting: unfinished + 1 });
  store.flush();
}

/** The interface has been running fine for a few seconds; a clean quit counts too. */
export function startedFine(): void {
  if (store.load().starting) store.save({ starting: 0 });
}

/** Restarts the game, in safe mode or normally. */
export function restart(mode: 'normal' | 'safe', reason: SafeReason = 'asked'): void {
  store.save({ safeNext: mode === 'safe' ? reason : null, starting: 0 });
  store.flush();
  app.relaunch({ args: process.argv.slice(1).filter((a) => a !== '--safe-mode') });
  app.quit();
}

/** The graphics driver failing again and again: the next start is in safe mode. */
export function watchGpu(getWin: () => BrowserWindow | null): void {
  let crashes = 0;
  app.on('child-process-gone', (_e, d) => {
    if (d.type !== 'GPU' || d.reason === 'clean-exit' || safe.on) return;
    if (++crashes < 2) return;
    store.save({ safeNext: 'crash' });
    getWin()?.webContents.send('app:gpu-trouble');
  });
}

/** The interface keeps crashing: safe mode, or (already in it) an explanation and quit. */
export function interfaceLost(): void {
  if (!safe.on) return restart('safe', 'crash');
  dialog.showErrorBox('Chud Tiles', say('L’interface s’est arrêtée plusieurs fois, même en mode sans échec. Redémarrez l’ordinateur ou mettez à jour le pilote graphique, puis relancez Chud Tiles.', 'The interface stopped several times, even in safe mode. Restart the computer or update the graphics driver, then start Chud Tiles again.'));
  app.quit();
}
