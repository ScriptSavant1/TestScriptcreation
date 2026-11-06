#!/bin/bash
# dwwire.sh <harness output dir> <run name>  — replay every Recorder DevWeb script with DevWeb through the test proxy
D="$(cd "$(dirname "$0")/.." && pwd)"
ROOT_DIR="$(cd "$D/../.." && pwd)"
SRC="$1"; NAME="$2"
for z in "$SRC"/*/devweb/zip/DevWebScript.zip; do
  [ -d "$z" ] || continue
  fx=$(basename "$(dirname "$(dirname "$(dirname "$z")")")")
  har="$D/recorder/fixtures/$fx"; [ -f "$har" ] || har="$ROOT_DIR/collection-examples/$fx"
  [ "$fx" = "large-20000.har" ] && continue
  node "$D/engines/rundevweb.js" "$z" "$D/engines/dw/$NAME/$fx" --har="$har" | sed "s/^.*\"exit\"/$fx: exit/"
done
