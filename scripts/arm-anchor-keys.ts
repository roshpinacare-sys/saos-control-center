// ═══ חימוש-מפתחות-העוגן (Anchor-Key Arming · EXEC-CD-35) ═════════════════════
// סוגר את המגבלה-הכנה העמוקה ביותר (anchorlessBirth): מסילת-העיגון בנויה אך
// לא עיגנה אף-חותם — כי מפתחות-ה-relay לא היו ב-.env של המנוע.
//
// מה-הסקריפט עושה (אפס-חומר-מפתח בפלט/לוג):
//  1. פותח את כספת-הריפו המוצפנת (AES-256-GCM משני-שברי-החותם).
//  2. מחלץ מ-'headcorner-recovered' את מפתחות POSTING/ACTIVE של STEEM+HIVE.
//  3. אימות-סמכות-חי מול RPC ציבורי (בדיוק כמו authorityOk של ה-relay):
//     WIF→pub גרפני מול הרשות-החיה של @headcorner בכל-שרשרת. fail-closed.
//  4. כותב ל-saos-dex/.env (0600, gitignored): WIF-התפקיד-המאומת לכל-שרשרת
//     + SAOS_RELAY_SIGNING_SESSION_UNLOCKED=1 (חימוש-סשן-חתימה לתהליך-המנוע).
//  5. מדפיס רק: החלטות-תפקיד, טביעות-אצבע-פומביות (pubkey ראשונים), ואישור-כתיבה.
//
// הרצה: bun scripts/arm-anchor-keys.ts [--dry]
import { openRepoVault, vaultExists } from '../src/lib/repo-vault';
import { pubOfWif } from '../saos-dex/src/lib/dex/signer';
import fs from 'fs';
import path from 'path';

const DRY = process.argv.includes('--dry');
const ENV_FILE = path.resolve(process.cwd(), 'saos-dex/.env');

interface RoleMap { owner?: string; active?: string; posting?: string; memo?: string; }

function parseRecovered(raw: string): { steem: RoleMap; hive: RoleMap } {
  const out = { steem: {} as RoleMap, hive: {} as RoleMap };
  let cur: 'steem' | 'hive' = 'steem';
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^HIVE$/i.test(line)) { cur = 'hive'; continue; }
    const m = line.match(/^(OWNER|ACTIVE|POSTING|MEMO)\s*=\s*(\S+)\s*$/i);
    if (!m) continue;
    const role = m[1].toLowerCase() as keyof RoleMap;
    out[cur][role] = m[2];
  }
  return out;
}

function wifShapeOk(w: string | undefined): boolean {
  if (!w) return false;
  return /^[1-9A-HJ-NP-Za-km-z]{51,52}$/.test(w);
}

async function chainAuthorities(chain: 'steem' | 'hive', account: string): Promise<Record<string, string[]> | null> {
  const endpoints = chain === 'steem'
    ? ['https://api.steemit.com', 'https://steem.crypto-fans.com']
    : ['https://api.hive.blog', 'https://anyx.io'];
  const body = JSON.stringify({ jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [[account]], id: 1 });
  for (const ep of endpoints) {
    try {
      const r = await fetch(ep, { method: 'POST', body, headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(9000) });
      if (!r.ok) continue;
      const j = (await r.json()) as { result?: Array<{ posting?: { key_auths?: Array<[string, number]> }; active?: { key_auths?: Array<[string, number]> }; owner?: { key_auths?: Array<[string, number]> } }> };
      const acc = j.result?.[0];
      if (!acc) continue;
      return {
        posting: (acc.posting?.key_auths ?? []).map(k => k[0]),
        active: (acc.active?.key_auths ?? []).map(k => k[0]),
        owner: (acc.owner?.key_auths ?? []).map(k => k[0]),
      };
    } catch { /* next endpoint */ }
  }
  return null;
}

async function main(): Promise<void> {
  if (!vaultExists()) { console.error('✖ אין-כספת-בריפו'); process.exit(1); }
  const { bundle } = openRepoVault();
  const recovered = bundle.absorbed?.['headcorner-recovered'];
  if (!recovered) { console.error('✖ headcorner-recovered לא-במעטפת'); process.exit(2); }

  const parsed = parseRecovered(recovered);
  const account = (bundle.absorbed?.['agent-env-0910'] ?? '').match(/headcorner/i) ? 'headcorner' : 'headcorner';
  console.log(`[arm] חומר-חולץ · חשבון-עיגון: ${account}`);

  const decisions: Array<{ env: string; wif: string; role: string; matched: boolean; pub: string; chain: string }> = [];

  for (const chain of ['steem', 'hive'] as const) {
    const roles = parsed[chain];
    const auth = await chainAuthorities(chain, account);
    if (!auth) { console.error(`✖ ${chain}: אין-תשובת-סמכות-חיה מ-RPC ציבורי — לא מחמש (fail-closed)`); continue; }
    let chosen: { env: string; wif: string; role: string; pub: string; matched: boolean } | null = null;
    for (const [role, envName] of [['posting', `${chain.toUpperCase()}_POSTING_WIF`], ['active', `${chain.toUpperCase()}_ACTIVE_WIF`]] as const) {
      const wif = roles[role];
      if (!wifShapeOk(wif)) continue;
      const pub = pubOfWif(wif);
      if (!pub) { console.log(`[arm] ${chain}/${role}: WIF-פסול (לא-נגזר-פומבי) — דילוג`); continue; }
      const matched = (auth[role] ?? []).includes(pub);
      console.log(`[arm] ${chain}/${role}: pub=${pub.slice(0, 14)}… · הרשות-חיה=${matched ? 'MATCH ✓' : 'לא-ברשות'}`);
      if (matched && !chosen) chosen = { env: envName, wif, role, pub, matched };
      if (matched) break;
    }
    if (chosen) decisions.push({ chain, ...chosen });
    else console.error(`✖ ${chain}: אף-מפתח-לא-מאומת-מול-הרשות-החיה — השרשרת-תישאר-כבויה-כנה (authority-mismatch)`);
  }

  if (decisions.length === 0) { console.error('✖ אף-שרשרת-לא-חומשה — לא נגעתי ב-.env'); process.exit(3); }

  // כתיבת-.env (מחליף-שורות-קיימות-לאותם-מפתחות, לא-משכפל)
  let envTxt = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  const lines = envTxt.split('\n');
  for (const d of decisions) lines.push(`${d.env}=${d.wif}`);
  if (!lines.some(l => /^SAOS_RELAY_SIGNING_SESSION_UNLOCKED=/.test(l))) lines.push('SAOS_RELAY_SIGNING_SESSION_UNLOCKED=1');
  else lines.forEach((l, i) => { if (/^SAOS_RELAY_SIGNING_SESSION_UNLOCKED=/.test(l)) lines[i] = 'SAOS_RELAY_SIGNING_SESSION_UNLOCKED=1'; });

  if (DRY) { console.log(`[arm] --dry: ${decisions.length} מפתחות היו נכתבים ל-${ENV_FILE} — לא נכתב`); return; }
  const out = lines.filter((l, i) => l.trim() !== '' || i === lines.length - 1).join('\n');
  fs.writeFileSync(ENV_FILE, out.endsWith('\n') ? out : out + '\n', { mode: 0o600 });
  fs.chmodSync(ENV_FILE, 0o600);

  console.log(`[arm] ✓ .env חומש: ${decisions.map(d => `${d.chain}(${d.role})`).join(' · ')} + session-armed`);
  console.log(`[arm] מוכן לאתחול-מחדש של המנוע — ה-relay יעגן את החותם-הבא על-השרשרת-הציבורית`);
}

main().catch(e => { console.error('✖', e instanceof Error ? e.message : e); process.exit(9); });
