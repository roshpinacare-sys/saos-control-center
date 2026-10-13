// ═══ CROSS-THE-BORDER · שלב-א: פענוח-מלא + אימות-סמכויות + מפת-כסף (EXEC-CD-29) ═══
// הכל-בזיכרון. אף-סוד-לא-מודפס. רק: שמות, כתובות, מפתחות-ציבוריים, בוליאנים, יתרות.
//
// הרצה: bun scripts/cross-border.ts
import crypto from 'crypto';
import fs from 'fs';
import { openRepoVault } from '../src/lib/repo-vault';
import { decodeFleetEnc } from '../src/lib/fleet-keys-decode';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { secp256k1 } from '@noble/curves/secp256k1';
import { ed25519 } from '@noble/curves/ed25519';
import { keccak_256 } from '@noble/hashes/sha3.js';
import bs58 from 'bs58';
import steem from 'steem';

// ── helpers ──
const MAGIC = 'SAOS-FLEET-VAULT-1';
function b58(buf: Uint8Array): string { return bs58.encode(buf); }
function tronFromPriv(priv: Uint8Array): string {
  const pub65 = Buffer.from(secp256k1.getPublicKey(priv, false));
  const h = keccak_256(pub65.subarray(1));
  const payload = Buffer.concat([Buffer.from([0x41]), Buffer.from(h.subarray(12))]);
  const chk = crypto.createHash('sha256').update(crypto.createHash('sha256').update(payload).digest()).digest().subarray(0, 4);
  return b58(Buffer.concat([payload, chk]));
}
function evmFromPriv(priv: Uint8Array): string {
  const pub = Buffer.from(secp256k1.getPublicKey(priv, true));
  const h = keccak_256(pub.subarray(1));
  const addr = '0x' + Buffer.from(h.subarray(12)).toString('hex');
  return '0x' + Buffer.from(h.subarray(12)).toString('hex').replace(/^/, '').toUpperCase().replace(/\b(..)/g, (m, p, o) => {
    void p; void o; return m;
  }) === '' ? addr : addr; // keep lowercase; checksum not needed for comparison
}
function wifToPrivBytes(wif: string): Uint8Array {
  const raw = bs58.decode(wif.trim());
  if (raw[0] !== 0x80) throw new Error('not mainnet WIF');
  const body = raw.subarray(0, raw.length - 4);
  const chk = raw.subarray(raw.length - 4);
  const expect = crypto.createHash('sha256').update(crypto.createHash('sha256').update(body).digest()).digest().subarray(0, 4);
  if (!chk.equals(expect)) throw new Error('WIF checksum bad');
  return body.subarray(1, 33);
}
function stmPubFromWif(wif: string, prefix: 'STM' | 'TST'): string {
  return steem.auth.wifToPublic(wif.trim(), prefix);
}
async function rpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return (await res.json()) as unknown;
}
async function steemAccount(net: 'steem' | 'hive', acct: string): Promise<Record<string, unknown> | null> {
  const url = net === 'steem' ? 'https://api.steemit.com' : 'https://api.hive.blog';
  const j = await rpc(url, 'condenser_api.get_accounts', [[acct]]) as { result?: Array<Record<string, unknown>> };
  return j.result?.[0] ?? null;
}
function authsOf(a: Record<string, unknown>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const role of ['owner', 'active', 'posting'] as const) {
    out[role] = ((a[role] as { key_auths: [string, number][] } | undefined)?.key_auths ?? []).map(([k]) => k);
  }
  out.memo = [a.memo_key as string];
  return out;
}

// ── targets ──
const KNOWN_TRON = new Set([
  'TYVwwuvdDmfy3shxT3cb3RKLrRCshaZxTy', 'TMXHfFQdG6BB8kwVfbMYuiXWqr9P5S4VAU',
  'TN7eCah4oTmv47SV8KSimF7WCNPv1fJ9D2', 'TPFmkfW6CbnPTSMaMkSS6xPgh7aRDE4zjH',
  'TAzZZkrwBXk59iRya7esnKVJeV1xLtqkGr', 'TRKStC5HbWzqdnrWDfc4vYNfgQgyZuQKP4',
  'TNd4aFZk1YUeP9uzUWCefJyadjCxZXBoBg',
]);
const SOL_DOOR = 'HBBdhpbpFP3BwqcvrxJ44hAyKSid3D6AB4SFvtrN736s';
const SOL_MAIN = '9knfnFMLmhUNjKRDbR1BmVnVkq4BRczyYjJ7BqiZSgiL';
const SOL_VAULT = 'hYWKEiQb5VV9HjQWiNMakJFZBm2UkuRZLrkDqrCLqDj';
const EVM_MAIN = '0x2767e8146c11bad1d9b0784f11325375195c1b0f';
const EVM_OLD = '0x10f6a3104996698bb6bfc6c9c581bca0cfd483f2';
const EVM_VAULT = '0x54b17dc575c374777b66d8ee6fb1f04dc0f1eb05';

// ════════════════════════════════════════════════════════════
console.log('═══ שלב-א: פענוח-המעטפת-הגנוזה ═══');
const { bundle } = openRepoVault();
const ab = bundle.absorbed ?? {};
console.log(`[A] absorbed secrets: ${Object.keys(ab).length}`);

// 1) fleet_keys.enc — 13 keys של-הצי
let fleetFiles: Record<string, string> = {};
const fleetEncB64 = ab['fleet-keys-enc'] ?? ab['fleet-keys-enc-a'];
if (fleetEncB64 && ab['fleet-keys-meta']) {
  try {
    const payload = decodeFleetEnc(String(fleetEncB64));
    const meta = JSON.parse(ab['fleet-keys-meta']) as { pass: string; kdf?: string };
    const key = crypto.scryptSync(meta.pass, payload.subarray(0, 16), 32);
    const d = crypto.createDecipheriv('aes-256-gcm', key, payload.subarray(16, 28));
    d.setAuthTag(payload.subarray(28, 44));
    const fleet = JSON.parse(Buffer.concat([d.update(payload.subarray(44)), d.final()]).toString('utf8')) as { files: Record<string, string>; count?: number; sealedAt?: string };
    fleetFiles = fleet.files ?? {};
    console.log(`[A] ✓ fleet_keys.enc נפתח · count=${fleet.count ?? Object.keys(fleetFiles).length} · sealedAt=${fleet.sealedAt ?? '?'}`);
    console.log(`[A]   files: ${Object.keys(fleetFiles).map(k => `${k}(${fleetFiles[k].length})`).join(', ')}`);
  } catch (e) { console.log(`[A] ✖ fleet_keys.enc: ${String(e).slice(0, 80)}`); }
} else console.log('[A] ✖ fleet material missing in envelope');

// 2) wallets-registry.json
interface RegAccount { agent?: string; chains?: Record<string, { address?: string; pk?: string; path?: string }>; sol?: { address?: string; pk?: string }; [k: string]: unknown }
let regAccounts: RegAccount[] = [];
if (ab['wallets-registry']) {
  try {
    const reg = JSON.parse(ab['wallets-registry']) as { seedRef?: string; derivedAt?: string; accounts: RegAccount[] };
    regAccounts = reg.accounts ?? [];
    console.log(`[A] ✓ wallets-registry · seedRef=${reg.seedRef ?? '?'} · accounts=${regAccounts.length}`);
    for (const a of regAccounts) {
      const sol = a.sol ? ` sol=${a.sol.address}` : '';
      const extra = Object.entries(a).filter(([k]) => !['agent', 'sol'].includes(k)).map(([k, v]) => {
        if (v && typeof v === 'object') {
          const o = v as Record<string, unknown>;
          return `${k}=${o.address ?? JSON.stringify(o).slice(0, 40)}`;
        }
        return `${k}=${String(v).slice(0, 30)}`;
      }).join(' ');
      console.log(`[A]   · agent=${a.agent ?? '?'}${sol} ${extra}`);
    }
  } catch (e) { console.log(`[A] ✖ wallets-registry: ${String(e).slice(0, 80)}`); }
}

// 3) wallets-seed.json
let seedHex: string | null = null;
if (ab['wallets-seed']) {
  try {
    const ws = JSON.parse(ab['wallets-seed']) as { seed?: string; createdAt?: string; note?: string };
    seedHex = (ws.seed ?? '').replace(/^0x/, '').trim();
    console.log(`[A] ✓ wallets-seed · len=${seedHex.length} · createdAt=${ws.createdAt ?? '?'} · note=${(ws.note ?? '').slice(0, 60)}`);
  } catch (e) { console.log(`[A] ✖ wallets-seed: ${String(e).slice(0, 60)}`); }
}

// 4) vault.json accounts
if (ab['vault-accounts']) {
  try {
    const v = JSON.parse(ab['vault-accounts']) as { accounts: Record<string, unknown>[] };
    console.log(`[A] ✓ vault.json · accounts=${v.accounts?.length ?? 0}`);
    for (const a of (v.accounts ?? []).slice(0, 12)) {
      const keys = Object.keys(a);
      const name = (a.name ?? a.account ?? a.agent ?? a.id ?? '?') as string;
      const addr = (a.address ?? a.addr ?? '') as string;
      const chain = (a.chain ?? a.network ?? '') as string;
      console.log(`[A]   · ${String(name).slice(0, 24)} chain=${chain} addr=${String(addr).slice(0, 44)} keys=[${keys.join(',')}]`);
    }
  } catch (e) { console.log(`[A] ✖ vault.json: ${String(e).slice(0, 60)}`); }
}

// 5) TRON mnemonics → derive
const tronDerived: Array<{ from: string; idx: number; addr: string }> = [];
for (const [nm, key] of [['tron-mnemonic', 'tron-mnemonic.txt'], ['tron-legacy-mnemonic', 'tron-legacy.txt']] as const) {
  const m = ab[nm];
  if (!m) continue;
  try {
    const seed = mnemonicToSeedSync(m.trim().split(/\s+/).join(' '));
    const hd = HDKey.fromMasterSeed(seed);
    for (const idx of [0, 1, 2, 3, 4]) {
      const d = hd.derive(`m/44'/195'/0'/0/${idx}`);
      if (!d.privateKey) continue;
      const addr = tronFromPriv(d.privateKey);
      tronDerived.push({ from: nm, idx, addr });
      const hit = KNOWN_TRON.has(addr);
      console.log(`[A] ${nm} idx=${idx} → ${addr}${hit ? '  ◀◀◀ MATCH!' : ''}`);
    }
  } catch (e) { console.log(`[A] ✖ ${nm}: ${String(e).slice(0, 80)}`); }
}

// 6) headcorner-recovered.txt — parse
const hcRecovered = ab['headcorner-recovered'] ?? '';
if (hcRecovered) {
  const lines = hcRecovered.split(/\r?\n/).filter(l => l.trim());
  console.log(`[A] headcorner-recovered: ${lines.length} lines; patterns: STM=${hcRecovered.match(/STM[A-Za-z0-9]{40,}/g)?.length ?? 0} WIF-5=${hcRecovered.match(/\b5[HJK][A-Za-z0-9]{45,}/g)?.length ?? 0} hex64=${hcRecovered.match(/\b[a-f0-9]{64}\b/gi)?.length ?? 0}`);
  for (const l of lines.slice(0, 8)) console.log(`[A]   | ${l.replace(/[A-Za-z0-9]{25,}/g, m => m.slice(0, 6) + '…' + m.slice(-4))}`);
}

// 7) hcsoldier jsons
for (const nm of ['hcsoldier-4', 'hcsoldier-5', 'hcsoldier-6']) {
  if (!ab[nm]) continue;
  try {
    const j = JSON.parse(ab[nm]) as { name?: string; keys?: Record<string, string>; meta?: Record<string, unknown> };
    const keys = j.keys ?? {};
    console.log(`[A] ${nm}: name=${j.name} key-roles=[${Object.keys(keys).join(',')}]`);
  } catch { console.log(`[A] ${nm}: parse-fail`); }
}

// 8) fleet files → find Steem/Hive WIFs
console.log('═══ שלב-א2: סריקת-fleet לסמכויות-Steem/Hive ═══');
const wifs: Array<{ file: string; label: string; wif: string }> = [];
for (const [fname, content] of Object.entries(fleetFiles)) {
  const m5 = content.match(/\b5[HJK][A-Za-z0-9]{45,50}\b/g) ?? [];
  for (const w of m5.slice(0, 4)) wifs.push({ file: fname, label: fname, wif: w });
}
console.log(`[A2] WIF candidates in fleet: ${wifs.length}`);
// derive Steem pubkeys from ALL WIFs (both roles a WIF could serve)
const wifPubs = wifs.map(w => {
  try {
    const priv = wifToPrivBytes(w.wif);
    const stm = stmPubFromWif(w.wif, 'STM');
    const tron = tronFromPriv(priv);
    const evm = evmFromPriv(priv);
    return { ...w, stm, tron, evm };
  } catch { return null; }
}).filter((x): x is NonNullable<typeof x> => x !== null);
console.log(`[A2] derived: ${wifPubs.length} (STM + TRON + EVM each)`);

// 9) live authorities — steem + hive headcorner
console.log('═══ שלב-א3: סמכויות-חיות מול-RPC ═══');
for (const net of ['steem', 'hive'] as const) {
  const a = await steemAccount(net, 'headcorner');
  if (!a) { console.log(`[A3] ${net} headcorner: RPC miss`); continue; }
  const auths = authsOf(a);
  const bal = `STEEM=${a.balance} SBD=${a.sbd_balance} VESTS=${a.vesting_shares} rewards=${a.reward_steem_balance}/${a.reward_sbd_balance}/${a.reward_vesting_balance}`;
  console.log(`[A3] ${net} headcorner: ${bal}`);
  for (const [role, pubs] of Object.entries(auths)) {
    console.log(`[A3]   ${role}: ${pubs.map(p => p.slice(0, 12) + '…').join(',')}`);
    for (const w of wifPubs) {
      if (pubs.includes(w.stm)) console.log(`[A3]   ◀◀◀ ${role} MATCH: WIF from fleet file "${w.file}" → live ${net}/${role} authority!`);
    }
  }
}
// also all soldiers for posting/rewards visibility
const soldiers = ['cashmachine', 'haran', 'lsa', 'wog', 'macrame', 'tov', 'siq', 'wic', 'woq'];
for (const net of ['steem'] as const) {
  const a = await steemAccount(net, 'headcorner');
  void a;
}
for (const s of soldiers) {
  const a = await steemAccount('steem', s).catch(() => null);
  if (!a) continue;
  const rewards = `${a.reward_steem_balance}/${a.reward_sbd_balance}/${a.reward_vesting_balance}`;
  const hasRewards = ![a.reward_steem_balance, a.reward_sbd_balance, a.reward_vesting_balance].every(v => String(v).startsWith('0.000'));
  console.log(`[A3] steem soldier ${s}: STEEM=${a.balance} SBD=${a.sbd_balance}${hasRewards ? ` ★UNCLAIMED-REWARDS: ${rewards}` : ''}`);
}

// 10) SOL verification
console.log('═══ שלב-א4: SOL ═══');
const regSolPks: Array<{ agent: string; pk: string }> = [];
for (const a of regAccounts) {
  if (a.sol?.pk) regSolPks.push({ agent: a.agent ?? '?', pk: a.sol.pk });
}
// also fleet files with hex64 that could be SOL seeds
for (const [fname, content] of Object.entries(fleetFiles)) {
  const hexes = content.match(/\b[a-f0-9]{64}\b/gi) ?? [];
  for (const h of hexes.slice(0, 6)) regSolPks.push({ agent: `fleet:${fname}`, pk: h });
}
for (const cand of regSolPks) {
  try {
    const seed = Buffer.from(cand.pk.replace(/^0x/, ''), 'hex');
    if (seed.length !== 32) continue;
    const addr = b58(ed25519.getPublicKey(seed));
    const hit = addr === SOL_DOOR ? ' ◀◀◀ SOL-DOOR!' : addr === SOL_MAIN ? ' ◀◀◀ SOL-MAIN!' : addr === SOL_VAULT ? ' ◀◀◀ SOL-VAULT!' : '';
    console.log(`[A4] ${cand.agent.slice(0, 30)} → ${addr.slice(0, 10)}…${addr.slice(-4)}${hit}`);
  } catch { /* skip */ }
}

// 11) EVM from fleet/registry/seed
console.log('═══ שלב-א5: EVM ═══');
const evmCands: Array<{ agent: string; pk: string }> = [];
for (const a of regAccounts) {
  for (const [k, v] of Object.entries(a)) {
    if (v && typeof v === 'object' && !['sol'].includes(k)) {
      const o = v as Record<string, unknown>;
      if (typeof o.pk === 'string' && o.pk.length === 64) evmCands.push({ agent: `${a.agent ?? '?'}:${k}`, pk: o.pk });
    }
  }
}
for (const [fname, content] of Object.entries(fleetFiles)) {
  const hexes = content.match(/\b[a-f0-9]{64}\b/gi) ?? [];
  for (const h of hexes.slice(0, 8)) evmCands.push({ agent: `fleet:${fname}`, pk: h });
}
if (seedHex) evmCands.push({ agent: 'wallets-seed', pk: seedHex });
for (const cand of evmCands) {
  try {
    const priv = Buffer.from(cand.pk, 'hex');
    if (priv.length !== 32) continue;
    const addr = evmFromPriv(priv);
    const hit = addr === EVM_MAIN ? ' ◀◀◀ EVM-MAIN(headcorner)!' : addr === EVM_OLD ? ' ◀◀◀ EVM-OLD(post-0x10f6)!' : addr === EVM_VAULT ? ' ◀◀◀ EVM-VAULT!' : '';
    console.log(`[A5] ${cand.agent.slice(0, 34)} → ${addr}${hit}`);
  } catch { /* skip */ }
}

// 12) TRON from WIFs/registry
console.log('═══ שלב-א6: TRON-זהויות ═══');
for (const w of wifPubs) {
  const hit = KNOWN_TRON.has(w.tron) ? ' ◀◀◀ TRON-MATCH!' : '';
  console.log(`[A6] WIF(${w.file.slice(0, 30)}) → ${w.tron}${hit}`);
}
for (const a of regAccounts) {
  for (const [k, v] of Object.entries(a)) {
    if (v && typeof v === 'object' && (v as Record<string, unknown>).pk && k !== 'sol') {
      try {
        const pk = Buffer.from((v as { pk: string }).pk.replace(/^0x/, ''), 'hex');
        if (pk.length !== 32) continue;
        const addr = tronFromPriv(pk);
        const hit = KNOWN_TRON.has(addr) ? ' ◀◀◀ TRON-MATCH!' : '';
        console.log(`[A6] reg:${a.agent ?? '?'}:${k} → ${addr}${hit}`);
      } catch { /* skip */ }
    }
  }
}
if (seedHex) {
  try {
    const seed = mnemonicToSeedSync(Buffer.from(seedHex, 'hex').toString('latin1'));
    void seed;
  } catch { /* not a mnemonic */ }
}

console.log('═══ שלב-א הושלם — אף-סוד-לא-הודפס ═══');
