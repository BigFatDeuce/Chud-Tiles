// Local files in every format of the specification, opened by their path like a file picked in the
// archives: MP3, FLAC, WAV, OGG, OPUS, AAC, M4A (AAC and ALAC), AIFF, WMA. Formats the page cannot
// decode go through FFmpeg. Each one must give a playable chart at the right tempo, and the
// original files must stay byte for byte the same.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { launch, createSuite, tempDir, cleanup, settle, sleep, audio } from './harness.mjs';

const suite = createSuite('formats');
const files = readdirSync(audio).filter((f) => f.startsWith('short-120.'));
const fingerprint = () => Object.fromEntries(files.map((f) => {
  const p = join(audio, f);
  return [f, `${createHash('sha256').update(readFileSync(p)).digest('hex')}:${statSync(p).mtimeMs}`];
}));
const before = fingerprint();

const profile = tempDir('ct-formats-');
const { app, win } = await launch(profile);
win.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
try {
  for (const f of files) {
    const path = join(audio, f);
    const t0 = Date.now();
    const ref = await win.evaluate((p) => window.ct.library.fromPaths([p]).then((r) => r[0] ?? null), path);
    if (!ref) {
      suite.check(`${f}: recognised as audio`, false);
      continue;
    }
    await win.evaluate((r) => window.__ct.nav.getState().go({ id: 'song', track: r }), ref);
    let out = null;
    for (let i = 0; i < 200 && !out; i++) {
      await sleep(150);
      out = await win.evaluate(() => {
        const play = document.querySelector('button.btn.primary.huge');
        if (play && !play.disabled) {
          const bpm = [...document.querySelectorAll('.facts .chip')].map((c) => c.textContent).find((t) => /BPM/.test(t ?? ''));
          return { ok: true, bpm: bpm ? parseInt(bpm, 10) : null };
        }
        const err = document.querySelector('.song-error, .error-text, .panel.error');
        return err ? { ok: false, error: err.textContent?.slice(0, 160) } : null;
      });
    }
    const ms = Date.now() - t0;
    suite.check(`${f}: playable chart, 120 BPM`, out?.ok && out.bpm && Math.abs(out.bpm - 120) <= 1, `${JSON.stringify(out)} in ${ms} ms`);
    await win.evaluate(() => window.__ct.nav.getState().go({ id: 'home' }));
    await settle(win, 0.3);
  }
} catch (e) {
  suite.check('no exception', false, String(e?.stack ?? e));
} finally {
  await app.close().catch(() => {});
  await sleep(300);
  cleanup(profile);
}
const after = fingerprint();
suite.check('original files untouched (content and date)', files.every((f) => before[f] === after[f]));
process.exit(suite.finish() ? 1 : 0);
