// ═══ /api/swap/chains — קטלוג-הרשתות + בריאות-מקורות חיה ═════════════════════
// כל-הפרובות אמת: Maya ו-SideShift נשאלים-ישירות; כישלון-מקור מוצג-ככזה.
import { NextResponse } from 'next/server';
import { CHAINS, majorTokens, mayaPools, ssCoins } from '@/lib/live/universal';
import { fetchJson, cached } from '@/lib/live/cache';
import { jupTokenSearch } from '@/lib/live/sources';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export interface ProviderHealth {
  maya: boolean; sideshift: boolean; lifi: boolean; paraswap: boolean; jupiter: boolean;
  checkedAt: string;
}

async function probeHealth(): Promise<ProviderHealth> {
  const h: ProviderHealth = { maya: false, sideshift: false, lifi: false, paraswap: false, jupiter: false, checkedAt: new Date().toISOString() };
  const [maya, ss, lifi, ps, jup] = await Promise.allSettled([
    mayaPools(),
    ssCoins(),
    fetchJson<{ chains: unknown[] }>('https://li.quest/v1/chains', undefined, 8000),
    fetchJson<{ priceRoute?: unknown }>('https://api.paraswap.io/prices?srcToken=0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee&destToken=0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48&amount=1000000000000000000&side=SELL&network=1', undefined, 8000),
    jupTokenSearch('SOL', 1),
  ]);
  if (maya.status === 'fulfilled' && maya.value.length > 0) h.maya = true;
  if (ss.status === 'fulfilled' && ss.value.length > 0) h.sideshift = true;
  if (lifi.status === 'fulfilled') h.lifi = true;
  if (ps.status === 'fulfilled' && ps.value.priceRoute) h.paraswap = true;
  if (jup.status === 'fulfilled' && Array.isArray(jup.value) && jup.value.length > 0) h.jupiter = true;
  return h;
}

const PS_NETS = [1, 10, 56, 100, 130, 137, 146, 4663, 8453, 42161, 43114];

export async function GET() {
  // בריאות-מטמון 2 דקות; מטמון-כשל-מקור 45 שנ׳ כדי-שהסטריפ-יתאושש מהר
  const { value: health } = await cached('swap:provider-health', 2 * 60000, probeHealth);

  // כיסוי-פר-מקור-פר-רשת — חוקי-כיסוי-אמת (מה-probes של EXEC-CD-23)
  const poolsAlive = new Set<string>();
  if (health.maya) {
    try { (await mayaPools()).filter(p => p.status === 'Available').forEach(p => poolsAlive.add(p.asset.split('.')[0])); } catch { /* */ }
  }
  let coins: Awaited<ReturnType<typeof ssCoins>> = [];
  if (health.sideshift) { try { coins = await ssCoins(); } catch { /* */ } }

  const chains = CHAINS.map(c => ({
    ...c,
    providers: {
      maya: !!c.mayaChain && poolsAlive.has(c.mayaChain),
      sideshift: !!c.ssNetwork && (coins.length === 0 ? false : coins.some(k => k.networks.includes(c.ssNetwork!))),
      lifi: c.kind === 'evm',
      paraswap: c.kind === 'evm' && PS_NETS.includes(c.chainId ?? -1),
      jupiter: c.kind === 'solana',
    },
  }));

  return NextResponse.json({ ok: true, chains, majors: majorTokens(), health, at: new Date().toISOString() });
}
