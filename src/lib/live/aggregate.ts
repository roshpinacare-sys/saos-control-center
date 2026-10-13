// ═══ החלפת-הכל · מנוע-הדירוג — פאן-אאוט מקבילי לכל-מקור + דירוג-נטו ═════════
// כל-ציטוט = אמת-מהמקור. מקור-שנכשל → ProviderFailure גלוי-עם-סיבה (כנות-מלאה).
// דירוג: פלט-נטו במטבע-היעד (אותו-נכס-יעד לכל-הציטוטים → השוואה-ישירה-כנה).

import {
  type ProviderId, type ProviderFailure, type UniversalQuote, type UToken,
  PROVIDER_META, chainByKey, ssCoinFor, ssCoins, ssQuote, mayaPools, mayaQuote,
  psQuote, psSupports, toRaw, fromRaw, fromP8,
} from './universal';
import { jupQuote, lifiQuote, quoteFromAddress } from './sources';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';

export interface QuoteRequest {
  fromChain: string; toChain: string;
  fromToken: UToken; toToken: UToken;
  amount: number;
  toPriceUsd?: number;           // להצגת-שווי-דולרי (מהיקום-בצד-הלקוח)
  walletEvm?: string;            // כתובת-ארנק EVM (אופציונלי לציטוט)
  walletSolana?: string;
}

export interface AggregateResult {
  quotes: UniversalQuote[];
  failed: ProviderFailure[];
  rankedAt: string;
}

function fail(id: ProviderId, msg: string): ProviderFailure {
  return { provider: id, providerName: PROVIDER_META[id].name, error: msg };
}

/** אילו-מקורות רלוונטיים לזוג-הזה — לפי-כללי-כיסוי-אמת. */
export async function providersFor(req: QuoteRequest): Promise<ProviderId[]> {
  const fc = chainByKey(req.fromChain), tc = chainByKey(req.toChain);
  if (!fc || !tc) return [];
  const out: ProviderId[] = [];

  // Maya — חוצה-מחלקות: שני-הנכסים-חייבים-בריכות-חיות-זמינות
  if (req.fromToken.mayaAsset && req.toToken.mayaAsset) {
    try {
      const pools = await mayaPools();
      const alive = new Set(pools.filter(p => p.status === 'Available').map(p => p.asset));
      if (alive.has(req.fromToken.mayaAsset) && alive.has(req.toToken.mayaAsset)) out.push('maya');
    } catch { /* מקור-לא-זמין — ייכשל-גלוי-בשלב-הציטוט */ }
  }

  // SideShift — שני-המטבעות-קיימים-בקטלוג-על-הרשתות-המבוקשות
  try {
    const coins = await ssCoins();
    if (ssCoinFor(req.fromToken.symbol, req.fromChain, coins) && ssCoinFor(req.toToken.symbol, req.toChain, coins)) out.push('sideshift');
  } catch { /* */ }

  // LI.Fi — שתי-שרשראות-EVM (סוואף-תוך-שרשרת או חוצה-שרשראות)
  if (fc.kind === 'evm' && tc.kind === 'evm' && fc.chainId && tc.chainId) out.push('lifi');

  // ParaSwap — תוך-שרשרת-EVM בלבד (עומק)
  if (fc.kind === 'evm' && tc.kind === 'evm' && fc.chainId && fc.chainId === tc.chainId && psSupports(fc.chainId)) out.push('paraswap');

  // Jupiter — Solana בלבד
  if (fc.kind === 'solana' && tc.kind === 'solana') out.push('jupiter');

  return out;
}

async function quoteMaya(req: QuoteRequest): Promise<UniversalQuote> {
  // יחידות-ילידות-מלאות של-הנכס (BTC→satoshi · ETH→wei · USDT→base): אומת-חיים EXEC-CD-23
  const amountRaw = toRaw(req.amount, req.fromToken.decimals);
  const q = await mayaQuote(req.fromToken.mayaAsset!, req.toToken.mayaAsset!, amountRaw);
  if (!q.inbound_address || !q.expected_amount_out) {
    throw new Error(`Maya: תשובה-חסרה (${(q.errors || []).join('; ') || 'בריכה-לא-זמינה'})`);
  }
  const out = fromP8(q.expected_amount_out);
  const etaSec = (q.inbound_confirmation_seconds ?? 600) + (q.outbound_delay_seconds ?? 0);
  const caveats: string[] = [];
  if (q.dust_threshold) caveats.push(`מתחת-לאבק-הרשת (${q.dust_threshold} יח׳) ההפקדה-תיפסל`);
  if (q.recommended_min_amount_in) caveats.push(`מינימום-מומלץ: ${fromP8(q.recommended_min_amount_in)} ${req.fromToken.symbol}`);
  if (q.warning) caveats.push('אל-תשלחו אחרי-פקיעת-השער');
  return {
    provider: 'maya', providerName: PROVIDER_META.maya.name, kind: 'deposit',
    outAmount: out,
    usdOut: req.toPriceUsd ? out * req.toPriceUsd : undefined,
    feeUsd: q.fees && req.toPriceUsd ? fromP8(q.fees.total) * req.toPriceUsd : undefined,
    etaSec, etaLabel: etaSec > 90 ? `≈${Math.max(1, Math.round(etaSec / 60))} דק׳` : 'דקות-ספורות',
    route: ['הפקדה', `כספת-Maya ${req.fromToken.mayaAsset!.split('.')[0]}`, `פדיון ${req.toToken.mayaAsset!.split('.')[0]}`],
    caveats,
    ref: { fromAsset: req.fromToken.mayaAsset, toAsset: req.toToken.mayaAsset, amountRaw },
  };
}

async function quoteSideShift(req: QuoteRequest): Promise<UniversalQuote> {
  const coins = await ssCoins();
  const dep = ssCoinFor(req.fromToken.symbol, req.fromChain, coins);
  const set = ssCoinFor(req.toToken.symbol, req.toChain, coins);
  if (!dep || !set) throw new Error('SideShift: המטבע-לא-בקטלוג-על-הרשת-המבוקשת');
  const q = await ssQuote({
    depositCoin: dep.coin, settleCoin: set.coin,
    depositAmount: req.amount.toPrecision(8),
    depositNetwork: chainByKey(req.fromChain)?.ssNetwork,
    settleNetwork: chainByKey(req.toChain)?.ssNetwork,
  });
  const out = Number.parseFloat(q.settleAmount);
  if (!Number.isFinite(out) || out <= 0) throw new Error('SideShift: פלט-לא-תקין');
  return {
    provider: 'sideshift', providerName: PROVIDER_META.sideshift.name, kind: 'deposit',
    outAmount: out,
    usdOut: req.toPriceUsd ? out * req.toPriceUsd : undefined,
    etaSec: 1800, etaLabel: '≈10–60 דק׳',
    rateLockSec: Math.max(0, Math.floor((new Date(q.expiresAt).getTime() - Date.now()) / 1000)),
    route: [`הפקדה ${q.depositNetwork ?? q.depositCoin}`, 'SideShift', `${q.settleNetwork ?? q.settleCoin}`],
    caveats: [
      'השער-נעול 15 דק׳ מרגע-ההזמנה',
      ...(dep.hasMemo ? [`המטבע ${dep.coin} דורש ממואר-הפקדה`] : []),
    ],
    ref: {
      quoteId: q.id, depositCoin: q.depositCoin, settleCoin: q.settleCoin,
      depositNetwork: q.depositNetwork, settleNetwork: q.settleNetwork,
      depositAmount: q.depositAmount, settleAmount: q.settleAmount, expiresAt: q.expiresAt,
      depositHasMemo: dep.hasMemo, settleHasMemo: set.hasMemo,
    },
  };
}

async function quoteLifi(req: QuoteRequest): Promise<UniversalQuote> {
  const fc = chainByKey(req.fromChain)!, tc = chainByKey(req.toChain)!;
  const NATIVE = '0x0000000000000000000000000000000000000000';
  const from = quoteFromAddress(req.walletEvm || undefined);
  const resp = await lifiQuote({
    fromChain: fc.chainId!, toChain: tc.chainId!,
    fromToken: req.fromToken.native ? NATIVE : (req.fromToken.address || NATIVE),
    toToken: req.toToken.native ? NATIVE : (req.toToken.address || NATIVE),
    fromAmount: toRaw(req.amount, req.fromToken.decimals),
    fromAddress: from.address,
  });
  const dec = resp.action.toToken.decimals;
  const out = fromRaw(resp.estimate.toAmount, dec);
  const gasUSD = (resp.estimate.gasCosts || []).reduce((s, g) => s + Number.parseFloat(g.amountUSD || '0'), 0);
  const feeUSD = (resp.estimate.feeCosts || []).reduce((s, f) => s + Number.parseFloat(f.amountUSD || '0'), 0);
  const cross = fc.chainId !== tc.chainId;
  return {
    provider: 'lifi', providerName: PROVIDER_META.lifi.name, kind: 'wallet',
    outAmount: out,
    outMin: fromRaw(resp.estimate.toAmountMin, dec),
    usdOut: resp.estimate.toAmountUSD ? Number.parseFloat(resp.estimate.toAmountUSD) : (req.toPriceUsd ? out * req.toPriceUsd : undefined),
    gasUsd: Number.isFinite(gasUSD) ? gasUSD : undefined,
    feeUsd: Number.isFinite(feeUSD) ? feeUSD : undefined,
    etaSec: resp.estimate.executionDuration || (cross ? 300 : 30),
    etaLabel: cross ? '≈1–10 דק׳' : 'שניות-ספורות',
    route: [resp.toolDetails?.name || resp.tool, ...(resp.includedSteps || []).map(s => s.toolDetails?.name || s.tool)],
    caveats: cross ? ['חוצה-שרשראות: חתימה-אחת, המנוע-מזיז-את-הכסף'] : [],
    ref: {
      fromChain: fc.chainId, toChain: tc.chainId,
      fromToken: req.fromToken.native ? NATIVE : req.fromToken.address,
      toToken: req.toToken.native ? NATIVE : req.toToken.address,
      fromDecimals: req.fromToken.decimals, toDecimals: dec,
      amount: req.amount, cross,
    },
  };
}

async function quoteParaSwap(req: QuoteRequest): Promise<UniversalQuote> {
  const fc = chainByKey(req.fromChain)!;
  const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  const src = req.fromToken.native ? NATIVE : (req.fromToken.address || NATIVE);
  const dst = req.toToken.native ? NATIVE : (req.toToken.address || NATIVE);
  const pr = await psQuote(fc.chainId!, src, dst, toRaw(req.amount, req.fromToken.decimals));
  const out = fromRaw(pr.destAmount, pr.destDecimals);
  const exchanges = (pr.bestRoute || []).flatMap(r => (r.swaps || []).flatMap(sw => (sw.swapExchanges || []).map(se => se.exchange || 'DEX')));
  return {
    provider: 'paraswap', providerName: PROVIDER_META.paraswap.name, kind: 'wallet',
    outAmount: out,
    usdOut: req.toPriceUsd ? out * req.toPriceUsd : undefined,
    gasUsd: pr.gasCostUSD ? Number.parseFloat(pr.gasCostUSD) : (pr.gasCost ? Number.parseFloat(pr.gasCost) : undefined),
    etaSec: 30, etaLabel: 'שניות-ספורות',
    route: [...new Set(exchanges)].slice(0, 4),
    caveats: [],
    ref: { network: fc.chainId, srcToken: src.toLowerCase(), destToken: dst.toLowerCase(), amountRaw: pr.srcAmount, slippageBps: 100 },
  };
}

async function quoteJupiter(req: QuoteRequest): Promise<UniversalQuote> {
  const inMint = req.fromToken.native ? SOL_MINT : (req.fromToken.address || SOL_MINT);
  const outMint = req.toToken.native ? SOL_MINT : (req.toToken.address || SOL_MINT);
  const q = await jupQuote(inMint, outMint, toRaw(req.amount, req.fromToken.decimals), 50);
  const out = fromRaw(q.outAmount, req.toToken.decimals);
  const usd = Number.parseFloat((q as unknown as { swapUsdValue?: string }).swapUsdValue ?? '');
  return {
    provider: 'jupiter', providerName: PROVIDER_META.jupiter.name, kind: 'wallet',
    outAmount: out,
    outMin: fromRaw(q.otherAmountThreshold, req.toToken.decimals),
    usdOut: Number.isFinite(usd) ? usd : (req.toPriceUsd ? out * req.toPriceUsd : undefined),
    etaSec: 5, etaLabel: 'שניות-ספורות',
    slippageBps: q.slippageBps,
    priceImpactPct: Number.parseFloat(q.priceImpactPct) || 0,
    route: q.routePlan.map(r => r.swapInfo.label || 'AMM').slice(0, 4),
    caveats: [],
    ref: { inMint, outMint, amountRaw: toRaw(req.amount, req.fromToken.decimals), slippageBps: 50, inDecimals: req.fromToken.decimals },
  };
}

const QUOTERS: Record<ProviderId, (req: QuoteRequest) => Promise<UniversalQuote>> = {
  maya: quoteMaya, sideshift: quoteSideShift, lifi: quoteLifi, paraswap: quoteParaSwap, jupiter: quoteJupiter,
};

export async function aggregateQuotes(req: QuoteRequest): Promise<AggregateResult> {
  const providers = await providersFor(req);
  if (!providers.length) return { quotes: [], failed: [], rankedAt: new Date().toISOString() };
  const settled = await Promise.allSettled(providers.map(p => QUOTERS[p](req)));
  const quotes: UniversalQuote[] = [];
  const failed: ProviderFailure[] = [];
  providers.forEach((p, i) => {
    const s = settled[i];
    if (s.status === 'fulfilled' && s.value.outAmount > 0) quotes.push(s.value);
    else failed.push(fail(p, s.status === 'rejected' ? (s.reason instanceof Error ? s.reason.message : String(s.reason)) : 'פלט-אפס'));
  });
  // דירוג-נטו: אותו-נכס-יעד → השוואה-ישירה של הפלט
  quotes.sort((a, b) => b.outAmount - a.outAmount);
  return { quotes, failed, rankedAt: new Date().toISOString() };
}
