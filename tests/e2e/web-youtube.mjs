// Online test of the browser build with YouTube: a pasted link, the official IFrame player, the
// smoothness of its clock, and the tab capture that lets the song be analysed (Mode A in the
// browser). Serves dist-web (npm run web:build) and drives Chromium; the tab's sound is muted for
// the person at the computer (--mute-audio), the capture still hears it.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createSuite, root, shots, sleep } from './harness.mjs';

const suite = createSuite('web-youtube');
const dist = join(root, 'dist-web');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.ico': 'image/x-icon' };
const server = createServer(async (req, res) => {
  try {
    let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[\\/]+/, '');
    if (!p || p.endsWith('/') || p.endsWith('\\')) p += 'index.html';
    const body = await readFile(join(dist, p));
    res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://localhost:${server.address().port}/`;

// Tab capture only receives sound in a real (headed) browser: the window is put off-screen, and
// --disable-audio-output sends the sound to a fake device (heard by the capture, not by anyone).
const browser = await chromium.launch({
  headless: false,
  // Playwright's Chromium, or another one: CT_BROWSER_PATH=…/chrome.exe, or CT_BROWSER=msedge|chrome
  ...(process.env.CT_BROWSER_PATH ? { executablePath: process.env.CT_BROWSER_PATH } : process.env.CT_BROWSER ? { channel: process.env.CT_BROWSER } : {}),
  args: ['--autoplay-policy=no-user-gesture-required', '--auto-accept-this-tab-capture', '--disable-audio-output', ...(process.env.CT_TEST_VISIBLE ? [] : ['--window-position=-32000,-32000'])],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text().slice(0, 200)); });
const video = process.env.CT_YT_VIDEO ?? 'dQw4w9WgXcQ';

try {
  await page.goto(url);
  await page.waitForFunction(() => !!window.__ct?.engine, null, { timeout: 30000 });
  await page.evaluate(() => window.__ct.settings.getState().set({ fail: false }));
  await page.evaluate(() => window.__ct.nav.getState().go({ id: 'search' }));
  await page.waitForSelector('.search-bar input');
  await page.fill('.search-bar input', `https://music.youtube.com/watch?v=${video}&feature=share`);
  await page.press('.search-bar input', 'Enter');
  await page.waitForFunction(() => window.__ct.nav.getState().page.id === 'song', null, { timeout: 10000 });
  suite.check('pasted link opens the song page', true);
  let primed = false;
  for (let i = 0; i < 60 && !primed; i++) {
    await sleep(500);
    primed = await page.evaluate(() => !!window.__ct.yt()?.isPrimed);
  }
  const st = await page.evaluate(() => { const h = window.__ct.yt(); return { kind: h?.kind, primed: h?.isPrimed, dur: h?.duration, err: h?.error, analysis: h?.analysis }; });
  suite.check('IFrame player primed', st.primed, JSON.stringify(st));
  await page.screenshot({ path: join(shots, 'web-yt-song.png') });

  // play: the live run asks for the tab's sound (auto-accepted here)
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /Jouer en direct/.test(x.textContent ?? '') && !x.disabled);
    b?.click();
    return !!b;
  });
  suite.check('"play live" available in the browser', clicked);
  await page.waitForFunction(() => window.__ct.nav.getState().page.id === 'game', null, { timeout: 15000 }).catch(() => {});
  const cap = await page.evaluate(() => window.__ct.yt()?.analysis);
  suite.check('tab capture granted', cap === 'capture', cap);
  // clock: smoothness of the media time the game follows (deviation from a straight line)
  await sleep(4000);
  const clock = await page.evaluate(async () => {
    const h = window.__ct.yt();
    const pts = [];
    for (let i = 0; i < 60; i++) {
      const now = performance.now();
      const m = h.mediaAt(now);
      if (m.playing) pts.push([now / 1000, m.t]);
      await new Promise((r) => setTimeout(r, 50));
    }
    if (pts.length < 10) return { n: pts.length };
    const n = pts.length;
    const mx = pts.reduce((s, p) => s + p[0], 0) / n;
    const my = pts.reduce((s, p) => s + p[1], 0) / n;
    const k = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
    const dev = Math.max(...pts.map((p) => Math.abs(my + k * (p[0] - mx) - p[1])));
    return { n, slope: k, dev };
  });
  suite.check('media clock is smooth', clock.n >= 10 && clock.dev < 0.03 && Math.abs(clock.slope - 1) < 0.02, JSON.stringify(clock));
  const frames = await page.evaluate(() => new Promise((res) => {
    const h = window.__ct.yt();
    let n = 0;
    let loud = 0;
    let max = 0;
    const off = h.onFrames((b) => {
      n += b.times.length;
      for (let i = 0; i < b.times.length; i++) {
        const r = b.data[i * 32 + 28];
        if (r > 0.01) loud++;
        if (r > max) max = r;
      }
    });
    setTimeout(() => { off(); res({ n, loud, max }); }, 3000);
  }));
  suite.check('frames from the tab capture', frames.n > 100 && frames.loud > frames.n * 0.3, JSON.stringify(frames));
  await page.evaluate(() => { const s = window.__ct.session(); if (s) s.pause = () => {}; });
  await sleep(26000);
  const run = await page.evaluate(() => { const s = window.__ct.session(); const now = performance.now(); return { state: s?.state, notes: s?.judge.notes.length, t: s?.songTime(now) }; });
  suite.check('live notes predicted in the browser', run.notes > 10, JSON.stringify(run));
  await page.screenshot({ path: join(shots, 'web-yt-live.png') });
} catch (e) {
  suite.check('no exception', false, String(e?.stack ?? e));
} finally {
  await browser.close().catch(() => {});
  server.close();
}
process.exit(suite.finish() ? 1 : 0);
