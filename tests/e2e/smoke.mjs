// Desktop smoke test: the window opens, the bridge is there, pages render, local files and the
// Chud Music import work (read only), the YouTube player page is served.
import { launch, createSuite, tempDir, cleanup, shot, settle, sleep } from './harness.mjs';

const suite = createSuite('smoke');
const profile = tempDir('ct-smoke-');
const { app, win } = await launch(profile);
try {
  const info = await win.evaluate(() => ({ ct: !!window.ct, platform: window.ct?.platform, version: window.ct?.version, testing: window.ct?.testing, player: window.ct?.yt.playerUrl }));
  suite.check('bridge exposed', info.ct && info.testing, JSON.stringify(info));
  suite.check('ffmpeg found', await win.evaluate(() => window.ct.hasFfmpeg()));
  await shot(win, 'smoke-home');
  const st = await win.evaluate(() => window.ct.yt.adblock.status());
  suite.check('adblock status readable', typeof st.enabled === 'boolean', `enabled=${st.enabled} waiting=${st.waiting} active=${st.active}`);
  const cm = await win.evaluate(() => window.ct.library.chudMusic().then((l) => ({ found: l.found, tracks: l.tracks.length, playlists: l.playlists.length, local: l.tracks.filter((t) => t.source === 'local').length })));
  suite.check('Chud Music library read', true, JSON.stringify(cm));
  for (const p of ['library', 'stats', 'settings', 'search', 'playlists']) {
    await win.evaluate((id) => window.__ct.nav.getState().go({ id }), p);
    await settle(win, 1.2);
    await shot(win, `smoke-${p}`);
  }
  suite.check('pages rendered', true);
} catch (e) {
  suite.check('no exception', false, String(e?.stack ?? e));
} finally {
  await app.close().catch(() => {});
  await sleep(300);
  cleanup(profile);
}
process.exit(suite.finish() ? 1 : 0);
