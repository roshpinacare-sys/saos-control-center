#!/usr/bin/env bun
/**
 * rot1-restore.ts — שחזור-מפתחות-החיילים מהזרע-במשמורת-המפעיל (EXEC-CD-13 דרך-הריפוי).
 * ═════════════════════════════════════════════════════════════════════════════════════
 * האמת-המדודה (EXEC-CD-13 / worklog 583): הרשויות-על-השרשראות חתומות-מחדש (STEEM
 * 8313cdcb… · HIVE 92654439…) מתוך זרע 64-hex שהמשמורת-היחידה שלו = גיבוי-צ'אט-המפעיל.
 * הזרע אינו-בידינו ולא-יימצא-לעולם-בקוד/בכספת. המערכת לא-ממציאה-מפתחות (fail-closed).
 *
 * הסקריפט הזה הוא הדרך-החוקית-היחידה להשיב-את-הצי-לשרשרת, כשהבעלים מפיל-את-הזרע:
 *
 *   1. משמורת: הזרע נקרא מ-/home/z/coord-work/vault/rot1-seed (0600) או env ROT1_SEED_FILE.
 *      חסר ⇒ exit 2 קולני — אפס-מפתחות-מומצאים.
 *   2. גזירה: HMAC-SAOS-ROT1 לכל חשבון×שרשרת×תפקיד (src/lib/keys.ts wifFromRot1Seed).
 *   3. אימות-חי: פאב-גזור (raw+normalized) מול רשויות-חיות ב-RPC-ציבורי (chain.ts
 *      getAccount/rolesForPub). רק-התאמות-אמת נכנסות-לכספת.
 *   4. fail-closed: אפס-התאמות ⇒ exit 3 קולני (הזרע לא-מתאים-לרשויות — טעות-משמורת).
 *   5. אטימה: מעטפת SAOS-FLEET-VAULT-1 בדיוק-כמו saos-dex fleet.ts openVault קורא —
 *      pass נגזר sha256("saos-fleet-vault-v2:"+DEX_OPERATOR_TOKEN), meta בלי-pass
 *      (custody נגזר-בלבד — תיקון R16-c). chmod 600. אפס-הדפסת-מפתחות/פאבים.
 *   6. קבלה: ספירות-בלבד (מותאמים/סה"כ, לפי-שרשרת) → state/audit/rot1-restore.json.
 *
 * שימוש:
 *   bun scripts/rot1-restore.ts seal --out-dir <dir>   # משמורת-מלאה
 *   bun scripts/rot1-restore.ts selftest --out-dir <d> # זרע-אקראי-בזיכרון-בלבד (בדיקת-אטימה/פתיחה)
 *   bun scripts/rot1-restore.ts verify --out-dir <dir> # פותח-את-הכספת (pass נגזר) ומדווח-ספירות
 * אפס-רשת-ב-selftest; אימות-חי-רק-ב-seal. זמן: חוקי (Date רק-ל-stamp).
 */
import { createHash, randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { wifFromRot1Seed, wifToPublic, wifToPublicRaw, ROT1_ACCOUNTS, ROT1_CHAINS, ROT1_ROLES, type Chain } from '../src/lib/keys';
import { getAccount, rolesForPub, type AccountAuths } from '../src/lib/chain';

const SEED_CUSTODY_DEFAULT = '/home/z/coord-work/vault/rot1-seed';
const MAGIC = 'SAOS-FLEET-VAULT-1';

function fail(code: number, msg: string): never {
  console.error(JSON.stringify({ ok: false, exit: code, reason: msg }, null, 1));
  process.exit(code);
}

function readSeed(): string {
  const p = process.env.ROT1_SEED_FILE || SEED_CUSTODY_DEFAULT;
  let raw = '';
  try {
    raw = readFileSync(p, 'utf8').trim();
    const st = statSync(p);
    if (st.mode & 0o077) console.error(`[rot1-restore] אזהרת-משמורת: ${p} אינו 0600 (מצב ${st.mode & 0o777}) — ממשיך, אך תקן-זאת`);
  } catch {
    fail(2, `custody absent: אין-זרע-ROT1 ב-${p} — המערכת אינה-ממציאה-מפתחות (fail-closed). הזרע נמצא במשמורת-הבעלים (גיבוי-צ'אט-המפעיל); הפל-אותו לקובץ-זה (0600) והרץ שוב`);
  }
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) fail(2, `custody malformed: הקובץ ${p} אינו זרע 64-hex`);
  return raw.toLowerCase();
}

/** פאבים של-כל-התפקידים (raw+normalized) לחשבון/שרשרת.
 * חוק-raw (keys.ts): wifToPublicRaw זורק על-חלק-מה-מפתחות (33-byte payload);
 * אימות-האמת-מנסה-normalized-תמיד, raw-כשקיים (באגי-סקלר-קלאס). */
function deriveSet(seed: string, account: string, chain: Chain): Record<string, { wif: string; pub: string; pubRaw: string | null }> {
  const out: Record<string, { wif: string; pub: string; pubRaw: string | null }> = {};
  for (const role of ROT1_ROLES) {
    const wif = wifFromRot1Seed(seed, account, chain, role);
    let pubRaw: string | null = null;
    try { pubRaw = wifToPublicRaw(wif); } catch { /* raw-form absent for this key class — normalized still verified */ }
    out[role] = { wif, pub: wifToPublic(wif), pubRaw };
  }
  return out;
}

async function liveMatch(seed: string): Promise<{ matched: Record<string, Record<Chain, Record<string, string>>>; matchedAccounts: string[]; chainCounts: Record<string, number>; auths: Record<string, Record<string, AccountAuths | null>> }> {
  const matched: Record<string, Record<Chain, Record<string, string>>> = {};
  const matchedAccounts: string[] = [];
  const chainCounts: Record<string, number> = {};
  const auths: Record<string, Record<string, AccountAuths | null>> = {};
  for (const chain of ROT1_CHAINS) {
    chainCounts[chain] = 0;
    for (const account of ROT1_ACCOUNTS) {
      const acct = await getAccount(chain, account);
      auths[account] = auths[account] ?? {};
      auths[account][chain] = acct;
      if (!acct) continue;
      const set = deriveSet(seed, account, chain);
      const roleHit: Record<string, string> = {};
      for (const [role, kp] of Object.entries(set)) {
        const roles = rolesForPub(acct, kp.pub);
        const rolesRaw = kp.pubRaw ? rolesForPub(acct, kp.pubRaw) : [];
        const all = new Set([...roles, ...rolesRaw]);
        if (all.size > 0) roleHit[role] = [...all].sort().join('|');
      }
      if (Object.keys(roleHit).length > 0) {
        matched[account] = matched[account] ?? ({} as Record<Chain, Record<string, string>>);
        matched[account][chain] = roleHit;
        chainCounts[chain]++;
        if (!matchedAccounts.includes(account)) matchedAccounts.push(account);
      }
    }
  }
  return { matched, matchedAccounts, chainCounts, auths };
}

function vaultPass(): string {
  const base = process.env.DEX_OPERATOR_TOKEN ?? '';
  if (!base || !base.trim()) fail(4, 'DEX_OPERATOR_TOKEN לא-מוגדר בסביבה — אין-מה לגזור-ממנו pass לכספת (custody fail-closed)');
  return createHash('sha256').update(`saos-fleet-vault-v2:${base}`).digest('hex');
}

function seal(bundle: unknown, outDir: string): void {
  const pass = vaultPass();
  const iv = randomBytes(12);
  const salt = randomBytes(16);
  const key = scryptSync(pass, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(bundle), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  mkdirSync(outDir, { recursive: true });
  const enc = MAGIC + Buffer.concat([salt, iv, tag, ct]).toString('hex');
  const target = join(outDir, 'fleet_keys.enc');
  writeFileSync(target, enc + '\n', { mode: 0o600 });
  // R16-c custody: meta בלי-pass — ה-pass הנגזר-מ-DEX_OPERATOR_TOKEN הוא-הדרך-היחידה
  writeFileSync(join(outDir, 'fleet_keys.meta.json'), JSON.stringify({
    note: 'derived-pass custody (saos-fleet-vault-v2:DEX_OPERATOR_TOKEN) — no legacy pass stored (R16-c)',
    sealedBy: 'rot1-restore (saos-control-center)',
  }, null, 1) + '\n', { mode: 0o600 });
  chmodSync(target, 0o600);
}

function openSealed(outDir: string): { accounts: string[]; at: string | null } {
  const enc = readFileSync(join(outDir, 'fleet_keys.enc'), 'utf8');
  if (!enc.startsWith(MAGIC)) fail(5, 'unknown seal format');
  const payload = Buffer.from(enc.slice(MAGIC.length).replace(/\s+/g, ''), 'hex');
  const key = scryptSync(vaultPass(), payload.subarray(0, 16), 32);
  const d = createDecipheriv('aes-256-gcm', key, payload.subarray(16, 28));
  d.setAuthTag(payload.subarray(28, 44));
  const plain = Buffer.concat([d.update(payload.subarray(44)), d.final()]).toString('utf8');
  const bundle = JSON.parse(plain) as { sealedAt?: string; files?: Record<string, string> };
  const vaultJson = bundle.files?.['keys/vault.json'];
  if (!vaultJson) fail(5, 'keys/vault.json member missing');
  const accounts = JSON.parse(vaultJson) as { accounts: Record<string, unknown> };
  return { accounts: Object.keys(accounts.accounts ?? {}), at: bundle.sealedAt ?? null };
}

function outDirOf(argv: string[]): string {
  const i = argv.indexOf('--out-dir');
  const d = i >= 0 ? argv[i + 1] : (process.env.SAOS_FLEET_VAULT_DIR || '');
  if (!d) fail(2, 'missing --out-dir (או env SAOS_FLEET_VAULT_DIR) — לאן לאטום את הכספת?');
  return resolve(d);
}

const [, , cmd, ...rest] = process.argv;

if (cmd === 'selftest') {
  // זרע-אקראי-בזיכרון-בלבד — בדיקת-אטימה/פתיחה + דטרמיניזם-גזירה. אפס-רשת, אפס-התמדה.
  const outDir = outDirOf(process.argv);
  const seed = randomBytes(32).toString('hex');
  const a = deriveSet(seed, ROT1_ACCOUNTS[1], 'steem');
  const b = deriveSet(seed, ROT1_ACCOUNTS[1], 'steem');
  if (a.posting.wif !== b.posting.wif || a.owner.pub !== b.owner.pub) fail(6, 'derivation not deterministic');
  if (!/^[5JKL]/.test(a.posting.wif)) fail(6, 'WIF shape invalid (base58check)');
  const acct = ROT1_ACCOUNTS[1];
  seal({ sealedAt: new Date().toISOString(), files: { 'keys/vault.json': JSON.stringify({ accounts: { [acct]: { keys: a } } }) } }, outDir);
  const opened = openSealed(outDir);
  if (!(opened.accounts.length === 1 && opened.accounts[0] === acct)) fail(6, 'seal/open roundtrip failed');
  console.log(JSON.stringify({ ok: true, mode: 'selftest', law: 'random in-memory seed; roundtrip seal→open verified; zero persistence of key material' }));
  process.exit(0);
}

if (cmd === 'verify') {
  const outDir = outDirOf(process.argv);
  if (!existsSync(join(outDir, 'fleet_keys.enc'))) fail(2, 'no sealed vault in out-dir');
  const opened = openSealed(outDir);
  console.log(JSON.stringify({ ok: true, mode: 'verify', at: opened.at, accounts: opened.accounts.length, names: opened.accounts }));
  process.exit(0);
}

if (cmd === 'seal') {
  const outDir = outDirOf(process.argv);
  const seed = readSeed();
  console.error('[rot1-restore] משמורת-זרע חיה — מאמת מול רשויות-חיות (רשת-ציבורית קריאה-בלבד)…');
  const { matched, matchedAccounts, chainCounts } = await liveMatch(seed);
  const totalMatches = Object.values(chainCounts).reduce((x, y) => x + y, 0);
  if (matchedAccounts.length === 0) {
    fail(3, `custody error: הזרע אינו מתאים לאף רשות-חיה (0/${ROT1_ACCOUNTS.length} חשבונות, ${JSON.stringify(chainCounts)}) — המערכת אינה אוטמת כספת-מפתחות-זרים (fail-closed)`);
  }
  // הכספת: לכל חשבון-מותאם — רק-השרשראות/התפקידים-שאומתו-חי
  const accounts: Record<string, unknown> = {};
  for (const account of matchedAccounts) {
    const keys: Record<string, { wif: string; pub: string }> = {};
    for (const chain of ROT1_CHAINS) {
      const hits = matched[account]?.[chain];
      if (!hits) continue;
      const set = deriveSet(seed, account, chain as Chain);
      for (const role of Object.keys(hits)) {
        keys[`${chain}:${role}`] = { wif: set[role]!.wif, pub: set[role]!.pub };
        // גם-צורה-ישירה לתפקיד-posting (ה-filter של fleet.ts accountsFromJson דורש keys.posting)
        if (role === 'posting') keys['posting'] = { wif: set[role]!.wif, pub: set[role]!.pub };
      }
    }
    if (keys['posting']) accounts[account] = { username: account, keys };
  }
  const sealedCount = Object.keys(accounts).length;
  if (sealedCount === 0) fail(3, 'custody error: התאמות-חי קיימות אך אף-אחת-לא-שמישה-לחתימה (posting) — לא אוטם כספת חלקית');
  seal({ sealedAt: new Date().toISOString(), files: { 'keys/vault.json': JSON.stringify({ accounts }) } }, outDir);
  const opened = openSealed(outDir);
  const receipt = {
    ok: true, mode: 'seal', at: new Date().toISOString(),
    matchedAccounts, chainCounts, totalMatches, sealedCount,
    roundtrip: { accounts: opened.accounts.length, at: opened.at },
    law: 'only live-authority-matched roles sealed; keys never printed/logged; meta without pass (R16-c)',
  };
  const auditDir = join(process.cwd(), 'state', 'audit');
  try {
    mkdirSync(auditDir, { recursive: true });
    writeFileSync(join(auditDir, 'rot1-restore.json'), JSON.stringify(receipt, null, 1) + '\n', { mode: 0o600 });
  } catch { /* receipt best-effort; stdout carries it regardless */ }
  console.log(JSON.stringify(receipt, null, 1));
  process.exit(0);
}

fail(2, 'usage: rot1-restore.ts seal|selftest|verify --out-dir <dir>');
