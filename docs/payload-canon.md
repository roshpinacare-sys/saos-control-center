# docs/payload-canon.md — קנון-מודלי-המטא של-payload-העסקאות (T-38 · תשובת-מפעיל)

**ההכרעה:** פרמטרי-הפריסה המדויקים של-מודלי-מטא-ה-payload — מקודדים-כאן מתוך-אמת-הדיסק
(הקוד-החי בrevenue-router.ts · post-batcher.ts), לא-מהנרטיב-המוזרק. כל-המודלים:
metadata-only · אפס-סודות · תקרות-בייטים-קשיחות · fail-closed על-חריגה.

## 1. `saos.tx-meta/1` — קובץ-עסקה-פר-פעולה
- **מיקום:** `saos-dex/tx/<ISO-ts>-<op>.json` (פריט-אחד לכל-פעולה-על-השרשרת)
- **שדות (סדר-קנון):**
  | שדה | טיפוס | הערה |
  |---|---|---|
  | `schema` | const `"saos.tx-meta/1"` | |
  | `at` | ISO-8601 | זמן-הריצה |
  | `chain` | `steem\|hive\|blurt` | |
  | `op` | string | למשל `claim_reward_balance` |
  | `status` | `confirmed\|failed-honest` | כנות-מלאה |
  | `txid` | hex — **מלא** כאן (מקוצר-רק-ב-latency) | |
  | `block` | number\|null | |
  | `node` | string (רשת-השידור, ללא-https://) | מזין-את-דירוג-rpc-mesh |
  | `latencyMs` | number | |
  | `amounts`/`error` | object\|string | תוצאה-או-כישלון-כנה |
  | `keysLeaked` | const `false` | אטימות-כנה |
- פורמט: JSON pretty (indent-1) · נגזר-מrevenue-router.ts:66

## 2. `saos.tx-latency/1` — יומן-latency מטא-בלבד
- **מיקום:** `saos-dex/tx/broadcast-latency.jsonl` · **תקרה: ~150B/שורה** (קשה)
- **שדות-שורה:** `{at, chain, op, node, ms, status, txid(≤16-תווים — המלא-נשמר-רק ב-tx-meta/1)}`
- צרכנים: rpc-mesh v2 successMetrics (דירוג-צמתים) · bandwidth-degradation (העשרה)

## 3. `saos.post-batch/1` + `saos.post-payload/1` — חבילת-הפרסום-המאוחרת
- **מיקום:** `saos-dex/state/broadcast-pending/post-batch-<ts>.json` + `post-batch-latest.json`
- **תקרה:** 32KB-קשה לחבילה · עלה-פר-ספר ≤16KB · ספרים-על-הדיסק-בלבד (ספירה-כנה — 11 כרגע)
- **שדות:** `{schema, at, bookCount, lineageRoot(sha256), leafCount, lineageVerify{verdict, prevRoot, prevRootMatchesLocal, prevRootMatchesRemote, remoteReceiptAt, checkedAt, channel}, payloads[{schema:"saos.post-payload/1", book, at, bytes{raw,compact}, body(compactCanon), status:"COMPILED"}], status:"BROADCAST-READY (staging-only)"→OWNER-GATED, doctrine, keysLeaked:false}`
- **compactCanon:** מיון-מפתחות · ניפוי-null · עיגול-צפים-4dp · קיצוץ-מחרוזות-96 · אפס-רווחים

## 4. `saos.content-rail/1` — front-matter-פריטי-התוכן
- **מיקום:** `content/rails/<rail>/items/YYYY-MM-DD-<slug>.md` · מסילות: technical/financial/architectural
- **front-matter-חובה:** `rail · slug · compiledFrom · booksRoot(מreceipts/books-lineage.json) · at · status: STAGED→REVIEWED→(owner-gate)PUBLISHED`
- פרסום = **OWNER-GATED** · פריט נחתם-רק-ממדדים-אמת · סריקת-דליפות fail-closed לפני-כתיבה

## 5. יומני-השמירה
- `receipts/lineage-guard.jsonl` — ≤1000-שורות · `{at, root, prevRoot, verdict, action}`
- `receipts/books-lineage.json` — `{schema:"saos.books-lineage/1", at, head, chain[≤64]{at, root, prevRoot, verdict}}`
- `receipts/bandwidth-degradation-history.jsonl` — ≤512-שורות · ~150B/שורה
- `receipts/witness-latency-history.jsonl` — ≤512-שורות · ≤300B/שורה (קנון-T-35)

**גבול-על:** אין-מודל-payload חדש-בלי-תקרת-בייטים-מוצהרת ואטימות-`keysLeaked:false` —
כל-הוספה עוברת-דרך-הקנון-הזה או נדחית.
