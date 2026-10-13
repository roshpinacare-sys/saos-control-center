/**
 * estate-unseal.ts — open the fleet estate bundle, use its era .env secret to
 * decrypt the DB vault seed rows, then run the full ROT1 truth sweep.
 * Zero secret output — booleans, counts, pubkeys only.
 */
import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import { db } from '../src/lib/db';
import { wifFromRot1Seed, wifToPublic, ROT1_ACCOUNTS, ROT1_ROLES } from '../src/lib/keys';

// Task 13-c: env override for the fleet-envelope dir; the repo-local gitignored
// agent/keys stays the default convention (created by reseal-fleet-vault.ts).
const KEYS_DIR = process.env.CC_KEYS_DIR || 'agent/keys';
const MAGIC = 'SAOS-FLEET-VAULT-1';

function openBundle(): { files: Record<string, string>; sealedAt?: string; count?: number } {
  const raw = fs.readFileSync(`${KEYS_DIR}/fleet_keys.enc`, 'utf8'); // Task 13-c: KEYS_DIR chain
  const payload = Buffer.from(raw.slice(MAGIC.length).replace(/\s+/g, ''), 'hex');
  const meta = JSON.parse(fs.readFileSync(`${KEYS_DIR}/fleet_keys.meta.json`, 'utf8'));
  const key = crypto.scryptSync(meta.pass, payload.subarray(0, 16), 32);
  const d = crypto.createDecipheriv('aes-256-gcm', key, payload.subarray(16, 28));
  d.setAuthTag(payload.subarray(28, 44));
  return JSON.parse(Buffer.concat([d.update(payload.subarray(44)), d.final()]).toString('utf8'));
}

function scryptKey(secret: string): Buffer {
  return crypto.scryptSync(secret, 'sovereign-vault-v1', 32);
}
function tryDecrypt(cipher: string, key: Buffer): string | null {
  const [ivH, tagH, ctH] = cipher.split(':');
  if (!ivH || !tagH || !ctH) return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivH, 'hex'));
    d.setAuthTag(Buffer.from(tagH, 'hex'));
    return Buffer.concat([d.update(Buffer.from(ctH, 'hex')), d.final()]).toString('utf8');
  } catch { return null; }
}

async function getAuths(net: 'steem' | 'hive', acct: string): Promise<Record<string, string[]>> {
  const url = net === 'steem' ? 'https://api.steemit.com' : 'https://api.hive.blog';
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'condenser_api.get_accounts', params: [[acct]] }),
  });
  const j = (await res.json()) as { result: Array<Record<string, unknown>> };
  const a = j.result?.[0];
  if (!a) throw new Error('missing');
  const out: Record<string, string[]> = {};
  for (const role of ['owner', 'active', 'posting'] as const) {
    out[role] = ((a[role] as { key_auths: [string, number][] }).key_auths).map(([k]) => k);
  }
  out.memo = [a.memo_key as string];
  return out;
}

async function main(): Promise<void> {
  const bundle = openBundle();
  console.log(`[estate] bundle opened: count=${bundle.count} sealedAt=${bundle.sealedAt}`);

  // candidate secrets: era .env from bundle, current .env, .vaultkey bytes (both disk & bundle)
  const eraEnv = bundle.files['.env'] ?? '';
  const eraSecret = (eraEnv.match(/^SOVEREIGN_VAULT_SECRET=(.+)$/m)?.[1] ?? '').trim();
  const curSecret = (process.env.SOVEREIGN_VAULT_SECRET ?? '').trim();
  const bundleVaultkey = bundle.files['keys/.vaultkey'] ?? '';
  const diskVaultkey = fs.existsSync(`${KEYS_DIR}/.vaultkey`) ? fs.readFileSync(`${KEYS_DIR}/.vaultkey`, 'utf8').trim() : '';
  console.log(`[estate] era .env present: ${eraEnv.length > 0}, has VAULT_SECRET: ${eraSecret.length >= 32}`);
  console.log(`[estate] era secret == current secret: ${eraSecret.length > 0 && eraSecret === curSecret}`);
  console.log(`[estate] bundle .vaultkey == disk .vaultkey: ${bundleVaultkey === diskVaultkey && bundleVaultkey.length > 0}`);

  const keyCands: Record<string, Buffer> = {};
  if (eraSecret) keyCands['eraEnv'] = scryptKey(eraSecret);
  if (curSecret) keyCands['currentEnv'] = scryptKey(curSecret);
  for (const [nm, raw] of [['bundleVaultkey', bundleVaultkey], ['diskVaultkey', diskVaultkey]] as const) {
    if (!raw) continue;
    try { keyCands[nm + 'Direct'] = Buffer.from(raw, 'base64'); } catch { /* no */ }
  }

  // probe: the ROT1 seed row
  const seedRow = await db.vaultKey.findFirst({ where: { chain: 'seed', account: 'saos-rot1' } });
  if (!seedRow?.cipher) throw new Error('seed row missing');
  let openedWith: string | null = null;
  let seedPlain: string | null = null;
  for (const [nm, key] of Object.entries(keyCands)) {
    const pt = tryDecrypt(seedRow.cipher, key);
    if (pt) { openedWith = nm; seedPlain = pt; break; }
  }
  console.log(`[estate] ROT1 seed row decrypts with: ${openedWith ?? 'NONE of ' + Object.keys(keyCands).join(',')}`);

  // also probe a random hive posting row to see if the whole era matches
  const probe = await db.vaultKey.findFirst({ where: { chain: 'hive', role: 'posting' } });
  if (probe?.cipher && openedWith) {
    console.log(`[estate] hive posting row decrypts with ${openedWith}: ${!!tryDecrypt(probe.cipher, keyCands[openedWith])}`);
  }

  if (!seedPlain) { console.log('[estate] cannot proceed to sweep — no seed'); process.exit(1); }
  const seedHex = seedPlain.trim();
  if (!/^[0-9a-f]{64}$/i.test(seedHex)) { console.log(`[estate] seed is not 64-hex (len ${seedHex.length}) — checking still`); }

  // full truth sweep with derived keys
  const authCache = new Map<string, Record<string, string[]>>();
  let controlled = 0, total = 0;
  const staleDetail: string[] = [];
  console.log('\n=== ROT1 TRUTH SWEEP (derived from vault seed) ===');
  for (const acct of ROT1_ACCOUNTS) {
    const cells: string[] = [];
    for (const chain of ['steem', 'hive'] as const) {
      const ck = acct + ':' + chain;
      let auths: Record<string, string[]>;
      try { auths = authCache.get(ck) ?? (await getAuths(chain, acct)); } catch { cells.push(chain + ':NO-ACCT'); continue; }
      authCache.set(ck, auths);
      for (const role of ROT1_ROLES) {
        total++;
        const pub = wifToPublic(wifFromRot1Seed(seedHex, acct, chain, role));
        if ((auths[role] ?? []).includes(pub)) controlled++;
        else staleDetail.push(`${acct}/${chain}/${role}`);
        cells.push((auths[role] ?? []).includes(pub) ? role.slice(0, 2).toUpperCase() : '·');
      }
    }
    console.log(acct.padEnd(12) + ' steem ' + cells.slice(0, 4).join('') + '  hive ' + cells.slice(4, 8).join(''));
  }
  console.log(`\nSWEEP: ${controlled}/${total} authorities controlled via ROT1 seed`);
  if (staleDetail.length) console.log('stale: ' + staleDetail.join(', '));
  process.exit(0);
}
main().catch(e => { console.error('[estate] FAILED: ' + String(e).slice(0, 200)); process.exit(1); });
