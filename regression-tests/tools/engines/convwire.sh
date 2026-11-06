#!/bin/bash
# convwire.sh <converter harness output dir> <run name>  — replay converter scripts (VuGen + DevWeb) through the test proxy
D="$(cd "$(dirname "$0")/.." && pwd)"
ROOT_DIR="$(cd "$D/../.." && pwd)"
SRC="$1"; NAME="$2"
for d in "$SRC"/pm-*-single "$SRC"/jmx-*-single-nowlm "$SRC"/pm-opt-*; do
  [ -d "$d/zip" ] || continue
  r=$(basename "$d")
  if [ -f "$d/zip/main.js" ]; then node "$D/engines/rundevweb.js" "$d/zip" "$D/engines/cv/$NAME/$r" | sed "s/^.*\"exit\"/devweb $r: exit/"
  elif ls "$d/zip/"*.usr >/dev/null 2>&1; then node "$D/engines/runvugen.js" "$d/zip" "$D/engines/cv/$NAME/$r" | sed "s/^.*\"exit\"/vugen $r: exit/"; fi
done
