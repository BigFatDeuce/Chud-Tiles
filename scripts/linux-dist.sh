#!/usr/bin/env bash
# Linux packages (AppImage, .tar.gz; .deb and .rpm when package.json has a homepage) from the Windows checkout, inside WSL (Fedora, a
# normal user: Electron refuses root). Run `node scripts/prepare-dist.mjs linux` on Windows first
# (icons, Linux FFmpeg), then, from Windows:
#   wsl -d <distribution> -- bash "/mnt/c/…/Chud Tiles/scripts/linux-dist.sh"
# Fedora needs: sudo dnf install nodejs npm rsync rpm-build libxcrypt-compat
# The packages are copied back into the checkout's dist/ folder.
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${CT_LINUX_WORK:-$HOME/chud-tiles}"
mkdir -p "$WORK"
rsync -a --delete --exclude node_modules --exclude dist --exclude out --exclude dist-web --exclude tests/output "$SRC/" "$WORK/"
cd "$WORK"
chmod 755 build/vendor/ffmpeg-linux/ffmpeg 2>/dev/null || echo "⚠  no Linux FFmpeg: run node scripts/prepare-dist.mjs linux on Windows first"
if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci --no-audit --no-fund
fi
rm -rf dist
npx electron-vite build
npx electron-builder --linux --publish never --config electron-builder.config.cjs
mkdir -p "$SRC/dist"
shopt -s nullglob
out=(dist/*.AppImage dist/*.deb dist/*.rpm dist/*.tar.gz dist/latest-linux.yml)
cp "${out[@]}" "$SRC/dist/"
ls -la "${out[@]}"
