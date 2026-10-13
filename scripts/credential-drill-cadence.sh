#!/usr/bin/env bash
# credential-drill-cadence — תרגיל-ריבונות-מפתחות כל-שעתיים + קבלה-ציבורית.
# מוכיח בכל-מחזור: כספת → wrap → P → keys.env.enc + rails.env.enc → digest-vs-disk.
# כישלון מתפרסם בכנות. אפס-סודות בקבלה. עצירה: touch /tmp/saos-credential-drill.stop
set -u
MOTHER="/home/z/my-project"
LOCK="/tmp/saos-credential-drill.lock"
STOP="/tmp/saos-credential-drill.stop"
INTERVAL=7200   # 2h — גילוי-מוות-סנדבוקס תוך-דקות-ספורות, לחץ-זניח על GitHub
LOG="$MOTHER/credential-drill.log"

log() { echo "[credential-cadence $(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> "$LOG"; }

if [ -f "$LOCK" ]; then
  OLD=$(cat "$LOCK" 2>/dev/null || echo 0)
  if kill -0 "$OLD" 2>/dev/null; then echo "copy-alive (pid $OLD) — exiting"; exit 0; fi
  log "stale lock (pid $OLD dead) — taking over"
fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT

while true; do
  if [ -f "$STOP" ]; then log "stop-file present — exiting"; rm -f "$LOCK"; exit 0; fi
  log "drill starting"
  if bash "$MOTHER/scripts/credential-drill.sh" >> "$LOG" 2>&1; then
    log "drill done verdict=PASS"
  else
    log "drill done verdict=FAIL — receipt published honestly"
  fi
  sleep "$INTERVAL"
done
