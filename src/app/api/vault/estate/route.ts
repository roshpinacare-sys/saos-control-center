// GET /api/vault/estate — אחוזת-האמת: סריקה-חיה של כל-מה-שהאחוזה באמת מחזיקה.
// כל-מספר כאן מגיע מ-RPC ציבורי בזמן-אמת — אפס הנחות, אפס יתרות-ספר פנימיות.
// התשובה הכנה לשאלת-המפעיל: "כמה אפשר לממש עכשיו באמת?"
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createHash } from 'crypto';
import bs58 from 'bs58';
import { db } from '@/lib/db';
import { requireOwner } from '@/lib/auth';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ── cache (90s) — סריקה-מלאה = ~120 קריאות-RPC; מאושר כקאש-קצר ──
interface EstateCache { at: number; data: unknown }
const G = globalThis as { __estateCache?: EstateCache };
const TTL = 90_000;

async function jrpc(url: string, method: string, params: unknown, timeout = 12000): Promise<Record<string, unknown>> {
  const r = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
    signal: AbortSignal.timeout(timeout), cache: 'no-store',
  });
  // FIX(R15-b · M2 fake-zero): !r.ok או גוף-error נפלו ל-'0x0'/[] ונקראו "אפס" —
  // אותה-מחלקת-R14 (לא-נודע ≠ אפס-פיזי). עתה: זריקה-כנה — הקורא מדלג-ומונה-כשל.
  if (!r.ok) throw new Error(`rpc HTTP ${r.status}`);
  const j = await r.json() as Record<string, unknown>;
  if (j && typeof j === 'object' && 'error' in j && j.error) throw new Error(`rpc error body`);
  return j;
}
// FIX(R15-b · M2): מונה-כשלי-RPC-פר-סריקה — התשובה נושאת אותו + קריאת-אמת
// "הרשימה-עלולה-להיות-חלקית" במקום-הצגת-אפסים-כעובדה.
let estateRpcFailures = 0;

// ── price feeds: CoinGecko → CoinPaprika (fallback) ──
const COINGECKO_IDS: Record<string, string> = { steem: 'steem', sbd: 'steem-dollars', hive: 'hive', blurt: 'blurt', eth: 'ethereum', sol: 'solana', btc: 'bitcoin', trx: 'tron', usdt: 'tether', usdc: 'usd-coin' };
type Prices = Record<string, { usd: number; src: string }>;
async function getPrices(): Promise<Prices> {
  const out: Prices = {};
  try {
    const ids = Object.values(COINGECKO_IDS).join(',');
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`, { signal: AbortSignal.timeout(9000), cache: 'no-store' });
    if (r.ok) {
      const j = (await r.json()) as Record<string, { usd?: number }>;
      for (const [sym, id] of Object.entries(COINGECKO_IDS)) {
        const usd = j[id]?.usd;
        if (typeof usd === 'number') out[sym] = { usd, src: 'coingecko' };
      }
    }
  } catch { /* fallback */ }
  const missing = Object.keys(COINGECKO_IDS).filter(s => !out[s]);
  if (missing.length) {
    const paprika: Record<string, string> = { steem: 'steem-steem', sbd: 'sbd-steem-dollars', hive: 'hive-hive', eth: 'eth-ethereum', sol: 'sol-solana', btc: 'btc-bitcoin', trx: 'trx-tron', blurt: 'blurt-blurt', usdt: 'usdt-tether', usdc: 'usdc-usd-coin' }; // FIX(R15-b · m7): blurt היה חסר — 404 על-סלאג-שגוי = skip-כנה, לא-אפס
    await Promise.allSettled(missing.map(async sym => {
      const slug = paprika[sym]; if (!slug) return;
      try {
        const r = await fetch(`https://api.coinpaprika.com/v1/tickers/${slug}`, { signal: AbortSignal.timeout(9000), cache: 'no-store' });
        if (!r.ok) return;
        const j = (await r.json()) as { quotes?: { USD?: { price?: number } } };
        const usd = j.quotes?.USD?.price;
        if (typeof usd === 'number') out[sym] = { usd, src: 'coinpaprika' };
      } catch { estateRpcFailures++; /* skip — honest partial */ }
    }));
  }
  return out;
}

// ── SP/BP conversion per chain ──
// FIX(3-b · F4c): null = השער-לא-נמדד (RPC נכשל) — 0-פיקטיבי מנמיך vested-USD בשקט;
// הקורא מסמן-את-השרשרות-הללו ב-scan.vestsUnknown (לא-נודע ≠ אפס).
async function vestsPerSp(chain: 'steem' | 'hive' | 'blurt', url: string): Promise<number | null> {
  try {
    const j = await jrpc(url, 'condenser_api.get_dynamic_global_properties', []);
    const p = j.result as { total_vesting_shares?: string; total_vesting_fund_steem?: string; total_vesting_fund_hive?: string; total_vesting_fund_blurt?: string } | undefined;
    const tvs = parseFloat(p?.total_vesting_shares || '0');
    const fund = parseFloat(p?.total_vesting_fund_steem || p?.total_vesting_fund_hive || p?.total_vesting_fund_blurt || '0');
    if (tvs > 0 && fund > 0) return tvs / fund;
  } catch { /* */ }
  return null;
}

const STEEM_NODE = 'https://api.steemit.com';
const HIVE_NODE = 'https://api.hive.blog';
const BLURT_NODE = 'https://blurt-rpc.saboin.com';
const EVM_RPCS: Record<string, string> = {
  ethereum: 'https://ethereum-rpc.publicnode.com',
  bsc: 'https://bsc-rpc.publicnode.com',
  polygon: 'https://polygon-bor-rpc.publicnode.com',
  arbitrum: 'https://arbitrum-one-rpc.publicnode.com',
  optimism: 'https://optimism-rpc.publicnode.com',
  base: 'https://base-rpc.publicnode.com',
  avalanche: 'https://avalanche-c-chain-rpc.publicnode.com',
};
const SOL_RPC = 'https://api.mainnet-beta.solana.com';
// TRON-RPC — trongrid בלבד עם ריווח-סבלני + retry (CROSS-F-fence: מארח-מקובע; rate-limit מטופל-בכבוד)
const TRON_BASE = 'https://api.trongrid.io';
// טריאדת-אמת: null = לא-מופעלת/ריקה (שרשרת ענתה וריק) · undefined = לא-ידוע (RPC נכשל) · object = חיה
async function tronAccount(address: string): Promise<{ balance?: number; assetV2?: Array<{ key: string; value: number }>; frozenV2?: Array<{ amount?: number }>; unfrozenV2?: Array<{ unfreeze_amount?: number }> } | null | undefined> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`${TRON_BASE}/v1/accounts/${address}`, { signal: AbortSignal.timeout(9000), cache: 'no-store' });
      if (r.status === 429) { await new Promise(rr => setTimeout(rr, 1500 * (attempt + 1))); continue; }
      if (!r.ok) return undefined;
      const j = (await r.json()) as { data?: Array<{ balance?: number; assetV2?: Array<{ key: string; value: number }>; frozenV2?: Array<{ amount?: number }>; unfrozenV2?: Array<{ unfreeze_amount?: number }> }> };
      return j.data?.[0] ?? null;
    } catch { await new Promise(rr => setTimeout(rr, 800)); }
  }
  return undefined;
}

// ── סריקת-טוקנים (Roast-63·H3: ERC-20 ו-SPL לא-נסרקו-מעולם — עתה סריקה-חיה מלאה) ──
const TRON_USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // USDT (TRC-20) — החוזה הקנוני
const TRON_USDT_DEC = 6;

/** base58check → 20-byte hex body (ללא 0x41 ובלי checksum) — מאמת checksum, null אם פגום */
function tronHex20(address: string): string | null {
  try {
    const raw = bs58.decode(address);
    if (raw.length !== 25 || raw[0] !== 0x41) return null;
    const body = raw.subarray(0, 21);
    const h = createHash('sha256').update(createHash('sha256').update(body).digest()).digest();
    for (let i = 0; i < 4; i++) if (h[i] !== raw[21 + i]) return null;
    return Buffer.from(body.subarray(1)).toString('hex');
  } catch { return null; }
}

/** TRC-20 balanceOf via triggerconstantcontract — null = לא-ידוע (כשל), 0 = יתרת-אפס אמת */
async function trc20Balance(owner: string, contract: string, dec: number): Promise<number | null> {
  const hex20 = tronHex20(owner);
  if (!hex20) return null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // FIX-measured: visible:false+base58=INVALID-hex (trongrid ציפה-hex) — visible:true+base58 הוכח-חי (decimals()=6, balanceOf זורם)
      const r = await fetch(`${TRON_BASE}/wallet/triggerconstantcontract`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ owner_address: owner, contract_address: contract, function_selector: 'balanceOf(address)', parameter: '70a08231' + '0'.repeat(24) + hex20, visible: true }),
        signal: AbortSignal.timeout(9000),
      });
      if (r.status === 429) { await new Promise(rr => setTimeout(rr, 1500 * (attempt + 1))); continue; }
      if (!r.ok) return null;
      const j = (await r.json()) as { constant_result?: string[] };
      const hex = j.constant_result?.[0];
      if (!hex) return null;
      return Number(BigInt('0x' + hex)) / 10 ** dec;
    } catch { await new Promise(rr => setTimeout(rr, 800)); }
  }
  return null;
}

const ERC20_TOKENS: Record<string, Array<{ sym: string; addr: string; dec: number }>> = {
  ethereum: [
    { sym: 'USDT', addr: '0xdac17f958d2ee523a2206206994597c13d831ec7', dec: 6 },
    { sym: 'USDC', addr: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', dec: 6 },
  ],
  bsc: [
    { sym: 'USDT', addr: '0x55d398326f99059ff775485246999027b3197955', dec: 18 },
    { sym: 'USDC', addr: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', dec: 18 },
  ],
};

async function erc20Balance(net: string, wallet: string, t: { addr: string; dec: number }): Promise<number | null> {
  const data = '0x70a08231' + wallet.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const j = await jrpc(EVM_RPCS[net], 'eth_call', [{ to: t.addr, data }, 'latest'], 10000);
      const res = String(j.result || '0x0');
      if (res === '0x') return 0; // חוזה-קיים, יתרת-אפס — אפס-אמת
      return Number(BigInt(res)) / 10 ** t.dec;
    } catch { if (attempt === 0) { await new Promise(rr => setTimeout(rr, 1200)); continue; } estateRpcFailures++; return null; }
  }
  return null;
}

const SOL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const KNOWN_SPL: Record<string, { sym: string }> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { sym: 'USDC' },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { sym: 'USDT' },
};

interface SplParsedAccount {
  result?: {
    value?: Array<{
      account?: {
        data?: {
          parsed?: {
            info?: { mint?: string; tokenAmount?: { uiAmount?: number | null } };
          };
        };
      };
    }>;
  };
}

/** SPL token accounts per owner (jsonParsed) — unknown mints מדווחים כמו-שהם (בלי-מחיר, כנה) */
async function solSpl(address: string): Promise<Array<{ mint: string; sym: string | null; amount: number }> | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const j = await jrpc(SOL_RPC, 'getTokenAccountsByOwner', [address, { programId: SOL_TOKEN_PROGRAM }, { encoding: 'jsonParsed' }], 15000);
      const jv = j as SplParsedAccount;
      const vals = jv.result?.value ?? [];
      const byMint = new Map<string, number>();
      for (const v of vals) {
        const info = v.account?.data?.parsed?.info;
        const amt = info?.tokenAmount?.uiAmount ?? 0;
        if (info?.mint && amt > 0) byMint.set(info.mint, (byMint.get(info.mint) || 0) + amt);
      }
      return [...byMint].map(([mint, amount]) => ({ mint, sym: KNOWN_SPL[mint]?.sym ?? null, amount }));
    } catch { if (attempt === 0) { await new Promise(rr => setTimeout(rr, 1200)); continue; } estateRpcFailures++; return null; }
  }
  return null;
}
// ── TRON-legacy (Task 60): כתובות-צפייה-פומביות שנגזרו ממנמוניק #2 שבכספת (פענוח-בזמן-חקירה בלבד).
// המנמוניק עצמו לא מאוחסן כאן — רק הכתובות הציבוריות. הערת-אמת: ה-TRC-10 שבהן הוא טוקני-סקאם ידועים (gas.bi/9pay.org) — שווי אפס.
// R21 (2026-09-13): פורנזיקת-חיות — זהות-הדלת TN7eCah4… (ממומנת 2.0-TRX + עיגון-ראשון-מהריפו txid 92d0ec01…),
// headcorner-legacy TMXHfFQd… (ממומנת; 10-TRX היו-מוקפאים-ENERGY מ-09-12), headcorner-main TYVwwuvd… (2.0-TRX).
// R22 (2026-09-14): UnfreezeBalanceV2 חתום-מהריפו (txid 3f6d9fa2… SUCCESS) — ה-10-TRX עברו-ל-unfrozenV2
// (חלון-WithdrawBalance 14-ימים); השדה-unfrozen להלן הופך-אותם-לנראים במפת-הכסף.
const TRON_LEGACY: Array<{ name: string; address: string }> = [
  { name: 'identity-door', address: 'TN7eCah4oTmv47SV8KSimF7WCNPv1fJ9D2' },
  { name: 'headcorner-legacy', address: 'TMXHfFQdG6BB8kwVfbMYuiXWqr9P5S4VAU' },
  { name: 'headcorner-main', address: 'TYVwwuvdDmfy3shxT3cb3RKLrRCshaZxTy' },
  { name: 'legacy-m2/0', address: 'TAzZZkrwBXk59iRya7esnKVJeV1xLtqkGr' },
  { name: 'legacy-m2/1', address: 'TRKStC5HbWzqdnrWDfc4vYNfgQgyZuQKP4' },
  { name: 'legacy-m2/2', address: 'TNd4aFZk1YUeP9uzUWCefJyadjCxZXBoBg' },
];

export async function GET(req: NextRequest) {
  const owner = await requireOwner(req);
  if (!owner) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  if (G.__estateCache && Date.now() - G.__estateCache.at < TTL) {
    return NextResponse.json({ ok: true, cached: true, ...(G.__estateCache.data as object) });
  }

  const HEAD = 'headcorner';
  estateRpcFailures = 0; // FIX(R15-b · M2): מונה-כשלים-פר-סריקה

  // ── 1. chain heads (liquid + vested) ──
  const [steemProps, hiveProps, blurtProps] = await Promise.all([
    vestsPerSp('steem', STEEM_NODE), vestsPerSp('hive', HIVE_NODE), vestsPerSp('blurt', BLURT_NODE),
  ]);
  // FIX(3-b · F4c): שער-vests/SP שלא-נמדד — סימון-כנה פר-שרשרת (vested-USD עבורן מוצג 0-לא-מדוד)
  const vestsUnknown = ([
    ['steem', steemProps], ['hive', hiveProps], ['blurt', blurtProps],
  ] as Array<[string, number | null]>).filter(([, v]) => v === null).map(([c]) => c);
  const headRes = await Promise.allSettled([
    jrpc(STEEM_NODE, 'condenser_api.get_accounts', [[HEAD]]),
    jrpc(HIVE_NODE, 'condenser_api.get_accounts', [[HEAD]]),
    jrpc(BLURT_NODE, 'condenser_api.get_accounts', [[HEAD]]),
  ]);
  const accOf = (i: number) => {
    const r = headRes[i];
    if (r.status !== 'fulfilled') return null;
    const res = (r.value.result as Array<Record<string, string>> | undefined);
    return res?.[0] || null;
  };
  const [steemAcc, hiveAcc, blurtAcc] = [accOf(0), accOf(1), accOf(2)];

  const spOf = (acc: Record<string, string> | null, ratio: number) => {
    if (!acc || !ratio) return 0;
    const own = parseFloat(acc.vesting_shares || '0') - parseFloat(acc.delegated_vesting_shares || '0') + parseFloat(acc.received_vesting_shares || '0');
    return own / ratio;
  };

  const heads: Record<string, unknown> = {};
  if (steemAcc) {
    heads.steem = {
      account: HEAD, liquid: parseFloat(steemAcc.balance || '0'), sbd: parseFloat(steemAcc.sbd_balance || '0'),
      savings: parseFloat(steemAcc.savings_balance || '0'), spOwn: spOf(steemAcc, steemProps ?? 0),
      spDelegatedOut: parseFloat(steemAcc.delegated_vesting_shares || '0') / (steemProps || 1),
    };
  }
  if (hiveAcc) {
    heads.hive = {
      account: HEAD, liquid: parseFloat(hiveAcc.balance || '0'), hbd: parseFloat(hiveAcc.hbd_balance || '0'),
      savings: parseFloat(hiveAcc.savings_hive || '0'), hpOwn: spOf(hiveAcc, hiveProps ?? 0),
      hpDelegatedOut: parseFloat(hiveAcc.delegated_vesting_shares || '0') / (hiveProps || 1),
    };
  }
  if (blurtAcc) {
    heads.blurt = {
      account: HEAD, liquid: parseFloat(blurtAcc.balance || '0'),
      bpOwn: spOf(blurtAcc, blurtProps ?? 0),
      bpDelegatedOut: parseFloat(blurtAcc.delegated_vesting_shares || '0') / (blurtProps || 1),
    };
  }

  // ── 1b. צי-HIVE מצטבר (Task 60): כל-חשבונות-הצי — לא רק הראש ──
  const fleetAccounts = (await db.vaultKey.findMany({
    where: { chain: 'steem' }, select: { account: true }, distinct: ['account'], orderBy: { account: 'asc' },
  })).map(r => r.account).filter(a => !a.includes(':') && a !== 'headcorner-archive');
  const fleetHiveRows: Array<{ account: string; liquid: number; hbd: number }> = [];
  let fleetHiveLiquidTotal = 0;
  if (fleetAccounts.length) {
    try {
      const fh = await jrpc(HIVE_NODE, 'condenser_api.get_accounts', [fleetAccounts]);
      const rows = (fh.result as Array<Record<string, string>> | undefined) || [];
      for (const a of rows) {
        if (!a?.name) continue;
        const liquid = parseFloat(a.balance || '0');
        const hbd = parseFloat(a.hbd_balance || '0');
        fleetHiveRows.push({ account: a.name, liquid, hbd });
        fleetHiveLiquidTotal += liquid + hbd;
      }
    } catch { estateRpcFailures++; /* honest-empty — unknown ≠ zero */ }
  }

  // ── 2. Hive-Engine tokens ──
  let heTokens: Array<{ symbol: string; balance: number }> = [];
  try {
    const he = await jrpc('https://api.hive-engine.com/rpc/contracts', 'find', ['tokens', 'balances', { account: HEAD, limit: 100 }]);
    const rows = (he.result as Array<{ symbol?: string; balance?: string; stake?: string }> | undefined) || [];
    heTokens = rows
      .map(b => ({ symbol: String(b.symbol || ''), balance: parseFloat(b.balance || '0') + parseFloat(b.stake || '0') }))
      .filter(b => b.symbol && b.balance > 0)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 12);
  } catch { estateRpcFailures++; /* honest-empty — unknown ≠ zero */ }

  // ── 3. all vault wallets ──
  const wallets = await db.vaultKey.findMany({
    where: { chain: { in: ['evm', 'sol', 'tron', 'btc'] }, role: 'wallet' },
    select: { account: true, chain: true, address: true },
    orderBy: { account: 'asc' },
  });
  const byEntity: Record<string, { evm?: string; sol?: string; tron?: string; btc?: string }> = {};
  for (const w of wallets) {
    const name = w.account.replace(/^wallet:/, '');
    byEntity[name] ||= {};
    if (w.chain === 'evm') byEntity[name].evm = w.address || undefined;
    if (w.chain === 'sol') byEntity[name].sol = w.address || undefined;
    if (w.chain === 'tron') byEntity[name].tron = w.address || undefined;
    if (w.chain === 'btc') byEntity[name].btc = w.address || undefined;
  }
  const entities = Object.entries(byEntity).filter(([, v]) => v.evm || v.sol || v.tron || v.btc);

  // ── 4. EVM balances (12 addresses × 7 chains) ──
  const evmRows: Array<{ entity: string; address: string; chains: Record<string, number> }> = [];
  await Promise.allSettled(entities.map(async ([name, w]) => {
    if (!w.evm) return;
    const chains: Record<string, number> = {};
    await Promise.allSettled(Object.entries(EVM_RPCS).map(async ([net, url]) => {
      try {
        const j = await jrpc(url, 'eth_getBalance', [w.evm, 'latest'], 10000);
        const wei = BigInt(String(j.result || '0x0'));
        const eth = Number(wei) / 1e18;
        if (eth > 0) chains[net] = eth;
      } catch { estateRpcFailures++; /* skip — honest partial */ }
    }));
    if (Object.keys(chains).length) evmRows.push({ entity: name, address: w.evm, chains });
  }));

  // ── 5. SOL balances (batched) ──
  const solRows: Array<{ entity: string; address: string; sol: number }> = [];
  const solAddrs = entities.filter(([, w]) => w.sol);
  try {
    const j = await jrpc(SOL_RPC, 'getMultipleAccounts', [solAddrs.map(([, w]) => w.sol), { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }], 15000);
    // FIX(Roast-63 · H8): טיפוס-אמת-לתשובת-RPC (היה-{} גורר-Property-'value'-לא-קיים)
    const jv = j as { result?: { value?: Array<{ lamports?: number } | null> } };
    const vals = jv.result?.value ?? [];
    solAddrs.forEach(([name, w], i) => {
      const lam = vals[i]?.lamports ?? 0;
      if (lam > 0) solRows.push({ entity: name, address: w.sol!, sol: lam / 1e9 });
    });
  } catch { estateRpcFailures++; /* honest-empty — unknown ≠ zero */ }

  // ── 6. TRON + BTC (serial-ish with spacing) — עתה: כל-הכתובות כולל-לא-מופעלות (מצב-אקטיבציה = נתון) ──
  // FIX(3-b · F4a): trx: number | null — null = RPC לא ענה (לא-נודע) בדיוק-כמו-usdt;
  // היה: (acc?.balance ?? 0)/1e6 = 0.00-פיקטיבי על-כישלון-RPC.
  const tronRows: Array<{ entity: string; address: string; trx: number | null; active: boolean | null; usdt: number | null }> = [];
  for (const [name, w] of entities.filter(([, w]) => w.tron)) {
    const acc = await tronAccount(w.tron!);
    if (acc === undefined) estateRpcFailures++; // לא-ידוע ≠ לא-מופעל
    const usdt = await trc20Balance(w.tron!, TRON_USDT, TRON_USDT_DEC);
    if (usdt === null) estateRpcFailures++;
    tronRows.push({ entity: name, address: w.tron!, trx: acc === undefined ? null : (acc?.balance ?? 0) / 1e6, active: acc === undefined ? null : acc !== null, usdt });
    await new Promise(rr => setTimeout(rr, 800));
  }
  // ── 6b. TRON-legacy (Task 60) — עתה כולל מצב-אקטיבציה + TRC-20-USDT ──
  // FIX(R22): שדה-unfrozen — כסף-מופשר-בחלון-WithdrawBalance (14-ימים) היה-בלתי-נראה
  // במפת-הכסף (frozen=0 + trx בלבד) מיד-אחרי-UnfreezeBalanceV2 חי (txid 3f6d9fa2…).
  // לא-נודע ≠ אפס — כסף-שלנו-בחלון חייב-להיראות.
  const tronLegacyRows: Array<{ name: string; address: string; trx: number | null; active: boolean | null; frozen: number | null; unfrozen: number | null; trc10: Array<{ id: string; value: number }>; usdt: number | null }> = [];
  for (const t of TRON_LEGACY) {
    const acc = await tronAccount(t.address);
    if (acc === undefined) estateRpcFailures++;
    const trc10 = (acc?.assetV2 || []).filter(x => x.value > 0).map(x => ({ id: x.key, value: x.value }));
    const usdt = await trc20Balance(t.address, TRON_USDT, TRON_USDT_DEC);
    if (usdt === null) estateRpcFailures++;
    const frozen = acc === undefined ? null : (acc?.frozenV2 || []).reduce((a, f) => a + (f.amount ?? 0), 0) / 1e6;
    const unfrozen = acc === undefined ? null : (acc?.unfrozenV2 || []).reduce((a, f) => a + (f.unfreeze_amount ?? 0), 0) / 1e6;
    tronLegacyRows.push({ name: t.name, address: t.address, trx: acc === undefined ? null : (acc?.balance ?? 0) / 1e6, active: acc === undefined ? null : acc !== null, frozen, unfrozen, trc10, usdt });
    await new Promise(rr => setTimeout(rr, 800));
  }
  const tronLegacyTrx = tronLegacyRows.reduce((a, r) => a + (r.trx ?? 0), 0);
  const tronLegacyUnfrozen = tronLegacyRows.reduce((a, r) => a + (r.unfrozen ?? 0), 0);

  // ── 6c. SPL tokens (Solana) — סריקה-חיה ראשונה (מונה-לא-נודע נפרד — לא-נודע ≠ אפס) ──
  const splRows: Array<{ entity: string; address: string; tokens: Array<{ mint: string; sym: string | null; amount: number }> }> = [];
  let splUnknownWallets = 0;
  for (const [name, w] of entities.filter(([, w]) => w.sol)) {
    const toks = await solSpl(w.sol!);
    if (toks === null) splUnknownWallets++;
    else if (toks.length) splRows.push({ entity: name, address: w.sol!, tokens: toks });
    await new Promise(rr => setTimeout(rr, 400));
  }

  // ── 6d. ERC-20 (USDT/USDC על ETH+BSC) לכל ארנקי-EVM (מונה-לא-נודע נפרד) ──
  const erc20Rows: Array<{ entity: string; address: string; tokens: Array<{ net: string; sym: string; amount: number }> }> = [];
  let erc20UnknownCalls = 0;
  await Promise.allSettled(entities.map(async ([name, w]) => {
    if (!w.evm) return;
    const tokens: Array<{ net: string; sym: string; amount: number }> = [];
    await Promise.allSettled(Object.entries(ERC20_TOKENS).map(async ([net, list]) => {
      for (const t of list) {
        const bal = await erc20Balance(net, w.evm!, t);
        if (bal === null) erc20UnknownCalls++;
        else if (bal > 0) tokens.push({ net, sym: t.sym, amount: bal });
      }
    }));
    if (tokens.length) erc20Rows.push({ entity: name, address: w.evm!, tokens });
  }));
  const trc20UnknownCalls = tronRows.filter(r => r.usdt === null).length + tronLegacyRows.filter(r => r.usdt === null).length;

  const btcRows: Array<{ entity: string; address: string; btc: number }> = [];
  for (const [name, w] of entities.filter(([, w]) => w.btc)) {
    try {
      const r = await fetch(`https://mempool.space/api/address/${w.btc}`, { signal: AbortSignal.timeout(9000), cache: 'no-store', headers: { 'User-Agent': 'saos-estate/1.0' } });
      if (r.ok) {
        const j = (await r.json()) as { chain_stats: { funded_txo_sum: number; spent_txo_sum: number }; mempool_stats?: { funded_txo_sum: number; spent_txo_sum: number } };
        const s = (j.chain_stats.funded_txo_sum - j.chain_stats.spent_txo_sum) + (j.mempool_stats ? j.mempool_stats.funded_txo_sum - j.mempool_stats.spent_txo_sum : 0);
        if (s > 0) btcRows.push({ entity: name, address: w.btc!, btc: s / 1e8 });
      }
    } catch { estateRpcFailures++; /* skip — honest partial */ }
    await new Promise(rr => setTimeout(rr, 140));
  }

  // ── 7. ETH gas for sweep estimate ──
  let gasGwei = 2;
  try {
    const j = await jrpc(EVM_RPCS.ethereum, 'eth_gasPrice', [], 8000);
    gasGwei = Number(BigInt(String(j.result || '0x77359400'))) / 1e9;
  } catch { /* default */ }
  const sweepGasEth = (evmRows.length * 21000 * gasGwei) / 1e9;

  // ── 8. prices + totals ──
  const prices = await getPrices();
  // FIX(3-b · F4b): usd() היה מחזיר $0.00 בשקט על-מחיר-חסר — עתה: אוסף-כנות
  // priceMissing (סמלים) שמוצג לצד rpcFailures/partialNote (לא-נודע ≠ אפס).
  const priceMissing = new Set<string>();
  const usd = (sym: string, amt: number) => {
    const pr = prices[sym];
    if (!pr) { priceMissing.add(sym); return 0; }
    return amt * pr.usd;
  };

  const s = heads.steem as { liquid: number; sbd: number; spOwn: number; spDelegatedOut: number } | undefined;
  const h = heads.hive as { liquid: number; hbd: number; hpOwn: number; hpDelegatedOut: number } | undefined;
  const b = heads.blurt as { liquid: number; bpOwn: number; bpDelegatedOut: number } | undefined;

  const solTotal = solRows.reduce((a, r) => a + r.sol, 0);
  const ethTotal = evmRows.reduce((a, r) => a + (r.chains.ethereum || 0), 0);
  const trxTotal = tronRows.reduce((a, r) => a + (r.trx ?? 0), 0);
  const btcTotal = btcRows.reduce((a, r) => a + r.btc, 0);

  // ── טוקנים: סה״כ-ערך (רק-מה שיש-לו מחיר-חוץ — מנטות-לא-מוכרות מדווחות בלבד, בלי-שווי-מומצא) ──
  // FIX(3-b · F4b): גם-כאן — סמל-מוכר-בלי-מחיר-חוץ נאסף ל-priceMissing (לא-נודע ≠ אפס)
  const splUsd = splRows.reduce((a, r) => a + r.tokens.reduce((b, t) => {
    if (!t.sym) return b;
    const pr = prices[t.sym.toLowerCase()];
    if (!pr) { priceMissing.add(t.sym.toLowerCase()); return b; }
    return b + t.amount * pr.usd;
  }, 0), 0);
  const splUnknownMints = splRows.reduce((a, r) => a + r.tokens.filter(t => !t.sym).length, 0);
  const trc20UsdtUnits = tronRows.reduce((a, r) => a + (r.usdt || 0), 0) + tronLegacyRows.reduce((a, r) => a + (r.usdt || 0), 0);
  // FIX(3-b · F4b): USDT-טרון בלי-מחיר — 0-לא-מדוד מסומן, לא אפס-עובדתי
  let trc20UsdtUsd = 0;
  if (prices.usdt) trc20UsdtUsd = trc20UsdtUnits * prices.usdt.usd;
  else if (trc20UsdtUnits > 0) priceMissing.add('usdt');
  const erc20Usd = erc20Rows.reduce((a, r) => a + r.tokens.reduce((b, t) => {
    const pr = prices[t.sym.toLowerCase()];
    if (!pr) { priceMissing.add(t.sym.toLowerCase()); return b; }
    return b + t.amount * pr.usd;
  }, 0), 0);
  const tronActivated = tronRows.filter(r => r.active === true).length;
  const tronUnknown = tronRows.filter(r => r.active === null).length + tronLegacyRows.filter(r => r.active === null).length;

  const totals = {
    steemLiquidUsd: s ? usd('steem', s.liquid) : 0,
    steemVestedUsd: s ? usd('steem', s.spOwn) : 0,
    // FIX(Roast-63 · H4): SBD-לא-נסחר-עוד-ב-1$-מזמן — מחיר-אמת-מהפיד (steem-dollars).
    sbdUsd: s ? usd('sbd', s.sbd) : 0,
    hiveLiquidUsd: h ? usd('hive', h.liquid) : 0,
    hiveVestedUsd: h ? usd('hive', h.hpOwn) : 0,
    blurtLiquidUsd: b ? usd('blurt', b.liquid) : 0,
    blurtVestedUsd: b ? usd('blurt', b.bpOwn) : 0,
    evmEthUsd: usd('eth', ethTotal),
    solUsd: usd('sol', solTotal),
    tronUsd: usd('trx', trxTotal),
    btcUsd: usd('btc', btcTotal),
    tronLegacyUsd: usd('trx', tronLegacyTrx),
    tronLegacyUnfrozenUsd: usd('trx', tronLegacyUnfrozen),
    fleetHiveUsd: usd('hive', fleetHiveLiquidTotal),
    heTokens: heTokens.length,
    splUsd,
    trc20UsdtUsd,
    erc20Usd,
  };

  const grandUsd = totals.steemLiquidUsd + totals.steemVestedUsd + totals.sbdUsd + totals.hiveLiquidUsd + totals.hiveVestedUsd
    + totals.blurtLiquidUsd + totals.blurtVestedUsd + totals.evmEthUsd + totals.solUsd + totals.tronUsd + totals.btcUsd
    + totals.tronLegacyUsd + totals.tronLegacyUnfrozenUsd + totals.fleetHiveUsd + splUsd + trc20UsdtUsd + erc20Usd;

  // ── 9. התשובה הכנה: כמה אפשר לממש עכשיו ──
  const fundedEvm = evmRows.filter(r => (r.chains.ethereum || 0) > 0);
  const cashOut = {
    eth: {
      inDexLiquidity: 0, // כנות: אין שוק-ETH ב-DEX — אפס נזילות-ETH ישירה
      realEstateEth: ethTotal,
      sweepGasEth: sweepGasEth,
      sweepGasGwei: gasGwei,
      netAfterSweepEth: Math.max(0, ethTotal - sweepGasEth),
      fundedAddresses: fundedEvm.length,
      verdict: ethTotal > 0
        ? `${ethTotal.toPrecision(3)} ETH אמיתיים פרוסים על ${fundedEvm.length} ארנקים; איחוד-מלא עולה ~${sweepGasEth.toFixed(6)} ETH גז`
        : 'אין ETH באחוזה',
    },
    paths: [
      { name: 'STEEM נזיל (headcorner) → שוק-חוץ → ETH', amount: s?.liquid || 0, sym: 'STEEM', usd: totals.steemLiquidUsd },
      { name: 'SBD → שוק-חוץ (מחיר-אמת-מהפיד — לא-עוגן-1:1)', amount: s?.sbd || 0, sym: 'SBD', usd: totals.sbdUsd },
      { name: 'BLURT נזיל → שוק-חוץ', amount: b?.liquid || 0, sym: 'BLURT', usd: totals.blurtLiquidUsd },
      { name: 'HIVE נזיל → שוק-חוץ', amount: h?.liquid || 0, sym: 'HIVE', usd: totals.hiveLiquidUsd },
      { name: 'SOL חיילים (איחוד → שוק-חוץ)', amount: solTotal, sym: 'SOL', usd: totals.solUsd },
      { name: 'ETH חיילים (איחוד → שוק-חוץ)', amount: ethTotal, sym: 'ETH', usd: totals.evmEthUsd },
      { name: `צי-HIVE מצטבר (${fleetHiveRows.length} חשבונות-נסרקו) → שוק-חוץ`, amount: fleetHiveLiquidTotal, sym: 'HIVE', usd: totals.fleetHiveUsd },
      { name: 'טרון-לגסי (אבק-מנמוניק #2) — להעביר ל-TVN3 ולממש', amount: tronLegacyTrx, sym: 'TRX', usd: totals.tronLegacyUsd },
      ...(tronLegacyUnfrozen > 0 ? [{ name: 'טרון-מופשר (חלון-WithdrawBalance 14-ימים) — שלב-חתימה-שני מהריפו', amount: tronLegacyUnfrozen, sym: 'TRX', usd: totals.tronLegacyUnfrozenUsd, locked: true }] : []),
      { name: 'STEEM vested (כוח-צי — מוגן-הוראה-R24 איסור-powerdown) — נעול', amount: s?.spOwn || 0, sym: 'SP', usd: totals.steemVestedUsd, locked: true },
      { name: 'BLURT vested (כוח-צי — מוגן-הוראה-R24) — נעול', amount: b?.bpOwn || 0, sym: 'BP', usd: totals.blurtVestedUsd, locked: true },
      ...(splUsd > 0 ? [{ name: 'SPL-טוקנים (סריקה חיה) — פירוט בכרטיסת הטוקנים', amount: splUsd, sym: 'USD', usd: splUsd }] : []),
      ...(trc20UsdtUsd > 0 ? [{ name: 'TRC-20 USDT (כספת+לגסי, סריקה חיה)', amount: trc20UsdtUnits, sym: 'USDT', usd: trc20UsdtUsd }] : []),
      ...(erc20Usd > 0 ? [{ name: 'ERC-20 USDT/USDC על ETH+BSC (סריקה חיה)', amount: erc20Usd, sym: 'USD', usd: erc20Usd }] : []),
    ],
  };

  // FIX(Roast-63 · H3): ספירות-אמת-לדוח-הסריקה (מהקוד-שרץ, לא-ממחרוזת)
  const totalKeys = await db.vaultKey.count();
  const evmCount = entities.filter(([, w]) => w.evm).length;
  const solCount = entities.filter(([, w]) => w.sol).length;
  const tronCount = entities.filter(([, w]) => w.tron).length;
  const btcCount = entities.filter(([, w]) => w.btc).length;

  // FIX(3-b · F4b/c): הערת-האמת-המאוחדת — כשלי-RPC + מחירים-חסרים + שערי-vests-שלא-נמדדו
  const honestyNotes: string[] = [];
  if (estateRpcFailures > 0) honestyNotes.push(`${estateRpcFailures} קריאות-RPC נכשלו בסריקה — הרשימה עלולה להיות חלקית (לא-נודע ≠ אפס פיזי)`);
  if (priceMissing.size) honestyNotes.push(`אין מחיר-חוץ עבור: ${[...priceMissing].sort().join(', ')} — ה-$ שלהן מוצג 0-לא-מדוד (לא-נודע ≠ אפס)`);
  if (vestsUnknown.length) honestyNotes.push(`שער-vests/SP לא נמדד עבור: ${vestsUnknown.join(', ')} — vested-USD מוצג 0-לא-מדוד`);

  const data = {
    at: new Date().toISOString(),
    heads, heTokens,
    wallets: { evm: evmRows, sol: solRows, tron: tronRows, btc: btcRows },
    tokens: { spl: splRows, splUnknownWallets, trc20: tronRows.map(r => ({ entity: r.entity, address: r.address, usdt: r.usdt })), trc20UnknownCalls, erc20: erc20Rows, erc20UnknownCalls },
    tronActivation: { total: tronRows.length, activated: tronActivated, unknown: tronUnknown },
    tronLegacy: tronLegacyRows,
    fleetHive: { rows: fleetHiveRows, liquidTotal: fleetHiveLiquidTotal },
    scan: {
      sweep: 'task-60',
      // FIX(Roast-63 · H3): כל-המספרים-כאן-מחושבים-מהקוד-שרץ-בפועל (היו-מחרוזת-קבועה-שהציגה-
      // סריקות-שלא-בוצעו: ERC-20/SPL מעולם-לא-נסרקו-בקוד-זה).
      checked: [
        `${entities.length} מפתחות-כספת-נסרקו (מתוך ${totalKeys} בכספת)`,
        `${evmCount} ארנקי-EVM × ${Object.keys(EVM_RPCS).length} רשתות (נייטיב)`,
        `${solCount} ארנקי-SOL (נייטיב + SPL סריקה-חיה)`,
        `${tronCount} ארנקי-TRON + ${tronLegacyRows.length} לגסי (נייטיב + TRC-20-USDT + מצב-אקטיבציה)`,
        `ERC-20 USDT/USDC על ETH+BSC לכל ארנקי-EVM`,
        `${btcCount} ארנקי-BTC`,
        `${fleetHiveRows.length} חשבונות-צי-HIVE`,
      ].join(' · '),
      zero: 'BTC · BSC/Polygon/ARB/Base/OP/AVAX נייטיב — אפסים כנים · SPL/TRC-20/ERC-20 — סריקה-חיה מלאה בסבב-זה · מנטות-SPL לא-מוכרות: מדווחות-בלבד, בלי-שווי-מומצא',
      rpcFailures: estateRpcFailures,
      // FIX(3-b · F4b/c): מוני-כנות נוספים — סמלים-בלי-מחיר + שערי-vests-שלא-נמדדו
      priceMissing: [...priceMissing].sort(),
      vestsUnknown,
      partialNote: honestyNotes.length ? honestyNotes.join(' · ') : null,
      resolved: 'מעטפת-0.0997ETH = דלק-DEX-היסטורי · ״legacy 117k״ = תווית-דור מהפרויקט-הישן (לא סכום) · 9.68-HIVE = מדידה-היסטורית-שגויה (אין-op-עברה-בשרשרת)',
    },
    prices,
    totals: { ...totals, grandUsd },
    cashOut,
  };
  G.__estateCache = { at: Date.now(), data };
  await audit('estate-scan', `grandUsd=${grandUsd.toFixed(2)} eth=${ethTotal.toPrecision(3)} sol=${solTotal.toPrecision(3)}`);
  return NextResponse.json({ ok: true, cached: false, ...data });
}
