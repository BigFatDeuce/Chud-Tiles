// One logo, everywhere. The logo kit lives in build/logo/ (drawn by hand: a full version, and
// simplified ones for small sizes; see build/logo/README.md). Nothing is redrawn or resized here:
// the kit's files are copied where each system looks for them. Run after changing the kit:
// npm run make:icons
//   build/icons/png/icon-N.png        window and Linux icons
//   build/icons/icon.ico              Windows exe, installer, taskbar
//   build/icons/icon.icns             macOS
//   src/renderer/public/              the browser version: favicon.svg, icon-192/512.png,
//                                     apple-touch-icon.png, icon-maskable-512.png
// The interface draws build/logo/svg/logo.svg and logo-small.svg (copies in src/renderer/src/assets).
import { copyFileSync, cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const kit = join(root, 'build', 'logo');
const out = join(root, 'build', 'icons');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(kit, 'png'), join(out, 'png'), { recursive: true });
copyFileSync(join(kit, 'icon.ico'), join(out, 'icon.ico'));
copyFileSync(join(kit, 'icon.icns'), join(out, 'icon.icns'));

const pub = join(root, 'src', 'renderer', 'public');
mkdirSync(pub, { recursive: true });
copyFileSync(join(kit, 'favicon.svg'), join(pub, 'favicon.svg'));
copyFileSync(join(kit, 'png', 'icon-192.png'), join(pub, 'icon-192.png'));
copyFileSync(join(kit, 'png', 'icon-512.png'), join(pub, 'icon-512.png'));
copyFileSync(join(kit, 'store', 'apple-touch-icon.png'), join(pub, 'apple-touch-icon.png'));
copyFileSync(join(kit, 'store', 'icon-maskable-512.png'), join(pub, 'icon-maskable-512.png'));

const assets = join(root, 'src', 'renderer', 'src', 'assets');
mkdirSync(assets, { recursive: true });
for (const f of ['logo.svg', 'logo-small.svg']) copyFileSync(join(kit, 'svg', f), join(assets, f));
console.log(`icons copied from build/logo: ${readdirSync(join(out, 'png')).length} PNG, icon.ico, icon.icns, favicon, interface logos`);
