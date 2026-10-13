// ═══ /api/live/quote — ציטוט-אמת: Solana (Jupiter) · EVM (Li.Fi) ═════════════
// קריאה-בלבד: לא-בונים-טרנזקציה, לא-חותמים, לא-מזיזים-כספים.
// fromAddress חסר-כוונה-אישית → כתובת-הבדיקה הריבונית (probe:true בתשובה).
import { NextResponse } from 'next/server';
import { jupQuote, lifiQuote, quoteFromAddress, toRawAmount, fromRawAmount } from '@/lib/live/sources';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: { nextUrl: { searchParams: URLSearchParams } }) {
  const sp = request.nextUrl.searchParams;
  const mode = sp.get('mode') || 'solana';

  try {
    if (mode === 'solana') {
      const inputMint = sp.get('inputMint') || '';
      const outputMint = sp.get('outputMint') || '';
      const amount = Number.parseFloat(sp.get('amount') || '0');
      const inDecimals = Number.parseInt(sp.get('inDecimals') || '9', 10);
      const outDecimals = Number.parseInt(sp.get('outDecimals') || '9', 10);
      const slippageBps = Math.min(Math.max(Number.parseInt(sp.get('slippageBps') || '50', 10) || 50, 10), 2000);

      if (!/^([1-9A-HJ-NP-Za-km-z]{32,44})$/.test(inputMint) || !/^([1-9A-HJ-NP-Za-km-z]{32,44})$/.test(outputMint)) {
        return NextResponse.json({ ok: false, error: 'מטבעות-Solana דורשים כתובות-mint תקינות (base58)' }, { status: 400 });
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ ok: false, error: 'כמות-חייבת-להיות חיובית' }, { status: 400 });
      }

      const quote = await jupQuote(inputMint, outputMint, toRawAmount(amount, inDecimals), slippageBps);
      return NextResponse.json({
        ok: true,
        engine: 'jupiter',
        chain: 'solana',
        inAmountHuman: amount,
        outAmountHuman: fromRawAmount(quote.outAmount, outDecimals),
        outMinHuman: fromRawAmount(quote.otherAmountThreshold, outDecimals),
        priceImpactPct: quote.priceImpactPct,
        slippageBps: quote.slippageBps,
        route: quote.routePlan.map(r => r.swapInfo.label || 'AMM'),
        at: new Date().toISOString(),
      });
    }

    // EVM / cross-chain via Li.Fi quote
    const fromChain = Number.parseInt(sp.get('fromChain') || '1', 10);
    const toChain = Number.parseInt(sp.get('toChain') || '1', 10);
    const fromToken = sp.get('fromToken') || '';
    const toToken = sp.get('toToken') || '';
    const amount = Number.parseFloat(sp.get('amount') || '0');
    const inDecimals = Number.parseInt(sp.get('inDecimals') || '18', 10);
    const outDecimals = Number.parseInt(sp.get('outDecimals') || '6', 10);
    const userAddr = sp.get('address') || undefined;

    if (!/^0x[0-9a-fA-F]{40}$/.test(fromToken) || !/^0x[0-9a-fA-F]{40}$/.test(toToken)) {
      return NextResponse.json({ ok: false, error: 'טוקני-EVM דורשים כתובות-חוזה תקינות (0x…)' }, { status: 400 });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ ok: false, error: 'כמות-חייבת-להיות חיובית' }, { status: 400 });
    }

    const from = quoteFromAddress(userAddr);
    const resp = await lifiQuote({
      fromChain, toChain, fromToken, toToken,
      fromAmount: toRawAmount(amount, inDecimals),
      fromAddress: from.address,
    });

    const gasUSD = (resp.estimate.gasCosts || []).reduce((s, g) => s + Number.parseFloat(g.amountUSD || '0'), 0);
    const feeUSD = (resp.estimate.feeCosts || []).reduce((s, f) => s + Number.parseFloat(f.amountUSD || '0'), 0);

    return NextResponse.json({
      ok: true,
      engine: 'lifi',
      tool: resp.toolDetails?.name || resp.tool,
      fromChainId: resp.action.fromChainId,
      toChainId: resp.action.toChainId,
      crossChain: resp.action.fromChainId !== resp.action.toChainId,
      inAmountHuman: amount,
      outAmountHuman: fromRawAmount(resp.estimate.toAmount, outDecimals),
      outMinHuman: fromRawAmount(resp.estimate.toAmountMin, outDecimals),
      outUsd: resp.estimate.toAmountUSD ? Number.parseFloat(resp.estimate.toAmountUSD) : undefined,
      gasUsd: Number.isFinite(gasUSD) ? gasUSD : undefined,
      feeUsd: Number.isFinite(feeUSD) ? feeUSD : undefined,
      durationSec: resp.estimate.executionDuration,
      subSteps: (resp.includedSteps || []).map(s => s.toolDetails?.name || s.tool),
      probe: from.probe,
      at: new Date().toISOString(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: `ציטוט-נכשל (כנות): ${msg}` }, { status: 502 });
  }
}
