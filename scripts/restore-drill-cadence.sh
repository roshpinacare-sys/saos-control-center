#!/usr/bin/env bash
# restore-drill-cadence (EXEC-CD-44) — תרגיל-שחזור-יומי + קבלה-ציבורית ב-TruthRail.
# הענקים לא מסתפקים בגיבוי — הם חוזרים-על-שחזור. כל-24ש': הרצת INSTRUMENT #19
# (restore-drill.ts) ופרסום-קבלה-כנה (PASS או FAIL) ל-receipts/restore-drill-latest.json.
# אפס-סודות בקבלה. עצירה: touch /tmp/saos-restore-drill.stop
set -u
MOTHER="/home/z/my-project"
PAT_FILE="$MOTHER/upload/pat.env"
REPO="roshpinacare-sys/TruthRail"
RECEIPT_PATH="receipts/restore-drill-latest.json"
LOCK="/tmp/saos-restore-drill.lock"
STOP="/tmp/saos-restore-drill.stop"
INTERVAL=86400
DEX="$MOTHER/saos-dex"
LOG="$MOTHER/restore-drill.log"

log() { echo "[restore-drill $(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> "$LOG"; }

if [ -f "$LOCK" ]; then
  OLD=$(cat "$LOCK" 2>/dev/null || echo 0)
  if kill -0 "$OLD" 2>/dev/null; then echo "copy-alive (pid $OLD) — exiting"; exit 0; fi
  log "stale lock (pid $OLD dead) — taking over"
fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT

run_once() {
  log "drill starting"
  local EXIT=1 VERDICT="FAIL" RTO="" HEIGHT="" AGE="" TAIL=""
  cd "$DEX" || { log "cd failed"; return 1; }
  bun scripts/restore-drill.ts --quiet >> "$LOG" 2>&1
  EXIT=$?
  if [ "$EXIT" = "0" ]; then VERDICT="PASS"; else VERDICT="FAIL"; fi
  if [ -s "$DEX/audit-package/proof-pack/restore-drill.json" ]; then
    IFS='|' read -r RTO HEIGHT AGE TAIL <<< "$(python3 -c "
import json
d={}
try:
    d=json.load(open('$DEX/audit-package/proof-pack/restore-drill.json'))
except Exception:
    d={}
def g(*path):
    try:
        v=d
        for k in path: v=v[k]
        return '' if v is None else str(v)
    except Exception:
        return ''
print(g('rtoMs'), g('snapshot','height'), g('snapshot','ageSec'), g('engine','tailOpsAtRisk'), sep='|')
" 2>/dev/null)"
  fi
  log "drill done verdict=$VERDICT exit=$EXIT rto=${RTO}ms height=$HEIGHT age=${AGE}s tail=$TAIL"

  # קבלה-ציבורית (אפס-סודות) — כנות-מלאה גם-בכישלון
  if [ -s "$PAT_FILE" ]; then
    TOKEN="$(tr -d '\r\n' < "$PAT_FILE")"
    WRK=$(mktemp -d)
    git clone -q --depth 1 "https://x-access-token:${TOKEN}@github.com/${REPO}.git" "$WRK/r" 2>/dev/null
    if [ ! -d "$WRK/r/.git" ]; then log "receipt: clone failed — skip cycle"; rm -rf "$WRK"; TOKEN=''; return 0; fi
    mkdir -p "$WRK/r/receipts"
    TMP=$(mktemp)
    cat > "$TMP" <<EOF
{
  "source": "sandbox-dex",
  "instrument": "restore-drill.ts (#19)",
  "ranAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "verdict": "$VERDICT",
  "exitCode": $EXIT,
  "rtoMs": ${RTO:-null},
  "snapshotHeight": ${HEIGHT:-null},
  "snapshotAgeSec": ${AGE:-null},
  "tailOpsAtRisk": ${TAIL:-null},
  "note": "daily restore rehearsal — proves the sandbox engine can be rebuilt from git+db alone; verdict FAIL is published honestly"
}
EOF
    cp "$TMP" "$WRK/r/$RECEIPT_PATH"
    git -C "$WRK/r" add "$RECEIPT_PATH"
    if git -C "$WRK/r" diff --cached --quiet; then
      log "receipt: no change"
    else
      git -C "$WRK/r" -c user.name="roshpinacare-sys" -c user.email="326012154+roshpinacare-sys@users.noreply.github.com" \
        commit -q -m "restore-drill: verdict=$VERDICT rto=${RTO}ms at $(date -u +%Y-%m-%dT%H:%M:%SZ) [skip ci]"
      if git -C "$WRK/r" push -q origin HEAD 2>/dev/null; then
        log "RECEIPT LANDED: verdict=$VERDICT"
      else
        log "receipt: push failed — skip cycle (honest: nothing published)"
      fi
    fi
    rm -rf "$WRK" "$TMP"
    TOKEN=''
  else
    log "receipt: no PAT — skip"
  fi
}

while true; do
  [ -f "$STOP" ] && { log "stop-file — exiting"; exit 0; }
  run_once
  sleep "$INTERVAL"
done
