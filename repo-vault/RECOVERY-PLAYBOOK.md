# מחברת-ההתאוששות (RECOVERY-PLAYBOOK) · T-55

> חברת-סנדבוקס-טרייה? clone-חדש? אחרי-איפוס? **המתכונים-האלה-הם-הדרך-היחידה.**
> כל-מתכון-נבדק-בפועל-ומתועד-בקבלות. אפס-בדיות. תמיד-סיים-ב"ודחוף".

---

## P1 · עלייה-מחדש-מclone-טרי (המסלול-המלא)

```bash
cd /home/z/my-project
bash sanbox/scripts/boot-all.sh          # מקים: מפקח → HQ → דקס → גשר → קונסולה
sleep 45
bun sanbox/scripts/fleet-census.mjs      # פקודת-אמת-אחת: הכל-בפנים (סעיף-P7)
```
**הוכחת-סיום**: census מציג מפקח-חי · פורטים-200 · 4-ריפו-עם-HEAD. אם-משהו-אדום — P5/P3-לפני-המשך.

## P2 · שחזור-סודות — שרשרת-הריבונות (T-64 · נמדד-בdrill)

**העיקרון**: כל-הסודות משתחזרים-מהגיט-בלבד. היחיד-שאינו-משתחזר-מגיט: הרשאת-ה-bootstrap
(PAT תקף-אחד — GitHub אינו-מחזיר-טוקנים; מהבעלים-או-מ-`~/.sovereign/remote.env`-אם-הסנדבוקס-עוד-חיה).

השרשרת-המלאה (כל-החוליות-בגיט):
1. clone `saos-control-center` + `sanbox` (PAT-ה-bootstrap)
2. `cd <clone>/saos-control-center && bun install --frozen-lockfile` (npm-ציבורי)
3. `bun scripts/repo-vault-open.ts` — הארנק-נפתח: seal.a ⊕ seal.b (בגיט) → AES → wallet.enc.json
4. `PASS="$(bun scripts/repo-vault-emit.ts --name hq-vault-pass)"` — סיסמת-כספת-הסודות,
   **בלועה-במעטפת-המוצפנת** (T-64) — זיכרון-בלבד, אף-כתיבה-לדיסק
5. `cd <clone>/sanbox && VAULT_SANDBOX_ROOT=<clone>/sanbox HQ_VAULT_PASS="$PASS" bun scripts/vault-restore.ts`
   → agent-api · headcorner-keys · hq.password · pat.env · web-keys — הכל-600
6. `web-keys.env` = Tavily×2 · Jina · Tavily-MCP; עותק-ריצה: `~/.sovereign/web-keys.env` (600);
   כלים: `scripts/web-search.mjs` · `scripts/web-read.mjs`
7. המשך-אל-P1 (boot-all.sh)

**הבדיקה-הקנונית**: `bash sanbox/scripts/sovereignty-drill.sh` → `PROVEN:true` = כל-השרשרת
חיה-ב-GitHub בפועל (clone-טרי-בפועל, לא-סימולציה). תרגיל-זה-הוא-ההוכחה-היחידה-הקבילה-של-ריבונות.
סיסמה-מקבילה-ל-roundtrip המקומי: `sanbox/scripts/vault-drill.sh` (5/5).

## P3 · אימוץ-אפס-אובדן (לפני-כל-דחיפה — חוק §4.2)

```bash
git fetch origin
git rev-list --left-right --count HEAD...origin/main   # לראות-מי-קדימה-ובכמה
git status --porcelain                                  # קבצי-ריצה-בלבד? אם-קבצי-קוד-התנגשו — עצור-וזכור-איחוד
git stash push -m "runtime-receipts" -- <קבצי-ריצה-בלבד>   # רק-אם-חוסם-ff
git merge --ff-only origin/main
git stash pop || git checkout HEAD -- <קובץ-ריצה-מתנגש>    # הלקח-מ-T-51: ריצה-נזרקת-בשלום, קוד-לעולם-לא
```
union-merge (`.gitattributes`) מגן-על `*.jsonl`/`worklog.md`/`MEMORY.md` — התנגשות-שם-מתאחדת-מעצמה.

## P4 · דחיפה-ריבונית (אפס-הדפסת-סוד)

```bash
cd <ריפו>
TOKEN="$(tr -d '\r\n ' < /home/z/my-project/upload/pat.env)"
git push "https://x-access-token:${TOKEN}@github.com/roshpinacare-sys/<ריפו>.git" HEAD
git ls-remote "https://x-access-token:${TOKEN}@github.com/roshpinacare-sys/<ריפו>.git" refs/heads/main | cut -f1
unset TOKEN    # מיידית!
```
**PROVEN** = `ls-remote == rev-parse HEAD`. כל-פלט-עובר-`sed 's/x-access-token:[^@]*/x-access-token:<REDACTED>/g'`.

## P5 · הפעלת-קוד-חדש-במפקח (חוק §4.5 — קובץ-על-הדיסק-אינו-תהליך-חי)

```bash
git -C /home/z/my-project/sanbox log --oneline -1        # ודא-שהתיקון-כבר-קומיט
bun build /home/z/my-project/sanbox/scripts/supervisor.ts --target=bun --outfile=/tmp/sup-smoke.js >/dev/null 2>&1 && echo BUILD-OK
bun -e "await import('/home/z/my-project/sanbox/scripts/supervisor.ts'); console.log('SMOKE-OK')"  # טוען-מודול-בלי-לולאה (import.meta.main=false)
kill "$(cat /home/z/my-project/sanbox/db/supervisor.pid)"
sleep 35                                                  # השומר-החיצוני-מקים-תוך-30-שנ'
tail -3 ~/.sovereign/guardian.jsonl                       # קבלת supervisor-revive
tail -5 /home/z/my-project/sanbox/receipts/supervisor.jsonl  # הוכחת-הקוד-החדש-בקבלות
```
**חובה**: אחרי-כל-P5 — גלול-את-הקבלות-וחפש `tick-error`. אין-tick-error-תוך-דקה = הקוד-החדש-נושם.
(הלקח-מ-T-55: מוקש-בדיסק-יכול-להיות-מוסתר-ע"י-תהליך-חי-ישן-ותקין; ההפעלה-מחדש-חושפת-והיא-הבדיקה-האמיתית.
ראיה-לקוד-חדש: סכימת-קבלה-חדשה (למשל mem-gate-recycle-עם-availKB) או אירוע-חדש (mem-gate-hold).)
לתיקון-שער-הזיכרון-T-55: הראיה-היא-`mem-gate-hold`-חדש-במקום-מיחזור-כשאין-לחץ.
(טיפ: `supervisor-start`-חדש-בקבלות = הקוד-החי-התחלף; אחרת-חזור-על-P5.)

## P6 · תגובת-זיכרון (כשהמכונה-נחנקת)

1. `free -m` + `ps aux --sort=-rss | head` — מי-הענק?
2. עץ-3050-גדול-ומכונה-רגועה → **אל-תהרוג** — השער-עצמו-כותב-`mem-gate-hold`. זה-התקין.
3. מכונה-דחוקה (MemAvailable<350MB) → השער-ממחזר-לבד-תוך-קולדאון; אל-תתערב ידנית אלא-אם-המפקח-מת.
4. המפקח-מת-בזמן-לחץ → P5. הקרנל-הרג (dmesg-מלא-OOM-kill) → עלה-`MEM_PRESSURE_AVAIL_MB`-בזהירות-או-הקטן-טורבופק.

## P7 · פקודת-האמת-האחת

```bash
bun /home/z/my-project/sanbox/scripts/fleet-census.mjs
```
מדפיס-JSON-אחת: מכונה (uptime/mem) · תהליכי-צי · פורטים-3000/3010/3011/3050 ·
4-ריפו (HEAD+לכלוך+ענף) · קבלות-אחרונות · כספות (קיום+הרשאות-בלבד — אפס-תוכן).
**העיקרון**: טענה-בלי-census/ls-remote/קבלה = בדיה. אסור.

## P8 · מה-לא-עובר-ומה-עובר-למפעיל

כל-דבר-הדורש-זהות-אנושית/החלטת-כספים (powerdown · המרת-SBD · WIF-חי · OAuth/KYC) →
`repo-vault/escalations.json`-עם-מספרים-מדודים, ודחיפה. המפעיל-רואה-בקונסולה.

## P9 · רענון-הקונסולה-בפרודקשן (T-56 · שינוי-UI-באפליקציה-האם)

הקונסולה-האם (:3050) רצה-**standalone-פרודקשן** מ-`/home/z/console-prod` (מחוץ-לריפו —
בנייה-במקום-הייתה-מתנגשת-ב-.next-של-3000). שינוי-קוד-ב-`src/`-מחייב-בנייה-מחדש:

```bash
rm -f /home/z/console-prod/.next/BUILD_ID            # סימון-צורך-בבנייה
pkill -f "console-prod/.next/standalone/server.js"   # השומר-יבנה-ויקים-לבד-תוך-~2-דק'
sleep 150 && curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3050/   # מצופה-200
```
השומר (zip watcher) עושה-הכל-אוטומטית: sync-ה-whitelist-של-האפליקציה → `bun run build`
→ `standalone/server.js`. אל-תבנה-ידנית-בתוך-`/home/z/my-project` בזמן-ש-3000-חי!
**מדוד**: prod-RSS-~158MB-נגד-~1500MB-dev; `GET /`-5ms-נגד-30-100ms.

## P10 · רענון-הדקס-בפרודקשן (T-56 · שינוי-קוד-ב-saos-dex)

הדקס (:3010, basePath /saos-dex) רץ-**standalone-פרודקשן** מ-`/home/z/dex-prod` (מחוץ-לריפו,
עץ-קישורים-קשיחים). **המשגר-הקנוני-היחיד**: `mini-services/dex-daemon/launch-prod.sh`
(heal → port-guard → self-heal-בנייה-אם-חסר → standalone). שלוש-שכבות-ההחייאה-כולן
מנותבות-אליו: dex-watchdog · supervisor-dex-revive · mini-services/start.sh.

שינוי-קוד-ב-`saos-dex/src/` מחייב-בנייה-מחדש:

```bash
rm -rf /home/z/dex-prod/.next                          # בנייה-טרייה
cd /home/z/dex-prod && DATABASE_URL=file:/home/z/my-project/saos-dex/db/dex.db bun run build
# המשגר-הקנוני-מקים-מחדש (kill-ידני-רק-אם-צריך):
pkill -f "dex-prod/.next/standalone/server.js"; sleep 2
cd /home/z/my-project/mini-services/dex-daemon && nohup bun run dev >> /home/z/my-project/dex-dev.log 2>&1 &
sleep 8 && curl -s http://127.0.0.1:3010/saos-dex/api/dex/state | head -c 120   # מצופה ok:true
```

**חוקי-זהב-שנמדדו-בדם (T-56)**:
1. `server.js`-של-standalone-עושה-`chdir(__dirname)` → `DATA_DIR=cwd/db` הוא
   `.next/standalone/db` — המשגר-יוצר-סימלינק-ל-`repo/db` **בשני-המקומות**. בלי-זה-הסנאפשוט
   "נעדר" → הבוט-בוחר-ג'נזיס-במקום-הידרציה (נמדד-חי).
2. `ln -sfn`-על-תיקייה-ריאלית-קיימת-יוצר-סימלינק-**בתוכה**-בשקט — אם-יש-תיקיית-db-ריאלית
   (מריצה-קודמת-בלי-סימלינק): `mv`-צידה-קודם, אחר-כך-סימלינק.
3. השרשרת-מזדהה-מול-ה-DB: סנאפשוט-שאינו-תואם-את-stateRoot-ב-db → HALT-fail-closed.
   אין-להחליף-סנאפשוט-מתחת-לשרשרת-חיה — רק-בזמן-שהיא-לא-רצה, ורק-עם-סנאפשוט-התואם-את-ה-db.
4. **לעולם-אל-תשגר-דקס-ישר-מהריפו** (`bun run dev`-ב-saos-dex) — זה-עוקף-את-port-guard
   ויוצר-כותב-כפול-על-dex.db. תמיד-דרך-dex-daemon.
5. dex.db-היה-נגוע-בסכמת-האם (תאונה-היסטורית 13:46-ה-9.10) — הסכמה-תוקנה-ב-`prisma db push`
   (scripts/ יצאו-מה-typecheck ב-tsconfig — בנייה-תקינה). תקופה-2-של-השרשרת-החלה-בג'נזיס-כנה;
   תקופה-1 (h185919) נשמרת-כראיה-בגיט-לנצח.

**מדוד**: prod-RSS-**229MB**-נגד-**1094MB**-dev (-79%) · שרשרת-מייצרת-בלוקים ·
resume-מאומת-מול-stateRoot · סנאפשוט-נמשך-ל-repo/db-דרך-הסימלינק (קדנס-גיט-חוגג-אותו).
