// ═══ גשר-החי · רשתות-אמת — פרובות-חיות על RPC ציבורי ════════════════════════
// 10 רשתות מרכזיות של עולם-ה-DEX, כל-אחת עם סולם-צמתים-ציבוריים (ladder).
// פרובה = קריאת-בלוק-ראש/סלוט אמת + מדידת-השהיה. כישלון-כל-הסולם = DOWN
// גלוי עם-שגיאת-האמת — אף-פעם לא מצב-מזויף. אפס-מפתחות, אפס-רישום.

import { cacheGet, cacheSet, fetchJson, singleFlight } from './cache';

export type ChainKind = 'solana' | 'evm';

export interface ChainDef {
  id: string;
  name: string;
  kind: ChainKind;
  symbol: string;
  /** סולם-צמתים-ציבוריים — הראשון-שעונה-מנצח; DOWN רק-אם-הכל-נפל */
  rpcs: string[];
  /** מזהה-השרשרת ב-Li.Fi / DexScreener (לציטוטים-חוצי-רשתות) */
  lifiId?: number;
  dexscreenerId?: string;
  explorer: string;
}

export const CHAINS: ChainDef[] = [
  {
    id: 'solana', name: 'Solana', kind: 'solana', symbol: 'SOL',
    rpcs: ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'],
    lifiId: 1151111081099710, dexscreenerId: 'solana', explorer: 'https://solscan.io',
  },
  {
    id: 'ethereum', name: 'Ethereum', kind: 'evm', symbol: 'ETH',
    rpcs: ['https://ethereum-rpc.publicnode.com', 'https://cloudflare-eth.com'],
    lifiId: 1, dexscreenerId: 'ethereum', explorer: 'https://etherscan.io',
  },
  {
    id: 'bsc', name: 'BNB Chain', kind: 'evm', symbol: 'BNB',
    rpcs: ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.binance.org'],
    lifiId: 56, dexscreenerId: 'bsc', explorer: 'https://bscscan.com',
  },
  {
    id: 'base', name: 'Base', kind: 'evm', symbol: 'ETH',
    rpcs: ['https://base-rpc.publicnode.com', 'https://mainnet.base.org'],
    lifiId: 8453, dexscreenerId: 'base', explorer: 'https://basescan.org',
  },
  {
    id: 'arbitrum', name: 'Arbitrum One', kind: 'evm', symbol: 'ETH',
    rpcs: ['https://arbitrum-one-rpc.publicnode.com', 'https://arb1.arbitrum.io/rpc'],
    lifiId: 42161, dexscreenerId: 'arbitrum', explorer: 'https://arbiscan.io',
  },
  {
    id: 'polygon', name: 'Polygon', kind: 'evm', symbol: 'POL',
    rpcs: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon-rpc.com'],
    lifiId: 137, dexscreenerId: 'polygon', explorer: 'https://polygonscan.com',
  },
  {
    id: 'avalanche', name: 'Avalanche C', kind: 'evm', symbol: 'AVAX',
    rpcs: ['https://avalanche-c-chain-rpc.publicnode.com', 'https://api.avax.network/ext/bc/C/rpc'],
    lifiId: 43114, dexscreenerId: 'avalanche', explorer: 'https://snowtrace.io',
  },
  {
    id: 'optimism', name: 'Optimism', kind: 'evm', symbol: 'ETH',
    rpcs: ['https://optimism-rpc.publicnode.com', 'https://mainnet.optimism.io'],
    lifiId: 10, dexscreenerId: 'optimism', explorer: 'https://optimistic.etherscan.io',
  },
  {
    id: 'scroll', name: 'Scroll', kind: 'evm', symbol: 'ETH',
    rpcs: ['https://scroll-rpc.publicnode.com', 'https://rpc.scroll.io'],
    lifiId: 534352, dexscreenerId: 'scroll', explorer: 'https://scrollscan.com',
  },
  {
    id: 'linea', name: 'Linea', kind: 'evm', symbol: 'ETH',
    rpcs: ['https://linea-rpc.publicnode.com', 'https://rpc.linea.build'],
    lifiId: 59144, dexscreenerId: 'linea', explorer: 'https://lineascan.build',
  },
];

export function chainById(id: string): ChainDef | undefined {
  return CHAINS.find(c => c.id === id.toLowerCase());
}

export interface ChainStatus {
  id: string;
  name: string;
  kind: ChainKind;
  symbol: string;
  live: boolean;
  /** גובה-בלוק (EVM) או סלוט (Solana) — אמת-מהצומת */
  height: number | null;
  latencyMs: number | null;
  rpc: string | null;
  error: string | null;
  probedAt: string;
}

async function probeRpc(chain: ChainDef): Promise<ChainStatus> {
  const probedAt = new Date().toISOString();
  let lastErr = 'לא-נודע';
  for (const rpc of chain.rpcs) {
    const t0 = Date.now();
    try {
      if (chain.kind === 'evm') {
        const j = await fetchJson<{ result?: string; error?: { message?: string } }>(
          rpc,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
          },
          6000,
        );
        if (j.error) throw new Error(j.error.message || 'RPC-שגיאה');
        if (!j.result) throw new Error('תשובה-חסרת-תוצאה');
        const height = Number.parseInt(j.result, 16);
        if (!Number.isFinite(height)) throw new Error('גובה-בלוק-לא-תקין');
        return { id: chain.id, name: chain.name, kind: chain.kind, symbol: chain.symbol, live: true, height, latencyMs: Date.now() - t0, rpc: new URL(rpc).host, error: null, probedAt };
      }
      const j = await fetchJson<{ result?: number; error?: { message?: string } }>(
        rpc,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSlot' }),
        },
        6000,
      );
      if (j.error) throw new Error(j.error.message || 'RPC-שגיאה');
      if (typeof j.result !== 'number') throw new Error('תשובה-חסרת-תוצאה');
      return { id: chain.id, name: chain.name, kind: chain.kind, symbol: chain.symbol, live: true, height: j.result, latencyMs: Date.now() - t0, rpc: new URL(rpc).host, error: null, probedAt };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  return { id: chain.id, name: chain.name, kind: chain.kind, symbol: chain.symbol, live: false, height: null, latencyMs: null, rpc: null, error: lastErr, probedAt };
}

const PROBE_TTL_MS = 15000;

/** פרובה-חיה לרשת-אחת — מטמון-15ש׳ + single-flight (מגן-על-קצב-הצמתים). */
export async function probeChain(id: string): Promise<ChainStatus> {
  const chain = chainById(id);
  if (!chain) throw new Error(`רשת-לא-מוכרת: ${id}`);
  const key = `probe:${chain.id}`;
  const hit = cacheGet<ChainStatus>(key);
  if (hit) return hit.value;
  const status = await singleFlight(key, () => probeRpc(chain));
  cacheSet(key, status, PROBE_TTL_MS);
  return status;
}

/** פרובה-מקבילה-מלאה לכל-הרשתות — מהירות-תמיד ≤ הפרובה-האיטית-ביותר. */
export async function probeAllChains(): Promise<{ chains: ChainStatus[]; summary: { total: number; live: number; probedAt: string } }> {
  const chains = await Promise.all(CHAINS.map(c => probeChain(c.id)));
  return {
    chains,
    summary: {
      total: chains.length,
      live: chains.filter(c => c.live).length,
      probedAt: new Date().toISOString(),
    },
  };
}
