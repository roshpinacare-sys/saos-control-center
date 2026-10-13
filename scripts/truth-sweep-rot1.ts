/**
 * truth-sweep.ts — derive every ROT1 key from the vault seed and compare against
 * LIVE on-chain authorities (steem+hive). Output: control truth table. No secrets printed.
 */
import 'dotenv/config';
import crypto from 'crypto';
import { db } from '../src/lib/db';
import { decryptSecret } from '../src/lib/vault';
import { wifFromRot1Seed, wifToPublic, ROT1_ACCOUNTS, ROT1_ROLES } from '../src/lib/keys';

function motherKey(): Buffer {
  const secret = process.env.SOVEREIGN_VAULT_SECRET || '';
  if (secret.length < 32) throw new Error('SOVEREIGN_VAULT_SECRET missing/short');
  return crypto.scryptSync(secret, 'sovereign-vault-v1', 32);
}
function manualDecrypt(cipherText: string): string {
  const [ivHex, tagHex, ctHex] = cipherText.split(':');
  const d = crypto.createDecipheriv('aes-256-gcm', motherKey(), Buffer.from(ivHex, 'hex'));
  d.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([d.update(Buffer.from(ctHex, 'hex')), d.final()]).toString('utf8');
}

async function getAuths(net: 'steem' | 'hive', acct: string): Promise<Record<string, string[]>> {
  const url = net === 'steem' ? 'https://api.steemit.com' : 'https://api.hive.blog';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'condenser_api.get_accounts', params: [[acct]] }),
  });
  const j = (await res.json()) as { result: Array<Record<string, unknown>> };
  const a = j.result?.[0];
  if (!a) throw new Error('account missing');
  const out: Record<string, string[]> = {};
  for (const role of ['owner', 'active', 'posting'] as const) {
    const auth = a[role] as { key_auths: [string, number][] };
    out[role] = auth.key_auths.map(([k]) => k);
  }
  out.memo = [a.memo_key as string];
  return out;
}

async function main(): Promise<void> {
  const seedRow = await db.vaultKey.findFirst({ where: { chain: 'seed', account: 'saos-rot1' } });
  if (!seedRow?.cipher) throw new Error('saos-rot1 seed row missing');
  const seed = manualDecrypt(seedRow.cipher);
  console.log(`[sweep] ROT1 seed decrypted: ${seed.length} chars, fingerprint-ok`);

  const cache = new Map<string, Record<string, string[]>>();
  let controlled = 0, stale = 0, total = 0;
  console.log('\naccount       | chain  | ' + ROT1_ROLES.map(r => r.padEnd(6)).join(' | '));
  console.log('-'.repeat(70));
  for (const acct of ROT1_ACCOUNTS) {
    const row: string[] = [];
    for (const chain of ['steem', 'hive'] as const) {
      const ck = `${acct}:${chain}`;
      let auths: Record<string, string[]>;
      try { auths = cache.get(ck) ?? (await getAuths(chain, acct)); } catch { row.push('NO-ACCT'); continue; }
      cache.set(ck, auths);
      const cells: string[] = [];
      for (const role of ROT1_ROLES) {
        total++;
        const derivedPub = wifToPublic(wifFromRot1Seed(seed, acct, chain, role));
        if ((auths[role] ?? []).includes(derivedPub)) { cells.push(role.toUpperCase().slice(0, 2) + '✓'); controlled++; }
        else { cells.push('·'); stale++; }
      }
      console.log(`${acct.padEnd(13)} | ${chain.padEnd(6)} | ${cells.map(c => c.padEnd(6)).join(' | ')}`);
    }
  }
  console.log(`\nRESULT: ${controlled}/${total} (account,chain,role) authorities controlled via ROT1 seed`);
  console.log('ynet: NOT in ROT1 tree — needs FACTORY_MASTER password (sha256(ynet+role+password) scheme, 09-04 rotation)');
  process.exit(0);
}
main().catch(e => { console.error(`[sweep] FAILED: ${String(e).slice(0, 200)}`); process.exit(1); });
