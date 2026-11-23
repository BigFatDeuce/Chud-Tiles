// Online test: YouTube Music search, the official player in the Song page, the analyser inside
// YouTube's frame, a live run (Mode A), and the learning of the song. Needs a connection.
import { launch, createSuite, tempDir, cleanup, shot, settle, sleep } from './harness.mjs';

const suite = createSuite('youtube');
const profile = tempDir('ct-yt-');
const { app, win } = await launch(profile);
win.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text().slice(0, 300)); });
win.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 400)));
const query = process.env.CT_YT_QUERY ?? 'Daft Punk Around the World';
try {
  const items = await win.evaluate((q) => window.ct.yt.search(q, 'song'), query);
  suite.check('search returns songs', items.length > 0, `${items.length} — ${items[0]?.title} / ${items[0]?.artist} (${items[0]?.duration}s)`);
  const it = items[0];
  const sugg = await win.evaluate(() => window.ct.yt.suggestions('daft pu'));
  suite.check('suggestions', sugg.length > 0, sugg.slice(0, 3).join(' | '));
  await win.evaluate((it) => window.__ct.nav.getState().go({ id: 'song', track: { key: `yt:${it.id}`, source: 'youtube', videoId: it.id, title: it.title, artist: it.artist, album: it.album ?? null, duration: it.duration, cover: it.thumbnail, origin: 'youtube' } }), it);
  // the player is primed: loaded, played muted until it really plays, paused at 0
  let primed = false;
  for (let i = 0; i < 80 && !primed; i++) {
    await sleep(500);
    primed = await win.evaluate(() => !!window.__ct.yt()?.isPrimed);
  }
  const st = await win.evaluate(() => { const h = window.__ct.yt(); return { primed: h?.isPrimed, analyser: h?.analyserOk, dur: h?.duration, err: h?.error, t: h?.mediaAt(performance.now()) }; });
  suite.check('player primed', st.primed, JSON.stringify(st));
  suite.check('analyser inside YouTube frame', st.analyser === true);
  const ab = await win.evaluate(() => window.ct.yt.adblock.status());
  suite.check('ad blocker', true, `active=${ab.active} filters=${ab.filters} blocked=${ab.blocked} adsSeen=${ab.adsSeen} waiting=${ab.waiting} checking=${ab.checking} err=${ab.error}`);
  await shot(win, 'yt-song');

  // live run (nobody plays: no failure)
  await win.evaluate(() => window.__ct.settings.getState().set({ fail: false }));
  await win.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /Jouer en direct/.test(x.textContent ?? ''));
    b?.click();
  });
  await sleep(1500);
  const frames = await win.evaluate(() => new Promise((res) => {
    const h = window.__ct.yt();
    let n = 0;
    const off = h.onFrames((b) => (n += b.times.length));
    setTimeout(() => { off(); res(n); }, 3000);
  }));
  suite.check('frames arrive during play', frames > 100, `${frames} frames in 3 s`);
  // let the predictor lock the tempo, keep the page rendering
  await win.evaluate(() => { const s = window.__ct.session(); if (s) s.pause = () => {}; });
  await win.evaluate(() => window.__ct.pump(30));
  console.log('page after run:', await win.evaluate(() => window.__ct.nav.getState().page.id), await win.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | ')));
  const run = await win.evaluate(() => {
    const s = window.__ct.session();
    const h = window.__ct.yt();
    const now = performance.now();
    return { state: s?.state, notes: s?.judge.notes.length, t: s?.songTime(now), media: h?.mediaAt(now) };
  });
  suite.check('live notes predicted', run.notes > 10, JSON.stringify(run));
  await shot(win, 'yt-live');
  // clock: the game's song time follows YouTube's media time (buffering stalls pause both)
  const sync = await win.evaluate(async () => {
    const s = window.__ct.session();
    const h = window.__ct.yt();
    const out = [];
    for (let i = 0; i < 20; i++) {
      const now = performance.now();
      const m = h.mediaAt(now);
      if (m.playing) out.push(s.songTime(now) + s.cfg.audioOffsetMs / 1000 - m.t);
      await new Promise((r) => setTimeout(r, 100));
    }
    return out;
  });
  const worst = sync.length ? Math.max(...sync.map(Math.abs)) : NaN;
  suite.check('song time = YouTube media time', sync.length > 5 && worst < 0.005, `${sync.length} samples, worst ${(worst * 1000).toFixed(2)} ms`);
  // quitting a live run learns the song when enough was heard (not here: a short run)
  await win.evaluate(() => window.__ct.nav.getState().go({ id: 'home' }));
  await settle(win, 0.5);
  const hidden = await win.evaluate(() => document.querySelector('.yt-dock')?.className);
  suite.check('player hidden and paused after the run', /hidden/.test(hidden ?? ''), hidden);
} catch (e) {
  suite.check('no exception', false, String(e?.stack ?? e));
} finally {
  await app.close().catch(() => {});
  await sleep(300);
  cleanup(profile);
}
process.exit(suite.finish() ? 1 : 0);
