#!/usr/bin/env bash
# End-to-end tests on the packaged Linux app, in WSL (after scripts/linux-dist.sh, same working copy).
#   wsl -d <distribution> -- bash "/mnt/c/…/Chud Tiles/scripts/linux-tests.sh"
# Windows stay invisible and muted, like on Windows (WSLg provides the display).
set -uo pipefail
WORK="${CT_LINUX_WORK:-$HOME/chud-tiles}"
cd "$WORK"
export DISPLAY="${DISPLAY:-:0}" WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}" XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/mnt/wslg/runtime-dir}" PULSE_SERVER="${PULSE_SERVER:-unix:/mnt/wslg/PulseServer}"
export CT_EXE="${CT_EXE:-$WORK/dist/linux-unpacked/chud-tiles}"
fail=0
for t in ${TESTS:-smoke formats lang safe}; do
  node "tests/e2e/$t.mjs" > "/tmp/ct-$t.log" 2>&1 || fail=1
  echo "$t: $(grep -E '^\[' "/tmp/ct-$t.log" | tail -1)"
  grep -E '^FAIL' "/tmp/ct-$t.log"
done
exit $fail
