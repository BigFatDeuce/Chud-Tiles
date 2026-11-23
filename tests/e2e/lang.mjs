// Languages: on an English system the interface starts in English, every page shows English text
// (no French left, no text without a translation), the system side's messages are translated too,
// and the language selector switches the interface to French.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, createSuite, tempDir, cleanup, shot, settle, sleep, audio } from './harness.mjs';

const suite = createSuite('lang');
const profile = tempDir('ct-lang-');
const { app, win } = await launch(profile, { CT_LANG: 'en-US' });
win.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 400)));

// Words and letters that only French text has (the language selector's "Français" aside).
const FRENCH = /[éèêàçùûôîœ]|\b(le|la|les|des|une|du|et|pour|avec|sans|vos|votre|dans|Jouer|Réglages|morceaux?|Retour|Fermer|Colonnes|Difficulté|parties?)\b/;
async function french() {
  return win.evaluate((src) => {
    const re = new RegExp(src);
    const text = document.getElementById('root').innerText.replace(/Français/g, '');
    const hits = [];
    for (const line of text.split('\n')) if (re.test(line)) hits.push(line.trim().slice(0, 90));
    return hits;
  }, FRENCH.source);
}
async function waitFor(fn, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v || Date.now() - t0 > ms) return v;
    await sleep(200);
  }
}
const go = (p) => win.evaluate((p) => window.__ct.nav.getState().go(p), p);

try {
  const st = await win.evaluate(() => ({ lang: window.__ct.i18n.lang, html: document.documentElement.lang }));
  suite.check('English system → English interface', st.lang === 'en' && st.html === 'en', JSON.stringify(st));

  const left = {};
  for (const id of ['home', 'library', 'playlists', 'search', 'stats', 'calibration']) {
    await go({ id });
    await settle(win, 1);
    const hits = await french();
    if (hits.length) left[id] = hits;
    if (id === 'home' || id === 'library') await shot(win, `en-${id}`);
  }
  await go({ id: 'settings' });
  await settle(win, 1);
  for (const tab of ['Game', 'Controls', 'Audio & sync', 'Display', 'YouTube', 'Data', 'About']) {
    await win.locator('.settings .tabs button').filter({ hasText: tab }).first().click();
    await settle(win, 0.6);
    const hits = await french();
    if (hits.length) left[`settings/${tab}`] = hits;
    if (tab === 'Game') await shot(win, 'en-settings');
  }

  // a song: its page, the game and the pause screen
  const bytes = readFileSync(join(audio, 'short-120.mp3')).toString('base64');
  await win.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.__ct.openUrl(URL.createObjectURL(new Blob([bin], { type: 'audio/mpeg' })), 'short-120.mp3');
  }, bytes);
  const ready = await waitFor(() => win.evaluate(() => !document.querySelector('button[aria-label="Edit the chart"]')?.disabled), 40000);
  suite.check('song analysed (English labels)', ready);
  await settle(win, 0.6);
  let hits = await french();
  if (hits.length) left.song = hits;
  await shot(win, 'en-song');
  await win.locator('button.btn.primary.huge').first().click();
  await waitFor(() => win.evaluate(() => window.__ct.nav.getState().page.id === 'game'), 8000);
  await settle(win, 2);
  await win.keyboard.press('Escape');
  await settle(win, 0.6);
  hits = await french();
  if (hits.length) left.pause = hits;
  await shot(win, 'en-pause');
  suite.check('pause screen in English', await win.locator('button', { hasText: 'Resume' }).count() > 0);
  await win.locator('button', { hasText: 'Quit' }).first().click();
  await settle(win, 0.6);

  suite.check('no French left on the pages', !Object.keys(left).length, JSON.stringify(left).slice(0, 1500));
  const missing = await win.evaluate(() => window.__ct.i18n.missing());
  suite.check('no text shown without a translation', !missing.length, missing.slice(0, 20).join(' | '));

  // the system side answers in the interface's language
  const err = await win.evaluate(() => window.ct.transcode('C:/not-audio.txt').then(() => '', (e) => String(e?.message ?? e)));
  suite.check('system-side messages in English', /This file is not an audio file/.test(err), err.slice(0, 160));

  // the selector: Settings → Game → Français reloads the interface in French
  await go({ id: 'settings' });
  await settle(win, 0.8);
  await win.locator('button', { hasText: 'Français' }).first().click();
  await win.waitForFunction(() => window.__ct?.i18n?.lang === 'fr', null, { timeout: 15000 });
  await win.waitForFunction(() => !!window.__ct?.engine, null, { timeout: 30000 });
  const fr = await win.evaluate(() => ({ lang: window.__ct.i18n.lang, saved: window.__ct.settings.getState().lang }));
  await go({ id: 'home' });
  await settle(win, 1);
  const home = await win.evaluate(() => document.getElementById('root').innerText);
  suite.check('selector switches to French', fr.lang === 'fr' && fr.saved === 'fr' && /jouer un fichier/i.test(home), JSON.stringify(fr));
  await shot(win, 'fr-home');
} catch (e) {
  suite.check('no exception', false, String(e?.stack ?? e));
} finally {
  await app.close().catch(() => {});
  await sleep(300);
  cleanup(profile);
}
process.exit(suite.finish() ? 1 : 0);
