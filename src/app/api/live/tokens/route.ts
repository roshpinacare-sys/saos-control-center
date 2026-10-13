// ═══ /api/live/tokens — סייר-טוקנים אמת חוצה-שרשראות ════════════════════════
// Solana: Jupiter v2 (מחיר-אמת, organicScore, verified, נזילות)
// כל-השאר: DexScreener search (מחיר-אמת + נזילות-אמת לזוג-העמוק-ביותר)
import { NextResponse } from 'next/server';
import { jupTokenSearch, dexPairsForChain, type JupToken, type DsPair } from '@/lib/live/sources';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export interface TokenRow {
  chain: string;
  address: string;
  symbol: string;
  name: string;
  icon?: string;
  priceUsd?: number;
  liquidityUsd?: number;
  mcapUsd?: number;
  verified?: boolean;
  organicScore?: number;
  source: 'jupiter' | 'dexscreener';
}

export async function GET(request: { nextUrl: { searchParams: URLSearchParams } }) {
  const q = (request.nextUrl.searchParams.get('q') || '').trim();
  if (q.length < 2) {
    return NextResponse.json({ ok: false, error: 'הזן לפחות 2 תווים לחיפוש' }, { status: 400 });
  }

  try {
    const [jupRes, dsResults] = await Promise.all([
      jupTokenSearch(q, 12).then(
        v => v,
        () => null, // Jupiter נופל → הסייר ממשיך עם DexScreener בלבד (כנות: מסומן)
      ),
      Promise.allSettled(
        ['ethereum', 'bsc', 'base', 'arbitrum', 'polygon'].map(c => dexPairsForChain(c, q, 4)),
      ),
    ]);

    const rows: TokenRow[] = [];
    let jupError: string | null = null;

    if (jupRes && Array.isArray(jupRes)) {
      for (const t of jupRes as JupToken[]) {
        rows.push({
          chain: 'solana',
          address: t.id,
          symbol: t.symbol || '?',
          name: t.name || t.symbol || '?',
          icon: t.icon,
          priceUsd: t.usdPrice,
          liquidityUsd: t.liquidity,
          mcapUsd: t.mcap,
          verified: t.isVerified,
          organicScore: t.organicScore,
          source: 'jupiter',
        });
      }
    } else if (jupRes === null) {
      jupError = 'מקור-Jupiter לא-נענה';
    }

    for (const r of dsResults) {
      if (r.status !== 'fulfilled') continue;
      for (const p of r.value.pairs as DsPair[]) {
        if (rows.some(x => x.chain === p.chainId && x.address.toLowerCase() === p.baseToken.address.toLowerCase())) continue;
        rows.push({
          chain: p.chainId,
          address: p.baseToken.address,
          symbol: p.baseToken.symbol || '?',
          name: p.baseToken.name || p.baseToken.symbol || '?',
          priceUsd: p.priceUsd ? Number.parseFloat(p.priceUsd) : undefined,
          liquidityUsd: p.liquidity?.usd,
          source: 'dexscreener',
        });
      }
    }

    rows.sort((a, b) => (b.liquidityUsd ?? b.mcapUsd ?? 0) - (a.liquidityUsd ?? a.mcapUsd ?? 0));

    return NextResponse.json({ ok: true, query: q, tokens: rows.slice(0, 36), jupError, at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
