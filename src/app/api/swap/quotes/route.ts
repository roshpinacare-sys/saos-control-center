// ═══ /api/swap/quotes — פאן-אאוט מקבילי לכל-המקורות + דירוג-נטו ══════════════
// POST { fromChain, toChain, fromToken, toToken, amount, toPriceUsd?, walletEvm?, walletSolana? }
// קריאה-בלבד: לא-חותמים, לא-מזיזים-כספים. כל-כישלון-מקור מוחזר-גלוי.
import { NextResponse } from 'next/server';
import { chainByKey, type UToken } from '@/lib/live/universal';
import { aggregateQuotes, type QuoteRequest } from '@/lib/live/aggregate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function parseToken(raw: unknown): UToken | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Partial<UToken>;
  const chain = chainByKey(String(t.chain || ''));
  if (!chain) return null;
  const decimals = Number(t.decimals);
  if (!Number.isFinite(decimals) || decimals < 0 || decimals > 24) return null;
  const address = typeof t.address === 'string' && t.address ? t.address : undefined;
  if (!t.native && !address) return null;
  if (address && chain.kind === 'evm' && !/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  return {
    id: String(t.id || `${chain.key}:${address ?? 'native'}`),
    chain: chain.key, chainName: chain.name, kind: chain.kind,
    symbol: String(t.symbol || '').slice(0, 24), name: String(t.name || t.symbol || '').slice(0, 64),
    decimals, ...(address ? { address } : {}), ...(t.native ? { native: true } : {}),
    priceUsd: Number.isFinite(Number(t.priceUsd)) ? Number(t.priceUsd) : undefined,
    ssCoin: typeof t.ssCoin === 'string' ? t.ssCoin : undefined,
    mayaAsset: typeof t.mayaAsset === 'string' ? t.mayaAsset : undefined,
    hue: Number(t.hue) || 200,
  };
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ ok: false, error: 'גוף-בקשה-לא-תקין' }, { status: 400 }); }

  const fromChain = chainByKey(String(body.fromChain || ''));
  const toChain = chainByKey(String(body.toChain || ''));
  const fromToken = parseToken(body.fromToken);
  const toToken = parseToken(body.toToken);
  const amount = Number(body.amount);

  if (!fromChain || !toChain) return NextResponse.json({ ok: false, error: 'רשת-לא-מוכרת' }, { status: 400 });
  if (!fromToken || !toToken) return NextResponse.json({ ok: false, error: 'טוקן-לא-תקין' }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ ok: false, error: 'כמות-חייבת-להיות-חיובית' }, { status: 400 });

  const walletEvm = typeof body.walletEvm === 'string' && /^0x[0-9a-fA-F]{40}$/.test(body.walletEvm) ? body.walletEvm : undefined;
  const walletSolana = typeof body.walletSolana === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(body.walletSolana) ? body.walletSolana : undefined;

  const req: QuoteRequest = {
    fromChain: fromChain.key, toChain: toChain.key, fromToken, toToken, amount,
    toPriceUsd: Number.isFinite(Number(body.toPriceUsd)) ? Number(body.toPriceUsd) : undefined,
    walletEvm, walletSolana,
  };

  try {
    const res = await aggregateQuotes(req);
    return NextResponse.json({ ok: true, ...res, at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: `אגרגציה-נכשלה (כנות): ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
}

