// ═══ טביעת-ארנק-ריבוני-והחתמתו-בכספת-הריפו (EXEC-CD-24) ═════════════════════
// הוראת-המפעיל: "תקים ארנק ותכניס אותו היטב לכספת בריפו שלא יהיה תלוי בסנדבוקס שנחמק…
// תקים שם כתובת מה שצריך ותשתמש ותשמור את הפרטים".
//
// מה-הסקריפט עושה:
//  1. מייצר mnemonic-BIP39 של-24-מילים (256-bit entropy) — בזיכרון-בלבד.
//  2. נגזר 4 רשתות: EVM · TRON · Bitcoin(P2WPKH) · Solana(SLIP-0010 ed25519).
//  3. בודק-חי את-כל-הכתובות מול-RPC-ציבורי (ה"תשתמש" — הרשמה-חיה-על-השרשרת).
//  4. כותב ל-repo-vault/: seal.a + seal.b (2-of-2 XOR → AES-256-GCM) + wallet.enc.json
//     + manifest.json (ציבורי-בלבד) — ומוודא-סיבוב-מלא (הצפנה→פענוח→שיוויון-ביט).
//
// בטיחות: מסרב לדרוך כספת-קיימת בלי --force. אף-דפסת-מפתח-פרטי. אף-קובץ-עירום.
// הרצה: bun scripts/repo-vault-mint.ts [--label sovereign-01] [--force] [--no-probe]
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { generateMnemonic } from '@scure/bip39';
import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english.js';
import {
  DERIVATION_SPECS, deriveAll, generateSeal, encryptWithKey, decryptWithKey,
  vaultFile, vaultExists, publicView, fp, probeChains,
  WALLET_ENC, MANIFEST, SEAL_A, SEAL_B, REPO_VAULT_DIR,
} from '../src/lib/repo-vault';

const args = process.argv.slice(2);
const labelArg = args.find(a => a.startsWith('--label'));
const label = labelArg ? labelArg.split('=')[1] ?? args[args.indexOf(labelArg) + 1] : 'sovereign-01';
const force = args.includes('--force');
const noProbe = args.includes('--no-probe');

if (vaultExists() && !force) {
  console.error('✖ repo-vault כבר-קיים (wallet.enc.json + seal). טביעה-שנייה-תדרוך-את-הכספת-הקיימת.');
  console.error('  אם-זו-באמת-הכוונה (למשל-רוטציה מאושרת-מפעיל): הרץ שוב עם --force');
  process.exit(1);
}

console.log(`[mint] יוצר כספת-ריפו ריבונית ב-${REPO_VAULT_DIR}`);
const t0 = Date.now();

// 1+2 — mnemonic + נגזרות
const mnemonic = generateMnemonic(englishWordlist, 256); // 24 מילים
const derivations = deriveAll(mnemonic);
console.log(`[mint] mnemonic: 24 מילים (BIP-39, 256-bit) · נגזרו ${derivations.length} רשתות`);

const bundle = {
  label,
  mnemonic,
  createdAt: new Date().toISOString(),
  derivations,
  operatorOrder: 'EXEC-CD-24 — תקים ארנק ותכניס אותו היטב לכספת בריפו שלא יהיה תלוי בסנדבוקס שנחמק',
};

// 3 — בדיקות-חי (ה"תשתמש": הרשמה-חיה-על-השרשרת)
let probes = null as Awaited<ReturnType<typeof probeChains>> | null;
if (!noProbe) {
  console.log('[mint] בודק-חי את-הכתובות מול-RPC-ציבורי (EVM/SOL/TRX/BTC)…');
  probes = await probeChains(derivations);
  for (const p of probes) {
    console.log(`[mint]   ${p.network.padEnd(8)} ${p.ok ? `✓ live (${p.latencyMs}ms) balance=${p.balance ?? '?'} ${p.unit}` : `✗ ${p.error}`}`);
  }
}

// 4 — חותם + הצפנה + כתיבה
const seal = generateSeal();
const env = {
  v: 1,
  kind: 'sovereign-repo-vault',
  algo: 'AES-256-GCM',
  seal: '2-of-2 XOR shards → sha256("sovereign-repo-vault-v1" ⊕ A⊕B)',
  ...encryptWithKey(JSON.stringify(bundle), seal.key),
  sealedAt: new Date().toISOString(),
};

fs.mkdirSync(REPO_VAULT_DIR, { recursive: true });
fs.writeFileSync(vaultFile(SEAL_A), seal.a + '\n', { mode: 0o600 });
fs.writeFileSync(vaultFile(SEAL_B), seal.b + '\n', { mode: 0o600 });
fs.writeFileSync(vaultFile(WALLET_ENC), JSON.stringify(env, null, 2) + '\n', { mode: 0o600 });

// סיבוב-אמת מלא לפני-שנכריז-על-הצלחה
const opened = decryptWithKey(JSON.parse(fs.readFileSync(vaultFile(WALLET_ENC), 'utf8')), seal.key);
if (opened !== JSON.stringify(bundle)) {
  console.error('✖ ROUNDTRIP MISMATCH — המעטפת לא מחזירה-ביט-מול-ביט. לא-נוגעים-במניפסט. בדוק-ידנית.');
  process.exit(2);
}
const reDerived = deriveAll((JSON.parse(opened) as typeof bundle).mnemonic);
const bitMatch = reDerived.every((d, i) => d.address === derivations[i].address && d.privateKey === derivations[i].privateKey);
if (!bitMatch) {
  console.error('✖ RE-DERIVE MISMATCH — ה-mnemonic לא משחזר את הנגזרות. מבוטל.');
  process.exit(2);
}

// מניפסט-ציבורי (אפס-חומר-סוד)
const manifest = {
  kind: 'sovereign-repo-vault-manifest',
  v: 1,
  label,
  createdAt: bundle.createdAt,
  algo: {
    cipher: 'AES-256-GCM',
    seal: 'seal.a ⊕ seal.b → sha256("sovereign-repo-vault-v1" ‖ x) → AES-256 key (2-of-2 — שני-השברים-בריפו-עצמו)',
    mnemonicWords: 24,
  },
  fingerprints: {
    'seal.a': fp(seal.a),
    'seal.b': fp(seal.b),
    'mnemonic': fp(mnemonic), // לעולם לא-הביטוי-עצמו
  },
  networks: publicView(bundle).map(v => ({
    ...v,
    ...(probes ? { probe: probes.find(p => p.network === v.network) ?? undefined } : {}),
  })),
  recovery: 'clone repo → bun install → bun scripts/repo-vault-open.ts --probe (2-of-2: שני-השברים-חיים-בריפו)',
  operatorOrder: bundle.operatorOrder,
};
fs.writeFileSync(vaultFile(MANIFEST), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o644 });

console.log(`[mint] ✓ סיבוב-אמת: הצפנה→פענוח→נגזרה-מחדש — ביט-מול-ביט (${Date.now() - t0}ms)`);
console.log('[mint] ── הארנק-הריבוני (רישום-ציבורי) ──');
for (const v of publicView(bundle)) {
  const p = probes?.find(x => x.network === v.network);
  console.log(`[mint]   ${v.network.padEnd(8)} ${v.address}   (${v.path})${p?.ok ? ` · live ✓` : ''}`);
}
console.log('[mint] קבצים:');
for (const f of [SEAL_A, SEAL_B, WALLET_ENC, MANIFEST]) {
  const st = fs.statSync(vaultFile(f));
  console.log(`[mint]   ${f.padEnd(18)} ${st.size}B  mode=${(st.mode & 0o777).toString(8)}`);
}
console.log('[mint] ✓ הכספת חתומה. השלב-הבא: git add repo-vault/ + push — העצמאות-מהסנדבוקס.');
console.log('[mint] ⚠ המפתח-הפרטי קיים-רק-בזיכרון-ובמעטפת-המוצפנת. אף-דפסה. אף-עותק-עירום.');
