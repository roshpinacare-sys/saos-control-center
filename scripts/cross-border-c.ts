// ═══ CROSS-THE-BORDER · שלב-ג: vault.json — המפתחות-החיים? ═══
// bun scripts/cross-border-c.ts
import crypto from 'crypto';
import { openRepoVault } from '../src/lib/repo-vault';
import steem from 'steem';

const MAGIC = 'SAOS-FLEET-VAULT-1';
console.log('═══ שלב-ג: vault.json + סריקת-כל-WIF-מול-הסמכויות-החיות ═══');
const { bundle } = openRepoVault();
import { decodeFleetEnc } from '../src/lib/fleet-keys-decode';
const ab = bundle.absorbed ?? {};
// T-64: פענוח-סובלני — ראה fleet-keys-decode.ts
const payload = decodeFleetEnc(String(ab['fleet-keys-enc'] ?? ab['fleet-keys-enc-a'] ?? ''));
const meta = JSON.parse(ab['fleet-keys-meta']) as { pass: string };
const key = crypto.scryptSync(meta.pass, payload.subarray(0, 16), 32);
const d = crypto.createDecipheriv('aes-256-gcm', key, payload.subarray(16, 28));
d.setAuthTag(payload.subarray(28, 44));
const fleet = JSON.parse(Buffer.concat([d.update(payload.subarray(44)), d.final()]).toString('utf8')) as { files: Record<string, string> };

// vault.json from fleet
const vaultJson = JSON.parse(fleetFiles('keys/vault.json')) as { accounts: Array<Record<string, unknown>> };
function fleetFiles(k: string): string { return fleet.files[k] ?? ab['vault-accounts'] ?? '{}'; }
void vaultJson;

const vaultAccounts = JSON.parse(fleet.files['keys/vault.json'] ?? ab['vault-accounts'] ?? '{"accounts":[]}') as { accounts: Array<Record<string, unknown>> };
console.log(`[C] vault.json accounts: ${vaultAccounts.accounts.length}`);

// collect WIFs + usernames
interface Cand { user: string; role: string; wif: string; source: string }
const cands: Cand[] = [];
for (const a of vaultAccounts.accounts) {
  const user = String(a.username ?? '?');
  const keys = (a.keys ?? {}) as Record<string, string>;
  const chains = (a.chains ?? {}) as Record<string, Record<string, string>>;
  for (const [role, wif] of Object.entries(keys)) {
    if (typeof wif === 'string' && wif.length >= 50) cands.push({ user, role, wif, source: 'keys' });
  }
  for (const [chn, roles] of Object.entries(chains)) {
    for (const [role, wif] of Object.entries(roles ?? {})) {
      if (typeof wif === 'string' && wif.length >= 50) cands.push({ user, role: `${chn}.${role}`, wif, source: 'chains' });
    }
  }
}
console.log(`[C] WIF candidates from vault.json: ${cands.length}`);
const byUser = new Map<string, number>();
for (const c of cands) byUser.set(c.user, (byUser.get(c.user) ?? 0) + 1);
for (const [u, n] of byUser) console.log(`[C]   · ${u}: ${n} keys`);

// live authorities per account
async function rpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return (await res.json()) as unknown;
}
async function acct(net: 'steem' | 'hive', name: string): Promise<Record<string, unknown> | null> {
  const url = net === 'steem' ? 'https://api.steemit.com' : 'https://api.hive.blog';
  const j = await rpc(url, 'condenser_api.get_accounts', [[name]]) as { result?: Array<Record<string, unknown>> };
  return j.result?.[0] ?? null;
}

let verified = 0;
const verifiedList: string[] = [];
for (const c of cands) {
  const chain = c.role.startsWith('hive.') ? 'hive' : 'steem';
  const role = c.role.replace('hive.', '').replace('steem.', '');
  const a = await acct(chain as 'steem' | 'hive', c.user).catch(() => null);
  if (!a) continue;
  const pubs: string[] = role === 'memo' ? [a.memo_key as string] : (((a[role] as { key_auths?: [string, number][] } | undefined)?.key_auths ?? []).map(([k]) => k));
  if (!pubs.length) continue;
  let pub = '';
  try {
    // steem-js wants the WIF raw; K/L WIFs are compressed (33-byte) — handle via scalar extraction
    const w = c.wif.trim();
    pub = steem.auth.wifToPublic(w);
  } catch {
    try {
      const raw2 = Buffer.from((() => { let n = 0n; for (const ch of c.wif) { const i = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'.indexOf(ch); n = n * 58n + BigInt(i); } return n.toString(16).padStart(66, '0'); })(), 'hex');
      void raw2;
      continue;
    } catch { continue; }
  }
  const hit = pubs.includes(pub);
  if (hit) { verified++; verifiedList.push(`${chain}/${c.user}/${role}`); console.log(`[C] ◀◀◀ VERIFIED ${chain}/${c.user}/${role} → ${pub.slice(0, 14)}…`); }
}
console.log(`[C] ═══ vault.json: ${verified} live-authority matches: ${verifiedList.join(', ')} ═══`);

// hcsoldier keys — live?
for (const nm of ['hcsoldier-4', 'hcsoldier-5', 'hcsoldier-6']) {
  if (!ab[nm]) continue;
  const j = JSON.parse(ab[nm]) as { name: string; keys: Record<string, string> };
  for (const [role, wif] of Object.entries(j.keys)) {
    if (!wif || wif.length < 50) continue;
    for (const chain of ['steem', 'hive'] as const) {
      const a = await acct(chain, j.name).catch(() => null);
      if (!a) break;
      const pubs: string[] = role === 'memo' ? [a.memo_key as string] : (((a[role] as { key_auths?: [string, number][] } | undefined)?.key_auths ?? []).map(([k]) => k));
      if (!pubs.length) break;
      try {
        const pub = steem.auth.wifToPublic(wif.trim());
        if (pubs.includes(pub)) console.log(`[C] ◀◀◀ VERIFIED ${nm} ${chain}/${role} → ${pub.slice(0, 14)}…`);
      } catch { /* skip */ }
    }
  }
}

// hed-soldiers-source: line-by-line WIF detection (any prefix)
const hed = fleet.files['keys/hed-soldiers-source.txt'] ?? ab['hed-soldiers-source'] ?? '';
const hedWifs = hed.split(/\r?\n/).map(l => l.trim()).filter(l => /^[569KL][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(l));
console.log(`[C] hed-soldiers-source base58-like lines: ${hedWifs.length}`);
for (const w of hedWifs.slice(0, 20)) {
  try { const pub = steem.auth.wifToPublic(w); console.log(`[C]   hed-WIF → ${pub}`); } catch { console.log('[C]   hed-WIF → not-secp'); }
}
