#!/usr/bin/env bash
# ═══ launch-prod.sh — המשגר-הקנוני של הדקס בפרודקשן (T-56) ═══════════════════
# רקע-מדיד: next dev של-הדקס-גדל-ל-1094MB-RSS (pid-2028, מדוד) על-קופסת-4GB
# → ה-sentinel-ירד-ל-warn. המרת-פרודקשן-בדרך-שהוכחה-בקונסולה (/home/z/console-prod):
# RSS-158MB-נגד-~1500MB-dev (-90%).
#
# רצף-ההשקה (זהה-לשרשרת-הישנה-ובטוח-יותר):
#   1. heal.ts      — שחזור-ריפו-הדקס-מגיט (סנדבוקס-נמחק → אפס-אובדן-קוד)
#   2. port-guard   — 3010-חייב-להיות-פנוי (F-6: אסור-זליגה-ל-3011=כותב-זומבי-dex.db)
#   3. self-heal    — /home/z/dex-prod נמחק? → בנייה-מחדש-מלאה-מהריפו (אוטומטי)
#   4. standalone   — bun .next/standalone/server.js על-3010 (DATABASE_URL-קנוני)
#
# טלאי-הבנייה (מיושמים-גם-בעץ-המקור): output:"standalone" ב-next.config ·
# scripts/-מחוץ-ל-typecheck (ב-tsconfig-של-הריפו-עצמו) · העתקת-static-ל-standalone.
set -u
DAEMON_DIR="/home/z/my-project/mini-services/dex-daemon"
REPO="/home/z/my-project/saos-dex"
PROD="/home/z/dex-prod"
DB="file:/home/z/my-project/saos-dex/db/dex.db"

# T-66 · מנעול-מופע — ה-watchdog/boot-hook/ידני כולם-משגרים-אותנו; שני-משגרים-מתחרים
# רצו-בנייה-מקבילית-על-אותו-PROD (sed-כפול=TS1117 · בנייה-מושחתת). היציב-מנצח, המגיע-
# מאוחר יוצא-בכנות. prev===pid=פטור (hot-reload של-עצמו אינו-כפילות).
LOCK="/tmp/saos-dex-daemon.lock"
PREV="$(cat "$LOCK" 2>/dev/null || true)"
if [ -n "$PREV" ] && [ "$PREV" != "$$" ] && kill -0 "$PREV" 2>/dev/null; then
  echo "[launch-prod] instance-alive-exiting (pid $PREV כבר-חי — אפס-כפילויות)"
  exit 0
fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT

# ── 1) שחזור-הריפו-מגיט (הדוקטרינה: הגיט-מקור-האמת) ──────────────────────────
bun "$DAEMON_DIR/heal.ts" || exit 1

# ── 2) שער-הפורט-הקפדני (F-6 יליד-/proc) ─────────────────────────────────────
bun "$DAEMON_DIR/port-guard.ts" 3010 || exit 1

# ── 3) self-heal: dex-prod חסר-או-חבל? → בנייה-מחדש-מהריפו ────────────────────
if [ ! -f "$PROD/.next/standalone/server.js" ]; then
  echo "[launch-prod] dex-prod חסר — בונה מחדש מהריפו (self-heal)"
  if [ ! -d "$PROD" ]; then
    mkdir -p "$PROD"
    cp -al "$REPO/." "$PROD/" || exit 1
    rm -rf "$PROD/.next" "$PROD/db" "$PROD/dev.log" "$PROD/.git"
  fi
  # טלאי-next.config: output standalone — אידמפוטנטי+מרפא (T-66: מסיר-כל-output-
  # קיים-ומכניס-אחד-קנוני; רעל-TS1117-קיים-מריצות-ישנות-מנוקה-בכל-הרצה)
  grep -v '^[[:space:]]*output:' "$PROD/next.config.ts" \
    | sed 's/^const nextConfig: NextConfig = {/const nextConfig: NextConfig = {\n  output: "standalone",/' \
    > "$PROD/.cfg.tmp" && mv "$PROD/.cfg.tmp" "$PROD/next.config.ts"
  # טלאי-package.json: build-סקריפט-עם-העתקת-static (וסליחה-על-public-חסר)
  node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('$PROD/package.json','utf8'));p.scripts.build='next build && cp -r .next/static .next/standalone/.next/ && ([ -d public ] && cp -r public .next/standalone/ || true)';fs.writeFileSync('$PROD/package.json',JSON.stringify(p,null,2))"
  ( cd "$PROD" && DATABASE_URL="$DB" bun run build ) || { echo "[launch-prod] בנייה-נכשלה"; exit 1; }
fi

# ── 3.5) db/ חייב-להצביע-על-הריפו (מקור-אמת-אחד — ה-boot-כותב-והקדנס-קורא-מאותו-מקום).
# שני-סימלינקים: (א) cwd-ההשקה /home/z/dex-prod/db · (ב) standalone עושה-chdir(__dirname)
# → chain.ts קורא cwd/db מ-.next/standalone/ (נמדד-חי: בלי-זה-הסנאפשוט-"נעדר" והבוט-בוחר-ג'נזיס)
ln -sfn "$REPO/db" "$PROD/db" || exit 1
ln -sfn "$REPO/db" "$PROD/.next/standalone/db" || exit 1

# ── 4) השקת-ה-standalone על-3010 ──────────────────────────────────────────────
cd "$PROD"
echo "[launch-prod] משגר standalone על 3010 (BUILD_ID: $(cat .next/BUILD_ID 2>/dev/null || echo '?'))"
DATABASE_URL="$DB" PORT=3010 HOSTNAME=127.0.0.1 NODE_ENV=production \
  bun .next/standalone/server.js 2>&1 | tee /home/z/my-project/saos-dex/dev.log
