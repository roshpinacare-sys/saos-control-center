// ═══ TDD — soldier custody vault verification (G77-a) ═══════════════════════
// DETERMINISTIC + SYNTHETIC ONLY: every key in this file is generated in-test
// from a random-ish fixed seed string. The REAL soldier/headcorner material is
// NEVER imported, read, or referenced here. Zero network (chainFetch injected).
/// <reference types="bun-types" />
import { describe, it, expect } from 'bun:test';
import { createHash, createHmac, createCipheriv, createDecipheriv, createECDH } from 'node:crypto';

import {
  SCHEMA_RECEIPT,
  SOLDIER_ROSTER,
  ROSTER_SOURCES,
  SOVEREIGN_HEAD,
  sha256Hex,
  fingerprintOf,
  b58Encode,
  b58Decode,
  b58checkEncode,
  b58checkDecode,
  scalarFromWif,
  pub33FromScalar,
  stmPubFromWif,
  isWifShape,
  deriveWifSteemJs,
  buildProbeCandidates,
  probeAccountAgainstChain,
  deriveWifRot1,
  blessDerivations,
  scanForPlaintextMaterial,
  sealGcmStore,
  openGcmStore,
  VaultAuthError,
  auditCustody,
  EXIT_GREEN,
  EXIT_WOUNDS,
  canonicalReceipt,
  wifFromScalar,
} from './verify-soldier-custody.mjs';

// ── synthetic key forge (self-generated test keys ONLY — never real ones) ──
const TEST_SEED = 'g77a-synthetic-seed-0123456789abcdef-do-not-use-in-prod';

/** deterministic synthetic scalar for (account, role) — test-only forge. */
function syntheticScalar(account: string, role: string): Buffer {
  return createHmac('sha256', TEST_SEED).update(`synthetic/${account}/${role}`).digest();
}

function syntheticWif(account: string, role: string): string {
  return wifFromScalar(syntheticScalar(account, role));
}

function syntheticPub(account: string, role: string): string {
  return stmPubFromWif(syntheticWif(account, role));
}

/** a fake chain account whose authorities carry exactly the synthetic pubs. */
function fakeChainAccount(account: string): Record<string, unknown> {
  return {
    name: account,
    created: '2026-10-25T17:50:54',
    recovery_account: 'headcorner',
    posting: { weight_threshold: 1, account_auths: [], key_auths: [[syntheticPub(account, 'posting'), 1]] },
    active: { weight_threshold: 1, account_auths: [], key_auths: [[syntheticPub(account, 'active'), 1]] },
    owner: { weight_threshold: 1, account_auths: [], key_auths: [[syntheticPub(account, 'owner'), 1]] },
    memo_key: syntheticPub(account, 'memo'),
  };
}

const TEST_MASTER = 'synthetic-vault-master-🧪-0123456789abcdef';

/** synthetic GCM vault holding every roster soldier's synthetic keys. */
function syntheticVault(accounts: string[]): string {
  const keys = accounts.flatMap((a) =>
    (['posting', 'active'] as const).map((role) => ({
      id: `${a}:${role}@steem`,
      wif: syntheticWif(a, role),
      meta: { account: a, role, chain: 'steem', derivation: 'synthetic-test-only' },
    })),
  );
  return sealGcmStore({ entries: keys, masterSecret: TEST_MASTER });
}

describe('crypto law · secp256k1 + base58 (pinned vectors)', () => {
  it('G·1 == G and G·2 == 2G (standard secp256k1 vectors, compressed)', () => {
    const one = Buffer.alloc(32); one[31] = 1;
    const two = Buffer.alloc(32); two[31] = 2;
    expect(pub33FromScalar(one).toString('hex').toUpperCase())
      .toBe('0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798');
    expect(pub33FromScalar(two).toString('hex').toUpperCase())
      .toBe('02C6047F9441ED7D6D3045406E95C07CD85C778E4B8CEF3CA7ABAC09B95C709EE5');
  });

  it('WIF roundtrip: b58check(0x80||scalar) → scalar (compression flag stripped)', () => {
    const wif = syntheticWif('probe-account', 'posting');
    expect(isWifShape(wif)).toBe(true);
    expect(scalarFromWif(wif).equals(syntheticScalar('probe-account', 'posting'))).toBe(true);
  });

  it('STM envelope: b58(pub33 || ripemd160(pub33)[0..4]) verifies on decode', () => {
    const pub = syntheticPub('probe-account', 'active');
    expect(pub.startsWith('STM')).toBe(true);
    const body = Buffer.from(b58Decode(pub.slice(3)));
    expect(body.length).toBe(37); // 33 pub + 4 checksum
    const pub33 = body.subarray(0, 33);
    const check = createHash('ripemd160').update(pub33).digest().subarray(0, 4);
    expect(body.subarray(33).equals(check)).toBe(true);
    // and the envelope pub really is the scalar's pub
    expect(body.subarray(0, 33).equals(pub33FromScalar(syntheticScalar('probe-account', 'active')))).toBe(true);
  });

  it('b58checkDecode rejects a tampered checksum (fail-closed)', () => {
    const wif = syntheticWif('probe-account', 'owner');
    const last = wif[wif.length - 1];
    const bad = wif.slice(0, -1) + (last === 'z' ? 'y' : 'z');
    expect(bad).not.toBe(wif);
    expect(b58checkDecode(bad)).toBeNull();
    const payload = b58checkDecode(wif)!;
    expect(payload[0]).toBe(0x80); // WIF version byte
    expect(payload.subarray(1, 33).equals(syntheticScalar('probe-account', 'owner'))).toBe(true);
  });
});

describe('derivation laws (deterministic, zero-dep mirrors of the in-repo laws)', () => {
  it('deriveWifSteemJs == sha256(account+role+master) WIF, deterministic', () => {
    const a = deriveWifSteemJs('syn-acct', 'posting', TEST_MASTER);
    const b = deriveWifSteemJs('syn-acct', 'posting', TEST_MASTER);
    expect(a).toBe(b);
    expect(isWifShape(a)).toBe(true);
    const expected = createHash('sha256').update('syn-acct' + 'posting' + TEST_MASTER).digest();
    expect(scalarFromWif(a).equals(expected)).toBe(true);
  });

  it('deriveWifRot1 == HMAC-SHA256(seed, SAOS-ROT1/account/chain/role) → 0x80||h||0x01 (keys.ts law)', () => {
    const seedHex = 'ab'.repeat(32);
    const wif = deriveWifRot1(seedHex, 'syn-acct', 'steem', 'posting');
    const h = createHmac('sha256', Buffer.from(seedHex, 'hex')).update('SAOS-ROT1/syn-acct/steem/posting').digest();
    const payload = Buffer.concat([Buffer.from([0x80]), h, Buffer.from([0x01])]);
    const check = createHash('sha256').update(createHash('sha256').update(payload).digest()).digest().subarray(0, 4);
    const wifExpected = b58Encode(Buffer.concat([payload, check])); // keys.ts: plain base58 over payload+check
    expect(wif).toBe(wifExpected);
    // compressed form decodes to the same scalar
    expect(scalarFromWif(wif).equals(h)).toBe(true);
  });
});

describe('GCM store law (AES-256-GCM, HKDF from the sovereign master)', () => {
  it('seal→open roundtrip restores every WIF; material never appears in the sealed text', () => {
    const wifs = [syntheticWif('a-one', 'posting'), syntheticWif('a-two', 'active')];
    const sealed = sealGcmStore({
      entries: wifs.map((wif, i) => ({ id: `e${i}`, wif, meta: { account: `a-${i + 1}` } })),
      masterSecret: TEST_MASTER,
    });
    for (const w of wifs) expect(sealed.includes(w)).toBe(false);
    const opened = openGcmStore(sealed, TEST_MASTER);
    expect(opened.entries.map((e: { wif: string }) => e.wif)).toEqual(wifs);
  });

  it('tampered authTag → VaultAuthError (fail-closed)', () => {
    const sealed = sealGcmStore({ entries: [{ id: 'x', wif: syntheticWif('x', 'posting'), meta: {} }], masterSecret: TEST_MASTER });
    const doc = JSON.parse(sealed);
    doc.verify.authTag = doc.verify.authTag.replace(/./, (c: string) => (c === '0' ? '1' : '0'));
    expect(() => openGcmStore(JSON.stringify(doc), TEST_MASTER)).toThrow(VaultAuthError);
  });

  it('wrong master → VaultAuthError (never a silent fallback)', () => {
    const sealed = sealGcmStore({ entries: [{ id: 'x', wif: syntheticWif('x', 'posting'), meta: {} }], masterSecret: TEST_MASTER });
    expect(() => openGcmStore(sealed, TEST_MASTER + '-wrong')).toThrow(VaultAuthError);
  });
});

describe('audit core · green path (synthetic vault + injected chain)', () => {
  it('every roster soldier VERIFIED → exit 0, receipt integrity valid, zero material', async () => {
    const roster = SOLDIER_ROSTER;
    const vaultText = syntheticVault(roster);
    const chainById = new Map(roster.map((a) => [a, fakeChainAccount(a)]));
    const { receipt, exitCode } = await auditCustody({
      roster,
      vaultFiles: [{ path: '/synthetic/army-keys.gcm.json', text: vaultText }],
      chainFetch: async (account: string) => chainById.get(account) ?? null,
      masterSecret: TEST_MASTER,
      nowIso: '2026-10-26T18:00:00.000Z',
    });
    expect(exitCode).toBe(EXIT_GREEN);
    expect(receipt.verdict).toBe('GREEN-CUSTODY');
    for (const row of receipt.soldiers) {
      expect(row.verdict).toBe('VERIFIED');
      expect(row.custody.encrypted).toBe(true);
    }
    // receipt integrity recomputes
    const core = { ...receipt } as Record<string, unknown>;
    delete core.integrity;
    expect(receipt.integrity.sha256).toBe(sha256Hex(canonicalReceipt(core)));
    // zero key material anywhere in the receipt
    expect(scanForPlaintextMaterial(JSON.stringify(receipt))).toEqual([]);
    // fingerprints are 12-hex and the chain fingerprints MATCH the vault ones
    for (const row of receipt.soldiers) {
      expect(row.chain.postingFp).toMatch(/^[0-9a-f]{12}$/);
      expect(row.custody.postingFp).toBe(row.chain.postingFp);
      expect(row.custody.activeFp).toBe(row.chain.activeFp);
    }
  });

  it('roster law: the measured soldier set + sources; headcorner is NOT a soldier', () => {
    expect(SOLDIER_ROSTER).toContain('saos-0004');
    expect(SOLDIER_ROSTER).not.toContain(SOVEREIGN_HEAD);
    expect(SOLDIER_ROSTER).toHaveLength(14); // 13 mesh soldiers + saos-0004
    const srcs = ROSTER_SOURCES.map((s: { source: string }) => s.source);
    expect(srcs.some((s: string) => s.includes('steem-mesh-bridge'))).toBe(true);
    expect(srcs.some((s: string) => s.includes('soldier-activation'))).toBe(true);
    expect(srcs.some((s: string) => s.includes('G77 directive'))).toBe(true);
  });
});

describe('audit core · deny-by-default (wounds are explicit, never silent)', () => {
  it('a soldier missing from the vault → explicit NO-CUSTODY wound, exit 2', async () => {
    const roster = SOLDIER_ROSTER;
    const present = roster.filter((a: string) => a !== 'saos-0004');
    const chainById = new Map(roster.map((a) => [a, fakeChainAccount(a)]));
    const { receipt, exitCode } = await auditCustody({
      roster,
      vaultFiles: [{ path: '/synthetic/army-keys.gcm.json', text: syntheticVault(present) }],
      chainFetch: async (account: string) => chainById.get(account) ?? null,
      masterSecret: TEST_MASTER,
      nowIso: '2026-10-26T18:00:00.000Z',
    });
    expect(exitCode).toBe(EXIT_WOUNDS);
    expect(receipt.verdict).toBe('CUSTODY-WOUNDS');
    const wound = receipt.wounds.find((w: { account: string; code: string }) => w.account === 'saos-0004');
    expect(wound).toBeTruthy();
    expect(wound.code).toBe('NO-CUSTODY');
    expect(String(wound.why)).toContain('deny-by-default');
    const row = receipt.soldiers.find((s: { account: string }) => s.account === 'saos-0004');
    expect(row.verdict).toBe('NO-CUSTODY');
  });

  it('absent vault → every soldier wounded VAULT-ABSENT with the exact measured paths', async () => {
    const { receipt, exitCode } = await auditCustody({
      roster: SOLDIER_ROSTER,
      vaultFiles: [],
      chainFetch: async (account: string) => fakeChainAccount(account),
      masterSecret: TEST_MASTER,
      nowIso: '2026-10-26T18:00:00.000Z',
      vaultCandidates: ['/law/path/one/army-keys.json', '/law/path/two/army-keys.gcm.json'],
    });
    expect(exitCode).toBe(EXIT_WOUNDS);
    expect(receipt.verdict).toBe('CUSTODY-WOUNDS');
    expect(receipt.wounds.filter((w: { code: string }) => w.code === 'VAULT-ABSENT')).toHaveLength(SOLDIER_ROSTER.length);
    const w = receipt.wounds[0];
    expect(w.why).toContain('/law/path/one/army-keys.json');
    expect(w.why).toContain('/law/path/two/army-keys.gcm.json');
  });

  it('plaintext army-keys vault → PLAINTEXT-VIOLATION even when the pubs match the chain', async () => {
    const roster = SOLDIER_ROSTER;
    const chainById = new Map(roster.map((a) => [a, fakeChainAccount(a)]));
    const plaintext = JSON.stringify({
      accounts: roster.map((a: string) => ({ name: a, gens: [{ gen: 'GEN-2', pub: syntheticPub(a, 'posting'), wif: syntheticWif(a, 'posting') }] })),
    });
    const { receipt, exitCode } = await auditCustody({
      roster,
      vaultFiles: [{ path: '/synthetic/army-keys.json', text: plaintext }],
      chainFetch: async (account: string) => chainById.get(account) ?? null,
      masterSecret: TEST_MASTER,
      nowIso: '2026-10-26T18:00:00.000Z',
    });
    expect(exitCode).toBe(EXIT_WOUNDS);
    expect(receipt.verdict).toBe('CUSTODY-WOUNDS');
    const row = receipt.soldiers.find((s: { account: string }) => s.account === 'cashmachine');
    expect(row.verdict).toBe('PLAINTEXT-VIOLATION');
    expect(row.custody.authorityMatch).toBe(true); // the pub DOES match — the SHAPE is the wound
    // and the receipt itself never carries the plaintext WIFs
    expect(scanForPlaintextMaterial(JSON.stringify(receipt))).toEqual([]);
  });

  it('vault pub ≠ live chain authority → AUTHORITY-MISMATCH wound (never green on mismatch)', async () => {
    const chainById = new Map(SOLDIER_ROSTER.map((a) => [a, fakeChainAccount(a)]));
    // vault sealed for the SAME soldiers but carrying ROTATED (different) scalars
    const wrongVault = sealGcmStore({
      entries: SOLDIER_ROSTER.flatMap((a: string) =>
        (['posting', 'active'] as const).map((role) => ({
          id: `${a}:${role}@steem`,
          wif: syntheticWif(`${a}-rotated`, role),
          meta: { account: a, role, chain: 'steem', derivation: 'synthetic-test-only' },
        }))),
      masterSecret: TEST_MASTER,
    });
    const { receipt, exitCode } = await auditCustody({
      roster: SOLDIER_ROSTER,
      vaultFiles: [{ path: '/synthetic/army-keys.gcm.json', text: wrongVault }],
      chainFetch: async (account: string) => chainById.get(account) ?? null,
      masterSecret: TEST_MASTER,
      nowIso: '2026-10-26T18:00:00.000Z',
    });
    expect(exitCode).toBe(EXIT_WOUNDS);
    const row = receipt.soldiers.find((s: { account: string }) => s.account === 'haran');
    expect(row.verdict).toBe('AUTHORITY-MISMATCH');
  });

  it('chain unreachable → verdict BLOCKED-CHAIN (fail-honest, not green, not a crash)', async () => {
    const { receipt, exitCode } = await auditCustody({
      roster: SOLDIER_ROSTER.slice(0, 3),
      vaultFiles: [{ path: '/synthetic/army-keys.gcm.json', text: syntheticVault(SOLDIER_ROSTER.slice(0, 3)) }],
      chainFetch: async () => { throw new Error('rpc down'); },
      masterSecret: TEST_MASTER,
      nowIso: '2026-10-26T18:00:00.000Z',
    });
    expect(exitCode).toBe(EXIT_WOUNDS);
    expect(receipt.verdict).toBe('BLOCKED-CHAIN');
  });

  it('encrypted vault without a master → SEALED-NO-MASTER wounds (honest, no fake green)', async () => {
    const { receipt, exitCode } = await auditCustody({
      roster: SOLDIER_ROSTER.slice(0, 2),
      vaultFiles: [{ path: '/synthetic/army-keys.gcm.json', text: syntheticVault(SOLDIER_ROSTER.slice(0, 2)) }],
      chainFetch: async (a: string) => fakeChainAccount(a),
      masterSecret: null,
      nowIso: '2026-10-26T18:00:00.000Z',
    });
    expect(exitCode).toBe(EXIT_WOUNDS);
    expect(receipt.wounds.every((w: { code: string }) => w.code === 'SEALED-NO-MASTER')).toBe(true);
  });
});

describe('zero-plaintext scanner (the (e) law)', () => {
  it('catches planted WIF-shaped material and P-prefixed Blurt forms', () => {
    const planted = `harmless ${syntheticWif('planted', 'posting')} tail`;
    expect(scanForPlaintextMaterial(planted).length).toBe(1);
    expect(scanForPlaintextMaterial('P' + syntheticWif('planted', 'posting'))).toHaveLength(1);
    expect(scanForPlaintextMaterial('nothing to see here')).toEqual([]);
    // a public STM pub is NOT key material — never flagged
    expect(scanForPlaintextMaterial('STM' + b58Encode(pub33FromScalar(syntheticScalar('pub-only', 'posting'))).slice(0, 0) + syntheticPub('pub-only', 'posting').slice(3))).toEqual([]);
  });

  it('b58Encode/b58Decode roundtrip (used by the scanner + pub envelope)', () => {
    const buf = Buffer.from('hello steem', 'utf8');
    expect(Buffer.from(b58Decode(b58Encode(buf))).equals(buf)).toBe(true);
  });
});

describe('receipt law', () => {
  it('SCHEMA_RECEIPT is pinned and receipts carry the schema + law fingerprint fields', async () => {
    expect(SCHEMA_RECEIPT).toBe('saos/soldier-custody-receipt/1');
    const { receipt } = await auditCustody({
      roster: ['syn-soldier'],
      vaultFiles: [],
      chainFetch: async () => fakeChainAccount('syn-soldier'),
      masterSecret: TEST_MASTER,
      nowIso: '2026-10-26T18:00:00.000Z',
      vaultCandidates: ['/x'],
    });
    expect(receipt.schema).toBe(SCHEMA_RECEIPT);
    expect(receipt.integrity.algorithm).toBe('sha256');
  });
});

describe('derivation probe core (the headcorner-keypair families, synthetic only)', () => {
  it('buildProbeCandidates covers the custody line + the keypair families (deterministic)', () => {
    const cands = buildProbeCandidates('synthetic-owner-line:secret-part-0123456789', { source: '/synthetic/master.txt' });
    const families = cands.map((c: { family: string }) => c.family);
    expect(families.filter((f: string) => f === 'custody-line').length).toBeGreaterThanOrEqual(3);
    expect(families).toContain('headcorner-keypair:posting-wif-as-master');
    expect(families).toContain('headcorner-keypair:posting-wif-sha256');
    expect(families).toContain('headcorner-keypair:posting-pub-as-master');
    const again = buildProbeCandidates('synthetic-owner-line:secret-part-0123456789');
    expect(again.map((c: { master: string }) => c.master)).toEqual(cands.map((c: { master: string }) => c.master));
  });

  it('probeAccountAgainstChain finds the ONLY lawful hit and hides all material', async () => {
    const account = 'syn-probed';
    const chainAcct = fakeChainAccount(account); // authorities = synthetic scalars for (account, role)
    // candidate master that ACTUALLY derives the chain pubs (steem-js law): we craft
    // a custody line whose sha256(account+role+line) equals the synthetic scalar is
    // infeasible, so instead we verify the negative law + the fingerprint shape:
    const cands = buildProbeCandidates('some-other-line', { source: '/synthetic/other.txt' });
    const res = await probeAccountAgainstChain(account, cands, async () => chainAcct);
    expect(res.account).toBe(account);
    expect(res.matches).toEqual([]);
    expect(res.liveFps.posting).toMatch(/^[0-9a-f]{12}$/);
    expect(res.liveFps.posting).toBe(fingerprintOf(syntheticPub(account, 'posting')));
    // and a candidate list CONTAINING the true master hits exactly the live role
    const trueMaster = 'the-true-master-of-' + account;
    const wif = deriveWifSteemJs(account, 'active', trueMaster);
    const pub = stmPubFromWif(wif);
    const tweakedChain = { ...chainAcct, active: { ...chainAcct.active, key_auths: [[pub, 1]] } } as typeof chainAcct;
    const hit = await probeAccountAgainstChain(account, [{ source: '/synthetic/true.txt', master: trueMaster, family: 'custody-line' }], async () => tweakedChain);
    expect(hit.matches).toHaveLength(1);
    expect(hit.matches[0].candidateRole).toBe('active');
    expect(hit.matches[0].liveRole).toBe('active');
    expect(hit.matches[0].pubFp).toBe(fingerprintOf(pub));
    // the probe result never carries a WIF
    expect(scanForPlaintextMaterial(JSON.stringify(hit))).toEqual([]);
  });

  it('probeAccountAgainstChain: chain-unreachable and no-such-account are honest errors', async () => {
    const boom = await probeAccountAgainstChain('a', [], async () => { throw new Error('rpc down'); });
    expect(boom.error).toContain('chain-unreachable');
    const none = await probeAccountAgainstChain('a', [], async () => null);
    expect(none.error).toBe('no-such-account');
  });
});

describe('seal blessing law (only live-authority-matched roles may ever be sealed)', () => {
  it('blesses EXACTLY the role whose derived pub matches a live chain authority (synthetic)', () => {
    const account = 'syn-blessed';
    const activeWif = deriveWifSteemJs(account, 'active', TEST_MASTER);
    const activePub = stmPubFromWif(activeWif);
    const chain = {
      postingPub: syntheticPub('unrelated-acct', 'posting'),
      activePub,
      ownerPub: null,
      memoKey: null,
    };
    const matched = blessDerivations({ account, candidateMasters: [TEST_MASTER], chain });
    expect(matched).toHaveLength(1);
    expect(matched[0].role).toBe('active');
    expect(matched[0].liveRole).toBe('active');
    expect(matched[0].pubFp).toBe(fingerprintOf(activePub));
    expect(matched[0].wif).toBe(activeWif); // in-memory only — needed to seal, never printed/written
  });

  it('blesses zero roles when nothing matches any live authority (the exit-3 refusal input)', () => {
    const chain = {
      postingPub: syntheticPub('a', 'posting'),
      activePub: syntheticPub('a', 'active'),
      ownerPub: syntheticPub('a', 'owner'),
      memoKey: syntheticPub('a', 'memo'),
    };
    const matched = blessDerivations({ account: 'syn-foreign', candidateMasters: ['some-other-master'], chain });
    expect(matched).toHaveLength(0); // caller must refuse to seal (rot1-restore fail-closed law)
  });

  it('refuses an unknown derivation name and empty candidate lists (no silent fallback)', () => {
    const chain = { postingPub: syntheticPub('x', 'posting'), activePub: null, ownerPub: null, memoKey: null };
    expect(() => blessDerivations({ account: 'x', candidateMasters: [TEST_MASTER], chain, derivation: 'no-such-law' })).toThrow(/unknown derivation/);
    expect(() => blessDerivations({ account: 'x', candidateMasters: [], chain })).toThrow(/no candidate masters/);
  });
});

// silence unused-import lint for the ECDH import (kept for future envelope ECDH law)
void createCipheriv; void createDecipheriv; void createECDH;
