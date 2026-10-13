// ═══ מנוע-הערך-האמתי (THE REAL-VALUE ENGINE · EXEC-CD-30) ════════════════════
// השאלה-של-המפעיל: "איך נהפוך את הכסף-הפנימי-שלנו לאמיתי-בעל-ערך... צעד-צעד
// לשטוף את זה... מה יש בפעילות... אילו שערים מה יש לנו ומה זה יוכל להניב?"
//
// התשובה-ההנדסית: **מדידה-קודם-הכל** — אי-אפשר לשטוף מה שלא נמדד. המנוע הזה
// קושר את שלושת-העולמות שכבר-חיים:
//   (1) האוצר-האמיתי — כתובות-כספת-הריפו על-השרשראות (RPC-ציבורי, אפס-סודות)
//       × מחירי-שוק-אמת (CoinGecko→Binance) = שווי-אמת-בדולר.
//   (2) הדקס-הפנימי — סולם-העתודה (reserve) + הכלכלה (state) על :3010.
//   (3) השערים — הדלת (peg-in מאומת-RPC), הגשר (ה-bridge-החי), הארביטראז
//       (vault-swap), רכבת-הפג (STEEM), הסוכנים (לגיון→עמלות→סחיבה), הפדיון.
// וכותב תמונת-מצב (ValueSnapshot) בכל-פעימה — השטיפה-הופכת-עקומה-מדידה.
//
// כנות: כל-מספר כאן נמדד-חי או מסומן-null. אין-הדמיה-מחופשת-להכנסה. הפער
// (supply מול real) מוצג-כפער — זהו-הפער-שהפעילות סוגרת, צעד-צעד.

import fs from 'fs';
import { MANIFEST, vaultFile, vaultExists } from './repo-vault';
import { fetchJson, cacheGet, cacheSet, singleFlight } from './live/cache';
import { scanArb, type ArbScan } from './arb-scanner';

export type { ArbScan, ArbEdge } from './arb-scanner';

const DEX = 'http://127.0.0.1:3010/saos-dex/api/dex';
const SOL_RPCS = ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com'] as const;
const USDC_SOL_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/** ידוע-אחרון-הטוב של מחירי-השוק (מוצג-כ-stale — לא-מתחפה-לחי). */
let lastGoodPrices: { data: MarketPrices; at: number } | null = null;

/** SOL-RPC-דרך-סולם (ראשי → publicnode) — 429-מ-IP-משותף נמדד-חי.
 * FIX(EXEC-CD-31 · truth): publicnode החזיר **0-חשבונות-SPL-כוזב** (נמדד-חי מול
 * mainnet-beta שהראה את-היתרה-האמתית) — 0-שקר-מ-fallback לא נאמן לעולם. */
async function solRpc<T>(body: unknown, timeoutMs = 9_000): Promise<T> {
  let lastErr: unknown = null;
  for (const rpc of SOL_RPCS) {
    try {
      return await fetchJson<T>(rpc, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }, timeoutMs);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('sol-rpc-ladder-exhausted');
}

// ─── (1) האוצר-האמיתי — מחירי-שוק + יתרות-חי ────────────────────────────────

export interface MarketPrices {
  ok: boolean;
  prices: Record<string, number>; // symbol(upper) → $price
  source: string;
  stale?: boolean;
  at: string;
}

// FIX(EXEC-CD-32 · עצמאות-כלכלית): סולם-מקורות-מדורג — היה CoinGecko→Binance
// ונמדד-חי: שניהם נפלו-יחד (העקומה מורעבת — priceSource 'binance' עם מפה-ריקה
// ו-usd:null בכל-השורות). עתה: 4 מקורות, כל-מקור משלים רק-את-החסר (merge-שכבתי):
// CoinGecko → Binance-vision → CryptoCompare → Jupiter-Price (מחיר-מהשרשרת-עצמה
// עבור USDC/SOL — בדיוק-הנכסים-שהאוצר מחזיק, מאותו-מקום-שבו-יבוצע-הביצוע).
async function fetchPricesCoinGecko(): Promise<Record<string, number>> {
  const ids = 'steem,tron,solana,ethereum,binancecoin,bitcoin,usd-coin';
  const rows = await fetchJson<Array<{ symbol: string; current_price: number }>>(
    `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&per_page=10&page=1`,
    undefined, 10_000,
  );
  const out: Record<string, number> = {};
  for (const r of rows ?? []) {
    const sym = String(r.symbol ?? '').toUpperCase();
    if (sym && Number.isFinite(r.current_price) && r.current_price > 0) out[sym] = r.current_price;
  }
  return out;
}

async function fetchPricesBinance(): Promise<Record<string, number>> {
  const symbols = ['STEEMUSDT', 'TRXUSDT', 'SOLUSDT', 'ETHUSDT', 'BNBUSDT', 'BTCUSDT', 'USDCUSDT'];
  const arr = await fetchJson<Array<{ symbol: string; lastPrice: string }>>(
    `https://data-api.binance.vision/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(symbols))}`,
    undefined, 10_000,
  );
  const out: Record<string, number> = {};
  for (const t of arr ?? []) {
    const sym = String(t.symbol ?? '').replace(/USDT$/, '').toUpperCase();
    const p = Number.parseFloat(t.lastPrice);
    if (sym && Number.isFinite(p) && p > 0) out[sym] = p;
  }
  return out;
}

async function fetchPricesCryptoCompare(): Promise<Record<string, number>> {
  const j = await fetchJson<Record<string, { USD?: number }>>(
    'https://min-api.cryptocompare.com/data/pricemulti?fsyms=STEEM,TRX,SOL,ETH,BNB,BTC,USDC&tsyms=USD',
    undefined, 10_000,
  );
  const out: Record<string, number> = {};
  for (const [sym, cur] of Object.entries(j ?? {})) {
    const p = Number(cur?.USD);
    if (sym && Number.isFinite(p) && p > 0) out[sym.toUpperCase()] = p;
  }
  return out;
}

const SOL_MINT = 'So11111111111111111111111111111111111111112';

async function fetchPricesJupiterChain(): Promise<Record<string, number>> {
  // מחיר-אמת-מהשרשרת (Jupiter-Price v3) — ה-USDC וה-SOL של-האוצר-עצמם
  const j = await fetchJson<Record<string, { usdPrice?: number }>>(
    `https://lite-api.jup.ag/price/v3?ids=${USDC_SOL_MINT},${SOL_MINT}`,
    undefined, 10_000,
  );
  const out: Record<string, number> = {};
  const pUsdc = Number(j?.[USDC_SOL_MINT]?.usdPrice);
  const pSol = Number(j?.[SOL_MINT]?.usdPrice);
  if (Number.isFinite(pUsdc) && pUsdc > 0) out.USDC = pUsdc;
  if (Number.isFinite(pSol) && pSol > 0) out.SOL = pSol;
  return out;
}

/** מחירי-שוק-אמת לסל-האוצר — סולם-מדורג-ממוזג + מטמון-TTL + single-flight +
 * stale-כנה בכישלון-מוחלט. כל-מקור נכשל → הבא; חלקי-תקין > שקר-מלא. */
export async function getMarketPrices(): Promise<MarketPrices> {
  const key = 've:market-prices';
  const hit = cacheGet<{ data: MarketPrices; cachedAt: number }>(key, true);
  if (hit && hit.expiresAt > Date.now()) return { ...hit.value.data, stale: false };
  const sources: Array<{ name: string; fetch: () => Promise<Record<string, number>> }> = [
    { name: 'coingecko', fetch: fetchPricesCoinGecko },
    { name: 'binance', fetch: fetchPricesBinance },
    { name: 'cryptocompare', fetch: fetchPricesCryptoCompare },
    { name: 'jupiter-chain', fetch: fetchPricesJupiterChain },
  ];
  const merged: Record<string, number> = {};
  const used: string[] = [];
  for (const src of sources) {
    if (Object.keys(merged).length >= 7) break; // הסל-מלא — די
    try {
      const p = await singleFlight(`${key}:${src.name}`, src.fetch);
      let added = 0;
      for (const [sym, price] of Object.entries(p)) {
        if (merged[sym] === undefined) { merged[sym] = price; added++; }
      }
      if (added > 0) used.push(src.name);
    } catch { /* fail-honest — המקור-הבא */ }
  }
  const data: MarketPrices = {
    ok: Object.keys(merged).length > 0,
    prices: merged,
    source: used.length > 0 ? used.join('+') : 'unavailable',
    at: new Date().toISOString(),
  };
  if (data.ok) { cacheSet(key, { data, cachedAt: Date.now() }, 240_000); lastGoodPrices = { data, at: Date.now() }; return data; }
  // כנות-מוצגת: ידוע-אחרון עם סימון stale (עד-שעה) — מוצג-ככזה, לא-מתחפה-לחי
  if (lastGoodPrices && Date.now() - lastGoodPrices.at < 3_600_000) {
    return { ...lastGoodPrices.data, stale: true };
  }
  if (hit) return { ...hit.value.data, stale: true };
  return { ok: false, prices: {}, source: 'unavailable', at: data.at };
}

export interface TreasuryRow {
  network: string;
  asset: string; // SOL | USDC | TRX | BTC | ETH
  address: string; // מקוצר-לתצוגה
  amount: number | null; // יחידות-אנושיות
  unit: string;
  usd: number | null; // שווי-בדולר (מחיר-שוק-אמת)
  ok: boolean;
  error?: string;
}

export interface RealTreasury {
  ok: boolean;
  rows: TreasuryRow[];
  totalUsd: number; // Σ שווי-אמת (0 אם-לא-נמדד)
  measuredUsd: number; // Σ רק-השורות-שנמדדו (להבדיל מ-0-פיזי)
  priceSource: string;
  at: string;
}

/** מדידת-האוצר-האמיתי: כתובות-הכספת מה-manifest + USDC-SPL על-זהות-ה-SOL,
 * מתומחרים-במחירי-שוק-אמת. אפס-סודות — כתובות-ציבוריות-בלבד. */
export async function getRealTreasury(): Promise<RealTreasury> {
  const at = new Date().toISOString();
  if (!fs.existsSync(vaultFile(MANIFEST))) {
    return { ok: false, rows: [], totalUsd: 0, measuredUsd: 0, priceSource: 'none', at };
  }
  const m = JSON.parse(fs.readFileSync(vaultFile(MANIFEST), 'utf8')) as {
    networks?: Array<{ network: string; address: string }>;
  };
  const by = (n: string): string | null => m.networks?.find(x => x.network === n)?.address ?? null;
  const solAddr = by('solana');
  const tronAddr = by('tron');
  const btcAddr = by('bitcoin');
  const evmAddr = by('evm');
  const mk = getMarketPrices();
  const solBal = solAddr ? solNative(solAddr) : Promise.resolve<TreasuryRow | null>(null);
  const usdcBal = solAddr ? solUsdc(solAddr) : Promise.resolve<TreasuryRow | null>(null);
  const tronBal = tronAddr ? tronNative(tronAddr) : Promise.resolve<TreasuryRow | null>(null);
  const btcBal = btcAddr ? btcNative(btcAddr) : Promise.resolve<TreasuryRow | null>(null);
  const evmBal = evmAddr ? evmNative(evmAddr) : Promise.resolve<TreasuryRow | null>(null);
  const [mkR, sol, usdc, trx, btc, eth] = await Promise.all([mk, solBal, usdcBal, tronBal, btcBal, evmBal]);
  const rows: TreasuryRow[] = [usdc, sol, trx, eth, btc].filter((r): r is TreasuryRow => r !== null);
  const price = (sym: string): number | null => mkR.prices[sym] ?? null;
  let totalUsd = 0, measuredUsd = 0;
  for (const r of rows) {
    if (r.amount === null || !r.ok) continue;
    const p = price(r.asset);
    if (p === null) continue;
    r.usd = Math.round(r.amount * p * 1e6) / 1e6;
    totalUsd += r.usd;
    measuredUsd += r.usd;
  }
  return {
    ok: rows.some(r => r.ok),
    rows, totalUsd: Math.round(totalUsd * 1e6) / 1e6, measuredUsd: Math.round(measuredUsd * 1e6) / 1e6,
    priceSource: mkR.source, at,
  };
}

const short = (a: string): string => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

async function solNative(addr: string): Promise<TreasuryRow | null> {
  try {
    const j = await solRpc<{ result?: { value?: number } }>({
      jsonrpc: '2.0', id: 1, method: 'getBalance', params: [addr, { commitment: 'confirmed' }],
    });
    const lam = j?.result?.value;
    if (lam === undefined) return { network: 'solana', asset: 'SOL', address: short(addr), amount: null, unit: 'SOL', usd: null, ok: false, error: 'rpc-no-value' };
    return { network: 'solana', asset: 'SOL', address: short(addr), amount: lam / 1e9, unit: 'SOL', usd: null, ok: true };
  } catch (e) {
    return { network: 'solana', asset: 'SOL', address: short(addr), amount: null, unit: 'SOL', usd: null, ok: false, error: msg(e) };
  }
}

type SolTokenResp = {
  result?: {
    value?: Array<{
      account?: { data?: { parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string } } } } };
    }>;
  };
};

async function solUsdc(addr: string): Promise<TreasuryRow | null> {
  // FIX(EXEC-CD-31 · truth): USDC נשאל-מה-RPC-הקנוני (mainnet-beta) קודם-הכל.
  // 0-חשבונות מ-fallback לא נאמן (נמדד-חי: publicnode+ankr החזירו 0 בעוד
  // mainnet-beta מראה 6.350293 אמת) — fail-closed כפרובה-לא-מאומתת, לא 0-שקר.
  const body = JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner',
    params: [addr, { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }, { encoding: 'jsonParsed', commitment: 'confirmed' }],
  });
  const ask = (rpc: string): Promise<SolTokenResp> =>
    fetchJson<SolTokenResp>(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body }, 10_000);
  try {
    const j = await ask(SOL_RPCS[0]);
    const { sum, seen } = sumUsdcAccounts(j);
    if (!seen && sum === 0) return { network: 'solana', asset: 'USDC', address: short(addr), amount: 0, unit: 'USDC', usd: null, ok: true };
    return { network: 'solana', asset: 'USDC', address: short(addr), amount: sum / 1e6, unit: 'USDC', usd: null, ok: true };
  } catch (mainErr) {
    // mainnet-beta נפל (429) — מנסים-פולבק; **0-מפולבק = לא-הוכח** (fail-closed)
    try {
      const j = await ask(SOL_RPCS[SOL_RPCS.length - 1]);
      const { sum } = sumUsdcAccounts(j);
      if (sum > 0) return { network: 'solana', asset: 'USDC', address: short(addr), amount: sum / 1e6, unit: 'USDC', usd: null, ok: true };
      return {
        network: 'solana', asset: 'USDC', address: short(addr), amount: null, unit: 'USDC', usd: null, ok: false,
        error: `usdc-spl-unverified: fallback מחזיר 0 בלי-אימות-קנוני (mainnet-beta: ${msg(mainErr).slice(0, 60)})`,
      };
    } catch (e) {
      return { network: 'solana', asset: 'USDC', address: short(addr), amount: null, unit: 'USDC', usd: null, ok: false, error: msg(e) };
    }
  }
}

function sumUsdcAccounts(j: SolTokenResp): { sum: number; seen: boolean } {
  let sum = 0; let seen = false;
  for (const acc of j?.result?.value ?? []) {
    const info = acc?.account?.data?.parsed?.info;
    if (info?.mint !== USDC_SOL_MINT) continue;
    seen = true;
    sum += Number.parseInt(info?.tokenAmount?.amount ?? '0', 10);
  }
  return { sum, seen };
}

async function tronNative(addr: string): Promise<TreasuryRow | null> {
  // FIX(EXEC-CD-31 · truth): /wallet/getaccount — ה-API-הסמכותי (v1/accounts מדלג
  // על balance במטמון — ייצר 0-כוזב בצופה; אותו-תיקון כאן)
  try {
    const j = await fetchJson<{ address?: string; balance?: number }>('https://api.trongrid.io/wallet/getaccount', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: addr, visible: true }),
    }, 9_000);
    const activated = typeof j.address === 'string' && j.address.length > 0;
    const raw = j.balance ?? 0;
    return { network: 'tron', asset: 'TRX', address: short(addr), amount: raw / 1e6, unit: 'TRX', usd: null, ok: activated };
  } catch (e) {
    return { network: 'tron', asset: 'TRX', address: short(addr), amount: null, unit: 'TRX', usd: null, ok: false, error: msg(e) };
  }
}

async function btcNative(addr: string): Promise<TreasuryRow | null> {
  try {
    const j = await fetchJson<{ chain_stats: { funded_txo_sum: number; spent_txo_sum: number } }>(`https://blockstream.info/api/address/${addr}`, undefined, 9_000);
    const sat = (j?.chain_stats?.funded_txo_sum ?? 0) - (j?.chain_stats?.spent_txo_sum ?? 0);
    return { network: 'bitcoin', asset: 'BTC', address: short(addr), amount: sat / 1e8, unit: 'BTC', usd: null, ok: true };
  } catch (e) {
    return { network: 'bitcoin', asset: 'BTC', address: short(addr), amount: null, unit: 'BTC', usd: null, ok: false, error: msg(e) };
  }
}

async function evmNative(addr: string): Promise<TreasuryRow | null> {
  try {
    const j = await fetchJson<{ result?: string }>('https://ethereum-rpc.publicnode.com', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [addr, 'latest'] }),
    }, 9_000);
    if (!j?.result) return { network: 'evm', asset: 'ETH', address: short(addr), amount: null, unit: 'ETH', usd: null, ok: false, error: 'rpc-no-value' };
    return { network: 'evm', asset: 'ETH', address: short(addr), amount: Number(BigInt(j.result)) / 1e18, unit: 'ETH', usd: null, ok: true };
  } catch (e) {
    return { network: 'evm', asset: 'ETH', address: short(addr), amount: null, unit: 'ETH', usd: null, ok: false, error: msg(e) };
  }
}

const msg = (e: unknown): string => (e instanceof Error ? e.message.slice(0, 140) : String(e).slice(0, 140));

// ─── (2) הדקס-הפנימי — סולם-העתודה + הכלכלה ────────────────────────────────

export interface DexReserve {
  ok: boolean;
  height: number;
  phase: number;
  phaseName: string;
  phaseNote: string;
  supplyMu: number;
  unitMu: number;
  realMu: number;
  unitBps: number;
  realBps: number;
  holdings: Record<string, number>;
  nextGapMu: number | null;
  redeemOpen: boolean;
  income: { poolFeesMu: number; feeMeterMu: number; treasuryProfitEverMu: number; ladderSpentMu: number } | null;
}

export async function getDexReserve(): Promise<DexReserve> {
  try {
    const [res, st] = await Promise.all([
      fetchJson<Record<string, unknown>>(`${DEX}/reserve`, undefined, 8_000),
      fetchJson<{ state?: Record<string, unknown> }>(`${DEX}/state`, undefined, 8_000),
    ]);
    const m = (res.measure ?? {}) as Record<string, unknown>;
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const next = (res.next ?? null) as { unitGapMu?: number } | null;
    const income = (st.state?.income ?? null) as { poolFeesMu?: number; feeMeterMu?: number; treasuryProfitEverMu?: number; ladderSpentMu?: number } | null;
    return {
      ok: true,
      height: Number(res.height ?? 0),
      phase: Number(res.phase ?? 0),
      phaseName: String(res.phaseName ?? '—'),
      phaseNote: String(res.phaseNote ?? ''),
      supplyMu: num(m.supplyMu),
      unitMu: num(m.unitMu),
      realMu: num(m.realMu),
      unitBps: num(m.unitBps),
      realBps: num(m.realBps),
      holdings: (m.holdings ?? {}) as Record<string, number>,
      nextGapMu: next?.unitGapMu ?? null,
      redeemOpen: Boolean((res.redeem as { open?: boolean } | undefined)?.open),
      income: income ? {
        poolFeesMu: income.poolFeesMu ?? 0,
        feeMeterMu: income.feeMeterMu ?? 0,
        treasuryProfitEverMu: income.treasuryProfitEverMu ?? 0,
        ladderSpentMu: income.ladderSpentMu ?? 0,
      } : null,
    };
  } catch (e) {
    return {
      ok: false, height: 0, phase: -1, phaseName: 'לא-זמין', phaseNote: msg(e),
      supplyMu: 0, unitMu: 0, realMu: 0, unitBps: 0, realBps: 0, holdings: {},
      nextGapMu: null, redeemOpen: false, income: null,
    };
  }
}

// ─── (3) מכ"ם-הסטיות — מחיר-פנימי מול מחיר-אמת ─────────────────────────────

export interface DeviationRow {
  asset: string; // WSTEEM | WTRX | WSOL | WETH | WBNB | WBTC(=BTC)
  realSymbol: string; // STEEM | TRX | SOL | ETH | BNB | BTC
  internalUsd: number | null; // מהאורקל-הקנוני (µ→$)
  realUsd: number | null; // מהשוק (CoinGecko/Binance)
  deviationPct: number | null; // (פנימי−אמת)/אמת × 100
  verdict: 'converged' | 'drift' | 'divergent' | 'unmeasured';
}

const RADAR: Array<{ asset: string; realSymbol: string }> = [
  { asset: 'WSTEEM', realSymbol: 'STEEM' },
  { asset: 'WTRX', realSymbol: 'TRX' },
  { asset: 'WSOL', realSymbol: 'SOL' },
  { asset: 'WETH', realSymbol: 'ETH' },
  { asset: 'WBNB', realSymbol: 'BNB' },
  { asset: 'BTC', realSymbol: 'BTC' },
];

export async function getDeviationRadar(mk?: MarketPrices): Promise<DeviationRow[]> {
  const prices = mk ?? await getMarketPrices();
  let oracle: Record<string, { mu?: number }> = {};
  try {
    const st = await fetchJson<{ state?: { oracle?: Record<string, { mu?: number }> } }>(`${DEX}/state`, undefined, 8_000);
    oracle = st.state?.oracle ?? {};
  } catch { oracle = {}; }
  return RADAR.map(({ asset, realSymbol }) => {
    const mu = oracle[asset]?.mu;
    const internalUsd = mu && mu > 0 ? mu / 1e6 : null;
    const realUsd = prices.prices[realSymbol] ?? null;
    const deviationPct = internalUsd !== null && realUsd !== null && realUsd > 0
      ? Math.round(((internalUsd - realUsd) / realUsd) * 1e4) / 100
      : null;
    const verdict: DeviationRow['verdict'] = deviationPct === null
      ? 'unmeasured'
      : Math.abs(deviationPct) < 3 ? 'converged'
        : Math.abs(deviationPct) < 15 ? 'drift' : 'divergent';
    return { asset, realSymbol, internalUsd, realUsd, deviationPct, verdict };
  });
}

// ─── (4) השערים — מה יש ומה זה יכול להניב ─────────────────────────────────

export interface Gate {
  id: string;
  he: string;
  status: 'open' | 'live' | 'armed' | 'gated' | 'locked';
  detail: string;
  yieldNow: string; // מדידה-חיה או הערכה-מנומקת
}

function buildGates(res: DexReserve, treasury: RealTreasury, radar: DeviationRow[], arb: ArbScan): Gate[] {
  const usdcRow = treasury.rows.find(r => r.asset === 'USDC');
  const deviations = radar.filter(r => r.verdict === 'divergent' || r.verdict === 'drift').length;
  return [
    {
      id: 'door',
      he: 'שער-הדלת — הפקדה-אמת מאומתת-RPC → הטבעה-מגובה 1:1',
      status: 'live',
      detail: 'peg-in מול-RPC-ציבורי (TRX/SOL/USDC/EVM×3) · תביעה-חד-פעמית · משמורת-נמדדת-חי',
      yieldNow: usdcRow?.usd != null ? `$${usdcRow.usd.toFixed(2)} USDC כבר-בפנים (גשר-ראשון בוצע)` : 'משמורת-חיה מדודה בדלת',
    },
    {
      id: 'bridge',
      he: 'שער-הגשר — האוצר-האמיתי → כספת-העתודה (גיבוי-אמת)',
      status: res.realMu > 144 ? 'open' : 'gated',
      detail: 'wrap_mint-חוץ-לreserve-vault · realMu = רצפת-האמת של המטבע-הפנימי',
      yieldNow: res.ok ? `realMu ${res.realMu.toLocaleString()}µ$ · realBps ${res.realBps}` : 'דקס-לא-זמין',
    },
    {
      id: 'arb',
      he: 'שער-הארביטראז — מסחר-אמת-ממוקד (Jupiter/ParaSwap מהכספת)',
      status: 'armed',
      detail: 'vault-swap.ts חמוש (DRY-RUN ברירת-מחדל · תקרות-קשיחות 0.1-SOL/0.05-ETH · known-router-only) · סריקה-מתמדת',
      // FIX(EXEC-CD-32): yieldNow היה-הצהרה ('פוטנציאל-פריסה') — עתה מדידה-חיה
      // מהסורק (סטיות-מול-עמלות + עלות-רכבת-השרשרת). אין-קצה → דיווח-כנה.
      yieldNow: arb.ok ? arb.note : `סריקה-לא-זמינה כרגע (כנה) · ${deviations} נכסים-בסטיה-נמדדת`,
    },
    {
      id: 'rail',
      he: 'שער-רכבת-הפג — STEEM/SBD אמת (headcorner)',
      status: 'gated',
      detail: '10.494 STEEM + 0.5 SBD חיים-על-הרשת — ה-authority-הפעיל מאחורי-רוטציה; המתכון-אצל-המפעיל (העלאת-WIF → absorb)',
      yieldNow: '≈$1.10 נעולים עד-העלאת-המפתח (escalations.json)',
    },
    {
      id: 'agents',
      he: 'שער-הסוכנים — הלגיון סוחר → עמלות → סחיבת-סולם',
      status: 'live',
      detail: 'כל-200-בלוקים הסולם סוחב-עודף-אוצר → כספת-העתודה (RESERVE_REAL ממיר לנכסי-דלת)',
      yieldNow: res.income ? `עמלות-בריכות-חיים: ${res.income.poolFeesMu.toLocaleString()}µ$ · רווח-אוצר-מצטבר: ${res.income.treasuryProfitEverMu.toLocaleString()}µ$` : '—',
    },
    {
      id: 'redeem',
      he: 'שער-הפדיון — שריפת-פנימי → משיכת-אמת (מדרגה-3+)',
      status: res.redeemOpen ? 'open' : 'locked',
      detail: 'נפתח ב-60%-רצפה + 20%-אמת · תקרת-5%-לאפוק — החוק-ששומר-על-הפדיון-מפני-התרוקנות',
      yieldNow: res.redeemOpen ? 'פתוח' : `נעול-בכנות — חסר ${res.nextGapMu != null ? `${res.nextGapMu.toLocaleString()}µ$` : 'מדידה'} למדרגה-1`,
    },
  ];
}

// ─── (5) הצטברות — state + snapshot + היסטוריה ─────────────────────────────

export interface ValueEngineState {
  ok: boolean;
  at: string;
  treasury: RealTreasury;
  reserve: DexReserve;
  radar: DeviationRow[];
  gates: Gate[];
  wash: {
    supplyUsd: number; // היצע-פנימי בדולר (µ$/1000)
    realUsd: number; // גיבוי-אמת בדולר
    realPlusTreasuryUsd: number; // גיבוי + שאר-האוצר-שעוד-לא-גושם
    ratioPct: number; // real/supply × 100
    note: string;
  };
  history: Array<{ at: string; height: number; phase: number; unitBps: number; realBps: number; realUsdMicro: string }>;
  arbScan: ArbScan; // EXEC-CD-32 — סריקת-הארביטראז-החיה (מטמון-5-דק')
  lastError?: string;
}

/** FIX(FZ-slo-B · 2026-10-08): SLO-המדידה תפסה — GET עשה-RPC-פאואאוט-מלא בכל-בקשה
 * (p50 190ms · p95 3,277ms נמדד-חי — miss-מטמון-מחירים = סקר-חוץ-סינכרוני).
 * עתה: מצב-מנוע נמדד פעם-ב-TTL (45ש׳) בלבד + singleFlight (גל-בקשות מקבילות =
 * מדידה-אחת). לוח-המחוונים חי-על-מצב-בן-עד-45ש׳ — כנה-לתצוגה; valueTick (הכותב
 * לעקומה) ממשיך-למדוד-חי ולא-דרך-המטמון. */
let veStateCache: { data: ValueEngineState; at: number } | null = null;
const VE_STATE_TTL_MS = 45_000;

export async function getValueEngineState(): Promise<ValueEngineState> {
  if (veStateCache && Date.now() - veStateCache.at < VE_STATE_TTL_MS) return veStateCache.data;
  const data = await singleFlight('ve-state', async (): Promise<ValueEngineState> => {
    const [treasury, reserve, arb] = await Promise.all([getRealTreasury(), getDexReserve(), scanArb()]);
    const radar = await getDeviationRadar();
    const gates = buildGates(reserve, treasury, radar, arb);
    const supplyUsd = reserve.supplyMu / 1000;
    const realUsd = reserve.realMu / 1000;
    const ratioPct = reserve.supplyMu > 0 ? Math.round((reserve.realMu / reserve.supplyMu) * 1e4) / 100 : 0;
    let history: ValueEngineState['history'] = [];
    try {
      const { db } = await import('@/lib/db');
      const snaps = await db.valueSnapshot.findMany({ orderBy: { takenAt: 'desc' }, take: 48 });
      history = snaps.map(s => ({
        at: s.takenAt.toISOString(), height: s.height, phase: s.phase,
        unitBps: s.unitBps, realBps: s.realBps, realUsdMicro: s.realUsdMicro.toString(),
      }));
    } catch { /* db-נפל — היסטוריה-ריקה כנה */ }
    return {
      ok: reserve.ok,
      at: new Date().toISOString(),
      treasury, reserve, radar, gates, arbScan: arb,
      wash: {
        supplyUsd: Math.round(supplyUsd * 100) / 100,
        realUsd: Math.round(realUsd * 1e6) / 1e6,
        realPlusTreasuryUsd: Math.round((realUsd + treasury.totalUsd) * 1e6) / 1e6,
        ratioPct,
        note: reserve.phase === 0
          ? 'מדרגה-0 (מטבע-בית): הגיבוי-האמיתי-הראשון חי — הפעילות סוגרת-את-הפער-צעד-צעד'
          : `מדרגה-${reserve.phase} (${reserve.phaseName})`,
      },
      history,
    };
  });
  veStateCache = { data, at: Date.now() };
  return data;
}

/** פעימה: מדידה + snapshot — הלולאה-האוטונומית של השטיפה.
 * כנות: אם-מקורות-המחירים נפלו (429 וכו') — לא-כותבים-תמונת-0-מזויף-לעקומה;
 * הפעימה מדלגת-בכנות והבאה-תנסה-שוב. אפס-מדידה ≠ מדידת-אפס.
 * FIX(EXEC-CD-31 · guard): גם-**קריסת-פרובות** לא נכתבת — אם-האוצר-המדוד צנח
 * מתחת-40% מהתמונה-הקודמת (≥$1) סבירות-גבוהה שזה RPC-שיקר ולא בזבוז-אמת;
 * העקומה מדלגת-בכנות עד-אימות-חוצה (נמדד-חי: USDC-0-כוזב מ-fallback-RPC). */
export async function valueTick(): Promise<{ ok: boolean; height: number; realUsdMicro: string; error?: string }> {
  try {
    const [treasury, reserve] = await Promise.all([getRealTreasury(), getDexReserve()]);
    if (!reserve.ok) return { ok: false, height: 0, realUsdMicro: '0', error: 'dex-unreachable' };
    if (treasury.priceSource === 'unavailable') {
      return { ok: false, height: reserve.height, realUsdMicro: '0', error: 'prices-unavailable — הפעימה דילגה (לא-רושמים-0-מזויף-לעקומת-השטיפה)' };
    }
    if (!treasury.ok) {
      return { ok: false, height: reserve.height, realUsdMicro: '0', error: 'treasury-probes-failed — הפעימה דילגה (אף-פרובה-לא-אושרה; לא-רושמים-0-מזויף)' };
    }
    const { db } = await import('@/lib/db');
    // גרדיאן-קריסה: תמונה-קודמת ≥$1 והחדשה <40% ממנה → דילוג-כנה (חשד-RPC, לא-בזבוז)
    // (מספרים-בדיק — סדרי-הגודל כאן דולריים; אין-BigInt-literals מתחת-ES2020)
    const lastSnap = await db.valueSnapshot.findFirst({ orderBy: { takenAt: 'desc' } });
    const lastUsd = lastSnap ? Number(lastSnap.realUsdMicro) / 1e6 : 0;
    if (Number.isFinite(lastUsd) && lastUsd >= 1 && treasury.totalUsd * 100 < lastUsd * 40) {
      return { ok: false, height: reserve.height, realUsdMicro: '0', error: `suspected-probe-collapse: $${lastUsd.toFixed(2)} → $${treasury.totalUsd.toFixed(2)} (<40%) — דילוג-כנה עד-אימות-חוצה` };
    }
    // EXEC-CD-32: תמצית-הסריקה נרשמת-בעקומה — כל-תמונה נושאת-עמה גם-את-מצב-הקצה
    let arbNote = '';
    try {
      const scan = await scanArb();
      arbNote = scan.ok ? ` · arb=${scan.bestNetPct !== null ? `best+${scan.bestNetPct.toFixed(2)}%` : 'no-edge'}` : '';
    } catch { /* הסריקה לא-חייבת-לעבור-כדי-לרשום-תמונה */ }
    const row = await db.valueSnapshot.create({
      data: {
        height: reserve.height,
        phase: Math.max(0, reserve.phase),
        supplyMu: BigInt(Math.max(0, Math.floor(reserve.supplyMu))),
        unitMu: BigInt(Math.max(0, Math.floor(reserve.unitMu))),
        realMu: BigInt(Math.max(0, Math.floor(reserve.realMu))),
        unitBps: reserve.unitBps,
        realBps: reserve.realBps,
        realUsdMicro: BigInt(Math.max(0, Math.round(treasury.totalUsd * 1e6))),
        notes: `src=${treasury.priceSource} · rows=${treasury.rows.filter(r => r.ok).length}/${treasury.rows.length}${arbNote}`,
      },
    });
    // היגיינה: השאר את 2,000-התמונות-האחרונות
    try {
      const old = await db.valueSnapshot.findMany({
        where: { id: { not: row.id } }, orderBy: { takenAt: 'desc' }, skip: 2_000, select: { id: true },
      });
      if (old.length > 0) {
        await db.valueSnapshot.deleteMany({ where: { id: { in: old.map(o => o.id) } } });
      }
    } catch { /* היגיינה-אופציונלית */ }
    return { ok: true, height: reserve.height, realUsdMicro: row.realUsdMicro.toString() };
  } catch (e) {
    return { ok: false, height: 0, realUsdMicro: '0', error: msg(e) };
  }
}
