#!/bin/bash
# studiowire.sh <studio harness output dir> <run name>  — replay every Studio script (VuGen + DevWeb) through the test proxy
D="$(cd "$(dirname "$0")/.." && pwd)"
ROOT_DIR="$(cd "$D/../.." && pwd)"
SRC="$1"; NAME="$2"
for fxd in "$SRC"/*.har "$SRC"/*.json; do
  [ -d "$fxd" ] || continue
  fx=$(basename "$fxd"); har="$D/studio/fixtures/$fx"; [ -f "$har" ] || har="$D/recorder/realfix/$fx"; [ -f "$har" ] || har="$ROOT_DIR/collection-examples/$fx"
  case "$fx" in big-3000*|large*) continue;; esac
  for mode in pattern diff; do
    z=$(ls -d "$fxd/$mode-webhttp/zip/"*.zip 2>/dev/null | head -1)
    [ -n "$z" ] && node "$D/engines/runvugen.js" "$z" "$D/engines/st/$NAME/vugen-$mode/$fx" --har="$har" | sed "s/^.*\"exit\"/vugen $mode $fx: exit/"
    z=$(ls -d "$fxd/$mode-devweb/zip/"*.zip 2>/dev/null | head -1)
    [ -n "$z" ] && node "$D/engines/rundevweb.js" "$z" "$D/engines/st/$NAME/devweb-$mode/$fx" --har="$har" | sed "s/^.*\"exit\"/devweb $mode $fx: exit/"
  done
done
