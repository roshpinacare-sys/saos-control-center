# SAOS-CI-OUTAGE-2026-10-06 — אבחון-אמת של האדום-הכלל-חשבוני

> עיקרון-ברזל: מה שחשוב — כתוב בריפו. מסמך זה הוא רשות-האבחון המלאה של כשלי
> ה-Actions החוזרים בכל הריפואים-הפרטיים, עם הוכחות משוחזרות-מקומית 1:1.
> הוכן על-ידי סוכן-הסנדבוקס (2026-10-06, באישור-מפעיל בצ'אט). אפס-ערכי-סודות במסמך.

---

## 1. התסמין

מ-2026-10-05 בערב (UTC) — כל ריצות ה-Actions בכל הריפואים-הפרטיים נכשלות,
ללא קשר ל-workflow, לריפו או לתוכן:

| ריפו | workflow | חיי-ה-job | שלבים | לוגים |
|---|---|---|---|---|
| saos-control-center | gitleaks / yaml-guard | 3s | 0 | 404 BlobNotFound |
| saos-dex | gitleaks / arb-scan | 3s | 0 | 404 BlobNotFound |
| steem | yaml-guard / beat / cognition-beat | 3s | 0 | 404 BlobNotFound |
| Zip | gitleaks / weave-anchor-lines | 3–39s | 0 | 404 BlobNotFound |
| Saosmartwallet | yaml-guard | 2s | 0 | 404 BlobNotFound |
| saos-sovereign-platform | foundry-tests / guard | 3s | 0 | 404 BlobNotFound |

## 2. שורש-האמת: דקות-Actions פרטיות אזלו

ציר-הזמן של ההצלחה-האחרונה לכל-workflow חוזר (API, עד 1000 ריצות-אחורה):

- saos-sovereign-platform :: foundry-tests — **10-05T12:33** ✓
- saos-dex :: dex-grid — 10-05T12:56 ✓ · dex-beat — 10-05T09:06 ✓
- Saosmartwallet :: wallet-verify — 10-05T14:58 ✓
- saos-control-center :: build — 10-05T12:53 ✓ · gitleaks/yaml-guard — 10-04T21:05 ✓
- saos-dex :: arb-scan — **10-05T22:01** ✓ · Zip :: weave-anchor-lines — **10-05T22:18** ✓ · steem :: cognition-beat — **10-05T22:29** ✓

מ-**10-05T22:30** ואילך: אפס-הצלחות בכל החשבון, כל-כישלון = הקמה-בלבד (0 שלבים).
הצי-המתוזמן (arb-scan כל-24-30דק׳, beats, weave-anchor-lines, cognition-beat)
שורף את מכסת-הדקות-החינמיות (~2,000/חודש) תוך יום-יומיים — מחזור שהתחדש
סביב 10-04 ואזל שוב בערב 10-05. **אין פגם-קוד ואין דליפת-סודות.**

## 3. הוכחה מקומית: הקוד ירוק, הסריקה תעבור כשהדקות יחזרו

שוחזר מקומית (gitleaks **v8.24.3** — הבינארי המקובע מה-workflows):

- **היסטוריה-מלאה (מצב-git, כמו ה-CI)**: steem (1186 קומיטים), Saosmartwallet (361),
  saos-sovereign-platform (336) → **0 ממצאים** בכולם — ה-`.gitleaksignore`
  הקנוני (טריאז'-ארגוני 2026-10-01, Task 13-d1/d2, org-run 36763896413,
  914 ממצאים שוחזרו 1:1) מכסה הכל בשתי-הצורות (git + HEAD-only).
- **עצי-HEAD (--no-git) לששת הריפואים**: כל הממצאים (19) = הערך-המילולי
  `REDACTED` (ההשחמה-העצמית של הרשת לפני-קומיט) — אפס-סודות אמיתיים.
- **שערי-טיפוסים חיים**: control-center `tsc --noEmit` = 0 ✓ ·
  saos-dex `typecheck` = 0 ✓ אחרי-התיקון הבא.

## 4. תיקון-אמת שנדחף בסשן זה

- **saos-dex @ 6f8dec7** — `fix(ci): exclude standalone harness/ from app typecheck`:
  ה-commit האוטונומי c8f6998 (grid-heartbeat-twin, `[skip ci]`) הוסיף את
  `harness/sovereign-gateway` — שירות-Bun עצמאי (פורט 3041, package.json משלו)
  שהשבית את `bun run typecheck` של האפ (2 שגיאות: `import.meta.dir`, `Bun`).
  הוצא מ-tsconfig של האפ לפי-מנהג-הרשת (אפס-ייבוא מ-harness/, אומת).
  אימות-אחרי: tsc=0 · eslint=0 · דחיפה fast-forward (לאחר rebase על 82b505f),
  מצב-השרשרת-החי (db/state-snapshot.json, db/tape.jsonl) נשמר ולא-נגע.

## 5. ההגירה-כבר-בעיצומה (סוכן הרשת עצמו)

`saos-sovereign-ci <ci@saos.local>` @ **dcc586a** (11:51 ואילך, בכל הריפואים):
ביטול טריגרי `schedule:`/`push:` בכל ה-workflows → `workflow_dispatch` בלבד,
ומעבר-הריצות ל**מנוע-CI ריבוני-מקומי על :3044** (אפס-דקות-Actions).
אומת ב-API: כל חמשת הריפואים-הנותרים — dispatch-only ✓.
(בסנדבוקס-זה :3044 עדיין אינו קם — תלוי-פריסה.)

## 6. החלטות-בעלים שנותרו (מחוץ-לסנדבוקס)

1. **חיוב/דקות**: לשקול הגדלת-מכסה מול השלמת-ההגירה ל-:3044 — לא-שניהם נדרשים.
2. **רוטציין-PAT (דחוף, מהטריאז' הקנוני 10-01)**: בהיסטוריית
   saos-sovereign-platform קיים `github-fine-grained-pat` שסומן אז
   "OWNER ROTATION URGENT — owner-blocked; history retains"
   (נתיב `upload/pat.env` בקומיט היסטורי 34e3d5c5…). ההיסטוריה משמרת-חומר —
   הרוטציה היא-התרופה, והיא הוחזקה עד-היום אצל-הבעלים.
3. ~~סנכרון-עותק-הסנדבוקס~~ **נסגר תוך-כדי**: הריבייס לקומיט-התיעוד הקהה-את
   העותק-החי על origin/main (כולל 0a27d2f ו-858c444 — PASS של המנוע-הריבוני
   כבר-נרשם) — העותק-החי מעודכן-מלא החל מ-0ca03f4.

## 7. שחזור

```bash
# הבינארי המקובע:
curl -sSL -o /tmp/gl.tgz https://github.com/gitleaks/gitleaks/releases/download/v8.24.3/gitleaks_8.24.3_linux_x64.tar.gz
# היסטוריה-מלאה (כמו ה-CI):
/tmp/gitleaks detect --source . --report-format json --report-path /tmp/gl.json --redact --no-banner
# כל-חדש-שאינו-ב-.gitleaksignore = טריאז'-כן, לא-התעלמות.
```
