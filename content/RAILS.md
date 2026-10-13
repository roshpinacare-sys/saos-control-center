# content/rails — קנון-מסילות-התוכן (T-37 החלטת-מפעיל)

## ההכרעה (השאלה: איפה מאוחסנים-נכסי-התוכן ברחבי-הצי)
**ריכוזיות ב-FleetHQ (המאגר-האם) בלבד** — `content/rails/<rail>/`.
אין-שכפול-מסילות ב-22 המאגרים-האחים: האחים יורשים-דרך-שושלת-הגיט
(כל-פריט-תוכן נושא-את-שורש-המרקל של-הספרים-שממנו-חובר — `booksRoot`
מתוך `receipts/books-lineage.json`) ואינם-מחזיקים-עותק-עצמאי.

## המבנה
```
content/
├── RAILS.md                      ← החלטה-זו (הסכמה-קנונית)
└── rails/
    ├── technical/manifest.json   ← מסילה-טכנית
    ├── financial/manifest.json   ← מסילה-פיננסית
    ├── architectural/manifest.json
    └── <rail>/items/             ← פריטים: YYYY-MM-DD-<slug>.md
```

## פריט-תוכן (front-matter חובה — דטרמיניסטי)
```yaml
rail: technical            # אחד-משלושת-המסילות
slug: example-item         # ייחודי-פר-מסילה
compiledFrom: books        # מקור-החיבור
booksRoot: <sha256>        # שורש-המרקל מreceipts/books-lineage.json בעת-החיבור
at: 2026-10-09T00:00:00Z
status: STAGED             # STAGED → REVIEWED → (owner-gate) PUBLISHED
```

## גבולות-הצ'רטר
- **סטאג'ינג-בלבד** — פרסום/שידור בפועל נשאר **מוחזק-להכרעת-הבעלים**
  (venue-gate — אותו-שער-כמו-שידור-העסקאות; אפס-פרסום-אוטומטי).
- **אפס-תוכן-מפוברק** — פריט נחתם-רק-ממדדים-אמת (ספרי-המדדים/הקבלות);
  מסילה-ריקה נשארת SCAFFOLDED-AWAITING-CONTENT בכנות.
- **חציית-שושלת לפני-קומיט** — כל-קומיט-תוכן מאמת שה-`booksRoot` שלו
  הוא-הראש-המשורשר בreceipts/books-lineage.json (הרחבה-ליניארית-מאומתת).
- **אפס-סודות** — סריקת-דליפות (נתיב+base58) על-כל-פריט לפני-דחיפה.
