// Online test of the interface around YouTube Music: the radio room (search, suggestions, kinds,
// albums, pasted links), the lists room (saved lists, Chud Music's lists, queues), the ad blocker
// settings, and "listen first" on a short song (the song is learned, every difficulty is ready).
import { launch, createSuite, tempDir, cleanup, shot, settle, sleep } from './harness.mjs';

const suite = createSuite('radio');
const profile = tempDir('ct-radio-');
const { app, win } = await launch(profile);
win.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 400)));
win.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text().slice(0, 300)); });

const page = () => win.evaluate(() => window.__ct.nav.getState().page);
const text = () => win.evaluate(() => document.querySelector('.page-inner')?.textContent ?? '');
const clickButton = (re) => win.evaluate((src) => {
  const r = new RegExp(src);
  const b = [...document.querySelectorAll('button')].find((x) => r.test(x.textContent ?? '') && !x.disabled);
  b?.click();
  return !!b;
}, re.source);
async function waitFor(fn, ms = 20000, step = 250) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) return v;
    await sleep(step);
  }
}

try {
  // ── radio room ────────────────────────────────────────────────────────────────────────────
  await win.evaluate(() => window.__ct.nav.getState().go({ id: 'search' }));
  await settle(win);
  const input = win.locator('.search-bar input');
  await input.fill('daft punk');
  const sugg = await waitFor(() => win.evaluate(() => document.querySelectorAll('.search-bar .suggest button').length), 8000);
  suite.check('suggestions while typing', sugg > 0, `${sugg}`);
  await input.fill('Daft Punk Harder Better Faster Stronger');
  await input.press('Enter');
  const rows = await waitFor(() => win.evaluate(() => document.querySelectorAll('.lib-list .track-row').length));
  suite.check('song results', rows > 0, `${rows} rows`);
  await shot(win, 'radio-search');

  await clickButton(/^Albums$/);
  const albums = await waitFor(() => win.evaluate(() => !document.querySelector('.lib-panel.busy') && document.querySelectorAll('.col-card').length));
  suite.check('album results', albums > 0, `${albums} albums`);
  await win.evaluate(() => document.querySelector('.col-card')?.click());
  const tracksIn = await waitFor(() => win.evaluate(() => document.querySelectorAll('.lib-list .track-row').length));
  const albumTitle = await win.evaluate(() => document.querySelector('.lib-tools b')?.textContent?.trim() ?? '');
  suite.check('album opens with its songs', tracksIn > 0, `${albumTitle}: ${tracksIn}`);
  await shot(win, 'radio-album');
  await clickButton(/Enregistrer/);
  await sleep(500);
  await clickButton(/Tout jouer/);
  const p1 = await waitFor(async () => ((await page()).id === 'song' ? page() : null), 5000);
  const label = await waitFor(() => win.evaluate(() => [...document.querySelectorAll('.label')].map((l) => l.textContent ?? '').find((t) => /\d+\/\d+/.test(t)) ?? ''), 5000);
  suite.check('"play all" opens the first song as a queue', p1?.id === 'song' && /1\/\d+/.test(label), label);

  // a pasted link opens its song
  await win.evaluate(() => window.__ct.nav.getState().go({ id: 'search' }));
  await settle(win);
  await win.locator('.search-bar input').fill('https://youtu.be/dQw4w9WgXcQ?si=abc');
  await win.locator('.search-bar input').press('Enter');
  const p2 = await waitFor(async () => { const p = await page(); return p.id === 'song' ? p : null; }, 10000);
  suite.check('pasted link opens the song', p2?.track?.videoId === 'dQw4w9WgXcQ', `${p2?.track?.title}`);

  // ── lists room ────────────────────────────────────────────────────────────────────────────
  await win.evaluate(() => window.__ct.nav.getState().go({ id: 'playlists' }));
  await settle(win);
  const saved = await text();
  suite.check('saved album is in the lists', albumTitle && saved.includes(albumTitle.replace(/^\s+/, '')), albumTitle);
  const hadChud = await clickButton(/Chud Music/);
  if (hadChud) {
    const n = await waitFor(() => win.evaluate(() => [...document.querySelectorAll('section h3')].some((h) => /Chud Music/.test(h.textContent ?? ''))), 30000);
    suite.check('Chud Music lists imported (read only)', n, '');
  }
  await clickButton(/Nouvelle liste/);
  await settle(win, 0.2);
  await win.locator('form input[placeholder="Nom de la liste"]').fill('Test e2e');
  await win.locator('form input[placeholder="Nom de la liste"]').press('Enter');
  await settle(win, 0.3);
  await clickButton(/^\s*Ajouter$/);
  await settle(win, 0.3);
  await win.evaluate(() => document.querySelectorAll('.lib-panel .track-row')[0]?.click());
  await win.evaluate(() => document.querySelectorAll('.lib-panel .track-row')[0]?.click());
  await settle(win, 0.3);
  const ownRows = await win.evaluate(() => document.querySelectorAll('.lib-panel:last-child .track-row').length);
  suite.check('own list: songs added from the archives', ownRows >= 2, `${ownRows}`);
  await shot(win, 'lists');

  // ── settings › YouTube ──────────────────────────────────────────────────────────────────────
  await win.evaluate(() => window.__ct.nav.getState().go({ id: 'settings', tab: 'youtube' }));
  await settle(win, 3); // the camera flies to the settings room
  const ab = await waitFor(() => win.evaluate(() => document.querySelector('.ab-stats')?.textContent ?? ''), 8000);
  suite.check('ad blocker panel', /filtres/.test(ab ?? ''), (ab ?? '').replace(/\s+/g, ' ').slice(0, 120));
  await shot(win, 'settings-youtube');

  // ── listen first on a short song ────────────────────────────────────────────────────────────
  const shortQ = process.env.CT_YT_SHORT ?? 'The Beatles Her Majesty';
  const found = await win.evaluate((q) => window.ct.yt.search(q, 'song'), shortQ);
  const short = found.find((x) => x.duration && x.duration < 60);
  suite.check('a short song to learn', !!short, short ? `${short.title} (${short.duration}s)` : 'none under 60 s');
  if (short) {
    await win.evaluate((it) => window.__ct.nav.getState().go({ id: 'song', track: { key: `yt:${it.id}`, source: 'youtube', videoId: it.id, title: it.title, artist: it.artist, album: it.album ?? null, duration: it.duration, cover: it.thumbnail, origin: 'youtube' } }), short);
    await waitFor(() => win.evaluate(() => !!window.__ct.yt()?.isPrimed), 40000, 500);
    await waitFor(() => win.evaluate(() => [...document.querySelectorAll('button')].some((b) => /Écouter d’abord/.test(b.textContent ?? '') && !b.disabled)), 15000);
    const started = await clickButton(/Écouter d’abord/);
    suite.check('listening starts', started);
    const t0 = Date.now();
    const learned = await waitFor(() => win.evaluate(() => !document.querySelector('.learn-panel') && [...document.querySelectorAll('.toast')].some((t) => /appris/.test(t.textContent ?? ''))), (short.duration + 40) * 1000, 1000);
    suite.check('song learned after one listen', learned, `${Math.round((Date.now() - t0) / 1000)} s`);
    const diffs = await win.evaluate(() => document.querySelectorAll('.diff-list button, .diff-row').length);
    console.log('difficulty rows:', diffs);
    await shot(win, 'learned');
    // a second visit plays from the stored analysis, no listening needed
    await win.evaluate(() => window.__ct.nav.getState().go({ id: 'home' }));
    await settle(win);
    await win.evaluate((it) => window.__ct.nav.getState().go({ id: 'song', track: { key: `yt:${it.id}`, source: 'youtube', videoId: it.id, title: it.title, artist: it.artist, album: null, duration: it.duration, cover: it.thumbnail, origin: 'youtube' } }), short);
    await sleep(2500);
    const again = await win.evaluate(() => !document.querySelector('.learn-panel'));
    suite.check('learned song is remembered', again);
  }
} catch (e) {
  suite.check('no exception', false, String(e?.stack ?? e));
} finally {
  await app.close().catch(() => {});
  await sleep(300);
  cleanup(profile);
}
process.exit(suite.finish() ? 1 : 0);
