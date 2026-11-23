// Before packaging: icons, FFmpeg and the third-party notices.
//   node scripts/prepare-dist.mjs <win|linux|mac>
// FFmpeg is Chud Music's LGPL build (audio only, with its licence and the address of its sources).
// It is COPIED from Chud Music's sources or, on Windows, from the installed Chud Music. Chud Music's
// files are only read, never changed. Where the sources are: CHUD_MUSIC_DIR, else the first line of
// `.chud-music-dir` at the root (a local file, not versioned), else a `Chud-Music` folder next to
// this project.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ?? (process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// ── icons ──────────────────────────────────────────────────────────────────────────────────────
if (!existsSync(join(root, 'build/icons/icon.ico')) || !existsSync(join(root, 'build/icons/png/icon-512.png'))) {
  execFileSync(process.execPath, [join(root, 'scripts/make-icons.mjs')], { stdio: 'inherit' });
}

// ── FFmpeg (copied, read only) ─────────────────────────────────────────────────────────────────
const VENDOR = { win: 'ffmpeg', linux: 'ffmpeg-linux', mac: 'ffmpeg-mac' }[target];
const EXE = target === 'win' ? 'ffmpeg.exe' : 'ffmpeg';
const dest = join(root, 'build/vendor', VENDOR);
if (!existsSync(join(dest, EXE))) {
  const local = join(root, '.chud-music-dir');
  const fromFile = existsSync(local) ? readFileSync(local, 'utf8').split(/\r?\n/)[0].trim() : '';
  const shares = [process.env.CHUD_MUSIC_DIR, fromFile, join(root, '..', 'Chud-Music')].filter(Boolean);
  const sources = [
    ...shares.map((d) => join(d, 'build/vendor', VENDOR)),
    ...(target === 'win' && process.env.LOCALAPPDATA ? [join(process.env.LOCALAPPDATA, 'Programs/Chud Music/resources/ffmpeg')] : []),
  ];
  const from = sources.find((d) => {
    try {
      return existsSync(join(d, EXE));
    } catch {
      return false;
    }
  });
  if (from) {
    mkdirSync(dest, { recursive: true });
    for (const f of readdirSync(from)) if (statSync(join(from, f)).isFile()) copyFileSync(join(from, f), join(dest, f));
    console.log(`FFmpeg copied from ${from}`);
  } else {
    console.warn(`\n⚠  FFmpeg not found for ${target}: the package will not include it (the rare formats WMA/ALAC/AIFF will need FFmpeg on the system). Set CHUD_MUSIC_DIR (or write the path in .chud-music-dir) to Chud Music's sources.\n`);
  }
}

// ── third-party notices ────────────────────────────────────────────────────────────────────────
// What ships: the production dependencies (main process) and what the bundler puts in the page.
const BUNDLED = ['react', 'react-dom', 'scheduler', 'three', 'zustand', 'use-sync-external-store', 'lucide-react', '@fontsource-variable/oxanium', '@fontsource-variable/space-grotesk'];
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const seen = new Map();
for (const [path, info] of Object.entries(lock.packages ?? {})) {
  if (!path.startsWith('node_modules/')) continue;
  const name = path.slice(path.lastIndexOf('node_modules/') + 13);
  if (info.dev && !BUNDLED.includes(name)) continue;
  if (!seen.has(name)) seen.set(name, { version: info.version, license: info.license });
}
const lines = [...seen].sort(([a], [b]) => a.localeCompare(b)).map(([n, i]) => {
  let license = i.license;
  if (!license) {
    try {
      license = JSON.parse(readFileSync(join(root, 'node_modules', n, 'package.json'), 'utf8')).license;
    } catch {
      /* unknown */
    }
  }
  return `- ${n} ${i.version} — ${license ?? 'see package'}`;
});
writeFileSync(
  join(root, 'build/THIRD-PARTY-NOTICES.txt'),
  [
    `Chud Tiles ${pkg.version} — composants tiers / third-party components`,
    '',
    'Chud Tiles contient les logiciels suivants, chacun sous sa propre licence.',
    'Chud Tiles contains the following software, each under its own licence.',
    'FFmpeg (LGPL) est livré à part avec sa licence et l’adresse de ses sources (dossier ffmpeg/).',
    'FFmpeg (LGPL) ships separately with its licence and the address of its sources (ffmpeg/ folder).',
    'Electron et Chromium : LICENSE.electron.txt et LICENSES.chromium.html, à côté de l’application.',
    'Polices Oxanium et Space Grotesk : SIL Open Font License 1.1.',
    '',
    ...lines,
    '',
  ].join('\n'),
);
console.log(`notices: ${lines.length} components`);
