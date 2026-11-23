// Every end-to-end suite of the desktop app, one after the other (each in its own isolated profile,
// muted and invisible). `--online` adds the suites that need YouTube.
//   npm run test:e2e            offline suites
//   npm run test:e2e -- --online
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { root } from './harness.mjs';

const OFFLINE = ['smoke', 'formats', 'editor', 'lang', 'safe'];
const ONLINE = ['radio', 'youtube'];
const suites = [...OFFLINE, ...(process.argv.includes('--online') ? ONLINE : [])];

const results = [];
for (const s of suites) {
  console.log(`\n━━ ${s} ━━`);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [join(root, 'tests/e2e', `${s}.mjs`)], { stdio: 'inherit', env: process.env });
  results.push({ s, ok: r.status === 0, secs: ((Date.now() - t0) / 1000).toFixed(0) });
}
console.log('\n━━ summary ━━');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.s} (${r.secs} s)`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} suites passed`);
process.exit(failed ? 1 : 0);
