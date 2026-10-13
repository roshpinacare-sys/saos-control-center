#!/usr/bin/env bash
# ═══ mini-services/start.sh — הבוטסטראפ-הריבוני (T-40 · רשומת-המשכיות) ══════════════
# הדוקטרינה (2026-10-06, מאומתת-T-40): הסנדבוקס נמחק כמה-פעמים-ביום — אסור
# להסתמך עליו. הגיט = מקור-האמת. עד-עכשיו-ההקמה-מחדש הייתה-ידנית-בכל-סשן.
# סקריפט-זה = ההקמה-הקנונית: אינסטנס-חדש שקיבל clone + PAT-מהמפעיל רץ `bash
# mini-services/start.sh --fresh` וחוזר-לחיים במלואו. אידמפוטנטי: בריצה-חוזרת
# על-עץ-חי — "alive — skip" לכל-רכיב + שער-בריאות בסוף.
#
# סדר-ההקמה קבוע-ולא-במקרה:
#   1. קוקפיט-האם → 3000 (קודם! כדי-שה-preview-bridge של ה-dex לא-יתפוס-את-הפורט)
#   2. dex-דרך-dex-daemon (heal.ts → port-guard → next-dev ב-3010, המסילה-הקנונית)
#   3. חמשת-השירותים (לכל-אחד נעילת-מופע-יחיד משלו — F1)
#   4. הקדנס-המאוחד (liquidity-cadence: 5דק'/2ש'/6ש')
#   5. שער-בריאות: HTTP + חיים-לפי-cwd (השיטה-שהוכחה ב-T-39 מול-הכפילויות)
#
# אפס-סודות: ה-PAT לא-נקרא כאן — הדחיפות מתבצעות על-ידי השירותים
# (dex-state-push) וסקריפט-הדחיפה הקנוני (scripts/sovereign-push.sh).
#
# שימוש:  bash mini-services/start.sh          (הקמה-חוזרת על-עץ-קיים)
#         bash mini-services/start.sh --fresh  (אינסטנס-חדש: התקנות + db + הקמה)
set -u
ROOT="/home/z/my-project"
LOG="/tmp/saos-bootstrap.log"
FRESH=0
[ "${1:-}" = "--fresh" ] && FRESH=1

log() { echo "[start.sh $(date -u +%FT%TZ)] $*"; }
: > "$LOG"

# ── חיים-לפי-cwd: כל-זוג runner/child של אותו-שירות יושב-באותו-עץ ────────────
alive_cwd() {
  local dir="$1" p
  for p in $(pgrep -x bun 2>/dev/null; pgrep -f 'liquidity-cadence.sh' 2>/dev/null); do
    [ "$(readlink "/proc/$p/cwd" 2>/dev/null)" = "$dir" ] && return 0
  done
  return 1
}

port_up() { # port_up <url> <want> — HTTP עם-סבלנות-קצרה
  local url="$1" want="$2" i c
  for i in 1 2 3 4 5 6; do
    c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 "$url" 2>/dev/null)"
    [ "$c" = "$want" ] && return 0
    sleep 3
  done
  return 1
}

start_dir() { # start_dir <label> <dir> <cmd> — הקשרה-כפולה-מנותקת
  local label="$1" dir="$2" cmd="$3"
  if alive_cwd "$dir"; then log "$label: alive — skip"; return 0; fi
  ( cd "$dir" && nohup bash -c "$cmd" >> "$LOG" 2>&1 & ) 
  log "$label: launched"
  sleep 2
}

# ── 0) (fresh בלבד) התקנות + סכמות ──────────────────────────────────────────
if [ "$FRESH" = "1" ]; then
  log "fresh mode: bun install ×3 + prisma"
  bun install --cwd "$ROOT" >> "$LOG" 2>&1 || log "WARN: mother bun install"
  bun install --cwd "$ROOT/saos-dex" >> "$LOG" 2>&1 || log "WARN: dex bun install"
  ( cd "$ROOT" && bunx prisma generate >> "$LOG" 2>&1 && bun run db:push >> "$LOG" 2>&1 ) || log "WARN: mother prisma"
  ( cd "$ROOT/saos-dex" && bunx prisma generate >> "$LOG" 2>&1 && bun run db:push >> "$LOG" 2>&1 ) || log "WARN: dex prisma"
  for s in relay-service revenue-governor dex-state-push dex-watchdog saos-legion dex-daemon; do
    [ -f "$ROOT/mini-services/$s/package.json" ] && bun install --cwd "$ROOT/mini-services/$s" >> "$LOG" 2>&1 || true
  done
fi

# ── 1) קוקפיט-האם (3000) — קודם-הכול ────────────────────────────────────────
if curl -s -o /dev/null --max-time 3 http://localhost:3000/ 2>/dev/null; then
  log "cockpit: already serving :3000 — skip"
else
  start_dir "cockpit" "$ROOT" "bun run dev"
fi

# ── 2) dex דרך-המסילה-הקנונית dex-daemon (3010 · basePath /saos-dex) ────────
if curl -s -o /dev/null --max-time 3 http://127.0.0.1:3010/saos-dex/api/dex/state 2>/dev/null; then
  log "dex: already serving :3010 — skip"
else
  start_dir "dex-daemon" "$ROOT/mini-services/dex-daemon" "bun run dev"
fi

# ── 2.5) קונסולת-האם (3050 · חוזה-הדלת-הקדמית: / → 3050) ────────────────────
# FIX(T-47): הייתה-חסרה-מהאתחול — אחרי-מחיקת-סנדבוקס הדלת-הקדמית 502 (מדוד).
# המשגיח-הטהור-של-zip (בון-בלבד) מקים-ומחיה-את-הקונסולה-בלולאה — הוא-עצמו
# נליטל-כפול-מנותק (nohup+setsid) כדי-שייר מהסשן (דוקטרינת-השרידות).
if curl -s -o /dev/null --max-time 3 http://127.0.0.1:3050/ 2>/dev/null; then
  log "zip-console: already serving :3050 — skip"
else
  start_dir "zip-console" "$ROOT/zip" "bun mini-services/web/index.ts"
fi

# ── 3) חמשת-השירותים (נעילות-F1 פנימיות כשכבת-הגנה-שנייה) ──────────────────
start_dir "relay-service"    "$ROOT/mini-services/relay-service"    "bun run dev"
start_dir "revenue-governor" "$ROOT/mini-services/revenue-governor" "bun run dev"
start_dir "dex-state-push"   "$ROOT/mini-services/dex-state-push"   "bun run dev"
start_dir "dex-watchdog"     "$ROOT/mini-services/dex-watchdog"     "bun run dev"
start_dir "saos-legion"      "$ROOT/mini-services/saos-legion"      "bun run dev"
start_dir "grid-twin"        "$ROOT/mini-services/grid-twin"        "bun run dev"   # T-51: המפעיל-הפנימי-של-רשת-הגריד (µ-sim · 30-דק' · אפס-מפתחות)

# ── 4) הקדנס-המאוחד (עצירה: touch /tmp/saos-liquidity.stop) ─────────────────
start_dir "liquidity-cadence" "$ROOT" "bash scripts/liquidity-cadence.sh"

# ── 5) שער-בריאות ───────────────────────────────────────────────────────────
log "health gate:"
FAIL=0
check() { # check <label> <dir-or-'-'> <cmd...>
  local label="$1" dir="$2"; shift 2
  if [ "$dir" != "-" ] && ! alive_cwd "$dir"; then echo "  ✖ $label: DEAD"; FAIL=1; return; fi
  if [ "$dir" = "-" ]; then
    "$@" >/dev/null 2>&1 && echo "  ✔ $label" || { echo "  ✖ $label"; FAIL=1; }
  else
    echo "  ✔ $label"
  fi
}
curl -s -o /dev/null -w '' --max-time 6 http://localhost:3000/api/health && echo "  ✔ front-door :3000 (bridge·health-200)" || { echo "  ✖ front-door :3000"; FAIL=1; }
port_up "http://127.0.0.1:3050/" 200 && echo "  ✔ zip-console :3050" || { echo "  ✖ zip-console :3050"; FAIL=1; }
port_up "http://127.0.0.1:3010/saos-dex/api/dex/state" 200 && echo "  ✔ dex :3010 (basePath /saos-dex)" || { echo "  ✖ dex :3010"; FAIL=1; }
check "relay-service"    "$ROOT/mini-services/relay-service"
check "revenue-governor" "$ROOT/mini-services/revenue-governor"
check "dex-state-push"   "$ROOT/mini-services/dex-state-push"
check "dex-watchdog"     "$ROOT/mini-services/dex-watchdog"
check "saos-legion"      "$ROOT/mini-services/saos-legion"
check "liquidity-cadence" "$ROOT" pgrep -f 'liquidity-cadence.sh'

if [ "$FAIL" = "0" ]; then log "ALL ALIVE — הריבונות-חיה"; exit 0; else log "PARTIAL — ראה $LOG"; exit 1; fi
