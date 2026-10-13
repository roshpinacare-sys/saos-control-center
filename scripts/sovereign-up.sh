#!/usr/bin/env bash
# sovereign-up.sh — תחייה-ריבונית-אחת-פקודה (AGENTS.md §1 · EXEC-CD-20)
# ═══════════════════════════════════════════════════════════════════════════
# דוקטרינה: הסנדבוקס אפס-אמון — הכל קם מהגיט בלבד. אידמפוטנטי: אפשר להריץ
# בכל-עת; מה שכבר-חי — לא נוגעים (בדיקת-פורט/HTTP לפני כל-שיגור).
# שימוש:  bash scripts/sovereign-up.sh
set -u
cd "$(dirname "$0")/.."
ROOT="$PWD"

say() { printf '[sovereign-up %s] %s\n' "$(date +%H:%M:%S)" "$*"; }

up() { # up <name> <url> <start-cmd>
  local name="$1" url="$2"; shift 2
  if curl -sf -o /dev/null --max-time 4 "$url"; then
    say "$name: חי כבר — מדלגים"
  else
    say "$name: לא מגיב — משגרים"
    eval "$@"
  fi
}

# 1. האם (:3000) — instrumentation שלה משגר את המנוע כילד (קנון)
up "mother:3000" "http://127.0.0.1:3000/api/health" \
  "setsid nohup bun run dev >/dev/null 2>&1 & disown; sleep 8"

# 2. מנוע-הדקס (:3010) — דרך המשגר-הקנוני (heal.ts משחזר מהגיט אם צריך)
up "engine:3010" "http://127.0.0.1:3010/saos-dex/api/dex/state" \
  "cd $ROOT/mini-services/dex-daemon && setsid nohup bun run dev >> $ROOT/dex-dev.log 2>&1 & disown"

# 3. ריליי (:3003) — אפיק-האירועים
up "relay:3003" "http://127.0.0.1:3003" \
  "cd $ROOT/mini-services/relay-service && setsid nohup bun run dev >> $ROOT/relay-dev.log 2>&1 & disown"

# 4. המושל-הכלכלי (:3042)
up "governor:3042" "http://127.0.0.1:3042/status" \
  "cd $ROOT/mini-services/revenue-governor && setsid nohup bun run dev >> $ROOT/governor-dev.log 2>&1 & disown"

# 5. השומר (watchdog) — לוק-פייל מונע-עותקים (F1)
if ! pgrep -f "dex-watchdog" >/dev/null 2>&1; then
  say "watchdog: לא רץ — משגרים"
  (cd "$ROOT/mini-services/dex-watchdog" && setsid nohup bun run dev >> "$ROOT/watchdog-dev.log" 2>&1 & disown)
else
  say "watchdog: בתפקיד"
fi

# 6. דחיפת-מצב-לגיט (state-push, קדנס 20דק')
if ! pgrep -f "dex-state-push" >/dev/null 2>&1; then
  say "state-push: לא רץ — משגרים (דרוש upload/pat.env לדחיפה)"
  (cd "$ROOT/mini-services/dex-state-push" && setsid nohup bun run dev >> "$ROOT/statepush-dev.log" 2>&1 & disown)
else
  say "state-push: בתפקיד"
fi

# 7. זהויות-הפקדה — רק אם הדלת עיוורת (כתיבה-רק-לשדות-ריקים, אפס-דריסה)
if [ -x "$(command -v bun)" ] && [ -f "$ROOT/saos-dex/scripts/restore-sovereign-identities.ts" ]; then
  if curl -sf --max-time 8 "http://127.0.0.1:3010/saos-dex/api/dex/door" | grep -q '"tron":null'; then
    say "door: זהויות-ריקות — גוזרים ממפתח-ההסכם"
    (cd "$ROOT/saos-dex" && bun scripts/restore-sovereign-identities.ts | tail -2)
    say "door: הפעלה-מחדש של המנוע לטעינת-סביבה"
    pkill -f "[n]ext dev -p 3010" 2>/dev/null; sleep 2
    (cd "$ROOT/mini-services/dex-daemon" && setsid nohup bun run dev >> "$ROOT/dex-dev.log" 2>&1 & disown)
  else
    say "door: זהויות-חיות או מנוע-לא-זמין — לא נוגעים"
  fi
fi

say "הושלם — צי: :3000 אם · :3010 מנוע · :3003/:3004 ריליי · :3042 מושל · watchdog · state-push"
