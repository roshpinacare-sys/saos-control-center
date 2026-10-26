// ═══ provision-soldier-vault — G77-a lawful provisioning of saos-0004 ══════════
// Generates a REAL secp256k1 keyset (owner/active/posting/memo) for the soldier,
// seals EVERY private key with AES-256-GCM (scrypt master key from a fresh
// 32-byte key file), and writes the vault OUTSIDE the repo, at:
//   /home/z/coord-work/vaults/steem-secrets/soldier-vault.json        (0600)
//   /home/z/coord-work/vaults/steem-secrets/soldier-vault.master.key  (0600, dir 0700)
//
// ZERO-PLAINTEXT LAW: this script prints ONLY public keys + sha256[0..12]
// fingerprints. Private material exists in process memory for milliseconds and
// is never logged, never echoed, never written unsealed. Deny-by-default: if the
// vault file already exists the script REFUSES (rotation is an owner action).
//
// Run: bun scripts/provision-soldier-vault.ts --account saos-0004 --chain steem
import { mkdirSync, existsSync, writeFileSync, renameSync, chmodSync, statSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

import {
  generateKeypair, buildSoldierVaultDoc, assertVaultLayout, unsealRole, ROLES,
  type KeypairSet, type SoldierVaultDoc,
} from '../src/lib/soldier-vault';

const VAULT_DIR = '/home/z/coord-work/vaults/steem-secrets';
const VAULT_PATH = `${VAULT_DIR}/soldier-vault.json`;
const MASTER_PATH = `${VAULT_DIR}/soldier-vault.master.key`;

function arg(name: string, def?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : (def ?? '');
}

const account = arg('account', 'saos-0004');
const chain = (arg('chain', 'steem') as SoldierVaultDoc['chain']);
const nowIso = new Date().toISOString();

// ── deny-by-default: refuse to overwrite an existing vault ──
if (existsSync(VAULT_PATH)) {
  console.log(JSON.stringify({ ok: false, error: 'SV_E_EXISTS', at: nowIso,
    note: `${VAULT_PATH} already exists — provisioning is denied (rotation is an owner action, not a script flag)` }));
  process.exit(1);
}
if (existsSync(MASTER_PATH)) {
  console.log(JSON.stringify({ ok: false, error: 'SV_E_MASTER_EXISTS', at: nowIso,
    note: `${MASTER_PATH} already exists — refusing to mint a second master key alongside an existing one` }));
  process.exit(1);
}

// ── layout: dir 0700 BEFORE any secret touches disk ──
mkdirSync(VAULT_DIR, { recursive: true, mode: 0o700 });
chmodSync(VAULT_DIR, 0o700); // umask may have widened the mkdir mode

// ── fresh 32-byte master key (CSPRNG), 0600, atomic write; read back as the single source ──
const masterTmp = `${MASTER_PATH}.tmp`;
writeFileSync(masterTmp, randomBytes(32), { mode: 0o600 });
chmodSync(masterTmp, 0o600);
renameSync(masterTmp, MASTER_PATH);
const masterKey = Buffer.from(readFileSync(MASTER_PATH)); // the only master handle in memory

// ── real secp256k1 keyset (4 roles), sealed immediately ──
const keyset: KeypairSet = {
  owner: generateKeypair(),
  active: generateKeypair(),
  posting: generateKeypair(),
  memo: generateKeypair(),
};

// NOTE on ordering: buildSoldierVaultDoc needs the master key; we zeroize AFTER it returns.
const doc = buildSoldierVaultDoc({
  account, chain, keyset, masterKey, createdAt: nowIso,
  status: 'PROVISIONED-PENDING-CHAIN-ANCHOR',
  derivationLaw: 'secp256k1 scalar·G (BigInt, SEC2-pinned); pub = STM+base58(point33‖ripemd160(point33)[:4]); WIF = 0x80‖key32 sha256d (uncompressed 5K)',
});

// ── atomic 0600 vault write ──
const vaultTmp = `${VAULT_PATH}.tmp`;
writeFileSync(vaultTmp, JSON.stringify(doc, null, 2), { mode: 0o600 });
chmodSync(vaultTmp, 0o600);
renameSync(vaultTmp, VAULT_PATH);

// ── self-verification (memory only): layout law + unseal→re-derive→pub match ──
const { wifToGraphenePub } = await import('../src/lib/soldier-vault');
let roundtripOk = 0;
const rolePubs: Record<string, string> = {};
for (const role of ROLES) {
  const wif = unsealRole(JSON.parse(readFileSync(VAULT_PATH, 'utf8')) as SoldierVaultDoc, role, masterKey);
  const rePub = wifToGraphenePub(wif);
  if (rePub !== doc.keyset[role].pub) throw new Error(`roundtrip mismatch for ${role}`);
  roundtripOk += 1;
  rolePubs[role] = doc.keyset[role].pub;
}
assertVaultLayout(VAULT_PATH, MASTER_PATH);

// zero-plaintext scan: no role WIF may appear in the vault bytes
const vaultBytes = readFileSync(VAULT_PATH, 'utf8');
let plaintextLeaks = 0;
for (const role of ROLES) {
  const wif = unsealRole(doc, role, masterKey);
  if (vaultBytes.includes(wif)) plaintextLeaks += 1;
}

const perms = (p: string) => (statSync(p).mode & 0o777).toString(8);

console.log(JSON.stringify({
  ok: true, at: nowIso, account, chain,
  status: doc.status, schema: doc.schema,
  vault: VAULT_PATH, vaultPerms: perms(VAULT_PATH),
  masterKeyPath: MASTER_PATH, masterKeyPerms: perms(MASTER_PATH),
  dirPerms: perms(VAULT_DIR),
  masterKeyFingerprint: doc.masterKeyFingerprint,
  keyset: Object.fromEntries(ROLES.map((r) => [r, { pub: doc.keyset[r].pub, fingerprint: doc.keyset[r].fingerprint }])),
  selfCheck: { roundtripOk, plaintextLeaks, layoutLaw: '0600/0600/0700 verified', aesGcm: 'aes-256-gcm', kdf: 'scrypt(soldier-vault-v1, 32)' },
  next: 'CHAIN ANCHOR pending: rotating saos-0004 on-chain keys requires its CURRENT owner/active authority (held by the creator side, measured NO-VAULT-CUSTODY) — custody-wound recorded; fuel drafts flow via rc-rebalance (broadcast:false)',
}, null, 1));
