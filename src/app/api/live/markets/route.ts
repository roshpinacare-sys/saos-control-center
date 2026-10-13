// ═══ /api/live/markets — מחירי-השוק-המובילים + זוגות-אמת-לרשת ═══════════════
import { NextResponse } from 'next/server';
import { coinMarkets, dexPairsForChain, type DsPair } from '@/lib/live/sources';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ברירת-המחדל: זוג-הציטוט הדומיננטי של כל-רשת (מקור-הנזילות-העמוק)
const CHAIN_QUERIES: Array<{ chain: string; query: string; label: string }> = [
  { chain: 'solana', query: 'SOL USDC', label: 'SOL/USDC' },
  { chain: 'ethereum', query: 'WETH USDC', label: 'ETH/USDC' },
  { chain: 'bsc', query: 'WBNB USDT', label: 'BNB/USDT' },
  { chain: 'base', query: 'WETH USDC', label: 'ETH/USDC' },
  { chain: 'arbitrum', query: 'WETH USDC', label: 'ETH/USDC' },
  { chain: 'polygon', query: 'WPOL USDC', label: 'POL/USDC' },
];

export async function GET() {
  try {
    const markets = await coinMarkets(40);

    const chainResults = await Promise.allSettled(
      CHAIN_QUERIES.map(async cq => ({
        chain: cq.chain,
        label: cq.label,
        pairs: (await dexPairsForChain(cq.chain, cq.query, 6)).pairs,
      })),
    );

    const chainPairs: Array<{ chain: string; label: string; pairs: DsPair[]; error?: string }> = chainResults.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : { chain: CHAIN_QUERIES[i].chain, label: CHAIN_QUERIES[i].label, pairs: [], error: String(r.reason?.message || r.reason) },
    );

    return NextResponse.json({
      ok: true,
      coins: markets.coins,
      coinsAgeMs: markets.ageMs,
      coinsStale: markets.stale === true,
      coinsSource: markets.source,
      chainPairs,
      at: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
