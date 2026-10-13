#!/usr/bin/env bash
# verify-witness-chain (EXEC-CD-44) — אימות-עצמאי של שרשרת-העדות ב-TruthRail.
# כל-עדות מקומטת prevHash=sha256(קובץ-העדות-הקודם). הכלי הולך על היסטוריית-הגיט
# ומאמת כל-חוליה — מחיקה/עריכה-אחורה של עדות-כלשהי שוברת-את-השרשרת-כאן.
# ריצה: bash scripts/verify-witness-chain.sh   (יציאה: 0=שרשרת-שלמה · 1=שבורה)
set -u
MOTHER="/home/z/my-project"
PAT_FILE="$MOTHER/upload/pat.env"
REPO="roshpinacare-sys/TruthRail"
WITNESS_PATH="receipts/sandbox-dex-witness.json"
if [ ! -s "$PAT_FILE" ]; then echo "no PAT — cannot verify"; exit 1; fi
TOKEN="$(tr -d '\r\n' < "$PAT_FILE")"
WRK=$(mktemp -d)
git clone -q "https://x-access-token:${TOKEN}@github.com/${REPO}.git" "$WRK/r" 2>/dev/null
if [ ! -d "$WRK/r/.git" ]; then echo "clone failed"; rm -rf "$WRK"; exit 1; fi
REVS=$(git -C "$WRK/r" rev-list --reverse HEAD -- "$WITNESS_PATH")
PREV_BLOB=""
OK=0; BAD=0; LINKS=0
for R in $REVS; do
  BLOB=$(git -C "$WRK/r" cat-file blob "$R:$WITNESS_PATH" 2>/dev/null) || BLOB=""
  PH=$(printf '%s' "$BLOB" | python3 -c "
import json,sys
try: print(json.load(sys.stdin).get('prevHash') or '')
except Exception: print('')
" 2>/dev/null)
  if [ -n "$PREV_BLOB" ] && [ -n "$PH" ]; then
    LINKS=$((LINKS+1))
    CUR=$(git -C "$WRK/r" cat-file blob "${PREV_REV}:${WITNESS_PATH}" | sha256sum | cut -d' ' -f1)
    if [ "$CUR" = "$PH" ]; then OK=$((OK+1)); else BAD=$((BAD+1)); echo "BROKEN LINK before $(git -C "$WRK/r" log -1 --format='%h %ci' "$R")"; fi
  fi
  PREV_BLOB="$BLOB"; PREV_REV="$R"
done
LAST=$(printf '%s' "$PREV_BLOB" | python3 -c "
import json,sys
try:
  d=json.load(sys.stdin); print('seq=%s height=%s witnessedAt=%s' % (d.get('seq'), d.get('height'), d.get('witnessedAt')))
except Exception: print('unparseable')
" 2>/dev/null)
N=$(echo $REVS | wc -w)
echo "witness-chain: commits=$N links_checked=$LINKS links_ok=$OK links_broken=$BAD"
echo "latest: $LAST"
rm -rf "$WRK"
if [ "$BAD" = "0" ]; then echo "CHAIN-INTACT"; exit 0; else echo "CHAIN-BROKEN"; exit 1; fi
