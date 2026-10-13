// ═══ CROSS-THE-BORDER · שלב-ב: אימות-סמכויות-Steem/Hive + מפת-כסף-מלאה ═══
// bun scripts/cross-border-b.ts
import crypto from 'crypto';
import { openRepoVault } from '../src/lib/repo-vault';
import { secp256k1 } from '@noble/curves/secp256k1';
import { ed25519 } from '@noble/curves/ed25519';
import { keccak_256 } from '@noble/hashes/sha3.js';
import bs58 from 'bs58';
import steem from 'steem';

const MAGIC = 'SAOS-FLEET-VAULT-1';
function wifToPriv(wif: string): Uint8Array {
  const raw = bs58.decode(wif.trim());
  if (raw[0] !== 0x80) throw new Error('not mainnet WIF');
  const body = raw.subarray(0, raw.length - 4);
  const chk = raw.subarray(raw.length - 4);
  const expect = crypto.createHash('sha256').update(crypto.createHash('sha256').update(body).digest()).digest().subarray(0, 4);
  if (!chk.equals(expect)) throw new Error('WIF checksum bad');
  return body.subarray(1, 33);
}
async function rpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return (await res.json()) as unknown;
}
async function acct(net: 'steem' | 'hive', name: string): Promise<Record<string, unknown> | null> {
  const url = net === 'steem' ? 'https://api.steemit.com' : 'https://api.hive.blog';
  const j = await rpc(url, 'condenser_api.get_accounts', [[name]]) as { result?: Array<Record<string, unknown>> };
  return j.result?.[0] ?? null;
}

console.log('═══ שלב-ב: פענוח + אימות-סמכויות ═══');
import { decodeFleetEnc } from '../src/lib/fleet-keys-decode';

const { bundle } = openRepoVault();
const ab = bundle.absorbed ?? {};
// T-64: פענוח-סובלני — ראה fleet-keys-decode.ts
const payload = decodeFleetEnc(String(ab['fleet-keys-enc'] ?? ab['fleet-keys-enc-a'] ?? ''));
const meta = JSON.parse(ab['fleet-keys-meta']) as { pass: string };
const key = crypto.scryptSync(meta.pass, payload.subarray(0, 16), 32);
const d = crypto.createDecipheriv('aes-256-gcm', key, payload.subarray(16, 28));
d.setAuthTag(payload.subarray(28, 44));
const fleet = JSON.parse(Buffer.concat([d.update(payload.subarray(44)), d.final()]).toString('utf8')) as { files: Record<string, string> };
const fleetFiles = fleet.files ?? {};

// ── parse headcorner-recovered.txt (from fleet files, same content as absorbed) ──
const hcTxt = fleetFiles['keys/headcorner-recovered.txt'] ?? ab['headcorner-recovered'] ?? '';
const roles: Record<string, string> = {};
let chain = 'steem';
for (const line of hcTxt.split(/\r?\n/)) {
  const t = line.trim();
  if (/^hive$/i.test(t)) { chain = 'hive'; continue; }
  if (/steemit/i.test(t)) { chain = 'steem'; continue; }
  const m = t.match(/^(OWNER|ACTIVE|POSTING|MEMO)\s*=\s*(\S+)/i);
  if (m) roles[`${chain}.${m[1].toLowerCase()}`] = m[2];
}
console.log(`[B] headcorner-recovered parsed: roles=${Object.keys(roles).join(',')} (values hidden)`);

// hcsoldier jsons — full key roles
const soldiers: Array<{ name: string; keys: Record<string, string> }> = [];
for (const nm of ['hcsoldier-4', 'hcsoldier-5', 'hcsoldier-6']) {
  if (!ab[nm]) continue;
  const j = JSON.parse(ab[nm]) as { name: string; keys: Record<string, string> };
  soldiers.push({ name: j.name, keys: j.keys });
}
for (const s of soldiers) console.log(`[B] ${s.name}: roles=[${Object.keys(s.keys).join(',')}] (values hidden)`);

// hed-soldiers-source.txt — pattern inventory
const hed = fleetFiles['keys/hed-soldiers-source.txt'] ?? ab['hed-soldiers-source'] ?? '';
console.log(`[B] hed-soldiers-source: ${hed.split(/\r?\n/).length} lines · KL-WIFs=${(hed.match(/\b[KL][A-Za-z0-9]{50,51}\b/g) ?? []).length} · 5-WIFs=${(hed.match(/\b5[HJK][A-Za-z0-9]{45,50}\b/g) ?? []).length}`);

// ── verify against LIVE authorities ──
function stmPub(wif: string): string { return steem.auth.wifToPublic(wif.trim()); }

const tests: Array<{ net: 'steem' | 'hive'; acct: string; role: string; wif: string }> = [];
for (const [k, wif] of Object.entries(roles)) {
  const [chain, role] = k.split('.');
  tests.push({ net: chain as 'steem' | 'hive', acct: 'headcorner', role, wif });
}
for (const s of soldiers) {
  for (const [role, wif] of Object.entries(s.keys)) {
    if (wif && wif.length > 40) tests.push({ net: 'steem', acct: s.name, role, wif });
  }
}
console.log(`[B] candidates to verify: ${tests.length}`);

let matches = 0;
for (const t of tests) {
  const a = await acct(t.net, t.acct);
  if (!a) { console.log(`[B] ${t.net}/${t.acct}: RPC miss`); continue; }
  const live = ((a[t.role === 'memo' ? 'memo_key' : t.role] as { key_auths?: [string, number][] } | undefined));
  const pubs: string[] = t.role === 'memo' ? [a.memo_key as string] : (live?.key_auths ?? []).map(([k2]) => k2);
  let pub = '';
  try { pub = stmPub(t.wif); } catch { console.log(`[B]   ${t.net}/${t.acct}/${t.role}: WIF-derivation-fail`); continue; }
  const hit = pubs.includes(pub);
  if (hit) matches++;
  console.log(`[B]   ${t.net}/${t.acct}/${t.role}: ${hit ? '◀◀◀ AUTHORITY-VERIFIED ' + pub.slice(0, 14) + '…' : 'no-match (' + pub.slice(0, 10) + '… vs ' + (pubs[0] ?? '?').slice(0, 10) + '…)'}`);
}
console.log(`[B] ═══ ${matches} authorities VERIFIED against live chain ═══`);

// ── balances of the fleet WIFs on chains (which WIFs hold TRON/EVM value?) ──
console.log('═══ שלב-ב2: מפת-כסף — כל-מפתחות-ה-registry על-כל-השרשרות ═══');
const reg = JSON.parse(ab['wallets-registry']) as { accounts: Array<{ agent?: string; sol?: { address?: string; pk?: string }; evm?: { address?: string; pk?: string }; tron?: { address?: string; pk?: string }; btc?: { address?: string; pk?: string }; idx?: number }> };

const TRON_API = 'https://api.trongrid.io';
async function tronBalance(addr: string): Promise<{ trx: number; energy: number; unfrozen: number }> {
  try {
    const r = await fetch(`${TRON_API}/wallet/getaccount`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: addr, visible: true }) });
    const a = await r.json() as Record<string, never> & { balance?: number; account_resource?: { energy_quota?: number }; unfrozenV2?: Array<{ unfreeze_amount?: number }> };
    return { trx: (a.balance ?? 0) / 1e6, energy: a.account_resource?.energy_quota ?? 0, unfrozen: (a.unfrozenV2 ?? []).reduce((s, u) => s + (u.unfreeze_amount ?? 0), 0) / 1e6 };
  } catch { return { trx: -1, energy: 0, unfrozen: 0 }; }
}
async function evmBalance(addr: string, rpcUrl: string): Promise<number> {
  try {
    const r = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [addr, 'latest'] }) });
    const j = await r.json() as { result?: string };
    return j.result ? parseInt(j.result, 16) / 1e18 : -1;
  } catch { return -1; }
}
async function solBalance(addr: string): Promise<number> {
  try {
    const r = await fetch('https://api.mainnet-beta.solana.com', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [addr] }) });
    const j = await r.json() as { result?: { value?: number } };
    return (j.result?.value ?? 0) / 1e9;
  } catch { return -1; }
}
async function btcBalance(addr: string): Promise<number> {
  try {
    const r = await fetch(`https://blockstream.info/api/address/${addr}`);
    const j = await r.json() as { chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number } };
    const c = j.chain_stats ?? {};
    return ((c.funded_txo_sum ?? 0) - (c.spent_txo_sum ?? 0)) / 1e8;
  } catch { return -1; }
}

const EVM_RPCS: Array<[string, string]> = [
  ['ETH', 'https://ethereum-rpc.publicnode.com'],
  ['BNB', 'https://bsc-rpc.publicnode.com'],
  ['POL', 'https://polygon-bor-rpc.publicnode.com'],
  ['BASE', 'https://base-rpc.publicnode.com'],
  ['ARB', 'https://arbitrum-one-rpc.publicnode.com'],
  ['AVAX', 'https://avalanche-c-chain-rpc.publicnode.com'],
  ['OP', 'https://optimism-rpc.publicnode.com'],
];

let total = { trx: 0, sol: 0, btc: 0 };
for (const a of reg.accounts) {
  const ag = a.agent ?? '?';
  const solAddr = a.sol?.address ?? '';
  const evmAddr = a.evm?.address ?? '';
  const tronAddr = a.tron?.address ?? '';
  const btcAddr = a.btc?.address ?? '';
  const [sol, tron, ...evms] = await Promise.all([
    solAddr ? solBalance(solAddr) : Promise.resolve(0),
    tronAddr ? tronBalance(tronAddr) : Promise.resolve({ trx: 0, energy: 0, unfrozen: 0 }),
    ...(evmAddr ? EVM_RPCS.map(([nm, url]) => evmBalance(evmAddr, url).then(v => [nm, v] as [string, number])) : []),
    btcAddr ? btcBalance(btcAddr) : Promise.resolve(0),
  ]);
  const evmNonZero = evms.filter(([, v]) => v > 0);
  const solHit = sol > 0 ? ' ◀◀◀ SOL!' : '';
  const tronHit = (tron.trx > 0 || tron.unfrozen > 0) ? ' ◀◀◀ TRON!' : '';
  const evmHit = evmNonZero.length ? ` ◀◀◀ EVM: ${evmNonZero.map(([n, v]) => `${n}=${v.toPrecision(4)}`).join(' ')}` : '';
  const btcHit = (btc as number) > 0 ? ' ◀◀◀ BTC!' : '';
  total.trx += Math.max(0, tron.trx); total.sol += Math.max(0, sol); total.btc += Math.max(0, btc as number);
  console.log(`[B2] ${ag.padEnd(12)} SOL=${sol.toFixed(6)}${solHit} · TRX=${tron.trx.toFixed(6)}(+unfz ${tron.unfrozen.toFixed(3)},en ${tron.energy})${tronHit} · BTC=${(btc as number).toFixed(8)}${btcHit}${evmHit}`);
}
console.log(`[B2] ═══ fleet totals: TRX=${total.trx.toFixed(6)} · SOL=${total.sol.toFixed(6)} · BTC=${total.btc.toFixed(8)} ═══`);
