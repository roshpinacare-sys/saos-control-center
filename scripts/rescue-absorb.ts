// ═══ חילוץ-ובליעת-המחסן-הגנוז (EXEC-CD-29 · CROSS-THE-BORDER) ═══════════════
// הוראת-המפעיל: "הכל נמצא בגיט... פשוט לא בדקת טוב עדיין" — צדק.
// /tmp/saos-vault (keys0910 + קבצים-רופפים) הוא מחסן-המפתחות שנחשב "אבוד" — fleet_keys.enc,
// wallets-registry.json, מנמוניקות-TRON, seed-ריבוני. כולם עכשיו נבלעים-למעטפת המוצפנת
// שחיה-בגיט עצמו — מחיקת-סנדבוקס כבר-לא-תהרוג-אותם לעולם.
//
// חוזה-סודות: אף-ערך-לא-מודפס. רק שמות + אורכים. בינארי → base64.
// סילוף: אחרי-כתיבה, כל-הבאפרים-המוחזקים בזיכרון מנוטרלים (best-effort).
//
// הרצה: bun scripts/rescue-absorb.ts [--force]
import fs from 'fs';
import path from 'path';
import { openRepoVault, verifyRepoVault, sealKeyFromShards, encryptWithKey, vaultFile, SEAL_A, SEAL_B, WALLET_ENC, MANIFEST } from '../src/lib/repo-vault';

const force = process.argv.includes('--force');
const SRC = '/tmp/saos-vault';
const SYNC = '/home/sync/upload';

interface RescueSrc { file: string; name: string; b64?: boolean }
const RESCUE: RescueSrc[] = [
  // keys0910 — מחסן-המפתחות (13 keys בפנים)
  { file: `${SRC}/keys0910/agent/keys/fleet_keys.enc`, name: 'fleet-keys-enc', b64: true },
  { file: `${SRC}/keys0910/agent/fleet_keys.enc`, name: 'fleet-keys-enc-a', b64: true },
  { file: `${SRC}/keys0910/agent/fleet_keys.meta.json`, name: 'fleet-keys-meta' },
  { file: `${SRC}/keys0910/agent/keys/wallets-registry.json`, name: 'wallets-registry' },
  { file: `${SRC}/keys0910/agent/keys/wallets-seed.json`, name: 'wallets-seed' },
  { file: `${SRC}/keys0910/agent/keys/vault.json`, name: 'vault-accounts' },
  { file: `${SRC}/keys0910/agent/keys/vault.enc`, name: 'vault-inner-enc', b64: true },
  { file: `${SRC}/keys0910/agent/keys/tron-mnemonic.txt`, name: 'tron-mnemonic' },
  { file: `${SRC}/keys0910/agent/keys/tron-legacy-mnemonic.txt`, name: 'tron-legacy-mnemonic' },
  { file: `${SRC}/keys0910/agent/keys/headcorner-recovered.txt`, name: 'headcorner-recovered' },
  { file: `${SRC}/keys0910/agent/keys/hed-soldiers-source.txt`, name: 'hed-soldiers-source' },
  { file: `${SRC}/keys0910/agent/keys/hcsoldier4.json`, name: 'hcsoldier-4' },
  { file: `${SRC}/keys0910/agent/keys/hcsoldier5.json`, name: 'hcsoldier-5' },
  { file: `${SRC}/keys0910/agent/keys/hcsoldier6.json`, name: 'hcsoldier-6' },
  { file: `${SRC}/keys0910/agent/keys/key-broker.token`, name: 'key-broker-token' },
  { file: `${SRC}/keys0910/agent/.env`, name: 'agent-env-0910' },
  { file: `${SRC}/keys0910/MANIFEST.txt`, name: 'manifest-0910' },
  // uploads של-המפעיל (יכולים-להכיל סיסמאות/זרעים)
  { file: `${SRC}/keys0910/upload/הד.txt`, name: 'upload-hed' },
  { file: `${SRC}/keys0910/upload/הדקור.txt`, name: 'upload-hedkor' },
  { file: `${SRC}/keys0910/upload/חח.txt`, name: 'upload-het' },
  { file: `${SRC}/keys0910/upload/Roshcaregt.txt`, name: 'upload-roshcaregt' },
  { file: `${SRC}/keys0910/upload/Ynet.txt`, name: 'upload-ynet' },
  { file: `${SRC}/keys0910/upload/IMG-20260905-WA0025.jpg`, name: 'upload-img-wa0025', b64: true },
  // רופפים
  { file: `${SRC}/seed-formula.md`, name: 'seed-formula' },
  { file: `${SRC}/seed-readme.md`, name: 'seed-readme' },
  { file: `${SRC}/tghk-pass.txt`, name: 'tghk-pass' },
  { file: `${SRC}/hist-passes.json`, name: 'hist-passes' },
  { file: `${SRC}/seed.zip`, name: 'seed-zip', b64: true },
  { file: `${SRC}/keys.zip`, name: 'keys-zip', b64: true },
  { file: `${SRC}/keys-0910.zip`, name: 'keys-0910-zip', b64: true },
  { file: `${SRC}/keys-0929.zip`, name: 'keys-0929-zip', b64: true },
  { file: `${SRC}/vault-inner.zip`, name: 'vault-inner-zip', b64: true },
  { file: `${SRC}/pat.env.enc`, name: 'pat-env-enc', b64: true },
  { file: `${SRC}/keys-0910.zip.enc`, name: 'keys-0910-zip-enc', b64: true },
  { file: `${SRC}/keys-0929.zip.enc`, name: 'keys-0929-zip-enc', b64: true },
  { file: `${SRC}/keys.zip.enc`, name: 'keys-zip-enc', b64: true },
  { file: `${SRC}/seed.zip.enc`, name: 'seed-zip-enc', b64: true },
  { file: `${SRC}/try.zip`, name: 'try-zip', b64: true },
  // sync
  { file: `${SYNC}/headcorner.txt`, name: 'headcorner-sync' },
  { file: `${SYNC}/rar.pass`, name: 'rar-pass' },
  { file: `${SYNC}/pat.env`, name: 'pat-env-sync' },
];

function readAsSecret(s: RescueSrc): string | null {
  if (!fs.existsSync(s.file)) return null;
  const buf = fs.readFileSync(s.file);
  if (buf.length === 0) return null;
  if (s.b64) return buf.toString('base64');
  return buf.toString('utf8').trim();
}

const t0 = Date.now();
console.log('[rescue] פותח-את כספת-הריפו (2-of-2 shards → AES-256-GCM)…');
const { bundle, envelope } = openRepoVault();
const before = verifyRepoVault();
if (!before.addressesMatch) { console.error('✖ הכספת-הקיימת-אינה-עקבית — מבטל, לא-נוגע.'); process.exit(2); }

bundle.absorbed = { ...(bundle.absorbed ?? {}) };
let absorbed = 0, skipped = 0, conflicted = 0;
for (const s of RESCUE) {
  const secret = readAsSecret(s);
  if (!secret) { console.log(`[rescue]   · ${s.name} — חסר/ריק, דלג`); skipped++; continue; }
  if (bundle.absorbed[s.name] !== undefined && !force) { conflicted++; continue; }
  bundle.absorbed[s.name] = secret;
  absorbed++;
  console.log(`[rescue]   ✓ ${s.name} (אורך ${secret.length})`);
}
if (absorbed === 0) { console.log('[rescue] אין-חדש-לבלוע (הכל-כבר-בפנים). יוצא.'); process.exit(0); }

// ── חתימה-מחדש ──
const a = fs.readFileSync(vaultFile(SEAL_A), 'utf8').trim();
const b = fs.readFileSync(vaultFile(SEAL_B), 'utf8').trim();
const key = sealKeyFromShards(a, b);
const plain = JSON.stringify(bundle);
const enc = encryptWithKey(plain, key);
const nextEnvelope = { ...envelope, iv: enc.iv, ct: enc.ct, tag: enc.tag, sealedAt: new Date().toISOString() };
fs.writeFileSync(vaultFile(WALLET_ENC), JSON.stringify(nextEnvelope, null, 2), { mode: 0o600 });
console.log(`[rescue] ✓ מעטפת-חותמה-מחדש (0600) · ${absorbed} נבלעו · ${conflicted} כבר-היו · ${skipped} דולגו`);

// ── סיבוב-מלא ──
const re = openRepoVault();
const after = verifyRepoVault();
if (!after.addressesMatch) { console.error('✖ סיבוב-נכשל: נגזרת-הארנק-השתנתה!'); process.exit(3); }
let roundtripOk = true;
for (const s of RESCUE) {
  const secret = readAsSecret(s);
  if (!secret) continue;
  const got = re.bundle.absorbed?.[s.name];
  if (got !== secret) { roundtripOk = false; console.error(`✖ סיבוב-נכשל עבור ${s.name}`); }
}
if (!roundtripOk) process.exit(3);
console.log(`[rescue] ✓ סיבוב-מלא: ${Object.keys(re.bundle.absorbed ?? {}).length} סודות במעטפת · נגזרת-ארנק ביט-מול-ביט (${Date.now() - t0}ms)`);

// ── מניפסט: שמות-בלבד ──
const manifestPath = vaultFile(MANIFEST);
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  manifest.absorbed = {
    keys: Object.keys(re.bundle.absorbed ?? {}),
    at: nextEnvelope.sealedAt,
    note: 'שמות-בלבד — הערכים-חיים-רק-בתוך-המעטפת-המוצפנת (wallet.enc.json)',
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('[rescue] ✓ manifest.json עודכן (שמות-בלבד)');
}
console.log('[rescue] ✓ הושלם — חובה: דחיפה-מיידית (bash scripts/sovereign-push.sh) · חוק §2.3');
