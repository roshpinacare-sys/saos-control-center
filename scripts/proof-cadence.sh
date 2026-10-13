#!/usr/bin/env bash
# ═══ קדנס-ההוכחה החיצוני (EXEC-CD-39-b) ══════════════════════════════════════
# הרקע-הכן: אם-האם (3000) עלתה בסביבה-שבה בינארי-ה-bun חסר באופן-חולף,
# אתחול-ה-instrumentation שלה מת-טרם-השלמתו → לופ-רץ-ההוכחה-ה-4h-בתהליך-לא-נחשף.
# הגשר-הריבוני: לופ-חיצוני-מנותק (setsid) שמריץ את אותו-רץ-הוכחה קנוני כל-4-שעות —
# בלי-לגעת-באם. בהפעלה-מחדש-של-האם הלופ-הפנימי-חוזר; עד-אז זהו-המנגנון-הריבוני.
#
# אנטי-כפילות: /tmp/saos-proof-cadence.lock (pid) — עותק-שני יוצא-מיד.
# כיבוי-כנה: SAOS_PROOF_RUNNER=off (אותו-מתג-כמו-הלופ-הפנימי).
# שימוש: bash -c 'setsid nohup bash /home/z/my-project/scripts/proof-cadence.sh >> /dev/null 2>&1 &'
set -u
LOCK="/tmp/saos-proof-cadence.lock"
LOG="/home/z/my-project/proof-cadence.log"
DEX="/home/z/my-project/saos-dex"

if [ -s "$LOCK" ]; then
  OLD_PID="$(cat "$LOCK" 2>/dev/null | tr -dc '0-9')"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[proof-cadence] copy-alive-exiting (pid ${OLD_PID}) $(date -u +%FT%TZ)" >> "$LOG"
    exit 0
  fi
  echo "[proof-cadence] stale-lock-reaped (was ${OLD_PID:-?}) $(date -u +%FT%TZ)" >> "$LOG"
fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT

if [ "${SAOS_PROOF_RUNNER:-on}" = "off" ]; then
  echo "[proof-cadence] kill-switch SAOS_PROOF_RUNNER=off — לא-חמוש $(date -u +%FT%TZ)" >> "$LOG"
  exit 0
fi

echo "[proof-cadence] חומש-מבחוץ (pid $$) — ריצה כל 14400ש׳; הריצה-הראשונה אחרי-המחזור-הראשון $(date -u +%FT%TZ)" >> "$LOG"
while true; do
  sleep 14400
  echo "[proof-cadence] run @ $(date -u +%FT%TZ)" >> "$LOG"
  ( cd "$DEX" && bun harness/proof-runner.ts --once ) >> "$LOG" 2>&1
done
