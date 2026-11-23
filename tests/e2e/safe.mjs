// Safe mode: asked for, the game draws with WebGL on the processor (no graphics card) and minimal
// effects, and a song stays playable; two starts in a row that crashed put the next one in safe
// mode by themselves; a normal start is not in safe mode and counts as a good start.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, createSuite, tempDir, cleanup, shot, settle, sleep, audio } from './harness.mjs';

const suite = createSuite('safe');
const state = (profile) => {
  try {
    return JSON.parse(readFileSync(join(profile, 'chud-tiles.json'), 'utf8'));
  } catch {
    return {};
  }
};
const look = async (win) => {
  await win.waitForSelector('.titlebar'); // the interface has applied its settings
  await settle(win, 0.5);
  return win.evaluate(() => {
    const r = window.__ct.engine.renderer;
    const gl = r?.getContext();
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      safe: window.ct.safeMode,
      body: document.body.className,
      gpu: gl ? String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : 'none',
      effects: window.__ct.engine.cosmos.effects,
      fpsCap: window.__ct.engine.fpsCap,
      quality: window.__ct.engine.currentQuality,
      chip: !!document.querySelector('.titlebar button.chip'),
    };
  });
};

// 1 · asked for (CT_SAFE_MODE=1, like the --safe-mode argument)
{
  const profile = tempDir('ct-safe-');
  const { app, win } = await launch(profile, { CT_SAFE_MODE: '1' });
  win.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
  try {
    const l = await look(win);
    suite.check('safe mode on, asked', l.safe.on && l.safe.reason === 'asked', JSON.stringify(l.safe));
    suite.check('WebGL drawn by the processor', /swiftshader|software|llvmpipe/i.test(l.gpu), l.gpu);
    suite.check('low quality, minimal effects, 60 images/s at most', l.quality === 'low' && l.effects === 0 && l.fpsCap > 0 && l.fpsCap <= 60 && /lowfx/.test(l.body), JSON.stringify(l));
    suite.check('safe mode shown in the title bar', l.chip);
    await win.evaluate(() => window.__ct.nav.getState().go({ id: 'settings', tab: 'display' }));
    await settle(win, 0.8);
    suite.check('Settings › Display offers a normal restart', (await win.locator('button', { hasText: 'Redémarrer normalement' }).count()) === 1);
    await shot(win, 'safe-settings');

    // a song plays in safe mode
    const bytes = readFileSync(join(audio, 'short-120.mp3')).toString('base64');
    await win.evaluate(async (b64) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await window.__ct.openUrl(URL.createObjectURL(new Blob([bin], { type: 'audio/mpeg' })), 'short-120.mp3');
    }, bytes);
    await win.waitForFunction(() => !document.querySelector('button.btn.primary.huge')?.disabled, null, { timeout: 40000 });
    await win.evaluate(() => window.__ct.settings.getState().set({ fail: false }));
    await win.locator('button.btn.primary.huge').first().click();
    await win.waitForFunction(() => window.__ct.nav.getState().page.id === 'game', null, { timeout: 8000 });
    await settle(win, 6);
    const run = await win.evaluate(() => {
      const s = window.__ct.session();
      return { state: s?.state, t: s?.songTime(performance.now()), fps: window.__ct.engine.stats.fps };
    });
    await shot(win, 'safe-game');
    suite.check('a song plays in safe mode', run.t > 1, JSON.stringify(run));
  } catch (e) {
    suite.check('no exception (asked)', false, String(e?.stack ?? e));
  } finally {
    await app.close().catch(() => {});
    await sleep(300);
    cleanup(profile);
  }
}

// 2 · two starts that never reached a working interface → safe mode by itself
{
  const profile = tempDir('ct-safe-');
  writeFileSync(join(profile, 'chud-tiles.json'), JSON.stringify({ folders: [], adblock: true, starting: 2 }));
  const { app, win } = await launch(profile);
  try {
    const l = await look(win);
    suite.check('after two crashed starts: safe mode, reason crash', l.safe.on && l.safe.reason === 'crash', JSON.stringify(l.safe));
    await sleep(9500); // the interface reports a good start after 8 s
    suite.check('a good start clears the crash count', (state(profile).starting ?? 0) === 0, JSON.stringify(state(profile)));
  } catch (e) {
    suite.check('no exception (crashes)', false, String(e?.stack ?? e));
  } finally {
    await app.close().catch(() => {});
    await sleep(300);
  }
  // the next start is normal again
  const again = await launch(profile);
  try {
    const l = await look(again.win);
    suite.check('next start normal again', !l.safe.on && !l.chip && !/swiftshader/i.test(l.gpu) && l.effects > 0, JSON.stringify({ safe: l.safe, gpu: l.gpu, effects: l.effects }));
  } catch (e) {
    suite.check('no exception (normal)', false, String(e?.stack ?? e));
  } finally {
    await again.app.close().catch(() => {});
    await sleep(300);
    cleanup(profile);
  }
}
process.exit(suite.finish() ? 1 : 0);
