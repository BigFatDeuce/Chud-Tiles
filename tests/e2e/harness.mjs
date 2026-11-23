// Shared helpers for the end-to-end tests (Playwright driving Electron). Set CT_EXE to test a
// packaged app (e.g. dist/win-unpacked/Chud Tiles.exe) instead of the development build.
import { _electron as electron } from 'playwright';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const audio = join(root, 'tests/fixtures/audio');
export const shots = join(root, 'tests/output');
mkdirSync(shots, { recursive: true });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const main = join(root, 'out/main/index.js');
const exe = process.env.CT_EXE;

export const tempDir = (prefix) => mkdtempSync(join(tmpdir(), prefix));
export function cleanup(...dirs) {
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch {
      /* temp dir, best effort */
    }
  }
}

export function createSuite(name) {
  const results = [];
  return {
    check(label, ok, detail = '') {
      results.push({ label, ok: !!ok });
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
    },
    finish() {
      const failed = results.filter((r) => !r.ok).length;
      console.log(`\n[${name}] ${results.length - failed}/${results.length} checks passed${exe ? ' (packaged app)' : ''}`);
      return failed;
    },
  };
}

// Tests run quietly: invisible, click-through, muted window that never takes the focus.
// CT_TEST_VISIBLE=1 shows a run.
const quiet = () => (process.env.CT_TEST_VISIBLE ? {} : { CT_TEST_QUIET: '1' });

export async function launch(profile, env = {}) {
  // the tests find buttons by their French labels: French unless a test asks for another language
  const e = { ...process.env, ...quiet(), CT_LANG: 'fr', CT_USER_DATA: profile, ...env };
  delete e.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch(exe ? { executablePath: exe, env: e } : { args: [main], env: e });
  const win = await app.firstWindow();
  await win.waitForFunction(() => !!window.__ct?.engine, null, { timeout: 30000 });
  // the hidden window does not advance animations: settle them before reading the page
  return { app, win };
}

/** Lets the page render (rAF may be throttled in an invisible window). */
export async function settle(win, seconds = 0.6) {
  await win.evaluate((s) => window.__ct.pump?.(s), seconds);
  await win.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
}

export async function shot(win, name) {
  await settle(win, 0.3);
  await win.screenshot({ path: join(shots, `${name}.png`) });
}
