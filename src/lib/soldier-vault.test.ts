// ═══ soldier-vault tests — the G77-a soldier key vault law (TDD, red→green) ═══
// Mission saos-0004 (owner NEXT MASTER DIRECTIVE §1): every soldier private key is
// DERIVED (real secp256k1), AES-256-GCM SEALED, secured locally (0600/0700),
// zero plaintext exposure, deny-by-default. NO key material may ever appear in
// this repo or in any printed output.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as nodeCrypto from 'node:crypto';
import {
  generateKeypair,
  pubFromScalar,
  wifFromScalar,
  scalarFromWif,
  wifToGraphenePub,
  sealSecret,
  openSecret,
  fingerprint12,
  buildSoldierVaultDoc,
  assertVaultLayout,
  SoldierVaultError,
  GRAPHENE_VECTOR_SCALAR1_PUB,
  ROLES,
} from './soldier-vault';

const WORK = mkdtempSync(join(tmpdir(), 'soldier-vault-'));
afterAll(() => {
  try { rmSync(WORK, { recursive: true, force: true }); } catch { /* best effort */ }
});

// deterministic 32-byte scalars for pinned tests (never real custody material)
const SCALAR1 = Buffer.alloc(32, 0); SCALAR1[31] = 1;
const detRng = (): (() => Buffer) => {
  let i = 0;
  return (n: number) => {
    i += 1;
    const b = Buffer.alloc(n);
    b.writeUInt32BE(i, Math.max(0, n - 4));
    for (let k = 0; k < n - 4; k++) b[k] = (k * 7 + i * 31) % 256;
    return b;
  };
};

describe('soldier-vault: secp256k1 derivation law (proven vs steem-js 0.7.10 canonical vectors)', () => {
  test('scalar 1·G is the pinned graphene pub (STM + base58(point33‖ripemd160(point33)[:4]))', () => {
    expect(pubFromScalar(SCALAR1)).toBe(GRAPHENE_VECTOR_SCALAR1_PUB);
    expect(GRAPHENE_VECTOR_SCALAR1_PUB.startsWith('STM')).toBe(true);
  });

  test('scalar 2G/3G match the SEC2 reference x-coordinates', () => {
    const two = Buffer.alloc(32, 0); two[31] = 2;
    const three = Buffer.alloc(32, 0); three[31] = 3;
    // known secp256k1 vectors (graphene ripemd160(point)[:4] envelope)
    expect(pubFromScalar(two)).toBe('STM' + b58Gph(B58POINT2));
    expect(pubFromScalar(three)).toBe('STM' + b58Gph(B58POINT3));
  });

  test('WIF roundtrip: canonical uncompressed 5K envelope (0x80‖key32, sha256d checksum)', () => {
    const wif1 = wifFromScalar(SCALAR1);
    // canonical, widely published WIF for scalar 1
    expect(wif1).toBe('5HpHagT65TZzG1PH3CSu63k8DbpvD8s5ip4nEB3kEsreAnchuDf');
    expect(scalarFromWif(wif1)!.equals(SCALAR1)).toBe(true);
    expect(wifToGraphenePub(wif1)).toBe(GRAPHENE_VECTOR_SCALAR1_PUB);
  });

  test('generateKeypair with injected rng is deterministic and law-conformant', () => {
    const a = generateKeypair(detRng());
    const b = generateKeypair(detRng());
    expect(a.wif).toBe(b.wif);
    expect(a.pub).toBe(b.pub);
    expect(a.wif.startsWith('5')).toBe(true); // canonical uncompressed form
    expect(a.pub.startsWith('STM')).toBe(true);
    // the derived pub must equal the law derivation of the wif
    expect(wifToGraphenePub(a.wif)).toBe(a.pub);
  });

  test('zero / ≥N scalars are refused (fail-closed key generation)', () => {
    let calls = 0;
    const zeroRng = () => { calls += 1; return Buffer.alloc(32); };
    expect(() => generateKeypair(zeroRng)).toThrow(/KEYGEN_EXHAUSTED/);
    expect(calls).toBe(8); // bounded — no infinite loop on a degenerate rng
  });
});

describe('soldier-vault: AES-256-GCM seal law (scrypt master key, repo iv:tag:ct envelope)', () => {
  const master = Buffer.alloc(32, 0xab);

  test('seal→open roundtrip (memory only, never persisted plaintext)', () => {
    const wif = wifFromScalar(SCALAR1);
    const sealed = sealSecret(wif, master);
    // envelope shape iv:tag:ct hex — the repo vault.ts law
    expect(sealed).toMatch(/^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
    expect(openSecret(sealed, master)).toBe(wif);
  });

  test('tamper with ciphertext → GCM auth failure (fail-closed, never plaintext)', () => {
    const sealed = sealSecret('secret-payload', master);
    const [iv, tag, ct] = sealed.split(':');
    const badCt = (Buffer.from(ct, 'hex')[0] ^ 0xff).toString(16).padStart(2, '0') + ct.slice(2);
    expect(() => openSecret(`${iv}:${tag}:${badCt}`, master)).toThrow(SoldierVaultError);
    const badTag = (Buffer.from(tag, 'hex')[0] ^ 0xff).toString(16).padStart(2, '0') + tag.slice(2);
    expect(() => openSecret(`${iv}:${badTag}:${ct}`, master)).toThrow(SoldierVaultError);
    expect(() => openSecret(sealed, Buffer.alloc(32, 0xcd))).toThrow(SoldierVaultError);
  });

  test('master key must be ≥32 bytes (fail-closed, no empty-key scrypt)', () => {
    expect(() => sealSecret('x', Buffer.alloc(16))).toThrow(SoldierVaultError);
    expect(() => openSecret('00:00:00', Buffer.alloc(8))).toThrow(SoldierVaultError);
  });

  test('same plaintext seals to different envelopes (fresh IV per seal)', () => {
    expect(sealSecret('same', master)).not.toBe(sealSecret('same', master));
  });
});

describe('soldier-vault: doc schema + fingerprint law', () => {
  const master = Buffer.alloc(32, 0x11);

  test('buildSoldierVaultDoc: pubs visible, WIFs sealed, fingerprints only, status carried', () => {
    const keyset = {
      owner: generateKeypair(detRng()),
      active: generateKeypair(detRng()),
      posting: generateKeypair(detRng()),
      memo: generateKeypair(detRng()),
    };
    const doc = buildSoldierVaultDoc({
      account: 'saos-0004', chain: 'steem', keyset, masterKey: master,
      createdAt: '2026-10-26T15:00:00.000Z', status: 'PROVISIONED-PENDING-CHAIN-ANCHOR',
      derivationLaw: 'secp256k1·G / base58(point33‖ripemd160(point33)[:4]) / WIF 0x80‖key32 sha256d',
    });
    expect(doc.schema).toBe('saos.soldier-vault/1');
    expect(Object.keys(doc.keyset).sort()).toEqual([...ROLES].sort());
    for (const role of ROLES) {
      const entry = doc.keyset[role];
      expect(entry.pub.startsWith('STM')).toBe(true);
      expect(entry.sealed).toMatch(/^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
      expect(entry.fingerprint).toMatch(/^[0-9a-f]{12}$/);
      // sealed envelope must NOT contain the plaintext WIF (zero-plaintext law)
      expect(entry.sealed.includes(keyset[role].wif)).toBe(false);
      expect(entry.fingerprint).toBe(fingerprint12(keyset[role].wif));
    }
    // the doc must not carry any plaintext key material anywhere
    const flat = JSON.stringify(doc);
    for (const role of ROLES) expect(flat.includes(keyset[role].wif)).toBe(false);
    expect(doc.status).toBe('PROVISIONED-PENDING-CHAIN-ANCHOR');
    expect(doc.account).toBe('saos-0004');
  });

  test('fingerprint12 is sha256-first-12 and stable', () => {
    expect(fingerprint12('abc')).toMatch(/^[0-9a-f]{12}$/);
    expect(fingerprint12('abc')).toBe(fingerprint12('abc'));
  });
});

describe('soldier-vault: deny-by-default file law (0600 files / 0700 dirs, fail-closed loader)', () => {
  const master = Buffer.alloc(32, 0x22);
  const keyset = {
    owner: generateKeypair(detRng()),
    active: generateKeypair(detRng()),
    posting: generateKeypair(detRng()),
    memo: generateKeypair(detRng()),
  };
  const doc = buildSoldierVaultDoc({
    account: 'saos-0004', chain: 'steem', keyset, masterKey: master,
    createdAt: '2026-10-26T15:00:00.000Z', status: 'PROVISIONED-PENDING-CHAIN-ANCHOR',
    derivationLaw: 'test-law',
  });

  test('layout law: 0600 vault + 0600 master + 0700 dir passes', () => {
    const dir = join(WORK, 'ok');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const vaultPath = join(dir, 'soldier-vault.json');
    const masterPath = join(dir, 'soldier-vault.master.key');
    writeFileSync(vaultPath, JSON.stringify(doc), { mode: 0o600 });
    writeFileSync(masterPath, master, { mode: 0o600 });
    expect(() => assertVaultLayout(vaultPath, masterPath)).not.toThrow();
    // bytes on disk carry no plaintext
    const bytes = readFileSync(vaultPath, 'utf8');
    for (const role of ROLES) expect(bytes.includes(keyset[role].wif)).toBe(false);
  });

  test('vault file 0644 → REFUSED (deny-by-default)', () => {
    const dir = join(WORK, 'loose');
    mkdirSync(dir, { recursive: true });
    const vaultPath = join(dir, 'soldier-vault.json');
    const masterPath = join(dir, 'master.key');
    writeFileSync(vaultPath, JSON.stringify(doc), { mode: 0o644 });
    writeFileSync(masterPath, master, { mode: 0o600 });
    try {
      expect(() => assertVaultLayout(vaultPath, masterPath)).toThrow(/0600/);
      expect(() => assertVaultLayout(vaultPath, masterPath)).toThrow(SoldierVaultError);
    } finally { chmodSyncSafe(vaultPath, 0o600); }
  });

  test('master key file 0664 → REFUSED', () => {
    const dir = join(WORK, 'loose-master');
    mkdirSync(dir, { recursive: true });
    const vaultPath = join(dir, 'soldier-vault.json');
    const masterPath = join(dir, 'master.key');
    writeFileSync(vaultPath, JSON.stringify(doc), { mode: 0o600 });
    writeFileSync(masterPath, master, { mode: 0o664 });
    try {
      expect(() => assertVaultLayout(vaultPath, masterPath)).toThrow(/0600/);
    } finally { chmodSyncSafe(masterPath, 0o600); }
  });

  test('vault dir 0755 → REFUSED (0700 required)', () => {
    const dir = join(WORK, 'loose-dir');
    mkdirSync(dir, { recursive: true, mode: 0o755 });
    const vaultPath = join(dir, 'soldier-vault.json');
    const masterPath = join(dir, 'master.key');
    writeFileSync(vaultPath, JSON.stringify(doc), { mode: 0o600 });
    writeFileSync(masterPath, master, { mode: 0o600 });
    try {
      expect(() => assertVaultLayout(vaultPath, masterPath)).toThrow(/0700/);
    } finally { chmodSyncSafe(dir, 0o700); }
  });

  test('master key <32 bytes on disk → REFUSED', () => {
    const dir = join(WORK, 'short-master');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const vaultPath = join(dir, 'soldier-vault.json');
    const masterPath = join(dir, 'master.key');
    writeFileSync(vaultPath, JSON.stringify(doc), { mode: 0o600 });
    writeFileSync(masterPath, Buffer.alloc(16), { mode: 0o600 });
    expect(() => assertVaultLayout(vaultPath, masterPath)).toThrow(/32/);
  });

  test('schema mismatch → REFUSED (soldier-vault/1 only)', () => {
    const dir = join(WORK, 'badschema');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const vaultPath = join(dir, 'soldier-vault.json');
    const masterPath = join(dir, 'master.key');
    writeFileSync(vaultPath, JSON.stringify({ ...doc, schema: 'other/9' }), { mode: 0o600 });
    writeFileSync(masterPath, master, { mode: 0o600 });
    expect(() => assertVaultLayout(vaultPath, masterPath)).toThrow(/schema/i);
  });
});

// ── helpers ──
function chmodSyncSafe(p: string, mode: number): void { try { chmodSync(p, mode); } catch { /* umask */ } }
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58Full(full: Buffer): string {
  let num = 0n; for (const byte of full) num = num * 256n + BigInt(byte);
  let out = '';
  while (num > 0n) { out = B58[Number(num % 58n)] + out; num /= 58n; }
  let pad = 0; while (full[pad] === 0) { out = '1' + out; pad++; }
  return out;
}
function b58Gph(buf: Buffer): string {
  // graphene pub envelope: base58(data ‖ ripemd160(data)[:4]) — measured law
  const chk = nodeCrypto.createHash('ripemd160').update(buf).digest().subarray(0, 4);
  return b58Full(Buffer.concat([buf, chk]));
}
// SEC2 reference: compressed points for 2G and 3G (x||y parity)
const B58POINT2 = Buffer.concat([
  Buffer.from([0x02]), // y(2G)=…2A → even parity
  Buffer.from('c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5', 'hex'),
]);
const B58POINT3 = Buffer.concat([
  Buffer.from([0x02]), // y(3G)=…72 → even parity
  Buffer.from('f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9', 'hex'),
]);
