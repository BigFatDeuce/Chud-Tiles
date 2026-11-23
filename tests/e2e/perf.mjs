// Resource use: images per second, processor and memory of every process, in the menus and during
// a run. Prints the measures; fails when the menus or a run use far more than they should.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, createSuite, tempDir, cleanup, sleep, audio } from './harness.mjs';

const suite = createSuite('perf');
const profile = tempDir('ct-perf-');
const { app, win } = await launch(profile);

/** CPU (% of one core) and memory (MB) per process type, averaged over `seconds`. */
async function measure(label, seconds = 5) {
  await app.evaluate(({ app }) => app.getAppMetrics()); // starts the CPU counters
  const f0 = await win.evaluate(() => window.__ct.engine.stats.frames);
  await sleep(seconds * 1000);
  const f1 = await win.evaluate(() => window.__ct.engine.stats.frames);
  const m = await app.evaluate(({ app }) => app.getAppMetrics().map((p) => ({ type: p.type, cpu: p.cpu.percentCPUUsage, mem: p.memory.workingSetSize / 1024 })));
  const by = {};
  for (const p of m) {
    const k = p.type;
    by[k] ??= { cpu: 0, mem: 0, n: 0 };
    by[k].cpu += p.cpu;
    by[k].mem += p.mem;
    by[k].n++;
  }
  const cpu = m.reduce((a, p) => a + p.cpu, 0);
  const mem = m.reduce((a, p) => a + p.mem, 0);
  const fps = (f1 - f0) / seconds;
  const detail = Object.entries(by).map(([k, v]) => `${k}×${v.n} ${v.cpu.toFixed(0)}% ${v.mem.toFixed(0)}MB`).join(' · ');
  console.log(`  ${label}: ${fps.toFixed(0)} i/s, CPU ${cpu.toFixed(0)} %, RAM ${mem.toFixed(0)} MB  [${detail}]`);
  return { fps, cpu, mem };
}

try {
  await sleep(3000);
  const home = await measure('menu (home)');
  // the images per second must follow the screen at most, never run free
  suite.check('menus: frame rate bounded', home.fps <= 65, `${home.fps.toFixed(0)} i/s`);

  const bytes = readFileSync(join(audio, 'short-120.mp3')).toString('base64');
  await win.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.__ct.openUrl(URL.createObjectURL(new Blob([bin], { type: 'audio/mpeg' })), 'short-120.mp3');
  }, bytes);
  await win.evaluate(() => window.__ct.settings.getState().set({ difficulty: 'normal', fail: false }));
  for (let i = 0; i < 80; i++) {
    if (await win.evaluate(() => !document.querySelector('button.btn.primary.huge')?.disabled)) break;
    await sleep(250);
  }
  const song = await measure('song page', 3);
  await win.evaluate(() => document.querySelector('button.btn.primary.huge')?.click());
  await sleep(4000);
  const game = await measure('run', 6);
  suite.check('run: images drawn', game.fps > 20, `${game.fps.toFixed(0)} i/s`);
  suite.check('memory under 1.5 GB', Math.max(home.mem, song.mem, game.mem) < 1500, `${Math.max(home.mem, song.mem, game.mem).toFixed(0)} MB`);
} catch (e) {
  suite.check('no exception', false, String(e?.stack ?? e));
} finally {
  await app.close().catch(() => {});
  await sleep(300);
  cleanup(profile);
}
process.exit(suite.finish() ? 1 : 0);
