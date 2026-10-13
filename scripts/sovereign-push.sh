#!/usr/bin/env bash
# ═══ דחיפה-ריבונית (EXEC-CD-25) ══════════════════════════════════════════════
# החוק (AUTONOMY-DOCTRINE §2.3): כל-טביעה/שחזור/עבודה נגמרת-ב-push.
# סקריפט-זה = היכולת-הקנונית-של-האוטונומיה-לדחוף בלי-להדפיס-אף-סוד:
#   · קורא את ה-PAT הגולמי מ-upload/pat.env (gitignored — לא-בגיט, לא-בלוג).
#   · דוחף ל-origin עם הטוקן-בURL-הזמני — הפלט-מסונן מכל-חשיפה.
#   · אם-הטוקן-חסר (מת-עם-הסנדבוקס) → יוצא-3 = האצה-למפעיל (escalations.json: pat-rotation).
#
# שימוש:  bash scripts/sovereign-push.sh [branch]     (ברירת-מחדל: main)
set -euo pipefail
cd "$(dirname "$0")/.."

PAT_FILE="upload/pat.env"
REPO="roshpinacare-sys/saos-control-center"
BRANCH="${1:-main}"

if [ ! -s "$PAT_FILE" ]; then
  echo "✖ upload/pat.env חסר/ריק — הטוקן-מת-עם-הסנדבוקס."
  echo "  → האצה: רשום-ב-repo-vault/escalations.json (פריט pat-rotation) ובקש-מהמפעיל PAT-חדש."
  echo "  → המפעיל: הנח PAT גולמי-בupload/pat.env (שורה-אחת, בלי-שם-משתנה)."
  exit 3
fi

TOKEN="$(tr -d '\r\n ' < "$PAT_FILE")"
if [ "${#TOKEN}" -lt 20 ]; then
  echo "✖ upload/pat.env אינו-טוקן-תקין (אורך ${#TOKEN}). האצה-למפעיל."
  exit 3
fi

REMOTE="https://x-access-token:${TOKEN}@github.com/${REPO}.git"
# הפלט-עובר-סינון-קבוע — אם-גיט-מדפיס-את-הURL (למשל-בשגיאה), הטוקן-לא-יזלג-ללוג.
git push "$REMOTE" "$BRANCH" 2>&1 | sed -E "s|x-access-token:[^@]*|x-access-token:<REDACTED>|g"
