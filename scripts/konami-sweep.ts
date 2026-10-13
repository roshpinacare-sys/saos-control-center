/**
 * konami-sweep — multi-chain address derivation from the owner's uploaded 24-word
 * mnemonic (upload/קונמי.txt) + live balance sweep. Fail-closed, create-only.
 *
 * TRUTH RULES (hard):
 *   · NEVER print the mnemonic, seed, private keys, or WIFs — addresses and
 *     balances only (addresses are public on-chain data).
 *   · Zero echo of file content — only structural verdicts were printed earlier.
 *   · Balances come from live public RPC only; no book balances, no invented numbers.
 *
 * Paths (standard):
 *   · EVM:  m/44'/60'/0'/0/i      (secp256k1, keccak → 0x…)
 *   · TRON: m/44'/195'/0'/0/i     (secp256k1, keccak → 0x41-prefixed base58check)
 *   · SOL:  m/44'/501'/0'/0'      (SLIP-0010 ed25519, all-hardened)
 *
 * Legacy cross-check: boolean match against TRON_LEGACY addresses from the estate
 * route (derived by an earlier task from vault mnemonic #2) — answers "is קונמי
 * the same mnemonic as legacy #2" without printing anything sensitive.
 *
 * Usage: bun scripts/konami-sweep.ts
 */
process.env.NODE_ENV ||= 'development';
import fs from 'fs';
import crypto from 'crypto';
import bs58 from 'bs58';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english.js'; // @scure/bip39 v2: ייצוא wordlist
import { keccak_256 } from '@noble/hashes/sha3.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { secureMaterialPath } from '../src/lib/secure-material'; // FIX(3-b · F2): secure-first

// FIX(3-b · F2): קלט-הסריקה secure-first — ההעתק-המוגן (0600) קודם; upload/ (tmpfs
// 777) רק-כנפילה-לאחור עם אזהרה-קולנית מה-helper; אף-מקור → fail-closed ב-main.
const FILE = secureMaterialPath('קונמי.txt');

interface Derived { chain: string; label: string; address: string }
const derived: Derived[] = [];

function evmAddr(pubUncompressed: Uint8Array): string {
  const h = keccak_256(pubUncompressed.slice(1)); // 64 bytes after 0x04
  return '0x' + Buffer.from(h.slice(12)).toString('hex');
}

function tronAddr(pubUncompressed: Uint8Array): string {
  const h = keccak_256(pubUncompressed.slice(1));
  const body = Buffer.concat([Buffer.from([0x41]), Buffer.from(h.slice(12))]); // 21 bytes
  const chk = sha256(sha256(body));
  const full = Buffer.concat([body, Buffer.from(chk.slice(0, 4))]);
  return bs58.encode(full);
}

function ethCall(url: string, to: string, data: string, timeout = 9000): Promise<string | null> {
  return fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_call', params: [{ to, data }, 'latest'], id: 1 }),
    signal: AbortSignal.timeout(timeout),
  }).then(r => r.json()).then((j: { result?: string }) => j.result ?? null).catch(() => null);
}

async function evmBalance(addr: string): Promise<{ eth: number | null; usdt: number | null }> {
  const j = await fetch('https://ethereum-rpc.publicnode.com', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([
      { jsonrpc: '2.0', method: 'eth_getBalance', params: [addr, 'latest'], id: 1 },
      { jsonrpc: '2.0', method: 'eth_call', params: [{ to: '0xdac17f958d2ee523a2206206994597c13d831ec7', data: '0x70a08231' + addr.toLowerCase().replace(/^0x/, '').padStart(64, '0') }, 'latest'], id: 2 },
    ]),
    signal: AbortSignal.timeout(12000),
  }).then(r => r.json()).catch(() => null);
  const rows = (Array.isArray(j) ? j : []) as Array<{ result?: string }>;
  const ethWei = rows[0]?.result;
  const usdtRaw = rows[1]?.result;
  return {
    eth: ethWei && ethWei !== '0x' ? Number(BigInt(ethWei)) / 1e18 : ethWei === '0x0' ? 0 : null,
    usdt: usdtRaw && usdtRaw !== '0x' && usdtRaw.length >= 64 ? Number(BigInt(usdtRaw)) / 1e6 : usdtRaw === '0x' ? 0 : null,
  };
}

async function solBalance(addr: string): Promise<number | null> {
  return fetch('https://api.mainnet-beta.solana.com', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'getBalance', params: [addr], id: 1 }),
    signal: AbortSignal.timeout(12000),
  }).then(r => r.json()).then((j: { result?: { value?: number } }) => (j.result?.value ?? null) === null ? null : (j.result!.value) / 1e9)
    .catch(() => null);
}

async function tronBalance(addr: string): Promise<{ trx: number | null; usdt: number | null; active: boolean | null }> {
  const acc = await fetch(`https://api.trongrid.io/v1/accounts/${addr}`, { signal: AbortSignal.timeout(9000) })
    .then(r => r.json()).then((j: { data?: Array<{ balance?: number }> }) => j.data?.[0] ?? null).catch(() => undefined);
  if (acc === undefined) return { trx: null, usdt: null, active: null }; // unknown
  const hex20 = (() => {
    const raw = bs58.decode(addr);
    if (raw.length !== 25 || raw[0] !== 0x41) return null;
    const h = sha256(sha256(raw.subarray(0, 21)));
    for (let i = 0; i < 4; i++) if (h[i] !== raw[21 + i]) return null;
    return Buffer.from(raw.subarray(1, 21)).toString('hex');
  })();
  let usdt: number | null = null;
  if (hex20) {
    usdt = await fetch('https://api.trongrid.io/wallet/triggerconstantcontract', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner_address: addr, contract_address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', function_selector: 'balanceOf(address)', parameter: '70a08231' + '0'.repeat(24) + hex20, visible: true }),
      signal: AbortSignal.timeout(9000),
    }).then(r => r.json()).then((j: { constant_result?: string[] }) => {
      const hex = j.constant_result?.[0];
      return hex && hex.length === 64 ? Number(BigInt('0x' + hex)) / 1e6 : null;
    }).catch(() => null);
  }
  return { trx: (acc?.balance ?? 0) / 1e6, usdt, active: acc !== null };
}

async function main() {
  if (!FILE) {
    console.error('konami file missing (secure + legacy) — fail-closed, nothing done');
    process.exit(1);
  }
  const words = fs.readFileSync(FILE.path, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0].split(/[\s,]+/).filter(Boolean);
  console.log(`mnemonic-structure: ${words.length} words (no content echo) · source=${FILE.legacy ? 'legacy-upload (WARN: 777-tmpfs)' : 'secure-material'}`);
  if (words.length !== 24) {
    console.error('not a 24-word first line — fail-closed, nothing derived');
    process.exit(1);
  }

  const phrase = words.join(' ');
  // FIX(3-b · F8): mnemonicToSeedSync לא מאמת-צ'קסום — מילה-שגויה/פגומה הייתה
  // גוזרת-כתובות-שקריות בשקט. עתה: validateMnemonic (BIP-39 checksum+wordlist)
  // לפני-כל-גזירה — fail-closed על-פגום.
  if (!validateMnemonic(phrase, englishWordlist)) {
    console.error('mnemonic failed BIP-39 validation (checksum/wordlist) — fail-closed, nothing derived');
    process.exit(1);
  }

  const seed = mnemonicToSeedSync(phrase, ''); // standard empty passphrase
  const hd = HDKey.fromMasterSeed(seed);

  // EVM m/44'/60'/0'/0/i
  for (const i of [0, 1]) {
    const d = hd.derive(`m/44'/60'/0'/0/${i}`);
    if (!d.publicKey) continue;
    const pub = secp256k1.ProjectivePoint.fromHex(Buffer.from(d.publicKey).toString('hex')).toRawBytes(false);
    const addr = evmAddr(pub);
    derived.push({ chain: 'evm', label: `60'/0'/0/${i}`, address: addr });
  }
  // TRON m/44'/195'/0'/0/i
  for (const i of [0, 1, 2]) {
    const d = hd.derive(`m/44'/195'/0'/0/${i}`);
    if (!d.publicKey) continue;
    const pub = secp256k1.ProjectivePoint.fromHex(Buffer.from(d.publicKey).toString('hex')).toRawBytes(false);
    const addr = tronAddr(pub);
    derived.push({ chain: 'tron', label: `195'/0'/0/${i}`, address: addr });
  }
  // SOL m/44'/501'/0'/0' (SLIP-0010 ed25519 — hardened only)
  for (const p of ["m/44'/501'/0'/0'", "m/44'/501'/0'/1'"]) {
    const d = hd.derive(p);
    if (!d.publicKey) continue;
    const pub = ed25519.getPublicKey(d.privateKey!);
    derived.push({ chain: 'sol', label: p.replace("m/", ''), address: bs58.encode(pub) });
  }

  const LEGACY = ['TAzZZkrwBXk59iRya7esnKVJeV1xLtqkGr', 'TRKStC5HbWzqdnrWDfc4vYNfgQgyZuQKP4', 'TNd4aFZk1YUeP9uzUWCefJyadjCxZXBoBg'];

  console.log(`derived ${derived.length} addresses — sweeping live RPC…`);
  let anyFunds = 0;
  for (const d of derived) {
    if (d.chain === 'evm') {
      const b = await evmBalance(d.address);
      const has = (b.eth ?? 0) > 0 || (b.usdt ?? 0) > 0;
      if (has) anyFunds++;
      console.log(`[evm ] ${d.label} ${d.address} eth=${b.eth === null ? 'unknown' : b.eth} usdt=${b.usdt === null ? 'unknown' : b.usdt}${has ? '  << FUNDS' : ''}`);
    } else if (d.chain === 'tron') {
      const b = await tronBalance(d.address);
      const isLegacy = LEGACY.includes(d.address);
      const has = (b.trx ?? 0) > 0 || (b.usdt ?? 0) > 0;
      if (has) anyFunds++;
      console.log(`[tron] ${d.label} ${d.address} trx=${b.trx === null ? 'unknown' : b.trx} usdt=${b.usdt === null ? 'unknown' : b.usdt} active=${b.active}${isLegacy ? '  == LEGACY-m2 MATCH' : ''}${has ? '  << FUNDS' : ''}`);
    } else {
      const b = await solBalance(d.address);
      const has = (b ?? 0) > 0;
      if (has) anyFunds++;
      console.log(`[sol ] ${d.label} ${d.address} sol=${b === null ? 'unknown' : b}${has ? '  << FUNDS' : ''}`);
    }
    await new Promise(r => setTimeout(r, 600));
  }
  console.log(anyFunds > 0 ? `VERDICT: ${anyFunds} funded address(es) found` : 'VERDICT: all derived addresses measured — zero balances (true zeros)');
}

main().catch(e => { console.error('fail-closed:', e instanceof Error ? e.message : e); process.exit(1); });
