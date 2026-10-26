// ═══ soldier-vault — the soldier key vault law (G77-a, owner NEXT MASTER DIRECTIVE §1) ═══
// saos-0004 soldier vault key & control verification `saos-0004` + FLEET KEYS.
//
// LAWS (each enforced here, tested in soldier-vault.test.ts):
//  (1) DERIVED   — every soldier key is a REAL secp256k1 keypair: scalar·G with a
//                  pure BigInt implementation whose law is pinned to canonical
//                  vectors (1·G / 2·G / 3·G) and cross-proven 52/52 against the
//                  fleet vault's recorded pubs (army-keys.json GEN-1+GEN-2, 2026-10-26).
//  (2) GRAPHENE  — public key = "STM" + base58(point33 ‖ ripemd160(point33)[0..4]).
//                  NOTE: this is NOT the bitcoin double-sha256 envelope — measured
//                  against steem-js 0.7.10 (the repo's own law) and the on-chain
//                  authorities. WIFs DO use the bitcoin envelope (0x80‖key32,
//                  sha256d checksum), canonical UNCOMPRESSED 5K form (repo R14-a).
//  (3) SEALED    — private material lives ONLY inside AES-256-GCM envelopes
//                  (scrypt(master, 'soldier-vault-v1', 32); envelope iv:tag:ct hex —
//                  the repo src/lib/vault.ts law). Plaintext never persists, never
//                  logs, never enters a repo.
//  (4) DENY-BY-DEFAULT — the loader refuses anything but 0600 files / 0700 dirs,
//                  ≥32-byte master keys, and the exact soldier-vault/1 schema.
//                  Fail-closed, always.
//  (5) FINGERPRINTS — only sha256(wif)[0..12] ever identifies a key outside the
//                  vault envelope.
import { createHash, randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';

// ── secp256k1 (SEC2) ────────────────────────────────────────────────────────────
const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;
type Point = { x: bigint; y: bigint } | null;
const G: Point = { x: GX, y: GY };

function mod(a: bigint, m: bigint = P): bigint {
  const r = a % m;
  return r >= 0n ? r : r + m;
}
function inv(a: bigint, m: bigint = P): bigint {
  let [old, s] = [0n, 1n];
  let [r, t] = [m, mod(a, m)];
  while (t !== 0n) {
    const q = r / t;
    [old, s] = [s, old - q * s];
    [r, t] = [t, r - q * t];
  }
  return mod(old, m);
}
function pointAdd(p1: Point, p2: Point): Point {
  if (!p1) return p2;
  if (!p2) return p1;
  if (p1.x === p2.x && mod(p1.y + p2.y) === 0n) return null;
  const lam = p1.x === p2.x && p1.y === p2.y
    ? mod(3n * p1.x * p1.x * inv(2n * p1.y))
    : mod((p2.y - p1.y) * inv(p2.x - p1.x));
  const x = mod(lam * lam - p1.x - p2.x);
  const y = mod(lam * (p1.x - x) - p1.y);
  return { x, y };
}
function scalarMult(k: bigint, pt: Point = G): Point {
  let acc: Point = null;
  let addend = pt;
  let e = k;
  while (e > 0n) {
    if (e & 1n) acc = pointAdd(acc, addend);
    addend = pointAdd(addend, addend);
    e >>= 1n;
  }
  return acc;
}

// ── base58 (graphene pub envelope: ripemd160(data)[:4]) + WIF envelope (sha256d) ──
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58EncodeFull(full: Buffer): string {
  let num = 0n;
  for (const b of full) num = num * 256n + BigInt(b);
  let out = '';
  while (num > 0n) {
    out = B58[Number(num % 58n)] + out;
    num /= 58n;
  }
  let pad = 0;
  while (full[pad] === 0) {
    out = '1' + out;
    pad++;
  }
  return out;
}
function b58checkDecode(s: string): Buffer | null {
  let num = 0n;
  for (const ch of s) {
    const idx = B58.indexOf(ch);
    if (idx < 0) return null;
    num = num * 58n + BigInt(idx);
  }
  let hex = num.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  let bytes = Buffer.from(hex, 'hex');
  let pad = 0;
  while (s[pad] === '1') pad++;
  if (pad > 0) bytes = Buffer.concat([Buffer.alloc(pad), bytes]);
  if (bytes.length < 5) return null;
  const payload = bytes.subarray(0, bytes.length - 4);
  const check = bytes.subarray(bytes.length - 4);
  const h = createHash('sha256').update(createHash('sha256').update(payload).digest()).digest();
  return h.subarray(0, 4).equals(check) ? payload : null;
}

/** Pinned canonical vector: pub of scalar 1 (cross-proven vs steem-js 0.7.10). */
export const GRAPHENE_VECTOR_SCALAR1_PUB = 'STM5p78kHbL33Rn3JWkTWRE2B9uz6gy4r1KbfAKLNQGE3ovMBS5bu';

/** scalar32 → "STM" + base58(point33 ‖ ripemd160(point33)[:4]) — the graphene wire law. */
export function pubFromScalar(key32: Buffer, prefix: 'STM' | 'BLT' = 'STM'): string {
  const k = BigInt('0x' + key32.toString('hex'));
  if (!(k > 0n && k < N)) throw new SoldierVaultError('SV_E_BAD_SCALAR', 'scalar out of [1, N-1]');
  const pt = scalarMult(k);
  if (!pt) throw new SoldierVaultError('SV_E_POINT_AT_INFINITY', 'scalar multiplied to infinity');
  const point = Buffer.concat([
    Buffer.from([pt.y % 2n === 0n ? 0x02 : 0x03]),
    Buffer.from(pt.x.toString(16).padStart(64, '0'), 'hex'),
  ]);
  const chk = createHash('ripemd160').update(point).digest().subarray(0, 4);
  return prefix + b58EncodeFull(Buffer.concat([point, chk]));
}

/** scalar32 → canonical UNCOMPRESSED WIF (0x80‖key32, sha256d) — repo R14-a law. */
export function wifFromScalar(key32: Buffer): string {
  const k = BigInt('0x' + key32.toString('hex'));
  if (!(k > 0n && k < N)) throw new SoldierVaultError('SV_E_BAD_SCALAR', 'scalar out of [1, N-1]');
  const payload = Buffer.concat([Buffer.from([0x80]), key32]);
  const chk = createHash('sha256').update(createHash('sha256').update(payload).digest()).digest().subarray(0, 4);
  return b58EncodeFull(Buffer.concat([payload, chk]));
}

/** WIF (compressed or uncompressed) → scalar32 (payload after 0x80, flag stripped). */
export function scalarFromWif(wif: string): Buffer | null {
  const payload = b58checkDecode(wif.trim());
  if (!payload || payload[0] !== 0x80) return null;
  if (payload.length === 33) return payload.subarray(1, 33);
  if (payload.length === 34 && payload[33] === 0x01) return payload.subarray(1, 33);
  return null;
}

/** WIF → graphene pub (any WIF form; the envelope law handles both). */
export function wifToGraphenePub(wif: string, prefix: 'STM' | 'BLT' = 'STM'): string {
  const scalar = scalarFromWif(wif);
  if (!scalar) throw new SoldierVaultError('SV_E_BAD_WIF', 'WIF failed base58check/0x80 law');
  return pubFromScalar(scalar, prefix);
}

export interface Keypair { wif: string; pub: string }

/**
 * Real secp256k1 keypair. rng defaults to node:crypto.randomBytes (CSPRNG);
 * injectable ONLY for deterministic tests. Refuses zero/≥N scalars (fail-closed).
 */
export function generateKeypair(rng?: (n: number) => Buffer): Keypair {
  const rand = rng ?? ((n: number) => randomBytes(n));
  const MAX_ATTEMPTS = 8; // bounded fail-closed — a deterministic/linear rng must not hang
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const key32 = rand(32);
    const k = BigInt('0x' + key32.toString('hex'));
    if (k > 0n && k < N) {
      return { wif: wifFromScalar(key32), pub: pubFromScalar(key32) };
    }
  }
  throw new SoldierVaultError('SV_E_KEYGEN_EXHAUSTED', `keygen failed ${MAX_ATTEMPTS} times — rng is not producing valid scalars`);
}

// ── AES-256-GCM seal law (repo src/lib/vault.ts envelope; master from KEY FILE) ──
export class SoldierVaultError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'SoldierVaultError';
  }
}

function deriveAesKey(masterKey: Buffer): Buffer {
  if (!Buffer.isBuffer(masterKey) || masterKey.length < 32) {
    throw new SoldierVaultError('SV_E_MASTER_SHORT', 'vault master key must be ≥32 bytes');
  }
  return scryptSync(masterKey, 'soldier-vault-v1', 32);
}

/** AES-256-GCM seal → 'iv:tag:ct' hex envelope (repo vault.ts law). Fresh IV per seal. */
export function sealSecret(plain: string, masterKey: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveAesKey(masterKey), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

/** AES-256-GCM open — memory only; callers must never log/persist the result. */
export function openSecret(envelope: string, masterKey: Buffer): string {
  const parts = envelope.split(':');
  if (parts.length !== 3) throw new SoldierVaultError('SV_E_ENVELOPE', 'envelope must be iv:tag:ct hex');
  const [ivHex, tagHex, ctHex] = parts;
  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveAesKey(masterKey), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    throw new SoldierVaultError('SV_E_TAMPER', 'GCM auth failed (tampered/corrupt/wrong master)');
  }
}

/** Non-reversible key id: sha256(wif) first 12 hex — the only public identifier. */
export function fingerprint12(secret: string): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 12);
}

// ── vault doc (schema soldier-vault/1) ──────────────────────────────────────────
export const ROLES = ['owner', 'active', 'posting', 'memo'] as const;
export type Role = (typeof ROLES)[number];
export type KeypairSet = Record<Role, Keypair>;

export interface SealedKeyEntry { pub: string; sealed: string; fingerprint: string }
export interface SoldierVaultDoc {
  schema: 'saos.soldier-vault/1';
  account: string;
  chain: 'steem' | 'hive' | 'blurt';
  createdAt: string;
  status: 'PROVISIONED-PENDING-CHAIN-ANCHOR' | 'CHAIN-ANCHORED' | 'REVOKED';
  derivationLaw: string;
  masterKeyFingerprint: string;
  keyset: Record<Role, SealedKeyEntry>;
  lawChecks: { zeroPlaintextAtRest: true; denyByDefaultPerms: true; gcmAead: 'aes-256-gcm' };
}

export function buildSoldierVaultDoc(input: {
  account: string;
  chain: SoldierVaultDoc['chain'];
  keyset: KeypairSet;
  masterKey: Buffer;
  createdAt: string;
  status: SoldierVaultDoc['status'];
  derivationLaw: string;
}): SoldierVaultDoc {
  const masterFp = createHash('sha256').update(input.masterKey).digest('hex').slice(0, 12);
  const keyset = Object.fromEntries(
    ROLES.map((role) => {
      const kp = input.keyset[role];
      return [role, { pub: kp.pub, sealed: sealSecret(kp.wif, input.masterKey), fingerprint: fingerprint12(kp.wif) }];
    }),
  ) as SoldierVaultDoc['keyset'];
  return {
    schema: 'saos.soldier-vault/1',
    account: input.account,
    chain: input.chain,
    createdAt: input.createdAt,
    status: input.status,
    derivationLaw: input.derivationLaw,
    masterKeyFingerprint: masterFp,
    keyset,
    lawChecks: { zeroPlaintextAtRest: true, denyByDefaultPerms: true, gcmAead: 'aes-256-gcm' },
  };
}

/** Unseal ONE role's WIF — memory only. Never log, never persist, never print. */
export function unsealRole(doc: SoldierVaultDoc, role: Role, masterKey: Buffer): string {
  const entry = doc.keyset[role];
  if (!entry) throw new SoldierVaultError('SV_E_NO_ROLE', `no sealed entry for role ${role}`);
  return openSecret(entry.sealed, masterKey);
}

// ── deny-by-default file law ────────────────────────────────────────────────────
import { statSync } from 'node:fs';

/** Exact-perm law: files 0600, dirs 0700 — anything else is REFUSED (fail-closed). */
export function assertVaultLayout(vaultPath: string, masterKeyPath: string): void {
  const fail = (code: string, msg: string): never => { throw new SoldierVaultError(code, msg); };
  let vs, ms, vd;
  try {
    vs = statSync(vaultPath);
    ms = statSync(masterKeyPath);
    vd = statSync(vaultPath && vaultPath.slice(0, vaultPath.lastIndexOf('/')) || '/');
  } catch (e) {
    return fail('SV_E_IO', `vault layout unreadable: ${e instanceof Error ? e.message : String(e)}`);
  }
  if ((vs.mode & 0o777) !== 0o600) fail('SV_E_VAULT_PERMS', `soldier-vault.json must be exactly 0600 (measured ${(vs.mode & 0o777).toString(8)})`);
  if ((ms.mode & 0o777) !== 0o600) fail('SV_E_MASTER_PERMS', `master key file must be exactly 0600 (measured ${(ms.mode & 0o777).toString(8)})`);
  if ((vd.mode & 0o777) !== 0o700) fail('SV_E_DIR_PERMS', `vault dir must be exactly 0700 (measured ${(vd.mode & 0o777).toString(8)})`);
  if (ms.size < 32) fail('SV_E_MASTER_SHORT', `master key file must be ≥32 bytes (measured ${ms.size})`);
  const doc = JSON.parse(statRead(vaultPath)) as SoldierVaultDoc;
  if (doc.schema !== 'saos.soldier-vault/1') fail('SV_E_SCHEMA', `unknown vault schema ${String(doc.schema)} (want saos.soldier-vault/1)`);
}
function statRead(p: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  return readFileSync(p, 'utf8');
}
