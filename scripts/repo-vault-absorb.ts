// ═══ בליעת-סודות-למעטפת-הכספת (EXEC-CD-25) ══════════════════════════════════
// הוראת-המפעיל: "ודא כמובן אם אתה משיג כתובות הם חייבות להאטם בכספות אחרת זה ילך
// לאיבוד בכל מחיקת סנדבוקס! זה קריטי מאוד"
//
// הבעיה-שהסקריפט-הזה-פותר: upload/headcorner.txt (מפתח-הפינה — ממנו-נגזרות
// זהויות-הדלת TRON/EVM והלגיון) חי-רק-בסנדבוקס (gitignored). מחיקה-אחת והדור-השני
// של-הזהויות נגזר-ממנו מת לתמיד. הפתרון: בליעה-למעטפת-המוצפנת שכבר-חיה-בגיט.
//
// מה-הוא-עושה:
//  1. פותח-את-הכספת (2-of-2 shards → AES).
//  2. בולע-את-הקובץ-המבוקש לתוך bundle.absorbed[<name>] (גולמי, כמו-שהוא).
//  3. מצפין-מחדש-עם-אותו-מפתח-AES, כותב wallet.enc.json (0600).
//  4. מעדכן-manifest (שמות-בלבד — אף-ערך!).
//  5. תרגיל-סיבוב: פותח-מחדש → נגזרה-ביט-מול-ביט → הבלוע-קיים-ותואם-אורך.
//
// חוזה-סודות: הערך-מודפס-אף-פעם. רק-שם + אורך. מסרב-לדרוך-בליעה-קיימת בלי --force.
//
// שימוש: bun scripts/repo-vault-absorb.ts --file upload/headcorner.txt --name headcorner [--force]
import fs from 'fs';
import { openRepoVault, verifyRepoVault, sealKeyFromShards, encryptWithKey, vaultFile, SEAL_A, SEAL_B, WALLET_ENC, MANIFEST } from '../src/lib/repo-vault';

// ── פרס-ארגומנטים ──
const args = process.argv.slice(2);
const force = args.includes('--force');
function argOf(flag: string): string | null {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
}
const file = argOf('--file');
const name = argOf('--name');
if (!file || !name) {
  console.error('שימוש: bun scripts/repo-vault-absorb.ts --file <נתיב> --name <שם-קנוני> [--force]');
  process.exit(1);
}
if (!/^[a-z0-9-]{2,40}$/.test(name)) {
  console.error('✖ שם-קנוני-בלבד (a-z0-9-, 2..40)');
  process.exit(1);
}

// ── קריאת-הסוד-המבוקש (בלי-להדפיסו) ──
if (!fs.existsSync(file)) {
  console.error(`✖ הקובץ-חסר: ${file}`);
  process.exit(1);
}
const raw = fs.readFileSync(file, 'utf8');
const secret = raw.trim();
if (secret.length < 16) {
  console.error(`✖ הסוד-קצר-מדי (${secret.length} תווים) — נראה-לא-תקין, מבטל.`);
  process.exit(1);
}

// ── פתיחת-הכספת ──
const t0 = Date.now();
console.log(`[absorb] פותח-את-כספת-הריפו…`);
const { bundle, envelope } = openRepoVault();
const before = verifyRepoVault();
if (!before.addressesMatch) {
  console.error('✖ הכספת-הקיימת-אינה-עקבית (נגזרה-לא-תואמת) — מבטל, לא-נוגע.');
  process.exit(2);
}
if (bundle.absorbed?.[name] !== undefined && !force) {
  console.error(`✖ "${name}" כבר-בלוע-במעטפת — דרוש --force (רוטציה-מאושרת-בלבד).`);
  process.exit(2);
}

// ── בליעה + סילוף-איפוס-זיכרון-אחרי-כתיבה ──
bundle.absorbed = { ...(bundle.absorbed ?? {}), [name]: secret };
const a = fs.readFileSync(vaultFile(SEAL_A), 'utf8').trim();
const b = fs.readFileSync(vaultFile(SEAL_B), 'utf8').trim();
const key = sealKeyFromShards(a, b);
const plain = JSON.stringify(bundle);
const enc = encryptWithKey(plain, key);
const nextEnvelope = { ...envelope, iv: enc.iv, ct: enc.ct, tag: enc.tag, sealedAt: new Date().toISOString() };
fs.writeFileSync(vaultFile(WALLET_ENC), JSON.stringify(nextEnvelope, null, 2), { mode: 0o600 });
console.log(`[absorb] ✓ המעטפת-הוצפנה-מחדש (AES-256-GCM, 0600) · "${name}" בלוע (אורך ${secret.length})`);

// ── תרגיל-סיבוב: פתיחה-מהדיסק-מחדש + שלמות-מלאה ──
const re = openRepoVault();
const reSecret = re.bundle.absorbed?.[name];
if (!reSecret || reSecret !== secret) {
  console.error('✖ סיבוב-נכשל: הבלוע-שונה-אחרי-כתיבה! זה-לא-אמור-לקרות — בדוק-ידנית.');
  process.exit(3);
}
const after = verifyRepoVault();
if (!after.addressesMatch) {
  console.error('✖ סיבוב-נכשל: נגזרת-הארנק-השתנתה! מבטל.');
  process.exit(3);
}
console.log(`[absorb] ✓ סיבוב-מלא: פתיחה-GCM · נגזרת-ארנק ביט-מול-ביט (${Date.now() - t0}ms) · הבלוע-שלם`);

// ── מניפסט: שמות-בלבד, אף-ערך ──
const manifestPath = vaultFile(MANIFEST);
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  const absorbedNames = Object.keys(re.bundle.absorbed ?? {});
  manifest.absorbed = {
    keys: absorbedNames,
    at: nextEnvelope.sealedAt,
    note: 'שמות-בלבד — הערכים-חיים-רק-בתוך-המעטפת-המוצפנת (wallet.enc.json)',
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`[absorb] ✓ manifest.json עודכן (שמות-בלבד): ${absorbedNames.join(', ')}`);
}

console.log('[absorb] ✓ הושלם — חובה: דחיפה-מיידית (bash scripts/sovereign-push.sh) · חוק §2.3');
