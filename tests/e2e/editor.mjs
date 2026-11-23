// The chart workshop on a local song: add a note, undo/redo, draw a long note, remove one, save,
// the "modified" mark on the song page, the edit kept on reopening, testing it in the game, and
// going back to the generated chart.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, createSuite, tempDir, cleanup, shot, settle, sleep, audio } from './harness.mjs';

const suite = createSuite('editor');
const profile = tempDir('ct-edit-');
const { app, win } = await launch(profile);
win.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 400)));
win.on('dialog', (d) => d.accept());
const page = () => win.evaluate(() => window.__ct.nav.getState().page.id);
const btn = (label) => win.locator(`button[aria-label="${label}"]`);
const count = () => win.evaluate(() => window.__ct.editor.notes().length);
async function waitFor(fn, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v || Date.now() - t0 > ms) return v;
    await sleep(200);
  }
}
/** Screen point of (lane, time) on the workshop's canvas, the view set to `view`. */
async function point(lane, t) {
  return win.evaluate(({ lane, t }) => {
    const c = document.querySelector('.editor-stage canvas');
    const r = c.getBoundingClientRect();
    const g = window.__ct.editor.geometry();
    const lw = Math.min(96, (c.clientWidth - 140) / g.lanes);
    const x0 = (c.clientWidth - lw * g.lanes) / 2;
    return { x: r.left + x0 + (lane + 0.5) * lw, y: r.top + c.clientHeight * g.hitY - (t - g.view) * g.pps };
  }, { lane, t });
}
/** A time in `lane` with no note within ±0.6 s, between from and to. */
async function freeSpot(lane, from, to) {
  return win.evaluate(({ lane, from, to }) => {
    const ns = window.__ct.editor.notes();
    for (let t = from; t < to; t += 0.05) if (!ns.some((n) => n.lane === lane && t > n.t - 0.6 && t < n.t + n.dur + 0.6)) return t;
    return null;
  }, { lane, from, to });
}

try {
  const bytes = readFileSync(join(audio, 'short-120.mp3')).toString('base64');
  await win.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.__ct.openUrl(URL.createObjectURL(new Blob([bin], { type: 'audio/mpeg' })), 'short-120.mp3');
  }, bytes);
  await win.evaluate(() => window.__ct.settings.getState().set({ difficulty: 'normal', fail: false }));
  const ready = await waitFor(() => win.evaluate(() => !document.querySelector('button[aria-label="Modifier la partition"]')?.disabled), 40000);
  suite.check('song analysed, workshop available', ready);
  await btn('Modifier la partition').click();
  await waitFor(async () => (await page()) === 'editor' && (await win.evaluate(() => !!window.__ct.editor)), 5000);
  await settle(win, 0.5);
  const n0 = await count();
  suite.check('workshop opens with the generated chart', n0 > 10, `${n0} notes`);
  await shot(win, 'editor');

  // add a note
  const t1 = await freeSpot(1, 2, 12);
  await win.evaluate((t) => window.__ct.editor.setView(t - 0.5), t1);
  let p = await point(1, t1);
  await win.mouse.click(p.x, p.y);
  suite.check('click adds a note', (await count()) === n0 + 1, `${await count()}`);
  await win.keyboard.press('Control+z');
  suite.check('undo', (await count()) === n0);
  await win.keyboard.press('Control+y');
  suite.check('redo', (await count()) === n0 + 1);

  // draw a long note
  const t2 = await freeSpot(2, 3, 14);
  await win.evaluate((t) => window.__ct.editor.setView(t - 0.3), t2);
  const a = await point(2, t2);
  const b = await point(2, t2 + 1.1);
  await win.mouse.move(a.x, a.y);
  await win.mouse.down();
  await win.mouse.move(a.x, (a.y + b.y) / 2, { steps: 4 });
  await win.mouse.move(b.x, b.y, { steps: 4 });
  await win.mouse.up();
  const hold = await win.evaluate((t) => window.__ct.editor.notes().find((n) => n.lane === 2 && Math.abs(n.t - t) < 0.3), t2);
  suite.check('drag draws a long note', hold && hold.dur > 0.5, JSON.stringify(hold && { t: hold.t.toFixed(2), dur: hold.dur.toFixed(2), kind: hold.kind }));

  // right click removes it
  p = await point(2, hold?.t ?? t2);
  await win.mouse.click(p.x, p.y, { button: 'right' });
  suite.check('right click removes a note', (await count()) === n0 + 1);

  // save, leave, mark on the song page
  await win.keyboard.press('Control+s');
  await sleep(400);
  const saved = await win.evaluate(() => [...document.querySelectorAll('.toast')].some((t) => /enregistrée/.test(t.textContent ?? '')));
  suite.check('saved', saved);
  await win.evaluate(() => [...document.querySelectorAll('.editor-bar button')].find((b) => /Retour/.test(b.textContent ?? ''))?.click());
  await waitFor(async () => (await page()) === 'song', 5000);
  await settle(win, 0.5);
  const mark = await waitFor(() => win.evaluate(() => [...document.querySelectorAll('.diff.on .meta')].some((m) => /modifiée/.test(m.textContent ?? ''))), 5000);
  suite.check('song page shows the edited chart', mark);

  // reopen: the edit is there
  await btn('Modifier la partition').click();
  await waitFor(async () => (await page()) === 'editor' && (await win.evaluate(() => !!window.__ct.editor)), 5000);
  const kept = await waitFor(async () => (await count()) === n0 + 1, 3000);
  suite.check('edit kept on reopening', kept, `${await count()}`);

  // test it in the game
  await win.evaluate((t) => window.__ct.editor.setView(t), t1);
  await win.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Tester/.test(b.textContent ?? ''))?.click());
  await waitFor(async () => (await page()) === 'game', 5000);
  const game = await win.evaluate(() => { const g = window.__ct.nav.getState().page.game; return { notes: g.chart.notes.length, practice: g.practice }; });
  suite.check('"test" plays the edited chart', game.notes === n0 + 1 && game.practice?.from > 0, JSON.stringify(game));
  await win.evaluate(() => window.__ct.nav.getState().go({ id: 'home' }));
  await settle(win, 0.5);

  // restore the generated chart
  await win.evaluate(() => { const st = window.__ct.nav.getState(); const s = [...st.stack].reverse().find((p) => p.id === 'song'); st.go(s); });
  await waitFor(async () => (await page()) === 'song', 5000);
  await waitFor(() => win.evaluate(() => !document.querySelector('button[aria-label="Modifier la partition"]')?.disabled), 20000);
  await btn('Modifier la partition').click();
  await waitFor(async () => (await page()) === 'editor' && (await win.evaluate(() => !!window.__ct.editor)), 5000);
  await waitFor(async () => (await count()) === n0 + 1, 3000);
  await btn('Revenir à la partition générée').click();
  await sleep(300);
  suite.check('restore the generated chart', (await count()) === n0, `${await count()}`);
} catch (e) {
  suite.check('no exception', false, String(e?.stack ?? e));
} finally {
  await app.close().catch(() => {});
  await sleep(300);
  cleanup(profile);
}
process.exit(suite.finish() ? 1 : 0);
