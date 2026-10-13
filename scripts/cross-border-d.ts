// ═══ CROSS-THE-BORDER · שלב-ד: מפת-כסף-מלאה (12-סוכנים + דלתות) ═══
// bun scripts/cross-border-d.ts
import { openRepoVault } from '../src/lib/repo-vault';
import crypto from 'crypto';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3.js';
import bs58 from 'bs58';

const ab = openRepoVault().bundle.absorbed ?? {};
const reg = JSON.parse(ab['wallets-registry'] ?? '{}') as { accounts: Array<{ agent?: string; sol?: { address?: string }; evm?: { address?: string }; tron?: { address?: string }; btc?: { address?: string } }> };

async function tronBalance(addr: string): Promise<{ trx: number; energy: number; unfrozen: number }> {
  try {
    const r = await fetch('https://api.trongrid.io/wallet/getaccount', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: addr, visible: true }) });
    const a = await r.json() as { balance?: number; account_resource?: { energy_quota?: number }; unfrozenV2?: Array<{ unfreeze_amount?: number }> };
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

// extra addresses: doors + old-eth + headcorner-master EVM
const EXTRA_EVM: Array<[string, string]> = [
  ['door-evm', '0xa35e309887530a70bb7ce6be0ebba2326ce6a989'],
  ['hc-main-evm', '0x2767e8146c11baD1d9B0784f11325375195c1b0f'],
  ['old-eth-post', '0x10f6a3104996698bb6bfc6c9c581bca0cfd483f2'],
];
const EXTRA_TRON: Array<[string, string]> = [
  ['door-tron', 'TQqCZgF1pAEQmAyayHBJkfE1z8J5NfLuwK'],
  ['hc-main', 'TYVwwuvdDmfy3shxT3cb3RKLrRCshaZxTy'],
  ['hc-legacy', 'TMXHfFQdG6BB8kwVfbMYuiXWqr9P5S4VAU'],
  ['identity-door', 'TN7eCah4oTmv47SV8KSimF7WCNPv1fJ9D2'],
];
const EXTRA_SOL: Array<[string, string]> = [
  ['sol-door(cash)', 'HBBdhpbpFP3BwqcvrxJ44hAyKSid3D6AB4SFvtrN736s'],
  ['sol-main(hc)', '9knfnFMLmhUNjKRDbR1BmVnVkq4BRczyYjJ7BqiZSgiL'],
];

let totTrx = 0, totSol = 0, totBtc = 0;
const funded: string[] = [];

for (const a of reg.accounts) {
  const ag = a.agent ?? '?';
  const jobs: Array<Promise<string>> = [];
  if (a.sol?.address) jobs.push(solBalance(a.sol.address).then(v => `SOL=${v.toFixed(6)}${v > 0 ? ' ★' : ''}`));
  if (a.tron?.address) jobs.push(tronBalance(a.tron.address).then(v => `TRX=${v.trx.toFixed(4)}${v.trx > 0 || v.unfrozen > 0 ? ' ★' : ''}`));
  if (a.btc?.address) jobs.push(btcBalance(a.btc.address).then(v => `BTC=${v.toFixed(8)}${v > 0 ? ' ★' : ''}`));
  if (a.evm?.address) jobs.push(Promise.all(EVM_RPCS.map(([nm, url]) => evmBalance(a.evm!.address!, url).then(v => [nm, v] as const))).then(rs => {
    const nz = rs.filter(([, v]) => v > 0);
    return 'EVM=' + (nz.length ? nz.map(([n, v]) => `${n}:${v.toPrecision(3)}★`).join(',') : '0×7');
  }));
  const res = await Promise.all(jobs);
  const line = res.join(' · ');
  if (line.includes('★')) funded.push(ag);
  console.log(`[D] ${ag.padEnd(12)} ${line}`);
}

console.log('═══ EXTRA (דלתות + ארנק-ראשי + ישן) ═══');
for (const [nm, addr] of EXTRA_SOL) {
  const v = await solBalance(addr);
  if (v > 0) { funded.push(nm); totSol += v; }
  console.log(`[D] ${nm.padEnd(15)} SOL=${v.toFixed(9)}${v > 0 ? ' ★FUNDED' : ''}`);
}
for (const [nm, addr] of EXTRA_TRON) {
  const v = await tronBalance(addr);
  const t = v.trx + v.unfrozen;
  if (t > 0) { funded.push(nm); totTrx += t; }
  console.log(`[D] ${nm.padEnd(15)} TRX=${v.trx.toFixed(6)} unfz=${v.unfrozen.toFixed(4)} en=${v.energy}${t > 0 ? ' ★FUNDED' : ''}`);
}
for (const [nm, addr] of EXTRA_EVM) {
  const rs = await Promise.all(EVM_RPCS.map(([cn, url]) => evmBalance(addr, url).then(v => [cn, v] as const)));
  const nz = rs.filter(([, v]) => v > 0);
  if (nz.length) funded.push(nm);
  console.log(`[D] ${nm.padEnd(15)} EVM ${addr.slice(0, 10)}… = ${nz.length ? nz.map(([n, v]) => `${n}:${v.toPrecision(5)}★`).join(' ') : '0×7'}`);
}
console.log(`[D] ═══ FUNDED: ${funded.join(', ') || 'none'} ═══`);
