// ═══ arm-rails-rot4.ts — חימוש-מסילות STEEM+BLURT מכספת-האם (EXEC-CD-46) ═════
// דבר-הבעלים: "האוטונומיה היא הבעלים של כל-המפתחות" — הכספת-המוכיחה:
//  · STEEM: חבילת rot4-console-vault (אוטמה 2026-10-08, ריפו-הצי) — מפתחות-ROT3
//    של headcorner. נמדד-חי: 4/4 תפקידים (owner/active/posting/memo) = הסמכות-
//    החיה בפועל על api.steemit.com. מחמש posting (עיגון=פרסום).
//  · BLURT: הבלוע vault-accounts מכיל WIF שנגזר ממנו ה-pub החי (BLT…) של
//    headcorner-active על rpc.blurt.blog. מחמש active (ל-blurt אין-posting-בכספת).
//  · WIF-ה-52-תווים (K-prefix, דחוס) מנורמל ל-51 סטנדרטי — המנוע-החי חותם ממנו.
//
// fail-closed: כל-מסילה מאומתת מול-סמכות-חיה לפני-כתיבה; אין-התאמה = המסילה
// לא-נכתבת והסקריפט מדווח-בכנות. אפס-חומר-מפתח בפלט (טביעות-פומביות-בלבד).
//
// הרצה: bun scripts/arm-rails-rot4.ts [--dry]
import { openRepoVault, vaultExists } from '../src/lib/repo-vault';
import { pubOfWif } from '../saos-dex/src/lib/dex/signer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DRY = process.argv.includes('--dry');
const ENV_FILE = path.resolve(process.cwd(), 'saos-dex/.env');
const UA = 'SAOS-Sovereign-Audit/1.0 (+sovereign-chain)';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58d(s: string): Buffer | null {
  let n = 0n;
  for (const c of s) { const i = B58.indexOf(c); if (i < 0) return null; n = n * 58n + BigInt(i); }
  let hex = n.toString(16); if (hex.length % 2) hex = '0' + hex;
  let buf = Buffer.from(hex, 'hex');
  for (const c of s) { if (c === '1') buf = Buffer.concat([Buffer.from([0]), buf]); else break; }
  return buf;
}
function b58e(buf: Buffer): string {
  let n = BigInt('0x' + buf.toString('hex')); let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n = n / 58n; }
  for (const b of buf) { if (b === 0) out = '1' + out; else break; }
  return out;
}
function dsha(b: Buffer): Buffer {
  const h = crypto.createHash('sha256').update(b).digest();
  return crypto.createHash('sha256').update(h).digest();
}
/** WIF-דחוס (52, K-prefix, דגל-0x01) → 51 סטנדרטי; 51 עובר-כמות-שהוא. */
function normalizeWif(w: string): string | null {
  const raw = b58d(w);
  if (!raw) return null;
  if (raw.length === 37) return w;
  if (raw.length === 38 && raw[33] === 0x01) {
    const body = raw.subarray(0, 33);
    return b58e(Buffer.concat([body, dsha(body).subarray(0, 4)]));
  }
  return null;
}
function pubBody(pub: string): string { return pub.slice(3); }

async function liveAuth(endpoint: string, account: string): Promise<{ posting: string[]; active: string[] } | null> {
  try {
    const r = await fetch(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [[account]], id: 1 }),
      signal: AbortSignal.timeout(12_000),
    });
    const j = (await r.json()) as { result?: Array<{ posting?: { key_auths?: Array<[string, number]> }; active?: { key_auths?: Array<[string, number]> } }> };
    const acc = j.result?.[0];
    if (!acc) return null;
    return {
      posting: (acc.posting?.key_auths ?? []).map(k => k[0]),
      active: (acc.active?.key_auths ?? []).map(k => k[0]),
    };
  } catch { return null; }
}

interface Decision { env: string; wif: string; chain: string; role: string; pub: string; }

async function main(): Promise<void> {
  if (!vaultExists()) { console.error('✖ אין-כספת-בריפו'); process.exit(1); }
  const { bundle } = openRepoVault();
  const ab = bundle.absorbed ?? {};

  const decisions: Decision[] = [];

  // ── STEEM מה-ROT4 ──────────────────────────────────────────────────────────
  const rot4Raw = ab['rot4-console-vault'];
  if (!rot4Raw) {
    console.error('✖ rot4-console-vault לא-במעטפת — הרץ: bun scripts/repo-vault-absorb.ts --file <vault.json> --name rot4-console-vault');
  } else {
    const rot4 = JSON.parse(rot4Raw) as { accounts?: Record<string, { username?: string; keys?: Record<string, { wif?: string }> }> };
    const master = Object.values(rot4.accounts ?? {}).find(a => (a.username ?? '').toLowerCase() === 'headcorner');
    const wif52 = master?.keys?.posting?.wif;
    const wif = wif52 ? normalizeWif(wif52) : null;
    if (!wif) {
      console.error('✖ steem: WIF-posting-לא-נורמל מה-ROT4 — המסילה-נשארת-כבויה');
    } else {
      const auth = await liveAuth('https://api.steemit.com', 'headcorner');
      if (!auth) {
        console.error('✖ steem: אין-תשובת-סמכות-חיה — fail-closed, לא-מחמש');
      } else {
        const pub = pubOfWif(wif);
        const matched = !!pub && auth.posting.includes(pub);
        console.log(`[arm] steem/posting: pub=${(pub ?? 'ERR').slice(0, 14)}… · סמכות-חיה=${matched ? 'MATCH ✓' : 'NO ✖'}`);
        if (matched && pub) decisions.push({ env: 'STEEM_POSTING_WIF', wif, chain: 'steem', role: 'posting', pub });
      }
    }
  }

  // ── BLURT מה-vault-accounts הבלוע ──────────────────────────────────────────
  const vaultAccounts = ab['vault-accounts'];
  const blurtAuth = await liveAuth('https://rpc.blurt.blog', 'headcorner');
  if (!blurtAuth) {
    console.error('✖ blurt: אין-תשובת-סמכות-חיה — fail-closed, לא-מחמש');
  } else if (!vaultAccounts) {
    console.error('✖ blurt: vault-accounts לא-במעטפת');
  } else {
    const targetBodies = blurtAuth.active.map(pubBody);
    let found: { wif: string; pub: string } | null = null;
    const wifs = [...new Set(vaultAccounts.match(/\b[5KJL][1-9A-HJ-NP-Za-km-z]{50,51}\b/g) ?? [])];
    for (const w of wifs) {
      const nw = normalizeWif(w);
      if (!nw) continue;
      const pub = pubOfWif(nw, 'BLT');
      if (pub && targetBodies.includes(pubBody(pub))) { found = { wif: nw, pub }; break; }
    }
    if (found) {
      console.log(`[arm] blurt/active: pub=${found.pub.slice(0, 14)}… · סמכות-חיה=MATCH ✓`);
      decisions.push({ env: 'BLURT_ACTIVE_WIF', wif: found.wif, chain: 'blurt', role: 'active', pub: found.pub });
    } else {
      console.error('✖ blurt: אף-WIF-בכספת-לא-מאומת מול-הסמכות-החיה — המסילה-נשארת-כבויה');
    }
  }

  if (decisions.length === 0) { console.error('✖ אף-מסילה-לא-חומשה — לא-נגעתי ב-.env'); process.exit(3); }
  if (DRY) { console.log('[dry] החלטות-בלבד, לא-נכתב-כלום'); process.exit(0); }

  // ── כתיבת-.env (החלפת-שורות-קיימות, אפס-כפילויות) ────────────────────────
  let envTxt = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  for (const d of decisions) {
    const line = `${d.env}=${d.wif}`;
    const re = new RegExp(`^${d.env}=.*$`, 'm');
    envTxt = re.test(envTxt) ? envTxt.replace(re, line) : envTxt.replace(/\s*$/, '\n') + line + '\n';
  }
  if (!/SAOS_RELAY_SIGNING_SESSION_UNLOCKED=/.test(envTxt)) envTxt += 'SAOS_RELAY_SIGNING_SESSION_UNLOCKED=1\n';
  fs.writeFileSync(ENV_FILE, envTxt, { mode: 0o600 });
  fs.chmodSync(ENV_FILE, 0o600);
  for (const d of decisions) console.log(`[arm] ✓ נכתב ${d.env} (${d.chain}/${d.role}, pub=${d.pub.slice(0, 14)}…) — דרוש-ריסטארט-מנוע (watchdog-heal)`);
  console.log('[arm] מסילות-שנכתבו:', decisions.map(d => d.chain).join('+'));
}

await main();
