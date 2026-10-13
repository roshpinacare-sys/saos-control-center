// ═══ /api/swap/universe — חיפוש-טוקנים חוצי-רשתות ════════════════════════════
// מקורות: מטבעות-יסוד מקוריים · SideShift (201 מטבעות×48 רשתות) ·
// Jupiter (Solana) · LI.Fi+DexScreener (כתובת-EVM). מאוחדים, מדורגים, כנים.
import { NextResponse } from 'next/server';
import {
  type UToken, CHAINS, chainByKey, majorTokens, ssCoins, ssCoinFor,
} from '@/lib/live/universal';
import { fetchJson, cached } from '@/lib/live/cache';
import { jupTokenSearch, type JupToken } from '@/lib/live/sources';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface DsResp { pairs?: Array<{ chainId: string; baseToken: { address: string; name: string; symbol: string }; priceUsd?: string }> }
const DS_CHAIN_MAP: Record<string, string> = {
  ethereum: 'ethereum', bsc: 'bsc', polygon: 'polygon', arbitrum: 'arbitrum',
  optimism: 'optimism', base: 'base', avalanche: 'avalanche', solana: 'solana',
};

function jupToU(j: JupToken): UToken {
  return {
    id: `solana:${j.id}`,
    chain: 'solana', chainName: 'Solana', kind: 'solana',
    symbol: j.symbol, name: j.name, decimals: j.decimals ?? 9,
    address: j.id, priceUsd: j.usdPrice, hue: chainByKey('solana')?.hue ?? 160,
  };
}

export async function GET(request: { nextUrl: { searchParams: URLSearchParams } }) {
  const sp = request.nextUrl.searchParams;
  const q = (sp.get('q') || '').trim();
  const chain = (sp.get('chain') || '').trim();

  let coins: Awaited<ReturnType<typeof ssCoins>> = [];
  try { coins = await ssCoins(); } catch { coins = []; }

  const results: UToken[] = [];
  const seen = new Set<string>();
  const push = (t: UToken) => {
    if (!t || seen.has(t.id)) return;
    if (chain && t.chain !== chain) return;
    seen.add(t.id); results.push(t);
  };

  /** מטבע-SideShift כרשומה-מאוחדת על-רשת-נתונה. */
  const ssToU = (symbol: string, name: string, chainKey: string): UToken | null => {
    const c = chainByKey(chainKey);
    if (!c || !c.ssNetwork) return null;
    const coin = coins.find(k => k.coin.toUpperCase() === symbol.toUpperCase() && k.networks.includes(c.ssNetwork!));
    if (!coin) return null;
    return {
      id: `${chainKey}:${coin.coin.toLowerCase()}`,
      chain: chainKey, chainName: c.name, kind: c.kind,
      symbol: coin.coin, name, decimals: c.native.decimals,
      ...(coin.coin.toUpperCase() === c.native.symbol ? { native: true } : {}),
      ssCoin: coin.coin, hue: c.hue,
    };
  };

  // 1) מטבעות-יסוד — תמיד; עם-שאילתא — רק-התואמים
  const ql0 = q.toLowerCase();
  for (const m of majorTokens()) {
    if (!q || m.symbol.toLowerCase().includes(ql0) || m.name.toLowerCase().includes(ql0)) push(m);
  }

  if (!q) {
    if (coins.length) {
      const POPULAR = ['BTC', 'ETH', 'SOL', 'USDT', 'USDC', 'XMR', 'DOGE', 'LTC', 'BCH', 'DASH', 'TRX', 'BNB', 'AVAX', 'TON', 'SUI', 'ADA', 'XLM', 'ALGO', 'APT'];
      const chainsFor = chain ? [chain] : CHAINS.map(c => c.key);
      for (const sym of POPULAR) {
        for (const ck of chainsFor) {
          const u = ssToU(sym, sym, ck);
          if (u) push(u);
        }
      }
    }
    return NextResponse.json({ ok: true, results: results.slice(0, 60), at: new Date().toISOString() });
  }

  const ql = q.toLowerCase();

  // 2) כתובת-EVM → LI.Fi (מספריות) + DexScreener (מחיר/זיהוי)
  if (/^0x[0-9a-fA-F]{40}$/.test(q)) {
    const evmChains = (chain ? [chain] : ['ethereum', 'bsc', 'base', 'arbitrum', 'polygon', 'optimism', 'avalanche'])
      .map(k => chainByKey(k)).filter((c): c is NonNullable<typeof c> => !!c && c.kind === 'evm');
    const liFi = await Promise.allSettled(evmChains.map(c =>
      fetchJson<{ symbol: string; name: string; decimals: number; priceUSD?: string }>(
        `https://li.quest/v1/token?chain=${c.chainId}&token=${encodeURIComponent(q)}`, undefined, 9000)));
    liFi.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value?.symbol) {
        const c = evmChains[i];
        push({
          id: `${c.key}:${q.toLowerCase()}`, chain: c.key, chainName: c.name, kind: 'evm',
          symbol: r.value.symbol, name: r.value.name, decimals: r.value.decimals,
          address: q.toLowerCase(), priceUsd: r.value.priceUSD ? Number.parseFloat(r.value.priceUSD) : undefined, hue: c.hue,
        });
      }
    });
    try {
      const ds = await fetchJson<DsResp>(`https://api.dexscreener.com/latest/dex/tokens/${q}`, undefined, 9000);
      for (const p of (ds.pairs || []).slice(0, 4)) {
        const ck = DS_CHAIN_MAP[p.chainId];
        const c = ck ? chainByKey(ck) : undefined;
        if (!c) continue;
        push({
          id: `${c.key}:${p.baseToken.address.toLowerCase()}`, chain: c.key, chainName: c.name, kind: c.kind,
          symbol: p.baseToken.symbol, name: p.baseToken.name, decimals: 18, address: p.baseToken.address.toLowerCase(),
          priceUsd: p.priceUsd ? Number.parseFloat(p.priceUsd) : undefined, hue: c.hue,
        });
      }
    } catch { /* כנות: כתובת-לא-זוהתה → המשך-לשאר-המקורות */ }
  }

  // 3) Solana — Jupiter (סמל או mint) · מדוד: סמל-אחד-מנצח-פר-רשת (הגבוה-בנזילות)
  const solanaRelevant = !chain || chain === 'solana';
  const isBase58 = /^[1-9A-HJ-NP-Za-km-z]{30,50}$/.test(q);
  if (solanaRelevant && (ql.length >= 2 || isBase58)) {
    try {
      const { value: jups } = await cached(`universe:jup:${q}`, 10 * 60000, () => jupTokenSearch(q, 12));
      const bestBySym = new Map<string, JupToken>();
      for (const j of jups) {
        const k = j.symbol?.toUpperCase() ?? j.id;
        const prev = bestBySym.get(k);
        if (!prev || (j.liquidity ?? 0) > (prev.liquidity ?? 0)) bestBySym.set(k, j);
      }
      for (const j of bestBySym.values()) push(jupToU(j));
    } catch { /* */ }
  }

  // 4) SideShift — התאמת-סמל/שם → פריסה-על-הרשתות
  if (coins.length && ql.length >= 2) {
    const matches = coins.filter(c =>
      c.coin.toLowerCase().includes(ql) || c.name.toLowerCase().includes(ql)).slice(0, 8);
    for (const coin of matches) {
      for (const ck of (chain ? [chain] : CHAINS.map(c => c.key))) {
        // כבר-מיוצג-ע"י-יסוד/מקור-קודם על-אותה-רשת ואותו-סמל → לא-משכפלים
        if (results.some(r => r.chain === ck && r.symbol.toUpperCase() === coin.coin.toUpperCase())) continue;
        const u = ssToU(coin.coin, coin.name, ck);
        if (u) push(u);
      }
    }
  }

  // דירוג: ילידים → מטבעות-יסוד (קטלוג-מקורי) → בעלי-מחיר → אלפבית
  const majorIds = new Set(majorTokens().map(m => m.id));
  const tierOf = (t: UToken): number =>
    t.native ? 0 : majorIds.has(t.id) ? 1 : (t.priceUsd ? 2 : 3);
  results.sort((a, b) => {
    const ta = tierOf(a), tb = tierOf(b);
    if (ta !== tb) return ta - tb;
    return a.symbol.localeCompare(b.symbol);
  });

  return NextResponse.json({ ok: true, results: results.slice(0, 40), at: new Date().toISOString() });
}
