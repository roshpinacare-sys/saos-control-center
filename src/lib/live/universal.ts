// ═══ החלפת-הכל · מנוע-האגרגציה האוניברסלי (EXEC-CD-23) ══════════════════════
// אגרגטור ריבוני אמת: ציטוט מכל-מקור-אפשרי במקביל, דירוג לפי-פלט-נטו, והוגן
// בכנות על כל כישלון-מקור. כל-המקורות נבדקו-חיים-מהסנדבוקס (probes EXEC-CD-23):
//   · Maya Protocol — חוצה-מחלקות בלי-משמורת (ביטקוין/לייטקוין/דאש ↔ ETH/ARB/טוקנים),
//     מפקדה-ציבורית keyless · ביצוע = הפקדה+ממואר לארנק-המשתמש-עצמו
//   · SideShift.ai — 201 מטבעות × 48 רשתות (כולל XMR/TRX/TON/SUI) · ציטוטים keyless
//     (ביצוע-הפקדה דורש מזהה-שותף → סביבה SAOS_SIDESHIFT_ID · שער-הפעלה כנה)
//   · LI.Fi      — 70 שרשראות EVM: סוואף-חוצה-שרשראות · ביצוע = חתימת-ארנק
//   · ParaSwap   — עומק-DEX תוך-שרשרת EVM · keyless (כתובות-קטנות-בלבד!)
//   · Jupiter    — עומק-Solana · keyless
// ריבונות: אף-מפתח-פרטי, אף-משמורת — הכסף תמיד זז מהארנק-של-המשתמש ישירות.
// אין-זיוף: מקור-שנכשל מוצג-כנכשל עם-הסיבה, לא-מוסתר ולא-מומצא.

import { fetchJson, singleFlight, cached } from './cache';

// ─── קטלוג-הרשתות הריבוני ────────────────────────────────────────────────────
export type ChainKind = 'evm' | 'utxo' | 'solana' | 'tron' | 'xmr' | 'other';

export interface ChainInfo {
  key: string;                 // קנוני: 'ethereum','bitcoin','solana'…
  name: string;
  kind: ChainKind;
  chainId?: number;            // EVM
  ssNetwork?: string;          // מפתח-רשת ב-SideShift
  mayaChain?: string;          // סמל-שרשרת ב-Maya ('BTC','ETH','ARB','DASH','ADA')
  explorerTx?: string;         // תבנית עם {tx}
  explorerAddr?: string;       // תבנית עם {addr}
  native: { symbol: string; name: string; decimals: number };
  hue: number;                 // צבע-זיהוי ב-UI
}

export const CHAINS: ChainInfo[] = [
  { key: 'bitcoin', name: 'Bitcoin', kind: 'utxo', ssNetwork: 'bitcoin', mayaChain: 'BTC',
    explorerTx: 'https://mempool.space/tx/{tx}', explorerAddr: 'https://mempool.space/address/{addr}',
    native: { symbol: 'BTC', name: 'Bitcoin', decimals: 8 }, hue: 32 },
  { key: 'ethereum', name: 'Ethereum', kind: 'evm', chainId: 1, ssNetwork: 'ethereum', mayaChain: 'ETH',
    explorerTx: 'https://etherscan.io/tx/{tx}', explorerAddr: 'https://etherscan.io/address/{addr}',
    native: { symbol: 'ETH', name: 'Ethereum', decimals: 18 }, hue: 240 },
  { key: 'solana', name: 'Solana', kind: 'solana', ssNetwork: 'solana',
    explorerTx: 'https://solscan.io/tx/{tx}', explorerAddr: 'https://solscan.io/account/{addr}',
    native: { symbol: 'SOL', name: 'Solana', decimals: 9 }, hue: 160 },
  { key: 'bsc', name: 'BNB Chain', kind: 'evm', chainId: 56, ssNetwork: 'bsc',
    explorerTx: 'https://bscscan.com/tx/{tx}', explorerAddr: 'https://bscscan.com/address/{addr}',
    native: { symbol: 'BNB', name: 'BNB', decimals: 18 }, hue: 45 },
  { key: 'base', name: 'Base', kind: 'evm', chainId: 8453, ssNetwork: 'base',
    explorerTx: 'https://basescan.org/tx/{tx}', explorerAddr: 'https://basescan.org/address/{addr}',
    native: { symbol: 'ETH', name: 'Ethereum', decimals: 18 }, hue: 217 },
  { key: 'arbitrum', name: 'Arbitrum One', kind: 'evm', chainId: 42161, ssNetwork: 'arbitrum', mayaChain: 'ARB',
    explorerTx: 'https://arbiscan.io/tx/{tx}', explorerAddr: 'https://arbiscan.io/address/{addr}',
    native: { symbol: 'ETH', name: 'Ethereum', decimals: 18 }, hue: 12 },
  { key: 'optimism', name: 'Optimism', kind: 'evm', chainId: 10, ssNetwork: 'optimism',
    explorerTx: 'https://optimistic.etherscan.io/tx/{tx}', explorerAddr: 'https://optimistic.etherscan.io/address/{addr}',
    native: { symbol: 'ETH', name: 'Ethereum', decimals: 18 }, hue: 0 },
  { key: 'polygon', name: 'Polygon PoS', kind: 'evm', chainId: 137, ssNetwork: 'polygon',
    explorerTx: 'https://polygonscan.com/tx/{tx}', explorerAddr: 'https://polygonscan.com/address/{addr}',
    native: { symbol: 'POL', name: 'POL', decimals: 18 }, hue: 276 },
  { key: 'avalanche', name: 'Avalanche C-Chain', kind: 'evm', chainId: 43114, ssNetwork: 'avax',
    explorerTx: 'https://snowtrace.io/tx/{tx}', explorerAddr: 'https://snowtrace.io/address/{addr}',
    native: { symbol: 'AVAX', name: 'Avalanche', decimals: 18 }, hue: 12 },
  { key: 'litecoin', name: 'Litecoin', kind: 'utxo', ssNetwork: 'litecoin',
    explorerTx: 'https://blockchair.com/litecoin/transaction/{tx}', explorerAddr: 'https://blockchair.com/litecoin/address/{addr}',
    native: { symbol: 'LTC', name: 'Litecoin', decimals: 8 }, hue: 210 },
  { key: 'dogecoin', name: 'Dogecoin', kind: 'utxo', ssNetwork: 'doge',
    explorerTx: 'https://blockchair.com/dogecoin/transaction/{tx}', explorerAddr: 'https://blockchair.com/dogecoin/address/{addr}',
    native: { symbol: 'DOGE', name: 'Dogecoin', decimals: 8 }, hue: 45 },
  { key: 'bitcoincash', name: 'Bitcoin Cash', kind: 'utxo', ssNetwork: 'bitcoincash',
    explorerTx: 'https://blockchair.com/bitcoin-cash/transaction/{tx}', explorerAddr: 'https://blockchair.com/bitcoin-cash/address/{addr}',
    native: { symbol: 'BCH', name: 'Bitcoin Cash', decimals: 8 }, hue: 20 },
  { key: 'dash', name: 'Dash', kind: 'utxo', ssNetwork: 'dash', mayaChain: 'DASH',
    explorerTx: 'https://blockchair.com/dash/transaction/{tx}', explorerAddr: 'https://blockchair.com/dash/address/{addr}',
    native: { symbol: 'DASH', name: 'Dash', decimals: 8 }, hue: 200 },
  { key: 'tron', name: 'Tron', kind: 'tron', ssNetwork: 'tron',
    explorerTx: 'https://tronscan.org/#/transaction/{tx}', explorerAddr: 'https://tronscan.org/#/address/{addr}',
    native: { symbol: 'TRX', name: 'TRON', decimals: 6 }, hue: 350 },
  { key: 'monero', name: 'Monero', kind: 'xmr', ssNetwork: 'monero',
    native: { symbol: 'XMR', name: 'Monero', decimals: 12 }, hue: 0 },
  { key: 'ton', name: 'TON', kind: 'other', ssNetwork: 'ton',
    native: { symbol: 'TON', name: 'Toncoin', decimals: 9 }, hue: 210 },
  { key: 'sui', name: 'Sui', kind: 'other', ssNetwork: 'sui',
    native: { symbol: 'SUI', name: 'Sui', decimals: 9 }, hue: 270 },
  { key: 'aptos', name: 'Aptos', kind: 'other', ssNetwork: 'aptos',
    native: { symbol: 'APT', name: 'Aptos', decimals: 8 }, hue: 190 },
  { key: 'stellar', name: 'Stellar', kind: 'other', ssNetwork: 'stellar',
    native: { symbol: 'XLM', name: 'Stellar', decimals: 7 }, hue: 0 },
  { key: 'algorand', name: 'Algorand', kind: 'other', ssNetwork: 'algorand',
    native: { symbol: 'ALGO', name: 'Algorand', decimals: 6 }, hue: 0 },
  { key: 'cardano', name: 'Cardano', kind: 'other', ssNetwork: 'cardano',
    native: { symbol: 'ADA', name: 'Cardano', decimals: 6 }, hue: 240 },
  { key: 'hyperevm', name: 'HyperEVM', kind: 'evm', chainId: 999, ssNetwork: 'hyperevm',
    explorerTx: 'https://hyperevmscan.io/tx/{tx}', explorerAddr: 'https://hyperevmscan.io/address/{addr}',
    native: { symbol: 'HYPE', name: 'Hyperliquid', decimals: 18 }, hue: 98 },
];

export function chainByKey(key: string): ChainInfo | undefined {
  return CHAINS.find(c => c.key === key);
}

// ─── יקום-הטוקנים — רשומה-אחידה לכל-מקור ─────────────────────────────────────
export interface UToken {
  id: string;                  // `${chainKey}:${address|'native'}`
  chain: string; chainName: string; kind: ChainKind;
  symbol: string; name: string; decimals: number;
  address?: string;            // חוזה/mint — חסר למטבע-יליד
  native?: boolean;
  priceUsd?: number;
  ssCoin?: string;             // מפתח-מטבע SideShift (למשל 'BTC','USDT')
  mayaAsset?: string;          // 'BTC.BTC' · 'ETH.USDC-0XA0B8…'
  hue: number;
}

// מטבעות-יסוד מתומחרים-ידנית — זמינות-מיידית בלי-תלות-ברשת
const PS_NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const USDC_ETH = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const USDT_ETH = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const WBTC_ETH = '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599';

interface MajorSeed {
  chain: string; symbol: string; name: string; decimals: number;
  address?: string; native?: boolean; maya?: string;
}
const MAJOR_SEEDS: MajorSeed[] = [
  { chain: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', decimals: 8, native: true, maya: 'BTC.BTC' },
  { chain: 'ethereum', symbol: 'ETH', name: 'Ethereum', decimals: 18, native: true, maya: 'ETH.ETH' },
  { chain: 'ethereum', symbol: 'USDC', name: 'USDC', decimals: 6, address: USDC_ETH, maya: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48' },
  { chain: 'ethereum', symbol: 'USDT', name: 'Tether USD', decimals: 6, address: USDT_ETH, maya: 'ETH.USDT-0XDAC17F958D2EE523A2206206994597C13D831EC7' },
  { chain: 'ethereum', symbol: 'WBTC', name: 'Wrapped BTC', decimals: 8, address: WBTC_ETH, maya: 'ETH.WBTC-0X2260FAC5E5542A773AA44FBCFEDF7C193BC2C599' },
  { chain: 'solana', symbol: 'SOL', name: 'Solana', decimals: 9, native: true },
  { chain: 'solana', symbol: 'USDC', name: 'USDC', decimals: 6, address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
  { chain: 'solana', symbol: 'USDT', name: 'Tether USD', decimals: 6, address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB' },
  { chain: 'bsc', symbol: 'BNB', name: 'BNB', decimals: 18, native: true },
  { chain: 'bsc', symbol: 'USDT', name: 'Tether USD', decimals: 18, address: '0x55d398326f99059ff775485246999027b3197955' },
  { chain: 'bsc', symbol: 'USDC', name: 'USDC', decimals: 18, address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d' },
  { chain: 'base', symbol: 'ETH', name: 'Ethereum', decimals: 18, native: true },
  { chain: 'base', symbol: 'USDC', name: 'USDC', decimals: 6, address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' },
  { chain: 'arbitrum', symbol: 'ETH', name: 'Ethereum', decimals: 18, native: true, maya: 'ARB.ETH' },
  { chain: 'arbitrum', symbol: 'USDC', name: 'USDC (native)', decimals: 6, address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', maya: 'ARB.USDC-0XAF88D065E77C8CC2239327C5EDB3A432268E5831' },
  { chain: 'arbitrum', symbol: 'USDT', name: 'Tether USD', decimals: 6, address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', maya: 'ARB.USDT-0XFD086BC7CD5C481DCC9C85EBE478A1C0B69FCBB9' },
  { chain: 'arbitrum', symbol: 'WBTC', name: 'Wrapped BTC', decimals: 8, address: '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f', maya: 'ARB.WBTC-0X2F2A2543B76A4166549F7AAB2E75BEF0AEFC5B0F' },
  { chain: 'optimism', symbol: 'ETH', name: 'Ethereum', decimals: 18, native: true },
  { chain: 'optimism', symbol: 'USDC', name: 'USDC', decimals: 6, address: '0x0b2c639c533813f4aa9d7837caf62653d097ff85' },
  { chain: 'polygon', symbol: 'POL', name: 'POL', decimals: 18, native: true },
  { chain: 'polygon', symbol: 'USDC', name: 'USDC', decimals: 6, address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359' },
  { chain: 'avalanche', symbol: 'AVAX', name: 'Avalanche', decimals: 18, native: true },
  { chain: 'avalanche', symbol: 'USDC', name: 'USDC', decimals: 6, address: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e' },
  { chain: 'litecoin', symbol: 'LTC', name: 'Litecoin', decimals: 8, native: true },
  { chain: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin', decimals: 8, native: true },
  { chain: 'bitcoincash', symbol: 'BCH', name: 'Bitcoin Cash', decimals: 8, native: true },
  { chain: 'dash', symbol: 'DASH', name: 'Dash', decimals: 8, native: true, maya: 'DASH.DASH' },
  { chain: 'tron', symbol: 'TRX', name: 'TRON', decimals: 6, native: true },
  { chain: 'monero', symbol: 'XMR', name: 'Monero', decimals: 12, native: true },
  { chain: 'ton', symbol: 'TON', name: 'Toncoin', decimals: 9, native: true },
  { chain: 'sui', symbol: 'SUI', name: 'Sui', decimals: 9, native: true },
  { chain: 'aptos', symbol: 'APT', name: 'Aptos', decimals: 8, native: true },
  { chain: 'stellar', symbol: 'XLM', name: 'Stellar', decimals: 7, native: true },
  { chain: 'algorand', symbol: 'ALGO', name: 'Algorand', decimals: 6, native: true },
  { chain: 'cardano', symbol: 'ADA', name: 'Cardano', decimals: 6, native: true, maya: 'ADA.ADA' },
  { chain: 'hyperevm', symbol: 'HYPE', name: 'Hyperliquid', decimals: 18, native: true },
];

function seedToUToken(s: MajorSeed): UToken {
  const c = chainByKey(s.chain);
  return {
    id: `${s.chain}:${s.address ?? 'native'}`,
    chain: s.chain, chainName: c?.name ?? s.chain, kind: c?.kind ?? 'other',
    symbol: s.symbol, name: s.name, decimals: s.decimals,
    ...(s.address ? { address: s.address } : {}),
    ...(s.native ? { native: true } : {}),
    ...(s.maya ? { mayaAsset: s.maya } : {}),
    hue: c?.hue ?? 200,
  };
}

export function majorTokens(): UToken[] {
  return MAJOR_SEEDS.map(seedToUToken);
}

// ─── SideShift — מקור-48-הרשתות ───────────────────────────────────────────────
export interface SsCoin {
  coin: string; name: string; networks: string[]; mainnet?: string;
  hasMemo: boolean; fixedOnly?: boolean; variableOnly?: boolean;
}
export async function ssCoins(): Promise<SsCoin[]> {
  const { value } = await cached('ss:coins', 30 * 60000, async () => {
    const arr = await fetchJson<SsCoin[]>('https://sideshift.ai/api/v2/coins', { headers: { 'User-Agent': 'Mozilla/5.0' } }, 10000);
    return Array.isArray(arr) ? arr : [];
  });
  return value;
}

/** מטבע-SideShift לפי סמל+רשת (מכובד: רשת-מרובה-חייבת-התאמה-מדויקת). */
export function ssCoinFor(symbol: string, chainKey: string, coins: SsCoin[]): SsCoin | undefined {
  const chain = chainByKey(chainKey);
  if (!chain?.ssNetwork) return undefined;
  const sym = symbol.toUpperCase();
  return coins.find(c => c.coin.toUpperCase() === sym && c.networks.includes(chain.ssNetwork!));
}

export interface SsQuote {
  id: string; depositCoin: string; settleCoin: string;
  depositNetwork?: string; settleNetwork?: string;
  depositAmount: string; settleAmount: string; rate: string; expiresAt: string;
}
export async function ssQuote(p: { depositCoin: string; settleCoin: string; depositAmount: string; depositNetwork?: string; settleNetwork?: string }): Promise<SsQuote> {
  const body: Record<string, string> = {
    depositCoin: p.depositCoin, settleCoin: p.settleCoin, depositAmount: p.depositAmount,
  };
  if (p.depositNetwork) body.depositNetwork = p.depositNetwork;
  if (p.settleNetwork) body.settleNetwork = p.settleNetwork;
  return fetchJson<SsQuote>('https://sideshift.ai/api/v2/quotes', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    body: JSON.stringify(body),
  }, 12000);
}

export interface SsShift {
  id: string; createdAt: string; depositCoin: string; settleCoin: string;
  depositNetwork?: string; settleNetwork?: string;
  depositAddress: string; depositMemo?: string;
  settleAddress: string; settleMemo?: string;
  depositAmount: string; settleAmount: string; expiresAt: string; type: string;
}
export async function ssCreateShift(p: { quoteId: string; settleAddress: string; refundAddress: string; settleMemo?: string; refundMemo?: string }): Promise<SsShift> {
  const affiliate = process.env.SAOS_SIDESHIFT_ID || process.env.SIDESHIFT_AFFILIATE_ID || '';
  const body: Record<string, unknown> = {
    type: 'variable', quoteId: p.quoteId,
    settleAddress: p.settleAddress, refundAddress: p.refundAddress,
  };
  if (p.settleMemo) body.settleMemo = p.settleMemo;
  if (p.refundMemo) body.refundMemo = p.refundMemo;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' };
  if (affiliate) headers['x-sideshift-id'] = affiliate;
  return fetchJson<SsShift>('https://sideshift.ai/api/v2/shifts', { method: 'POST', headers, body: JSON.stringify(body) }, 15000);
}

export async function ssShiftStatus(id: string): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { 'User-Agent': 'Mozilla/5.0' };
  const affiliate = process.env.SAOS_SIDESHIFT_ID || process.env.SIDESHIFT_AFFILIATE_ID || '';
  if (affiliate) headers['x-sideshift-id'] = affiliate;
  return fetchJson<Record<string, unknown>>(`https://sideshift.ai/api/v2/shifts/${encodeURIComponent(id)}`, { headers }, 10000);
}

// ─── Maya Protocol — חוצה-מחלקות בלי-משמורת ──────────────────────────────────
const MAYA_BASE = 'https://mayanode.mayachain.info/mayachain';

export interface MayaPool { asset: string; status: string; balance_asset: string; balance_cacao: string; assetDepth?: string }
export async function mayaPools(): Promise<MayaPool[]> {
  const { value } = await cached('maya:pools', 3 * 60000, async () => {
    const arr = await fetchJson<MayaPool[]>(`${MAYA_BASE}/pools`, undefined, 10000);
    return Array.isArray(arr) ? arr : [];
  });
  return value;
}

export interface MayaQuote {
  inbound_address: string | null; inbound_confirmation_blocks?: number;
  inbound_confirmation_seconds?: number; outbound_delay_blocks?: number; outbound_delay_seconds?: number;
  router?: string | null;
  fees?: { asset: string; affiliate: string; outbound: string; liquidity: string; total: string; slippage_bps: number; total_bps: number };
  expiry?: number; warning?: string; notes?: string; dust_threshold?: string;
  recommended_min_amount_in?: string; recommended_gas_rate?: string; gas_rate_units?: string;
  memo?: string | null; expected_amount_out?: string | null; max_streaming_quantity?: number;
  errors?: unknown[];
}
/** ציטוט-Maya — בלי destination (גורם-לתשובה-ריקה): כתובות-נבדקות-צד-שרת. */
export async function mayaQuote(fromAsset: string, toAsset: string, amountRaw: string): Promise<MayaQuote> {
  const url = `${MAYA_BASE}/quote/swap?from_asset=${encodeURIComponent(fromAsset)}&to_asset=${encodeURIComponent(toAsset)}&amount=${encodeURIComponent(amountRaw)}`;
  return fetchJson<MayaQuote>(url, undefined, 12000);
}

// ─── ParaSwap — עומק-DEX תוך-שרשרת (כתובות-קטנות!) ──────────────────────────
export interface PsPriceRoute {
  srcToken: string; destToken: string; srcAmount: string; destAmount: string;
  srcDecimals: number; destDecimals: number; side: string;
  gasCost?: string; gasCostUSD?: string; partnerFee?: number;
  bestRoute?: Array<{ swaps?: Array<{ swapExchanges?: Array<{ exchange?: string; percent?: number }> }> }>;
}
const PS_NETWORKS = new Set([1, 10, 56, 100, 130, 137, 146, 4663, 8453, 42161, 43114]);
export function psSupports(chainId: number): boolean { return PS_NETWORKS.has(chainId); }

export async function psQuote(network: number, srcToken: string, destToken: string, amountRaw: string): Promise<PsPriceRoute> {
  const q = new URLSearchParams({
    srcToken: srcToken.toLowerCase(), destToken: destToken.toLowerCase(),
    amount: amountRaw, side: 'SELL', network: String(network), partner: 'saos-dex',
  });
  const j = await fetchJson<{ priceRoute?: PsPriceRoute }>(`https://api.paraswap.io/prices?${q}`, undefined, 12000);
  if (!j.priceRoute) throw new Error('ParaSwap: אין-priceRoute');
  return j.priceRoute;
}

export interface PsTx {
  from: string; to: string; data: string; value: string; chainId: number;
  gasPrice?: string; gas?: string;
}
export async function psBuildTx(network: number, priceRoute: PsPriceRoute, userAddress: string, slippageBps: number): Promise<PsTx> {
  return fetchJson<PsTx>(`https://api.paraswap.io/transactions/${network}?ignoreChecks=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      srcToken: priceRoute.srcToken, destToken: priceRoute.destToken, srcAmount: priceRoute.srcAmount,
      slippage: slippageBps / 10000, priceRoute, userAddress, partner: 'saos-dex', ignoreChecks: true,
    }),
  }, 15000);
}

// ─── Jupiter — ביצוע-סוואף-Solana ────────────────────────────────────────────
export async function jupSwapTx(quoteResponse: unknown, userPublicKey: string): Promise<{ swapTransaction: string; lastValidBlockHeight?: number }> {
  return fetchJson<{ swapTransaction: string; lastValidBlockHeight?: number }>(
    'https://lite-api.jup.ag/swap/v1/swap',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quoteResponse, userPublicKey, wrapAndUnwrapSol: true }) },
    15000,
  );
}

// ─── LI.Fi — קטלוג-טוקן-לפי-כתובת (חיפוש-כתובת EVM) ─────────────────────────
export interface LifiTokenFull { address: string; chainId: number; symbol: string; decimals: number; name: string; priceUSD?: string; logoURI?: string }
export async function lifiTokenByAddress(chainId: number, address: string): Promise<LifiTokenFull | null> {
  try {
    return await singleFlight(`lifi:tok:${chainId}:${address.toLowerCase()}`, async () => {
      const t = await fetchJson<LifiTokenFull>(`https://li.quest/v1/token?chain=${chainId}&token=${encodeURIComponent(address)}`, undefined, 10000);
      return t;
    });
  } catch {
    return null;
  }
}

// ─── בדיקות-כתובת קפדניות-פר-רשת (fail-closed) ───────────────────────────────
const B58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
export function isValidAddress(chainKey: string, addr: string): boolean {
  const chain = chainByKey(chainKey);
  if (!chain || !addr) return false;
  const a = addr.trim();
  switch (chain.kind) {
    case 'evm':
      return /^0x[0-9a-fA-F]{40}$/.test(a);
    case 'solana':
      return a.length >= 32 && a.length <= 44 && B58.test(a);
    case 'utxo': {
      if (chainKey === 'bitcoin')
        return /^(bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(a);
      if (chainKey === 'litecoin')
        return /^(ltc1[a-z0-9]{25,62}|[ML][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(a);
      if (chainKey === 'dogecoin')
        return /^[DA9][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(a);
      if (chainKey === 'bitcoincash')
        return /^((bitcoincash:)?q[pz][a-z0-9]{38,58}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(a);
      if (chainKey === 'dash')
        return /^[X7][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(a);
      return a.length >= 20 && a.length <= 100;
    }
    case 'tron':
      return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a);
    case 'xmr':
      return /^[48][0-9AB][1-9A-HJ-NP-Za-km-z]{93,104}$/.test(a);
    default:
      return a.length >= 8 && a.length <= 128;
  }
}

// ─── סיוע-פורמט ל-1e8 (הוסכם-Maya/THOR: פלט-ביחידות-1e8) ────────────────────
export function fromP8(raw: string | number | null | undefined): number {
  const n = typeof raw === 'number' ? raw : Number.parseFloat(raw ?? '');
  if (!Number.isFinite(n)) return 0;
  return n / 1e8;
}

// ─── ציטוט-אוניברסלי מנורמל ──────────────────────────────────────────────────
export type QuoteKind = 'deposit' | 'wallet';
export type ProviderId = 'maya' | 'sideshift' | 'lifi' | 'paraswap' | 'jupiter';

export const PROVIDER_META: Record<ProviderId, { name: string; hue: number; note: string }> = {
  maya: { name: 'Maya Protocol', hue: 290, note: 'ריבוני·ללא-משמורת · הפקדה+ממואר' },
  sideshift: { name: 'SideShift', hue: 45, note: '48 רשתות · שער-נעול-15דק׳' },
  lifi: { name: 'LI.Fi', hue: 320, note: '70 שרשראות-EVM · חתימת-ארנק' },
  paraswap: { name: 'ParaSwap', hue: 12, note: 'עומק-DEX תוך-שרשרת' },
  jupiter: { name: 'Jupiter', hue: 150, note: 'אגרגטור-Solana' },
};

export interface UniversalQuote {
  provider: ProviderId;
  providerName: string;
  kind: QuoteKind;
  outAmount: number;           // יחידות-אנושיות של-מטבע-היעד
  outMin?: number;
  usdOut?: number;
  gasUsd?: number;
  feeUsd?: number;
  etaSec?: number;
  etaLabel?: string;
  rateLockSec?: number;
  slippageBps?: number;
  priceImpactPct?: number;
  minInHuman?: number;
  route: string[];             // תיאור-מסלול
  caveats: string[];
  ref: Record<string, unknown>; // פרמטרים-מינימליים לביצוע-מחדש
}

export interface ProviderFailure { provider: ProviderId; providerName: string; error: string }

export function toRaw(human: number, decimals: number): string {
  if (!Number.isFinite(human) || human <= 0) return '0';
  const d = Math.min(decimals, 18);
  const s = human.toFixed(d);
  const [int, frac = ''] = s.split('.');
  return BigInt(int + frac.padEnd(d, '0') || '0').toString();
}

export function fromRaw(raw: string | number, decimals: number): number {
  const n = typeof raw === 'number' ? raw : Number.parseFloat(raw);
  if (!Number.isFinite(n)) return 0;
  return n / 10 ** Math.min(decimals, 18);
}
