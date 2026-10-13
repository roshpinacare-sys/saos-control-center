// ═══ /api/live/bridge — מסלולי-גשר אמת חוצי-שרשראות (Li.Fi) ═════════════════
// מחזיר עד-3 מסלולי-גישור מתחרים עם עלויות-אמת (גז/עמלות/משך) — השוואה-כנה
// של הגשרים-מאחורי-הקלעים, בדיוק-כמו שהכפתור-"גשר" של הארנקים-המובילים עושה.
import { NextResponse } from 'next/server';
import { lifiRoutes, quoteFromAddress, toRawAmount, fromRawAmount, type LifiRoute } from '@/lib/live/sources';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: { nextUrl: { searchParams: URLSearchParams } }) {
  const sp = request.nextUrl.searchParams;
  const fromChainId = Number.parseInt(sp.get('fromChainId') || '1', 10);
  const toChainId = Number.parseInt(sp.get('toChainId') || '137', 10);
  const fromTokenAddress = sp.get('fromToken') || '';
  const toTokenAddress = sp.get('toToken') || '';
  const amount = Number.parseFloat(sp.get('amount') || '0');
  const inDecimals = Number.parseInt(sp.get('inDecimals') || '18', 10);
  const outDecimals = Number.parseInt(sp.get('outDecimals') || '6', 10);
  const userAddr = sp.get('address') || undefined;

  if (!/^0x[0-9a-fA-F]{40}$/.test(fromTokenAddress) || !/^0x[0-9a-fA-F]{40}$/.test(toTokenAddress)) {
    return NextResponse.json({ ok: false, error: 'כתובות-טוקן EVM תקינות נדרשות (0x…)' }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ ok: false, error: 'כמות-חייבת-להיות חיובית' }, { status: 400 });
  }
  if (fromChainId === toChainId) {
    return NextResponse.json({ ok: false, error: 'גשר דורש שתי שרשראות שונות (השתמש ב-סוואף EVM לאותה-שרשרת)' }, { status: 400 });
  }

  try {
    const from = quoteFromAddress(userAddr);
    const routes = await lifiRoutes({
      fromChainId, toChainId, fromTokenAddress, toTokenAddress,
      fromAmount: toRawAmount(amount, inDecimals),
      fromAddress: from.address,
    });

    const mapped = routes.slice(0, 3).map((r: LifiRoute, idx) => {
      const gasUSD = r.steps.reduce((s, st) => s + (st.estimate.gasCosts || []).reduce((a, g) => a + Number.parseFloat(g.amountUSD || '0'), 0), 0);
      const feeUSD = r.steps.reduce((s, st) => s + (st.estimate.feeCosts || []).reduce((a, f) => a + Number.parseFloat(f.amountUSD || '0'), 0), 0);
      const duration = r.steps.reduce((s, st) => s + (st.estimate.executionDuration || 0), 0);
      const tools = r.steps.map(st => st.toolDetails?.name || st.tool);
      return {
        rank: idx + 1,
        id: r.id,
        tools,
        outAmountHuman: fromRawAmount(r.steps[r.steps.length - 1]?.estimate?.toAmount || '0', outDecimals),
        outMinHuman: fromRawAmount(r.steps[r.steps.length - 1]?.estimate?.toAmountMin || '0', outDecimals),
        outUsd: r.steps[r.steps.length - 1]?.estimate?.toAmountUSD ? Number.parseFloat(r.steps[r.steps.length - 1].estimate.toAmountUSD as string) : undefined,
        gasUsd: Number.isFinite(gasUSD) ? Number(gasUSD.toFixed(2)) : undefined,
        feeUsd: Number.isFinite(feeUSD) ? Number(feeUSD.toFixed(2)) : undefined,
        durationSec: duration,
        stepsCount: r.steps.length,
      };
    });

    return NextResponse.json({ ok: true, engine: 'lifi-routes', routes: mapped, probe: from.probe, at: new Date().toISOString() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: `מסלולי-גשר-נכשלו (כנות): ${msg}` }, { status: 502 });
  }
}
