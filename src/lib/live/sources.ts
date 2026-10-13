// ═══ גשר-החי · מקורות-אמת — שווקים, טוקנים, ציטוטים, גישור ═══════════════════
// ארבעה-מקורות-ציבוריים-מוכחים-חיים (נבדקו-מהסנדבוקס):
//   · CoinGecko  — מחירי-שוק-אמת למטבעות-המובילים
//   · DexScreener— זוגות-מסחר אמת (נזילות/ווליום/שינוי) על-פני-הרשתות
//   · Jupiter    — מנוע-האגרגציה של Solana: ציטוטי-מסלול אמת + קטלוג-טוקנים
//   · Li.Fi      — מנוע-הגישור החוצה-שרשראות: ציטוטים + מסלולי-גשר אמת
// כל-מקור: timeout-כפוי · מטמון-TTL · single-flight · שגיאה-גלויה — אין-זיוף.

import { cacheGet, cacheSet, fetchJson, singleFlight } from './cache';

// ─── CoinGecko — מחירי-השוק-המובילים ─────────────────────────────────────────
export interface CoinRow {
  id: string; symbol: string; name: string; image: string;
  current_price: number; price_change_percentage_24h: number | null;
  market_cap: number; total_volume: number; market_cap_rank: number | null;
}
const CG_TTL = 90000;
export async function coinMarkets(perPage = 40): Promise<{ coins: CoinRow[]; ageMs: number; source: string; stale?: boolean }> {
  const key = `cg:markets:${perPage}`;
  // בדיקה-קיימת כולל-פגוּת (בלי-מחיקה) — כדי-שהידוע-אחרון ישרוד כישלון-מקור
  const any = cacheGet<{ coins: CoinRow[]; cachedAt: number }>(key, true);
  if (any && any.expiresAt > Date.now()) {
    return { coins: any.value.coins, ageMs: Date.now() - any.value.cachedAt, source: 'coingecko' };
  }
  try {
    const coins = await singleFlight(key, () =>
      fetchJson<CoinRow[]>(
        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=1&price_change_percentage=24h`,
        undefined, 10000,
      ),
    );
    cacheSet(key, { coins, cachedAt: Date.now() }, CG_TTL);
    return { coins, ageMs: 0, source: 'coingecko' };
  } catch (cgErr) {
    // כנות-גלויה: CoinGecko נכשל (לרוב 429 מ-IP-משותף) → סולם-גיבוי Binance
    // (data-api.binance.vision — נקודת-קצה-ציבורית-לנתוני-שוק). אם-גם-הוא-נכשל
    // וקיים-ידוע-אחרון → מוחזר-עם stale:true. אין-היסטוריה = כישלון-גלוי.
    try {
      const coins = await singleFlight(`${key}:binance`, () => binanceTopTickers(perPage));
      cacheSet(key, { coins, cachedAt: Date.now() }, CG_TTL);
      return { coins, ageMs: 0, source: 'binance' };
    } catch {
      if (any) return { coins: any.value.coins, ageMs: Date.now() - any.value.cachedAt, source: 'coingecko', stale: true };
      throw cgErr;
    }
  }
}

// ─── Binance — סולם-גיבוי למחירי-השוק ────────────────────────────────────────
const BINANCE_SYMBOLS = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'TRX', 'AVAX', 'LINK', 'DOT', 'TON', 'LTC', 'BCH', 'UNI', 'ATOM', 'XLM', 'NEAR', 'APT', 'ARB', 'OP', 'SUI', 'PEPE', 'SHIB', 'ZEC', 'FIL', 'INJ', 'TIA'];
async function binanceTopTickers(perPage: number): Promise<CoinRow[]> {
  const symbols = BINANCE_SYMBOLS.slice(0, Math.max(perPage, BINANCE_SYMBOLS.length)).map(s => `${s}USDT`);
  const arr = await fetchJson<Array<{ symbol: string; lastPrice: string; priceChangePercent: string; quoteVolume: string }>>(
    `https://data-api.binance.vision/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(symbols))}`,
    undefined, 10000,
  );
  const rows: CoinRow[] = arr.map(t => {
    const sym = t.symbol.replace(/USDT$/, '');
    const price = Number.parseFloat(t.lastPrice);
    return {
      id: sym.toLowerCase(),
      symbol: sym.toLowerCase(),
      name: sym,
      image: '',
      current_price: price,
      price_change_percentage_24h: Number.parseFloat(t.priceChangePercent),
      market_cap: 0, // Binance לא-מספק שווי-שוק — מוצג "—" בכנות
      total_volume: Number.parseFloat(t.quoteVolume) || 0,
      market_cap_rank: null,
    };
  });
  rows.sort((a, b) => b.total_volume - a.total_volume);
  return rows.slice(0, perPage);
}

// ─── DexScreener — זוגות-מסחר-אמת ────────────────────────────────────────────
export interface DsPair {
  chainId: string; dexId: string; pairAddress: string; url: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken?: { address: string; name: string; symbol: string };
  priceUsd?: string; priceChange?: { h24?: number };
  volume?: { h24?: number }; liquidity?: { usd?: number };
  fdv?: number; txns?: { h24?: { buys?: number; sells?: number } };
  labels?: string[];
}
const DS_TTL = 90000;
export async function dexPairsForChain(chainDexId: string, query: string, limit = 6): Promise<{ pairs: DsPair[]; ageMs: number }> {
  const key = `ds:${chainDexId}:${query}:${limit}`;
  const hit = cacheGet<{ pairs: DsPair[]; cachedAt: number }>(key);
  if (hit) return { pairs: hit.value.pairs, ageMs: Date.now() - hit.value.cachedAt };
  const pairs = await singleFlight(key, async () => {
    const j = await fetchJson<{ pairs?: DsPair[] }>(
      `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`,
      undefined, 10000,
    );
    const all = (j.pairs || []).filter(p =>
      p.chainId === chainDexId && (p.liquidity?.usd ?? 0) >= 25000,
    );
    all.sort((a, b) => (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0));
    return all.slice(0, limit);
  });
  cacheSet(key, { pairs, cachedAt: Date.now() }, DS_TTL);
  return { pairs, ageMs: 0 };
}

// ─── Jupiter — קטלוג-טוקנים של Solana ────────────────────────────────────────
export interface JupToken {
  id: string; name: string; symbol: string; icon?: string; decimals: number;
  usdPrice?: number; mcap?: number; organicScore?: number; isVerified?: boolean;
  liquidity?: number; holderCount?: number;
}
export async function jupTokenSearch(query: string, limit = 12): Promise<JupToken[]> {
  const key = `jup:search:${query}:${limit}`;
  return singleFlight(key, async () => {
    const arr = await fetchJson<JupToken[]>(
      `https://lite-api.jup.ag/tokens/v2/search?query=${encodeURIComponent(query)}&limit=${limit}`,
      undefined, 8000,
    );
    return Array.isArray(arr) ? arr : [];
  });
}

// ─── Jupiter — ציטוט-מסלול אמת (Solana) ──────────────────────────────────────
export interface JupQuote {
  inputMint: string; outputMint: string; inAmount: string; outAmount: string;
  otherAmountThreshold: string; slippageBps: number; priceImpactPct: string;
  routePlan: Array<{ swapInfo: { label?: string; ammKey: string }; percent: number }>;
}
export async function jupQuote(inputMint: string, outputMint: string, amountRaw: string, slippageBps: number): Promise<JupQuote> {
  const url = `https://lite-api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountRaw}&slippageBps=${slippageBps}`;
  return fetchJson<JupQuote>(url, undefined, 10000);
}

// ─── Li.Fi — ציטוט-חוצה-שרשראות + מסלולי-גשר ────────────────────────────────
export interface LifFiToken { address: string; chainId: number; symbol: string; decimals: number; name: string; priceUSD?: string; logoURI?: string }
export interface LifiStep {
  id: string; type: string; tool: string;
  toolDetails: { key: string; name: string; logoURI?: string };
  action?: { fromToken?: LifFiToken; toToken?: LifFiToken; fromAmount?: string; fromChainId?: number; toChainId?: number };
  estimate: {
    fromAmount: string; toAmount: string; toAmountMin: string; toAmountUSD?: string;
    fromAmountUSD?: string; gasCosts?: Array<{ amountUSD?: string }>;
    feeCosts?: Array<{ amountUSD?: string }>; executionDuration?: number;
  };
  includedSteps?: LifiStep[];
}
export interface LifiRoute { id: string; fromChainId: number; toChainId: number; fromAmount: string; fromAmountUSD?: string; fromToken?: LifFiToken; toToken?: LifFiToken; steps: LifiStep[] }

export interface LifiQuoteResp {
  id?: string; type: string; tool: string;
  toolDetails: { key: string; name: string; logoURI?: string };
  action: { fromToken: LifFiToken; toToken: LifFiToken; fromAmount: string; fromChainId: number; toChainId: number };
  estimate: LifiStep['estimate'];
  includedSteps?: LifiStep[];
  // EXEC-CD-23: מסלול-ביצוע לחתימת-ארנק (מוחזר-כשהציטוט-מבוצע-מה-API)
  transactionRequest?: {
    data: string; to: string; value?: string; gasPrice?: string; gasLimit?: string;
    gas?: string; from?: string; chainId?: number;
  };
}

export async function lifiQuote(params: {
  fromChain: number; toChain: number; fromToken: string; toToken: string; fromAmount: string; fromAddress: string;
}): Promise<LifiQuoteResp> {
  const q = new URLSearchParams({
    fromChain: String(params.fromChain), toChain: String(params.toChain),
    fromToken: params.fromToken, toToken: params.toToken,
    fromAmount: params.fromAmount, fromAddress: params.fromAddress,
    integrator: 'saos-dex',
  });
  return fetchJson<LifiQuoteResp>(`https://li.quest/v1/quote?${q}`, undefined, 12000);
}

export async function lifiRoutes(params: {
  fromChainId: number; toChainId: number; fromTokenAddress: string; toTokenAddress: string;
  fromAmount: string; fromAddress: string;
}): Promise<LifiRoute[]> {
  const body = {
    fromChainId: params.fromChainId, toChainId: params.toChainId,
    fromTokenAddress: params.fromTokenAddress, toTokenAddress: params.toTokenAddress,
    fromAmount: params.fromAmount, fromAddress: params.fromAddress,
    options: { slippage: 0.005, sort: 'RECOMMENDED', integrator: 'saos-dex' },
  };
  const j = await fetchJson<{ routes: LifiRoute[] }>(
    'https://li.quest/v1/advanced/routes',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    15000,
  );
  return Array.isArray(j.routes) ? j.routes : [];
}

// ─── כתובת-בדיקה ריבונית (quote-probe) ───────────────────────────────────────
// Li.Fi דורש fromAddress תקין-גם-לציטוט-קריאה-בלבד. במקום כתובת של אדם-חוץ —
// נגזרת-כתובת-קבועה-ריבונית מ-keccak("saos-dex/live-bridge/probe/v1") עם
// checksum-EIP-55. הכתובת אינה-ארנק, אינה-חתימה, אין-כספים — רק נשא-סימולציה.
import { keccak_256 } from '@noble/hashes/sha3.js';
import { utf8ToBytes, bytesToHex } from '@noble/hashes/utils.js';

function eip55(addrLowerHex: string): string {
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(addrLowerHex)));
  let out = '0x';
  for (let i = 0; i < 40; i++) {
    const ch = addrLowerHex[i];
    out = out + (parseInt(hash[i], 16) >= 8 ? ch.toUpperCase() : ch);
  }
  return out;
}

let probeAddr: string | null = null;
export function sovereignProbeAddress(): string {
  if (probeAddr) return probeAddr;
  const seed = keccak_256(utf8ToBytes('saos-dex/live-bridge/probe/v1'));
  const hex = bytesToHex(seed.slice(12)); // 20 בייטים אחרונים = כתובת
  probeAddr = eip55(hex);
  return probeAddr;
}

/** קבלת-כתובת-לציטוט: כתובת-משתמש אם-תקינה, אחרת כתובת-הבדיקה הריבונית. */
export function quoteFromAddress(userAddr?: string): { address: string; probe: boolean } {
  if (userAddr && /^0x[0-9a-fA-F]{40}$/.test(userAddr)) return { address: userAddr, probe: false };
  return { address: sovereignProbeAddress(), probe: true };
}

// ─── סיוע-פורמט ──────────────────────────────────────────────────────────────
export function toRawAmount(human: number, decimals: number): string {
  if (!Number.isFinite(human) || human <= 0) return '0';
  const raw = BigInt(Math.floor(human * 10 ** Math.min(decimals, 18)));
  return raw.toString();
}
export function fromRawAmount(raw: string | number, decimals: number): number {
  const n = typeof raw === 'number' ? raw : Number.parseFloat(raw);
  if (!Number.isFinite(n)) return 0;
  return n / 10 ** Math.min(decimals, 18);
}
