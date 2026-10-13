/**
 * rearm-hive-soldiers.ts — re-arm soldier HIVE role keys from agent/keys/vault.json
 * under the CURRENT SOVEREIGN_VAULT_SECRET.
 *
 * Truth basis (measured, Task 2-a audit): vault.json holds plaintext WIF material
 * whose hive pubs reproduce the LIVE on-chain authorities for 9 soldier accounts
 * (cashmachine, haran, israelnews, lsa, macrame, siq, wic, wog, woq × 4 roles).
 * Their vault rows exist but are cipher-sealed (encrypted under the lost-era
 * secret) — undecryptable today. This script re-ciphers the SAME material under
 * the CURRENT secret — but ONLY after a live authority match on-chain this run.
 * Corrects the worklog-74 claim that vault.json was "a skeleton": it is not.
 *
 * Safety rails (in order, all fail-closed):
 *  · LIVE authority match on hive this run (normalized OR raw form — R18 dual-form)
 *    → no match = row untouched (sealed stays sealed, honestly).
 *  · Fingerprint guard: sha256(plain)[:16] must equal the stored fingerprint
 *    → same material = safe re-cipher; different = REFUSED (rotation guard).
 *  · Self-verification: decryptSecret(newCipher) === plaintext roundtrip per row
 *    → any failure = nothing written for that row.
 *  · Zero key material on stdout — booleans / fingerprints / counts only.
 */
import fs from 'fs';
import { db } from '../src/lib/db';
import { encryptSecret, decryptSecret, fingerprint } from '../src/lib/vault';
import { wifToPublic, wifToPublicRaw, type Role } from '../src/lib/keys';
import { getAccount } from '../src/lib/chain';

// Task 13-c: canonical org key vault = steem/agent/keys (gitignored, 0600);
// the pre-reset /home/z/my-project/agent/keys died with the sandbox reset.
// Chain: env CC_KEYS_DIR → repo-local convention → canonical vault → legacy.
const SRC = process.env.CC_KEYS_DIR
  ? `${process.env.CC_KEYS_DIR}/vault.json`
  : ['agent/keys/vault.json', '/home/z/git-audit/steem/agent/keys/vault.json', '/home/z/my-project/agent/keys/vault.json'].find((p) => fs.existsSync(p))
    ?? 'agent/keys/vault.json';
const ROLES: Role[] = ['owner', 'active', 'posting', 'memo'];

interface VaultFleet { username: string; keys: Record<string, { wif: string; pub: string }> }

async function main(): Promise<void> {
  const raw = JSON.parse(fs.readFileSync(SRC, 'utf8')) as { accounts?: VaultFleet[] } | VaultFleet[];
  const accounts: VaultFleet[] = Array.isArray(raw) ? raw : (raw.accounts ?? []);
  console.log(`[rearm] source accounts: ${accounts.length} (headcorner intentionally skipped — re-armed in 74)`);

  let matched = 0, reciphered = 0, refused = 0, created = 0, noMatch = 0, roundtripFail = 0;

  for (const fleet of accounts) {
    if (!fleet?.username || !fleet.keys) continue;
    if (fleet.username === 'headcorner') continue;
    let acct: Awaited<ReturnType<typeof getAccount>> = null;
    try { acct = await getAccount('hive', fleet.username); } catch { acct = null; }
    if (!acct) { console.log(`[rearm] ${fleet.username}/hive: account not found / RPC fail this run — skip (fail-closed)`); continue; }

    for (const role of ROLES) {
      const mat = fleet.keys[role];
      if (!mat?.wif) continue;
      const chainPubs = (acct as unknown as Record<string, unknown>)[role];
      const arr: string[] = Array.isArray(chainPubs) ? chainPubs.map(String) : chainPubs ? [String(chainPubs)] : [];
      const pubN = wifToPublic(mat.wif);
      const pubR = wifToPublicRaw(mat.wif);
      const form = arr.includes(pubN) ? 'norm' : arr.includes(pubR) ? 'raw' : null;
      if (!form) { noMatch++; console.log(`[rearm] ${fleet.username}/hive/${role}: no authority match this run — untouched (honest)`); continue; }
      matched++;

      const existing = await db.vaultKey.findUnique({ where: { account_chain_role: { account: fleet.username, chain: 'hive', role } } });
      const fp = fingerprint(mat.wif);
      if (existing && existing.fingerprint !== fp) {
        refused++;
        console.log(`[rearm] ${fleet.username}/hive/${role}: fingerprint MISMATCH (db=${existing.fingerprint.slice(0, 8)}… src=${fp.slice(0, 8)}…) — REFUSED (rotation guard)`);
        continue;
      }

      const cipher = encryptSecret(mat.wif);
      let roundtrip = false;
      try { roundtrip = decryptSecret(cipher) === mat.wif; } catch { roundtrip = false; }
      if (!roundtrip) { roundtripFail++; console.log(`[rearm] ${fleet.username}/hive/${role}: roundtrip FAIL — nothing written`); continue; }

      const note = `LIVE (vault.json material) — authority match (${form} form) verified on-chain this run; re-ciphered under current secret`;
      if (!existing) {
        await db.vaultKey.create({
          data: { account: fleet.username, chain: 'hive', role, pubKey: form === 'raw' ? pubR : pubN, cipher, fingerprint: fp, verified: true, lastVerifiedAt: new Date(), source: 'rearm-hive-soldiers', note },
        });
        created++;
      } else {
        await db.vaultKey.update({
          where: { account_chain_role: { account: fleet.username, chain: 'hive', role } },
          data: { cipher, fingerprint: fp, verified: true, lastVerifiedAt: new Date(), lastError: null, source: 'rearm-hive-soldiers', note },
        });
      }
      reciphered++;
      console.log(`[rearm] ${fleet.username}/hive/${role}: RE-ARMED (authority ${form}-form match, fingerprint ${fp.slice(0, 8)}…, roundtrip OK)`);
    }
  }

  console.log(`[rearm] DONE matched=${matched} reciphered=${reciphered} (created=${created}) refused=${refused} noMatch=${noMatch} roundtripFail=${roundtripFail}`);
}

main().then(() => process.exit(0)).catch((e: unknown) => { console.error('[rearm] FATAL', e instanceof Error ? e.message : String(e)); process.exit(1); });
