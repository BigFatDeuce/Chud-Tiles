// The browser version, offline: served from dist-web (npm run web:build), it starts in the
// browser's language, a local file becomes a chart, the preview plays it with judgements, and the
// language selector works. Headless Chromium: nothing is shown or heard.
//   CT_BROWSER_PATH=…/chrome.exe to use another Chromium (or CT_BROWSER=msedge|chrome)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { audio, createSuite, root, shots, sleep } from './harness.mjs';

const suite = createSuite('web');
const dist = join(root, 'dist-web');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    // the test song, served next to the site
    if (url.pathname === '/__fixture.mp3') {
      res.writeHead(200, { 'content-type': 'audio/mpeg' });
      return res.end(await readFile(join(audio, 'short-120.mp3')));
    }
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^[\\/]+/, '');
    if (!p || p.endsWith('/') || p.endsWith('\\')) p += 'index.html';
    const body = await readFile(join(dist, p));
    res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CT_BROWSER_PATH ? { executablePath: process.env.CT_BROWSER_PATH } : process.env.CT_BROWSER ? { channel: process.env.CT_BROWSER } : {}),
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));

try {
  await page.goto(base);
  await page.waitForFunction(() => !!window.__ct?.engine, null, { timeout: 30000 });
  const info = await page.evaluate(() => ({ web: !window.ct, lang: window.__ct.i18n.lang, gl: !!window.__ct.engine.renderer }));
  suite.check('browser version starts (WebGL, English browser → English)', info.web && info.gl && info.lang === 'en', JSON.stringify(info));
  await page.screenshot({ path: join(shots, 'web-home.png') });

  await page.evaluate(async () => {
    await window.__ct.openUrl('/__fixture.mp3', 'short-120.mp3');
  });
  await page.waitForFunction(() => !document.querySelector('button.btn.primary.huge')?.disabled, null, { timeout: 60000 });
  const bpm = await page.evaluate(() => [...document.querySelectorAll('.facts .chip')].map((c) => c.textContent).find((t) => /BPM/.test(t ?? '')));
  suite.check('local file analysed in the browser', bpm && Math.abs(parseInt(bpm, 10) - 120) <= 1, bpm);

  // the preview (autoplay) plays the chart: judgements come in
  await page.locator('button.btn.huge.icon').first().click();
  await page.waitForFunction(() => window.__ct.nav.getState().page.id === 'game', null, { timeout: 8000 });
  await sleep(7000);
  const run = await page.evaluate(() => {
    const s = window.__ct.session();
    return { state: s?.state, t: s?.songTime(performance.now()), judged: s?.judge.state.judged ?? 0, perfect: s?.judge.state.perfect ?? 0 };
  });
  await page.screenshot({ path: join(shots, 'web-game.png') });
  suite.check('the chart plays in the browser', run.t > 2 && run.judged > 3, JSON.stringify(run));
  const missing = await page.evaluate(() => window.__ct.i18n.missing());
  suite.check('no text without a translation', !missing.length, missing.slice(0, 10).join(' | '));

  // language selector: French, kept after a reload
  await page.evaluate(() => window.__ct.settings.getState().set({ lang: 'fr' }));
  await page.reload();
  await page.waitForFunction(() => !!window.__ct?.engine, null, { timeout: 30000 });
  suite.check('language kept after reload (French)', (await page.evaluate(() => window.__ct.i18n.lang)) === 'fr');
} catch (e) {
  suite.check('no exception', false, String(e?.stack ?? e));
} finally {
  await browser.close();
  server.close();
}
process.exit(suite.finish() ? 1 : 0);
