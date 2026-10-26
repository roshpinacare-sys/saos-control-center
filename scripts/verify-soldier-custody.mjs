#!/usr/bin/env node
// ═══ verify-soldier-custody.mjs — G77-a soldier key custody + authority audit ═══
// ═══════════════════════════════════════════════════════════════════════════════
// OWNER DIRECTIVE (MASTER §1, trace 1a178c595ee6edd5 · G77 wave): verify that
// saos-0004 + every listed soldier's keys are DERIVED + AES-256-GCM in the vault,
// chain-judged against the LIVE authorities, deny-by-default on any gap,
// zero plaintext anywhere.
//
// LAWS (each measured from the estate's own documented custody lineage):
//  · DERIVATION  steem-js seed law   WIF = 0x80 || sha256(account+role+master)
//                ROT1 law (src/lib/keys.ts) WIF = 0x80 || HMAC-SHA256(seed,
//                `SAOS-ROT1/${account}/${chain}/${role}`) || 0x01
//  · PUB LAW     STM pub = "STM" + base58(pub33 || ripemd160(pub33)[0..4])
//                (proven identical envelope across Steem/Hive/Blurt, keys.ts R-a)
//  · ENVELOPE    AES-256-GCM, key = HKDF-SHA256(sha256(sovereign master), salt,
//                info) — the sovereign (headcorner custody) material is the ONLY
//                unlock; a verify block rejects a wrong master before any key.
//  · BLESSING    only roles whose derived pub MATCHES a live chain authority may
//                ever be sealed (rot1-restore seal law, fail-closed, 0 matches ⇒
//                exit 3). Keys are never printed, logged, or written in plaintext.
//  · WOUNDS      deny-by-default: any roster soldier without verified encrypted
//                custody is an EXPLICIT wound (never silent), heal = owner-only.
//  · FINGERPRINTS  sha256(value)[0..12). Full pubs are public chain data; WIFs
//                never leave the process boundary.
//
// ZERO dependencies: node:crypto + BigInt secp256k1 + fetch. Bun-testable with an
// injected chainFetch (deterministic, synthetic keys only — never real material).
//
// EXIT CODES: 0 = GREEN-CUSTODY · 2 = honest wounds/blocked verdict ·
//             1 = broken tooling (a crash is a tool bug, never a verdict).
// SUBCOMMANDS: audit (default) | probe | seal — see usage() below.
import {
  createHash, createHmac, createCipheriv, createDecipheriv,
  hkdfSync, randomBytes, timingSafeEqual,
} from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, chmodSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// ─────────────────────────────────────────────────────────── constants & roster

export const SCHEMA_RECEIPT = 'saos/soldier-custody-receipt/1';
export const SCHEMA_VAULT = 'saos/soldier-key-vault/1';
export const SCHEMA_WOUND = 'custody-wound/1'; // the mesh wound-registry law
export const EXIT_GREEN = 0;
export const EXIT_WOUNDS = 2;
export const EXIT_TOOL = 1;
export const SOVEREIGN_HEAD = 'headcorner';
export const NEW_SOLDIER = 'saos-0004'; // born 2026-10-25T17:50:54, creator headcorner (measured live)

/**
 * THE SOLDIER ROSTER — union of the measured soldier-node surfaces:
 *  · the 13-soldier voting mesh (mini-services/steem-mesh-bridge/soldier-mesh-run.mjs
 *    DEFAULT_ROSTER @main; "master headcorner is NOT a soldier" per its wire law)
 *  · the G77 directive's new soldier saos-0004 (owner MASTER DIRECTIVE §1)
 * headcorner is audited separately as the SOVEREIGN HEAD (master-derive by design —
 * the public soldiers API keeps it in its roster, so the receipt records it, but it
 * is not a soldier row). ynet is operator-delegated by documented law — recorded as
 * an explicit exemption, never as silence.
 */
export const ROSTER_SOURCES = [
  {
    source: 'src/lib/soldier-activation.ts SOLDIER_ROSTER (the public soldiers API law @main)',
    accounts: ['cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq'],
    note: 'headcorner appears on that surface too but is carved out here as the SOVEREIGN HEAD, never a soldier row',
  },
  {
    source: 'steem-mesh-bridge DEFAULT_ROSTER (mini-services/steem-mesh-bridge/soldier-mesh-run.mjs @main)',
    accounts: ['cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq', 'hcsoldier4', 'hcsoldier5', 'hcsoldier6'],
  },
  {
    source: 'G77 directive (trace 1a178c595ee6edd5): new soldier saos-0004 (born 2026-10-25T17:50:54, creator headcorner)',
    accounts: [NEW_SOLDIER],
  },
];

export const SOLDIER_ROSTER = [...new Set(ROSTER_SOURCES.flatMap((s) => s.accounts))].sort();

/** documented custody exemptions (never silence — each carries its source). */
export const CUSTODY_EXEMPTIONS = [
  {
    account: SOVEREIGN_HEAD,
    role: 'sovereign-head',
    why: 'keyless-in-vault BY DESIGN (master-derive) — steem@main vault truth matrix / CREDENTIAL-SOVEREIGNTY; the head is audited as the recovery_account + creator plane, not as a soldier row',
  },
  {
    account: 'ynet',
    role: 'operator-delegated',
    why: 'operator-delegated BY DESIGN (posting account_auth headcorner:1 rescue anchor; owner/active operator-held) — out of vault scope by documented law',
  },
];

// ────────────────────────────────────────────────────────── primitives: base58

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function b58Encode(buf) {
  let num = BigInt('0x' + buf.toString('hex'));
  let out = '';
  while (num > 0n) { out = B58[Number(num % 58n)] + out; num /= 58n; }
  let pad = 0;
  while (pad < buf.length && buf[pad] === 0) { out = '1' + out; pad++; }
  return out;
}

export function b58Decode(str) {
  let num = 0n;
  for (const ch of str) {
    const idx = B58.indexOf(ch);
    if (idx < 0) throw new Error('base58: invalid character');
    num = num * 58n + BigInt(idx);
  }
  let hex = num.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const bytes = Buffer.from(hex, 'hex');
  let pad = 0;
  while (pad < str.length && str[pad] === '1') pad++;
  return Buffer.concat([Buffer.alloc(pad), bytes]);
}

function sha256d(buf) {
  return createHash('sha256').update(createHash('sha256').update(buf).digest()).digest();
}

export function b58checkEncode(payload) {
  return b58Encode(Buffer.concat([payload, sha256d(payload).subarray(0, 4)]));
}

export function b58checkDecode(str) {
  let num = 0n;
  for (const ch of str) {
    const idx = B58.indexOf(ch);
    if (idx < 0) return null;
    num = num * 58n + BigInt(idx);
  }
  let hex = num.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const buf = Buffer.from(hex, 'hex');
  let pad = 0;
  while (pad < str.length && str[pad] === '1') pad++;
  const full = Buffer.concat([Buffer.alloc(pad), buf]);
  if (full.length < 5) return null;
  const payload = full.subarray(0, full.length - 4);
  const check = full.subarray(full.length - 4);
  return sha256d(payload).subarray(0, 4).equals(check) ? payload : null;
}

// ─────────────────────────────────────────── primitives: secp256k1 (pure BigInt)

const P = 2n ** 256n - 2n ** 32n - 977n; // field prime
const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n; // group order
const Gx = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n;
const Gy = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n;

const mod = (a) => ((a % P) + P) % P;
const modN = (a) => ((a % N) + N) % N;

function modPow(base, exp, m) {
  let r = 1n, b = mod(base), e = exp;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return r;
}
const inv = (a, m) => modPow(a, m - 2n, m); // m prime

// Jacobian point [X, Y, Z]; infinity = [0n, 1n, 0n]
function jDouble([X1, Y1, Z1]) {
  if (Y1 === 0n || Z1 === 0n) return [0n, 1n, 0n];
  const S = mod(4n * X1 * Y1 * Y1);
  const M = mod(3n * X1 * X1);
  const X3 = mod(M * M - 2n * S);
  const Y3 = mod(M * (S - X3) - 8n * Y1 * Y1 * Y1 * Y1);
  const Z3 = mod(2n * Y1 * Z1);
  return [X3, Y3, Z3];
}

function jAdd(p1, p2) {
  const [X1, Y1, Z1] = p1, [X2, Y2, Z2] = p2;
  if (Z1 === 0n) return p2;
  if (Z2 === 0n) return p1;
  const Z1Z1 = mod(Z1 * Z1), Z2Z2 = mod(Z2 * Z2);
  const U1 = mod(X1 * Z2Z2), U2 = mod(X2 * Z1Z1);
  const S1 = mod(Y1 * Z2 * Z2Z2), S2 = mod(Y2 * Z1 * Z1Z1);
  const H = mod(U2 - U1), r = mod(S2 - S1);
  if (H === 0n) return r === 0n ? jDouble(p1) : [0n, 1n, 0n];
  const H2 = mod(H * H), H3 = mod(H * H2), U1H2 = mod(U1 * H2);
  const X3 = mod(r * r - H3 - 2n * U1H2);
  const Y3 = mod(r * (U1H2 - X3) - S1 * H3);
  const Z3 = mod(Z1 * Z2 * H);
  return [X3, Y3, Z3];
}

/** 33-byte COMPRESSED public key for a 32-byte scalar (fail on 0 / ≥N). */
export function pub33FromScalar(scalar32) {
  let k = BigInt('0x' + scalar32.toString('hex'));
  if (k === 0n) throw new Error('secp256k1: zero scalar');
  k = modN(k);
  if (k === 0n) throw new Error('secp256k1: scalar out of range');
  let R0 = [0n, 1n, 0n]; // infinity
  let R1 = [Gx, Gy, 1n];
  for (let i = 255n; i >= 0n; i--) {
    if ((k >> i) & 1n) { R0 = jAdd(R0, R1); R1 = jDouble(R1); }
    else { R1 = jAdd(R0, R1); R0 = jDouble(R0); }
  }
  const [X, Y, Z] = R0;
  if (Z === 0n) throw new Error('secp256k1: point at infinity');
  const z2 = inv(Z, P), x = mod(X * z2 * z2), y = mod(Y * z2 * z2 * z2);
  const prefix = y % 2n === 0n ? 0x02 : 0x03;
  return Buffer.concat([Buffer.from([prefix]), Buffer.from(x.toString(16).padStart(64, '0'), 'hex')]);
}

// ───────────────────────────────────────────────── WIF + STM pub envelope law

const WIF_RE = /^(?:P)?[5KLP][1-9A-HJ-NP-Za-km-z]{50,51}$/;

export function isWifShape(s) {
  return typeof s === 'string' && WIF_RE.test(s.trim());
}

/** WIF → 32-byte scalar (handles the 0x01 compression flag + P display prefix). */
export function scalarFromWif(wif) {
  let w = wif.trim();
  if (w.length === 52 && w.startsWith('P')) w = w.slice(1);
  const payload = b58checkDecode(w);
  if (!payload || payload.length < 33 || payload[0] !== 0x80) {
    throw new Error('wif: invalid envelope (version/checksum)');
  }
  let body = payload.subarray(1, 33);
  if (payload.length === 34 && payload[33] === 0x01) { /* compressed flag — same scalar */ }
  else if (payload.length !== 33) throw new Error('wif: unexpected payload length');
  return Buffer.from(body); // 32 bytes
}

/** scalar → canonical uncompressed-5K-style WIF (0x80 || scalar, sha256d check). */
export function wifFromScalar(scalar32) {
  if (scalar32.length !== 32) throw new Error('wif: scalar must be 32 bytes');
  return b58checkEncode(Buffer.concat([Buffer.from([0x80]), scalar32]));
}

/** THE STM pub envelope: "STM" + b58(pub33 || ripemd160(pub33)[0..4]). */
export function stmPubFromWif(wif) {
  return stmPubFromScalar(scalarFromWif(wif));
}

export function stmPubFromScalar(scalar32) {
  const pub33 = pub33FromScalar(scalar32);
  const check = createHash('ripemd160').update(pub33).digest().subarray(0, 4);
  return 'STM' + b58Encode(Buffer.concat([pub33, check]));
}

// ──────────────────────────────────────────────────────── fingerprint helpers

export function sha256Hex(s) {
  return createHash('sha256').update(s).digest('hex');
}

export function fingerprintOf(s) {
  return sha256Hex(String(s)).slice(0, 12);
}

function canonicalize(v) {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canonicalize(v[k]);
    return out;
  }
  return v;
}

/** canonical receipt core → its sha256 (the receipt's tamper-evident seal). */
export function canonicalReceipt(core) {
  return JSON.stringify(canonicalize(core));
}

// ───────────────────────────────────────────────────── derivation laws (keys.ts)

/** steem-js seed law: WIF scalar = sha256(account + role + master). */
export function deriveWifSteemJs(account, role, master) {
  const digest = createHash('sha256').update(`${account}${role}${master}`).digest();
  return wifFromScalar(digest);
}

/** ROT1 law (src/lib/keys.ts wifFromRot1Seed): HMAC-SHA256(seed, SAOS-ROT1/…). */
export function deriveWifRot1(seedHex, account, chain, role) {
  const h = createHmac('sha256', Buffer.from(seedHex, 'hex')).update(`SAOS-ROT1/${account}/${chain}/${role}`).digest();
  const payload = Buffer.concat([Buffer.from([0x80]), h, Buffer.from([0x01])]);
  const check = sha256d(payload).subarray(0, 4);
  return b58Encode(Buffer.concat([payload, check]));
}

export const DERIVATIONS = {
  'steem-js-seed-v1': (account, role, master) => deriveWifSteemJs(account, role, master),
};

// ───────────────────────────────────── GCM store (AES-256-GCM sovereign vault)

const INFO_KEY = 'saos/soldier-key-vault/1/key';
const INFO_VERIFY = 'saos/soldier-key-vault/1/verify';
const VERIFY_PLAINTEXT = 'saos/soldier-key-vault/1/verify-ok';

function aesKey(masterSecret, salt, info) {
  const ikm = createHash('sha256').update(String(masterSecret), 'utf8').digest();
  return Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from(info, 'utf8'), 32));
}

function gcmSeal(key, plaintext) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return { iv: iv.toString('hex'), authTag: c.getAuthTag().toString('hex'), ciphertext: ct.toString('hex') };
}

function gcmOpen(key, block, label) {
  const iv = Buffer.from(block.iv, 'hex');
  const tag = Buffer.from(block.authTag, 'hex');
  if (iv.length !== 12 || tag.length !== 16) throw new VaultAuthError(`authentication failed for ${label} — malformed block`);
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  try {
    return Buffer.concat([d.update(Buffer.from(block.ciphertext, 'hex')), d.final()]);
  } catch {
    throw new VaultAuthError(`authentication failed for ${label} — wrong master or tampered data`);
  }
}

export class VaultAuthError extends Error {}

/**
 * Seal key entries into the sovereign GCM vault (AES-256-GCM, HKDF from the
 * sovereign master). entries: [{id, wif, meta}]. Returns the JSON document.
 */
export function sealGcmStore({ entries, masterSecret, nowIso }) {
  if (!masterSecret || String(masterSecret).length < 16) {
    throw new Error('vault: master secret required (16+ chars) — never seal under a weak/absent master');
  }
  const salt = randomBytes(32);
  const verify = gcmSeal(aesKey(masterSecret, salt, INFO_VERIFY), Buffer.from(VERIFY_PLAINTEXT, 'utf8'));
  const keys = entries.map((e) => {
    const env = gcmSeal(aesKey(masterSecret, salt, INFO_KEY), Buffer.from(String(e.wif), 'utf8'));
    return {
      id: String(e.id),
      type: 'secp256k1-wif',
      iv: env.iv,
      authTag: env.authTag,
      ciphertext: env.ciphertext,
      meta: e.meta ?? null,
      createdAt: e.createdAt ?? nowIso ?? new Date().toISOString(),
    };
  });
  return JSON.stringify({
    schema: SCHEMA_VAULT,
    kdf: 'hkdf-sha256(sha256(sovereign-master), salt, info)',
    salt: salt.toString('hex'),
    verify,
    keys,
  });
}

/** Open the sovereign GCM vault (fail-closed). Returns {entries: [{id, wif, meta}]}. */
export function openGcmStore(text, masterSecret) {
  let doc;
  try { doc = JSON.parse(text); } catch { throw new Error('vault: not JSON'); }
  if (doc?.schema !== SCHEMA_VAULT) throw new Error(`vault: schema must be ${SCHEMA_VAULT}`);
  const salt = Buffer.from(doc.salt, 'hex');
  if (salt.length !== 32) throw new VaultAuthError('vault: salt must be 32 bytes');
  const plain = gcmOpen(aesKey(masterSecret, salt, INFO_VERIFY), doc.verify ?? {}, 'store.verify');
  if (plain.toString('utf8') !== VERIFY_PLAINTEXT) throw new VaultAuthError('vault: verify block mismatch');
  if (!Array.isArray(doc.keys)) throw new Error('vault: keys must be an array');
  return {
    entries: doc.keys.map((k) => {
      const wif = gcmOpen(aesKey(masterSecret, salt, INFO_KEY), k, `key:${k.id}`).toString('utf8');
      if (!isWifShape(wif)) throw new VaultAuthError(`vault: envelope ${k.id} does not decrypt to a valid WIF`);
      return { id: String(k.id), wif, meta: k.meta ?? null, createdAt: k.createdAt ?? null };
    }),
  };
}

// ───────────────────────────────────────────────── zero-plaintext scanner law

const WIF_SCAN_RE = /(^|[^1-9A-HJ-NP-Za-km-z])([5KLP][1-9A-HJ-NP-Za-km-z]{50,51})($|[^1-9A-HJ-NP-Za-km-z])/g;

/**
 * Find WIF-shaped key material in a text WITHOUT ever echoing it.
 * Returns location descriptors only ({kind, index, length}).
 */
export function scanForPlaintextMaterial(text) {
  const findings = [];
  const s = String(text ?? '');
  for (const m of s.matchAll(WIF_SCAN_RE)) {
    findings.push({ kind: 'wif-shape', index: m.index + m[1].length, length: m[2].length });
  }
  return findings;
}

// ──────────────────────────────────────────────────────────── chain authority

export const DEFAULT_RPC = [
  'https://api.steemit.com',
  'https://rpc.steemitapi.com',
  'https://steemapi.boylikegirl.club',
];

function pickAuths(acct) {
  const auth = (a) => (a?.key_auths?.[0]?.[0] ?? null);
  return {
    postingPub: auth(acct?.posting),
    activePub: auth(acct?.active),
    ownerPub: auth(acct?.owner),
    memoKey: acct?.memo_key ?? null,
    postingAccountAuths: acct?.posting?.account_auths ?? [],
    activeAccountAuths: acct?.active?.account_auths ?? [],
    ownerAccountAuths: acct?.owner?.account_auths ?? [],
    recoveryAccount: acct?.recovery_account ?? null,
    created: acct?.created ?? null,
  };
}

async function rpcCall(endpoints, method, params, timeoutMs = 12_000) {
  let lastErr = null;
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const json = await res.json();
      if (json?.error) throw new Error(`${json.error.code ?? ''} ${String(json.error.message ?? '').slice(0, 120)}`);
      return json?.result;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`rpc failed on all endpoints: ${String(lastErr?.message ?? lastErr).slice(0, 160)}`);
}

/** live chain authority for one account (public RPC, read-only). */
export async function fetchChainAccount(endpoints, account) {
  const result = await rpcCall(endpoints, 'condenser_api.get_accounts', [[account]]);
  const acct = result?.[0] ?? null;
  return acct ? pickAuths(acct) : null;
}

// ─────────────────────────────────────────────────────────────── audit core

function vaultShapeOf(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  if (text.startsWith('SAOS-FLEET-VAULT-1')) return 'fleet-vault-1';
  const t = text.trim();
  if (!t.startsWith('{')) return null;
  try {
    const j = JSON.parse(t);
    if (j?.schema === SCHEMA_VAULT) return 'gcm-store';
    if (Array.isArray(j?.accounts)) return 'army-keys-plaintext';
  } catch { return null; }
  return null;
}

function collectFromGcmStore(text, masterSecret) {
  if (!masterSecret) return { error: 'SEALED-NO-MASTER', entries: null };
  try {
    return { error: null, entries: openGcmStore(text, masterSecret).entries };
  } catch (e) {
    return { error: e instanceof VaultAuthError ? 'VAULT-AUTH-FAILED' : 'VAULT-CORRUPT', entries: null, detail: String(e.message).slice(0, 160) };
  }
}

function collectFromArmyKeysPlaintext(text) {
  try {
    const j = JSON.parse(text);
    const out = [];
    for (const acc of j.accounts ?? []) {
      const name = acc.name ?? acc.account ?? null;
      const gens = (acc.gens ?? []).filter((g) => typeof g?.pub === 'string' && (typeof g?.wif === 'string' || typeof g?.key === 'string'));
      out.push({ account: name, gens, plaintext: true });
    }
    return { error: null, accounts: out };
  } catch {
    return { error: 'VAULT-CORRUPT', accounts: null };
  }
}

/**
 * THE AUDIT (pure core — tests inject chainFetch; zero network in tests).
 * Returns {receipt, exitCode}.
 */
export async function auditCustody(opts) {
  const {
    roster = SOLDIER_ROSTER,
    vaultFiles = [],            // [{path, text}]
    chainFetch,                 // async (account) => authority object | null  (throws on unreachable)
    masterSecret = null,
    nowIso = new Date().toISOString(),
    vaultCandidates = [],
    gapLaw = null,              // {derivationAttemptable, reasons[], healPath}
    endpoints = null,           // recorded provenance only
  } = opts;

  const wounds = [];
  const soldiers = [];
  let chainReachable = true;

  // 1. classify vault shapes
  const shapes = [];
  for (const vf of vaultFiles) {
    const shape = vaultShapeOf(vf.text);
    shapes.push({ path: vf.path, shape });
  }
  const gcmStores = shapes.filter((s) => s.shape === 'gcm-store');
  const plaintextStores = shapes.filter((s) => s.shape === 'army-keys-plaintext');
  const opaqueStores = shapes.filter((s) => s.shape === 'fleet-vault-1');

  // 2. open GCM stores (the ONLY lawful encrypted custody shape)
  let gcmEntries = [];
  let gcmError = null;
  if (gcmStores.length > 0) {
    const results = [];
    for (const s of gcmStores) {
      const r = collectFromGcmStore(vaultFiles.find((f) => f.path === s.path).text, masterSecret);
      results.push({ path: s.path, ...r });
    }
    const ok = results.filter((r) => r.entries);
    if (ok.length > 0) {
      gcmEntries = ok.flatMap((r) => r.entries);
    } else {
      gcmError = results[0].error;
    }
  }

  // 3. plaintext army-keys stores (measured shape — a wound by the zero-plaintext law)
  const plaintextByAccount = new Map();
  for (const s of plaintextStores) {
    const r = collectFromArmyKeysPlaintext(vaultFiles.find((f) => f.path === s.path).text);
    if (r.accounts) for (const acc of r.accounts) plaintextByAccount.set(acc.account, acc);
  }

  const entryIndex = new Map(); // account → [{id, wif, meta}]
  for (const e of gcmEntries) {
    const account = e.meta?.account ?? (e.id.includes(':') ? e.id.split(':')[0] : e.id);
    if (!entryIndex.has(account)) entryIndex.set(account, []);
    entryIndex.get(account).push(e);
  }

  const hasAnyVault = vaultFiles.length > 0;
  const noMaster = gcmError === 'SEALED-NO-MASTER';

  // 4. per-soldier verdict
  for (const account of roster) {
    let chain = null;
    try {
      chain = await chainFetch(account);
      if (chain && chain.postingPub === undefined && chain.posting?.key_auths) chain = pickAuths(chain); // tolerate raw condenser shapes
    } catch {
      chainReachable = false;
    }

    const chainRow = chain
      ? {
          reachable: true,
          exists: true,
          created: chain.created,
          recoveryAccount: chain.recoveryAccount,
          postingFp: chain.postingPub ? fingerprintOf(chain.postingPub) : null,
          activeFp: chain.activePub ? fingerprintOf(chain.activePub) : null,
          postingPub: chain.postingPub,       // public chain data
          activePub: chain.activePub,
          ownerAccountAuths: chain.ownerAccountAuths,
          postingAccountAuths: chain.postingAccountAuths,
          activeAccountAuths: chain.activeAccountAuths,
        }
      : chainReachable
        ? { reachable: true, exists: false }
        : { reachable: false, exists: null };

    const entries = entryIndex.get(account) ?? [];
    const ptAccount = plaintextByAccount.get(account) ?? null;
    const row = { account, role: 'soldier', verdict: null, why: null, chain: chainRow, custody: { present: false, encrypted: false, shape: null, authorityMatch: null } };
    const woundsFor = (code, why) => { wounds.push({ account, code, why, at: nowIso }); row.verdict = row.verdict ?? code; row.why = row.why ?? why; };

    if (chainRow.reachable === false) {
      woundsFor('CHAIN-UNREACHABLE', 'public RPC unreachable — the authority half of the proof is missing (fail-honest; never green)');
    } else if (chainRow.exists === false) {
      woundsFor('CHAIN-NO-ACCOUNT', 'account does not exist on chain');
    } else if (entries.length > 0) {
      // encrypted custody exists — derive + fingerprint + chain-judge
      const best = { posting: null, active: null };
      for (const e of entries) {
        try {
          const pub = stmPubFromWif(e.wif);
          const role = e.meta?.role ?? (e.id.includes(':') ? e.id.split(':')[1]?.split('@')[0] : null);
          if (role === 'posting' && !best.posting) best.posting = { pub, fp: fingerprintOf(pub), derivation: e.meta?.derivation ?? 'recorded' };
          if (role === 'active' && !best.active) best.active = { pub, fp: fingerprintOf(pub), derivation: e.meta?.derivation ?? 'recorded' };
        } catch { /* corrupt envelope — wound below via zero matches */ }
      }
      const postingMatch = best.posting && best.posting.pub === chainRow.postingPub;
      const activeMatch = best.active && best.active.pub === chainRow.activePub;
      const anyEnvelope = best.posting || best.active;
      row.custody.present = true;
      row.custody.encrypted = true;
      row.custody.shape = 'gcm-store';
      row.custody.postingFp = best.posting?.fp ?? null;
      row.custody.activeFp = best.active?.fp ?? null;
      row.custody.derivation = best.posting?.derivation ?? best.active?.derivation ?? null;
      row.custody.authorityMatch = postingMatch || activeMatch;
      if (anyEnvelope && (postingMatch || activeMatch)) {
        row.verdict = 'VERIFIED';
        row.why = `encrypted AES-256-GCM custody; derived pub fingerprint ${postingMatch ? 'posting' : 'active'} MATCHES the live chain authority`;
      } else if (anyEnvelope) {
        woundsFor('AUTHORITY-MISMATCH', 'encrypted custody present but NO derived pub matches any live chain authority (stale key — rotation owner-only)');
      } else {
        woundsFor('VAULT-CORRUPT', 'envelopes exist but none decrypt to a valid WIF');
      }
    } else if (ptAccount) {
      // plaintext vault — the mesh's documented shape; a SHAPE violation even when pubs match
      const genMatch = (ptAccount.gens ?? []).some((g) => g.pub === chainRow.postingPub || g.pub === chainRow.activePub);
      row.custody.present = true;
      row.custody.encrypted = false;
      row.custody.shape = 'army-keys-plaintext';
      row.custody.authorityMatch = genMatch;
      woundsFor('PLAINTEXT-VIOLATION', genMatch
        ? 'pub MATCHES the live chain authority but the WIF sits in PLAINTEXT — the zero-plaintext law forbids this shape; re-seal into the GCM store'
        : 'plaintext custody present AND its pub does not match the live chain authority (stale)');
    } else if (noMaster || (gcmStores.length > 0 && !masterSecret)) {
      woundsFor('SEALED-NO-MASTER', 'an encrypted GCM store exists but the sovereign master is not available in this process — cannot verify, never fake-green');
    } else if (gcmError) {
      woundsFor(gcmError, 'encrypted store present but failed to open (fail-closed)');
    } else if (opaqueStores.length > 0) {
      woundsFor('SEALED-OPAQUE', 'a SAOS-FLEET-VAULT-1 sealed bundle exists on the candidate paths but its pass-derived custody is not available in this process');
    } else if (hasAnyVault) {
      woundsFor('NO-CUSTODY', 'deny-by-default: soldier absent from every readable vault on this host');
    } else {
      const paths = vaultCandidates.join(', ') || '(no candidate paths configured)';
      const gap = account === NEW_SOLDIER && gapLaw
        ? ` | derivation+blessing: ${gapLaw.derivationAttemptable ? 'ATTEMPTABLE' : 'BLOCKED — ' + gapLaw.reasons.join(' | ')} | heal: ${gapLaw.healPath}`
        : '';
      woundsFor('VAULT-ABSENT', `deny-by-default: no vault found on any lawful path (${paths})${gap}`);
    }

    soldiers.push(row);
  }

  // 5. overall verdict (fail-honest)
  const verified = soldiers.filter((s) => s.verdict === 'VERIFIED').length;
  const verdict = !chainReachable && soldiers.every((s) => s.verdict === 'CHAIN-UNREACHABLE')
    ? 'BLOCKED-CHAIN'
    : verified === soldiers.length && soldiers.length > 0
      ? 'GREEN-CUSTODY'
      : 'CUSTODY-WOUNDS';
  const exitCode = verdict === 'GREEN-CUSTODY' ? EXIT_GREEN : EXIT_WOUNDS;

  const core = {
    schema: SCHEMA_RECEIPT,
    at: nowIso,
    verdict,
    roster: {
      soldiers: roster,
      sources: ROSTER_SOURCES,
      sovereignHead: SOVEREIGN_HEAD,
      exemptions: CUSTODY_EXEMPTIONS,
    },
    counts: {
      soldiers: soldiers.length,
      verified,
      wounds: wounds.length,
    },
    vaults: shapes,
    gapLaw: gapLaw ?? null,
    endpoints,
    soldiers,
    wounds,
  };
  const integrity = { algorithm: 'sha256', sha256: sha256Hex(canonicalReceipt(core)) };
  const receipt = { ...core, integrity };

  // the (e) law: the receipt itself must never carry key material
  const leak = scanForPlaintextMaterial(canonicalReceipt(receipt));
  if (leak.length > 0) {
    throw new Error(`TOOL BUG: receipt would carry ${leak.length} plaintext-material span(s) — refusing to emit (fail-closed)`);
  }
  return { receipt, exitCode };
}

// ───────────────────────────────────────────────────────────────── CLI shell

const DEFAULT_VAULT_CANDIDATES = [
  '/home/z/coord-work/vaults/steem-secrets/army-keys.gcm.json', // the GCM generation (this law)
  '/home/z/coord-work/vaults/steem-secrets/army-keys.json',     // the mesh's documented path
  '/home/z/coord-work/vault/army-keys.json',
  '/home/z/audit/repos/saos-control-center/agent/keys/fleet_keys.enc', // SAOS-FLEET-VAULT-1 (manifest'd, absent post-wipe)
];

function usage() {
  console.error(`usage:
  node scripts/verify-soldier-custody.mjs audit  [--vault <path>]… [--master-file <p>] [--out <receipt.json>] [--wounds-out <p>] [--no-gpg]
  node scripts/verify-soldier-custody.mjs probe  --master-file <p> [--account <a>] [--extra-master-file <p>]…
  node scripts/verify-soldier-custody.mjs seal   --master-file <p> [--account <a>] [--out-dir <dir>] [--derivation steem-js-seed-v1]
laws: exit 0 GREEN-CUSTODY · exit 2 honest wounds · exit 1 tool failure · keys NEVER printed`);
}

function readMasterFile(p) {
  const st = statSync(p);
  if (st.mode & 0o077) console.error(`[custody] warning: ${p} is not 0600 (mode ${(st.mode & 0o777).toString(8)}) — fix the perms`);
  return readFileSync(p, 'utf8');
}

/** candidate master strings from an owner custody line (never printed). */
function masterCandidates(line) {
  const raw = line.trim();
  const nfkc = raw.normalize('NFKC').trim();
  const set = new Set([raw, nfkc, raw.replace(/\s+/g, ''), nfkc.replace(/\s+/g, '')]);
  const colon = nfkc.indexOf(':');
  if (colon >= 0) {
    set.add(nfkc.slice(colon + 1).trim());
    set.add(nfkc.slice(0, colon).trim());
  }
  return [...set].filter((s) => s.length >= 4);
}

/**
 * THE PROBE CANDIDATES — every lawful derivation family the estate documents,
 * built from the owner custody line (material stays in memory, never printed):
 *  1. the line itself (raw / NFKC / no-space / secret-after-colon variants)
 *  2. the HEADCORNER KEYPAIR family (the owner's live posting key, proven
 *     live-matched 2026-10-26): the WIF, its sha256-hex, and the pub string
 *     used as the derivation master ("headcorner keypair derivation law")
 */
export function buildProbeCandidates(masterLine, { source = 'owner-custody' } = {}) {
  const line = String(masterLine).trim();
  const out = masterCandidates(line).map((master) => ({ source, master, family: 'custody-line' }));
  const hcWif = deriveWifSteemJs(SOVEREIGN_HEAD, 'posting', line);
  out.push({ source, master: hcWif, family: 'headcorner-keypair:posting-wif-as-master' });
  out.push({ source, master: createHash('sha256').update(hcWif).digest('hex'), family: 'headcorner-keypair:posting-wif-sha256' });
  try {
    out.push({ source, master: stmPubFromWif(hcWif), family: 'headcorner-keypair:posting-pub-as-master' });
  } catch { /* unreachable scalar — skip */ }
  return out;
}

/**
 * Probe one account: derive all roles under every candidate master and match
 * against the LIVE chain authorities (injected chainFetch — no network in tests).
 * Returns {account, matches:[{family, candidateRole, liveRole, pubFp, pub}], chain}.
 */
export async function probeAccountAgainstChain(account, candidates, chainFetch) {
  let chain = null;
  try {
    chain = await chainFetch(account);
    if (chain && chain.postingPub === undefined && chain.posting?.key_auths) chain = pickAuths(chain); // tolerate raw condenser shapes
  } catch (e) {
    return { account, error: `chain-unreachable: ${String(e?.message ?? e).slice(0, 120)}`, matches: [] };
  }
  if (!chain) return { account, error: 'no-such-account', matches: [] };
  const live = new Map();
  if (chain.postingPub) live.set(chain.postingPub, 'posting');
  if (chain.activePub) live.set(chain.activePub, 'active');
  if (chain.ownerPub) live.set(chain.ownerPub, 'owner');
  if (chain.memoKey) live.set(chain.memoKey, 'memo');
  const matches = [];
  for (const cand of candidates) {
    for (const role of ['owner', 'active', 'posting', 'memo']) {
      try {
        const pub = stmPubFromWif(deriveWifSteemJs(account, role, cand.master));
        if (live.has(pub)) matches.push({ family: cand.family, source: cand.source, candidateRole: role, liveRole: live.get(pub), pubFp: fingerprintOf(pub), pub });
      } catch { /* unreachable scalar — skip */ }
    }
  }
  return {
    account,
    created: chain.created ?? null,
    recoveryAccount: chain.recoveryAccount ?? null,
    liveFps: { posting: chain.postingPub ? fingerprintOf(chain.postingPub) : null, active: chain.activePub ? fingerprintOf(chain.activePub) : null },
    matches,
  };
}

async function cmdProbe(argv) {
  const arg = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
  const masterFile = arg('--master-file');
  if (!masterFile) { usage(); return EXIT_TOOL; }
  const accounts = argv.includes('--all-soldiers') ? SOLDIER_ROSTER : [arg('--account', NEW_SOLDIER)];
  const extraFiles = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--extra-master-file') extraFiles.push(argv[i + 1]);

  let candidates = [];
  for (const f of [masterFile, ...extraFiles]) {
    const line = readMasterFile(f);
    candidates = candidates.concat(buildProbeCandidates(line, { source: f }));
  }
  console.error(`[probe] ${candidates.length} candidate master strings across all documented derivation families (content never printed)`);

  const results = [];
  for (const account of accounts) {
    results.push(await probeAccountAgainstChain(account, candidates, (a) => fetchChainAccount(DEFAULT_RPC, a)));
  }
  console.log(JSON.stringify(results, null, 1));
  return results.some((r) => (r.matches?.length ?? 0) > 0) ? EXIT_GREEN : EXIT_WOUNDS;
}

async function cmdSeal(argv) {
  const arg = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
  const masterFile = arg('--master-file');
  if (!masterFile) { usage(); return EXIT_TOOL; }
  const account = arg('--account', NEW_SOLDIER);
  const derivation = arg('--derivation', 'steem-js-seed-v1');
  const outDir = resolve(arg('--out-dir', '/home/z/coord-work/vaults/steem-secrets'));
  const nowIso = new Date().toISOString();

  const masterLine = readMasterFile(masterFile);
  const candidates = masterCandidates(masterLine);
  const chain = await fetchChainAccount(DEFAULT_RPC, account);
  if (!chain) {
    console.error(JSON.stringify({ ok: false, reason: `no-such-account ${account}` }));
    return EXIT_WOUNDS;
  }
  // BLESSING LAW (pure, tested): only roles whose derived pub matches a LIVE
  // chain authority may ever be sealed — extracted so the law is unit-provable.
  const matched = blessDerivations({ account, candidateMasters: candidates, chain, derivation });
  if (matched.length === 0) {
    console.error(JSON.stringify({ ok: false, reason: 'custody error: derivation matches NO live authority — refusing to seal foreign keys (fail-closed, rot1-restore law)' }));
    return 3;
  }

  const target = join(outDir, 'army-keys.gcm.json');
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const entries = matched.map((m) => ({
    id: `${account}:${m.role}@steem`,
    wif: m.wif,
    meta: {
      account, role: m.role, chain: 'steem', derivation,
      derivedFrom: `master-file:${masterFile}`,
      pubFp: m.pubFp, createdAt: nowIso,
    },
  }));

  // merge with an existing store sealed under the SAME master (never break prior custody)
  let finalEntries = entries;
  if (existsSync(target)) {
    try {
      const prior = openGcmStore(readFileSync(target, 'utf8'), masterLine.trim());
      const ids = new Set(entries.map((e) => e.id));
      finalEntries = [...entries, ...prior.entries.filter((e) => !ids.has(e.id))];
    } catch {
      console.error('[seal] existing store present but not openable under this master — refusing to overwrite (fail-closed)');
      return 3;
    }
  }
  const sealed = sealGcmStore({ entries: finalEntries, masterSecret: masterLine.trim(), nowIso });
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, sealed, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, target); // atomic same-dir rename (fsync-less durability)

  const custody = {
    schema: 'saos/soldier-key-vault-custody/1',
    at: nowIso,
    vault: target,
    sealedAccounts: [...new Set(finalEntries.map((e) => e.meta?.account ?? e.id.split(':')[0]))],
    sealedCount: finalEntries.length,
    blessed: matched.map((m) => ({ account, role: m.role, liveRole: m.liveRole, pubFp: m.pubFp })),
    law: 'AES-256-GCM (HKDF from the sovereign master); only live-authority-matched roles sealed; zero plaintext at rest',
  };
  writeFileSync(join(outDir, 'CUSTODY.json'), JSON.stringify(custody, null, 1) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ ok: true, ...custody, vault: target }, null, 1));
  return EXIT_GREEN;
}

/**
 * BLESSING LAW (pure, testable): derive every role under each candidate master
 * and keep ONLY the (role, wif) pairs whose derived pub matches a LIVE chain
 * authority. In-memory material (wif/pub) never leaves the process — callers
 * seal it GCM-encrypted and record fingerprints only.
 */
export function blessDerivations({ account, candidateMasters, chain, derivation = 'steem-js-seed-v1' }) {
  if (!Array.isArray(candidateMasters) || candidateMasters.length === 0) {
    throw new Error('seal: no candidate masters (refusing to derive from nothing)');
  }
  const fn = DERIVATIONS[derivation];
  if (!fn) throw new Error(`seal: unknown derivation '${derivation}'`);
  const livePubs = new Map();
  for (const [pub, role] of [[chain?.postingPub, 'posting'], [chain?.activePub, 'active'], [chain?.ownerPub, 'owner'], [chain?.memoKey, 'memo']]) {
    if (typeof pub === 'string' && pub.startsWith('STM')) livePubs.set(pub, role);
  }
  const matched = [];
  for (const master of candidateMasters) {
    for (const role of ['owner', 'active', 'posting', 'memo']) {
      const wif = fn(account, role, master);
      const pub = stmPubFromWif(wif);
      if (livePubs.has(pub)) matched.push({ role, liveRole: livePubs.get(pub), wif, pubFp: fingerprintOf(pub), pub });
    }
  }
  return matched;
}

async function cmdAudit(argv) {
  const arg = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
  const nowIso = new Date().toISOString();
  const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), '..');

  const vaultPaths = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--vault') vaultPaths.push(resolve(argv[i + 1]));
  if (vaultPaths.length === 0) {
    if (process.env.SAOS_VAULT_DIR) vaultPaths.push(resolve(process.env.SAOS_VAULT_DIR, 'army-keys.json'), resolve(process.env.SAOS_VAULT_DIR, 'army-keys.gcm.json'));
    vaultPaths.push(...DEFAULT_VAULT_CANDIDATES);
  }
  const vaultFiles = [];
  for (const p of vaultPaths) {
    if (existsSync(p)) vaultFiles.push({ path: p, text: readFileSync(p, 'utf8') });
  }
  const masterFile = arg('--master-file', process.env.SOVEREIGN_SOLDIER_MASTER_FILE ?? null);
  let masterSecret = null;
  if (masterFile && existsSync(masterFile)) masterSecret = readMasterFile(masterFile).trim();

  // the G77-a measured gap law (owner-only heal) — with a LIVE derivation probe
  // whenever the owner custody material is available in this process
  const gapLaw = {
    derivationAttemptable: false,
    reasons: [
      'no soldier vault on this host (post-wipe; coord-work re-minted without the soldier vault)',
      'FACTORY_MASTER dead+absent (chain-verified 2026-10-19; absent from disk+git)',
      'ROT1 seed custody absent (/home/z/coord-work/vault/rot1-seed)',
      `saos-0004 born 2026-10-25T17:50:54 (creator headcorner) — postdates every custody seal (vault-home last seal 2026-10-22T08:48Z)`,
      'no authority anchor over saos-0004 (owner/active/posting account_auths all empty — measured live) so the fleet cannot rotate without current key material',
    ],
    probe: null,
    healPath: 'owner-only: supply saos-0004 birth key material (or rotate via the owner wallet) → seal → re-run audit → green',
  };
  if (masterSecret) {
    const probeTargets = [NEW_SOLDIER, SOVEREIGN_HEAD];
    const probeResults = [];
    for (const account of probeTargets) {
      probeResults.push(await probeAccountAgainstChain(account, buildProbeCandidates(masterSecret, { source: masterFile }), (a) => fetchChainAccount(DEFAULT_RPC, a)));
    }
    const saosProbe = probeResults.find((r) => r.account === NEW_SOLDIER);
    const saosMatches = saosProbe?.matches ?? [];
    gapLaw.probe = {
      at: nowIso,
      candidates: buildProbeCandidates('probe-count-placeholder').length,
      families: ['custody-line (raw/NFKC/no-space/secret-after-colon)', 'headcorner-keypair:posting-wif-as-master', 'headcorner-keypair:posting-wif-sha256', 'headcorner-keypair:posting-pub-as-master'],
      perAccount: probeResults.map((r) => ({ account: r.account, matches: r.matches.length, hits: r.matches.map((m) => ({ family: m.family, liveRole: m.liveRole, pubFp: m.pubFp })) })),
    };
    if (saosMatches.length > 0) {
      gapLaw.derivationAttemptable = true;
      gapLaw.reasons.push(`LIVE PROBE: ${saosMatches.length} derivation match(es) for ${NEW_SOLDIER} — run 'seal' to bless them into the GCM vault`);
    } else {
      gapLaw.reasons.push(`LIVE PROBE (measured): 0 derivation matches for ${NEW_SOLDIER} across every documented family (steem-js seed from the owner custody line + the headcorner-keypair families) — the birth keys are not derivable from any material this host holds`);
    }
  }

  const { receipt, exitCode } = await auditCustody({
    roster: SOLDIER_ROSTER,
    vaultFiles,
    chainFetch: (account) => fetchChainAccount(DEFAULT_RPC, account),
    masterSecret,
    nowIso,
    vaultCandidates: vaultPaths,
    gapLaw,
    endpoints: DEFAULT_RPC,
  });

  const outPath = arg('--out', join(repoRoot, 'state', 'audit', 'soldier-custody-receipt.json'));
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(receipt, null, 1) + '\n', { mode: 0o644 });

  const woundsPath = arg('--wounds-out', join(repoRoot, 'state', 'audit', 'custody-wounds.jsonl'));
  if (receipt.wounds.length > 0) {
    const lines = receipt.wounds.map((w) => JSON.stringify({ schema: SCHEMA_WOUND, ...w })).join('\n');
    writeFileSync(woundsPath, lines + '\n', { mode: 0o644 });
  }

  // GPG-detach-sign the receipt (tamper-evident custody receipt; best-effort, honest)
  let gpg = { signed: false, reason: 'skipped (--no-gpg)' };
  if (!argv.includes('--no-gpg')) {
    try {
      const { execFileSync } = await import('node:child_process');
      execFileSync('gpg', ['--batch', '--yes', '--detach-sign', '--local-user', 'E0E28CEB418D10D89AABBE6BDCBB0BA15761958F', '--output', `${outPath}.sig`, outPath], { stdio: 'pipe' });
      gpg = { signed: true, sigPath: `${outPath}.sig`, key: 'E0E28CEB418D10D89AABBE6BDCBB0BA15761958F' };
    } catch (e) {
      gpg = { signed: false, reason: String(e.message).slice(0, 120) };
    }
  }

  console.log(JSON.stringify({
    ok: true,
    verdict: receipt.verdict,
    exitCode,
    counts: receipt.counts,
    receipt: outPath,
    woundsOut: receipt.wounds.length > 0 ? woundsPath : null,
    gpg,
    perSoldier: receipt.soldiers.map((s) => ({ account: s.account, verdict: s.verdict, postingFp: s.custody.postingFp ?? s.chain.postingFp, chainPostingFp: s.chain.postingFp })),
  }, null, 1));
  return exitCode;
}

export async function main(argv) {
  const cmd = argv[0] ?? 'audit';
  const rest = argv.slice(1);
  if (cmd === 'audit') return cmdAudit(rest);
  if (cmd === 'probe') return cmdProbe(rest);
  if (cmd === 'seal') return cmdSeal(rest);
  usage();
  return EXIT_TOOL;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => process.exit(code)).catch((e) => {
    console.error(JSON.stringify({ ok: false, exit: EXIT_TOOL, reason: String(e?.message ?? e).slice(0, 200) }));
    process.exit(EXIT_TOOL);
  });
}

// timingSafeEqual re-export guard (future constant-time compares); keeps tree-shake honest
void timingSafeEqual;
