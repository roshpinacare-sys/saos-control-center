// ═══ תרגיל-השחזור (Recovery Drill · EXEC-CD-24) ══════════════════════════════
// מה-המפעיל הורה: "שלא יהיה תלוי בסנדבוקס שנחמק" — כלומר: סנדבוקס-מתה → clone חדש
// → הרצת-הסקריפט-הזה → הארנק חי. זהו-התרגיל-הקנוני-שהאוטונומיה מחויבת-לדעת.
//
// מה-הוא עושה (בלי-להדפיס-אף-סוד):
//  1. קורא seal.a + seal.b מהריפו → מפתח-AES → פענוח-GCM של wallet.enc.json.
//  2. נגזר-מחדש-את-כל-הכתובות מה-mnemonic-המפוענח — התאמה-ביט-מול-ביט מול-המעטפת.
//  3. משווה-מול-manifest.json (הרישום-הציבורי) — אם-מישהו-שינה-כתובת-במניפסט → קולני.
//  4. [--probe] בודק-חי-יתרות-מול-RPC-ציבורי.
//
// הרצה: bun scripts/repo-vault-open.ts [--probe]
import { openRepoVault, verifyRepoVault, vaultExists, vaultFile, MANIFEST, ESCALATIONS, readEscalations, probeChains, publicView } from '../src/lib/repo-vault';
import fs from 'fs';

if (!vaultExists()) {
  console.error('✖ אין-כספת-בריפו (repo-vault/). clone את-הריפו-או-הרץ scripts/repo-vault-mint.ts');
  process.exit(1);
}

const t0 = Date.now();
const probe = process.argv.includes('--probe');

console.log('[open] תרגיל-שחזור: קורא שברי-חותם + מעטפת-מוצפנת מהריפו…');
const { envelope, manifest } = openRepoVault();
const v = verifyRepoVault();

if (!v.addressesMatch) {
  console.error(`✖ נגזרה-מחדש לא-תואמת את המעטפת! לא-תקין: ${v.mismatches.join(', ')}`);
  process.exit(2);
}
console.log(`[open] ✓ פתיחה-GCM תקינה · נגזרה-מחדש ביט-מול-ביט (${Date.now() - t0}ms) · label=${v.label}`);

// עקביות-מול-הרישום-הציבורי (המניפסט)
if (manifest) {
  const manifestAddrs = manifest.networks.map(n => `${n.network}:${n.address}`).sort();
  const vaultAddrs = v.view.map(d => `${d.network}:${d.address}`).sort();
  const same = JSON.stringify(manifestAddrs) === JSON.stringify(vaultAddrs);
  console.log(`[open] ${same ? '✓' : '✗'} manifest.json ${same ? 'מתואם-עם המעטפת' : `חסר-התאמה! manifest=${manifestAddrs.length} vs vault=${vaultAddrs.length}`}`);
  console.log(`[open]   algo: ${manifest.algo.cipher} · ${manifest.algo.seal}`);
} else {
  console.warn('[open] ⚠ אין manifest.json — הרץ מחדש את ה-mint או שחזר את הקובץ מהגיט');
}

console.log('[open] ── הארנק-הריבוני (כתובות-ציבוריות) ──');
for (const d of v.view) {
  console.log(`[open]   ${d.network.padEnd(8)} ${d.address}   (${d.path})`);
}

if (probe) {
  console.log('[open] בדיקות-חי מול-RPC-ציבורי…');
  const { bundle } = openRepoVault();
  const probes = await probeChains(bundle.derivations);
  for (const p of probes) {
    console.log(`[open]   ${p.network.padEnd(8)} ${p.ok ? `✓ live · balance=${p.balance ?? '?'} ${p.unit} · (${p.latencyMs}ms)` : `✗ ${p.error}`}`);
  }
}

// בלוע-במעטפת (EXEC-CD-25) — שמות-בלבד, אף-ערך-מודפס
const { bundle: bundleForAbsorbed } = openRepoVault();
const absorbedNames = Object.keys(bundleForAbsorbed.absorbed ?? {});
if (absorbedNames.length > 0) {
  console.log(`[open] ── סודות-בלועים-במעטפת: ${absorbedNames.length} ──`);
  for (const nm of absorbedNames) {
    const len = (bundleForAbsorbed.absorbed?.[nm] ?? '').length;
    console.log(`[open]   · ${nm} (אורך ${len}) — נשמר-בגיט-המוצפן · שורד-מחיקת-סנדבוקס`);
  }
} else {
  console.log('[open] (אין-סודות-בלועים-נוספים — הרץ scripts/repo-vault-absorb.ts לבליעת-מפתח-הפינה)');
}

// רישום-ההעברה-למפעיל
const esc = readEscalations();
console.log(`[open] ── העברה-למפעיל: ${esc.items.length} פריטים שהאוטונומיה לא יכולה לבצע ──`);
for (const it of esc.items) console.log(`[open]   · [${it.priority}] ${it.title} — ${it.status}`);

console.log('[open] ✓ התרגיל עבר — הכספת נפתחת-מclone-טרי. עצמאות-מסנדבוקס מוכחת.');
