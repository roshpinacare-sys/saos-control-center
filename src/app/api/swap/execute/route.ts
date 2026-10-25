// ═══ /api/swap/execute — הכנת-ביצוע-ריבונית לפי-מקור ══════════════════════════
// POST { provider, fromChain, toChain, fromToken, toToken, amount,
//        settleAddress?, settleMemo?, refundAddress?, refundMemo?, walletAddress? }
//   · maya      → ציטוט-טרי + כתובת-הפקדה/ממואר (המשתמש-שולח-מהארנק-שלו; אין-משמורת)
//   · sideshift → יצירת-הזמנה (דורש SAOS_SIDESHIFT_ID — שער-כנה כשחסר)
//   · lifi      → transactionRequest לחתימת-ארנק-EVM
//   · paraswap  → calldata לחתימת-ארנק-EVM
//   · jupiter   → swapTransaction (base64) לחתימת-ארנק-Solana
// אף-מפתח-פרטי-אינו-נשלח-מעולם-לכאן. כל-כתובת-יעד נבדקת fail-closed.
import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import {
  type UToken, chainByKey, isValidAddress, mayaQuote, ssQuote, ssCreateShift,
  psQuote, psBuildTx, toRaw, fromP8,
} from '@/lib/live/universal';
import { jupQuote } from '@/lib/live/sources';
import { lifiQuote, quoteFromAddress } from '@/lib/live/sources';
import { SOL_MINT } from '@/lib/live/aggregate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// זהה ל-parseToken ב-quotes — מועתק כאן כדי-שהדבר-הקדוש (קלט-משתמש) ייבדק בכל-שער
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
    ssCoin: typeof t.ssCoin === 'string' ? t.ssCoin : undefined,
    mayaAsset: typeof t.mayaAsset === 'string' ? t.mayaAsset : undefined,
    hue: Number(t.hue) || 200,
  };
}

async function qr(text: string): Promise<string> {
  try { return await QRCode.toDataURL(text, { margin: 1, width: 240, errorCorrectionLevel: 'L' }); }
  catch { return ''; }
}

export async function POST(request: Request) {
  // §1 deny-by-default (EMERGENCY DIRECTIVE 2026-10-25): creating external shift
  // orders (SideShift/Maya/lfi/paraswap/jupiter payloads with the platform
  // affiliate id) is an owner prerogative. Anonymous order creation is refused
  // BEFORE any payload is parsed and recorded in the deny ledger. Read-only
  // quote endpoints remain public.
  {
    const { requireOwner } = await import('@/lib/auth');
    const { denyAndLog } = await import('@/lib/deny-audit');
    const owner = await requireOwner(request as never);
    if (!owner) return denyAndLog(request as never, '/api/swap/execute', 'order creation without owner session');
  }
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ ok: false, error: 'גוף-בקשה-לא-תקין' }, { status: 400 }); }

  const provider = String(body.provider || '');
  const fromChain = chainByKey(String(body.fromChain || ''));
  const toChain = chainByKey(String(body.toChain || ''));
  const fromToken = parseToken(body.fromToken);
  const toToken = parseToken(body.toToken);
  const amount = Number(body.amount);

  if (!fromChain || !toChain || !fromToken || !toToken)
    return NextResponse.json({ ok: false, error: 'פרמטרים-חסרים/לא-תקינים' }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0)
    return NextResponse.json({ ok: false, error: 'כמות-חייבת-להיות-חיובית' }, { status: 400 });

  const settleAddress = typeof body.settleAddress === 'string' ? body.settleAddress.trim() : '';
  const refundAddress = typeof body.refundAddress === 'string' ? body.refundAddress.trim() : '';
  const settleMemo = typeof body.settleMemo === 'string' ? body.settleMemo.trim() : undefined;
  const refundMemo = typeof body.refundMemo === 'string' ? body.refundMemo.trim() : undefined;
  const walletAddress = typeof body.walletAddress === 'string' ? body.walletAddress.trim() : '';

  try {
    // ─── Maya Protocol — הפקדה+ממואר, בלי-משמורת ───
    if (provider === 'maya') {
      if (!fromToken.mayaAsset || !toToken.mayaAsset)
        return NextResponse.json({ ok: false, error: 'הזוג-אינו-זמין-ב-Maya (אין-בריכות-חיות-לשני-הנכסים)' }, { status: 400 });
      if (!isValidAddress(toChain.key, settleAddress))
        return NextResponse.json({ ok: false, error: `כתובת-קבלה-לא-תקינה עבור ${toChain.name}` }, { status: 400 });
      if (!isValidAddress(fromChain.key, refundAddress))
        return NextResponse.json({ ok: false, error: `כתובת-החזרה-לא-תקינה עבור ${fromChain.name}` }, { status: 400 });

      const q = await mayaQuote(fromToken.mayaAsset, toToken.mayaAsset, toRaw(amount, fromToken.decimals));
      if (!q.inbound_address || !q.expected_amount_out)
        return NextResponse.json({ ok: false, error: 'Maya: הבריכה/הכספת-אינה-זמינה כרגע (תשובה-חסרה)' }, { status: 502 });

      // ממואר: מה-node כשהוא-מספק; אחרת נבנה-לפי-פורמט-xchain-mayachain הרשמי:
      // SWAP:<FROM.ASSET>:<TO.ASSET>:<DESTADDR>:<AFFILIATE>:<AFFILIATEBPS>
      // ההחזרות-חוזרות-אוטומטית לשולח (הארנק-של-המשתמש — ריבונות-מלאה).
      const memo = (q.memo && q.memo.length > 0)
        ? q.memo
        : `SWAP:${fromToken.mayaAsset}:${toToken.mayaAsset}:${settleAddress}::`;

      const expectedOut = fromP8(q.expected_amount_out);
      const steps = mayaSteps(fromChain, toChain, fromToken.symbol, amount);
      if (q.router) steps.push(`ERC20: אשר (approve) את חוזה-ה-router ${q.router} ואז שלח דרכו עם הממואר`);
      return NextResponse.json({
        ok: true, kind: 'deposit', provider: 'maya',
        depositAddress: q.inbound_address,
        depositAddressQr: await qr(q.inbound_address),
        memo,
        memoBytes: memo.length,
        memoOversized: memo.length > 80,
        router: q.router || undefined,
        depositChain: fromChain.key, depositAsset: fromToken.symbol,
        depositAmountHuman: amount,
        settleChain: toChain.key, settleAsset: toToken.symbol,
        settleAddress, expectedOut,
        expiry: q.expiry, dustThreshold: q.dust_threshold,
        minInHuman: q.recommended_min_amount_in ? fromP8(q.recommended_min_amount_in) : undefined,
        etaSec: (q.inbound_confirmation_seconds ?? 600) + (q.outbound_delay_seconds ?? 0),
        explorerDeposit: fromChain.explorerAddr?.replace('{addr}', q.inbound_address),
        explorerSettle: toChain.explorerAddr?.replace('{addr}', settleAddress),
        notes: q.notes, warning: q.warning,
        steps,
        at: new Date().toISOString(),
      });
    }

    // ─── SideShift — הפקדה, שער-נעול ───
    if (provider === 'sideshift') {
      const affiliate = process.env.SAOS_SIDESHIFT_ID || process.env.SIDESHIFT_AFFILIATE_ID || '';
      if (!affiliate)
        return NextResponse.json({
          ok: false, error: 'SideShift: ביצוע-הפקדה-דורש מזהה-שותף ריבוני (SAOS_SIDESHIFT_ID בסביבת-המפעיל). הציטוט-והדירוג-חיים; הביצוע-ייפתח-ברגע-שהמזהה-מוגדר.',
          honestGate: 'sideshift-affiliate-missing',
        }, { status: 501 });
      if (!isValidAddress(toChain.key, settleAddress))
        return NextResponse.json({ ok: false, error: `כתובת-קבלה-לא-תקינה עבור ${toChain.name}` }, { status: 400 });
      if (!isValidAddress(fromChain.key, refundAddress))
        return NextResponse.json({ ok: false, error: `כתובת-החזרה-לא-תקינה עבור ${fromChain.name}` }, { status: 400 });
      if (!fromToken.ssCoin || !toToken.ssCoin)
        return NextResponse.json({ ok: false, error: 'המטבעות-אינם-ממופים-ל-SideShift' }, { status: 400 });

      const quote = await ssQuote({
        depositCoin: fromToken.ssCoin, settleCoin: toToken.ssCoin,
        depositAmount: amount.toPrecision(8),
        depositNetwork: fromChain.ssNetwork, settleNetwork: toChain.ssNetwork,
      });
      const shift = await ssCreateShift({ quoteId: quote.id, settleAddress, refundAddress, settleMemo, refundMemo });
      return NextResponse.json({
        ok: true, kind: 'deposit', provider: 'sideshift',
        shiftId: shift.id,
        depositAddress: shift.depositAddress,
        depositAddressQr: await qr(shift.depositAddress),
        depositMemo: shift.depositMemo,
        depositChain: fromChain.key, depositAsset: shift.depositCoin,
        depositAmountHuman: Number.parseFloat(shift.depositAmount),
        settleChain: toChain.key, settleAsset: shift.settleCoin,
        settleAddress, settleAmount: Number.parseFloat(shift.settleAmount),
        expiresAt: shift.expiresAt,
        steps: sideShiftSteps(fromChain, toChain, shift.depositCoin),
        at: new Date().toISOString(),
      });
    }

    // ─── LI.Fi — חתימת-ארנק-EVM ───
    if (provider === 'lifi') {
      if (!/^0x[0-9a-fA-F]{40}$/.test(walletAddress))
        return NextResponse.json({ ok: false, error: 'נדרשת-כתובת-ארנק-EVM (חבר ארנק)' }, { status: 400 });
      const NATIVE = '0x0000000000000000000000000000000000000000';
      const resp = await lifiQuote({
        fromChain: fromChain.chainId!, toChain: toChain.chainId!,
        fromToken: fromToken.native ? NATIVE : (fromToken.address || NATIVE),
        toToken: toToken.native ? NATIVE : (toToken.address || NATIVE),
        fromAmount: toRaw(amount, fromToken.decimals),
        fromAddress: walletAddress,
      });
      const tx = resp.transactionRequest as Record<string, unknown> | undefined;
      if (!tx?.data) return NextResponse.json({ ok: false, error: 'LI.Fi: לא-התקבל-transactionRequest' }, { status: 502 });
      return NextResponse.json({
        ok: true, kind: 'wallet', chainClass: 'evm', provider: 'lifi',
        txRequest: tx,
        tool: resp.toolDetails?.name || resp.tool,
        expectedOut: fromRawRaw(resp.estimate.toAmount, resp.action.toToken.decimals),
        toChainId: toChain.chainId,
        at: new Date().toISOString(),
      });
    }

    // ─── ParaSwap — calldata לחתימת-ארנק-EVM ───
    if (provider === 'paraswap') {
      if (!/^0x[0-9a-fA-F]{40}$/.test(walletAddress))
        return NextResponse.json({ ok: false, error: 'נדרשת-כתובת-ארנק-EVM (חבר ארנק)' }, { status: 400 });
      const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
      const src = fromToken.native ? NATIVE : (fromToken.address || NATIVE);
      const dst = toToken.native ? NATIVE : (toToken.address || NATIVE);
      const pr = await psQuote(fromChain.chainId!, src, dst, toRaw(amount, fromToken.decimals));
      const tx = await psBuildTx(fromChain.chainId!, pr, walletAddress, 100);
      return NextResponse.json({
        ok: true, kind: 'wallet', chainClass: 'evm', provider: 'paraswap',
        txRequest: { to: tx.to, data: tx.data, value: tx.value, gas: tx.gas, gasPrice: tx.gasPrice, chainId: tx.chainId },
        expectedOut: fromRawRaw(pr.destAmount, pr.destDecimals),
        toChainId: fromChain.chainId,
        at: new Date().toISOString(),
      });
    }

    // ─── Jupiter — חתימת-ארנק-Solana ───
    if (provider === 'jupiter') {
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(walletAddress))
        return NextResponse.json({ ok: false, error: 'נדרשת-כתובת-ארנק-Solana (חבר ארנק)' }, { status: 400 });
      const inMint = fromToken.native ? SOL_MINT : (fromToken.address || SOL_MINT);
      const outMint = toToken.native ? SOL_MINT : (toToken.address || SOL_MINT);
      const quote = await jupQuote(inMint, outMint, toRaw(amount, fromToken.decimals), 50);
      const j = await fetch('https://lite-api.jup.ag/swap/v1/swap', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteResponse: quote, userPublicKey: walletAddress, wrapAndUnwrapSol: true }),
        signal: AbortSignal.timeout(15000),
      });
      if (!j.ok) return NextResponse.json({ ok: false, error: `Jupiter swap-tx: HTTP ${j.status}` }, { status: 502 });
      const r = (await j.json()) as { swapTransaction: string; lastValidBlockHeight?: number };
      return NextResponse.json({
        ok: true, kind: 'wallet', chainClass: 'solana', provider: 'jupiter',
        swapTransaction: r.swapTransaction,
        expectedOut: fromRawRaw(quote.outAmount, toToken.decimals),
        at: new Date().toISOString(),
      });
    }

    return NextResponse.json({ ok: false, error: `מקור-לא-מוכר: ${provider}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: `ביצוע-נכשל (כנות): ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
}

function fromRawRaw(raw: string | number, decimals: number): number {
  const n = typeof raw === 'number' ? raw : Number.parseFloat(raw);
  if (!Number.isFinite(n)) return 0;
  return n / 10 ** Math.min(decimals, 24);
}

function mayaSteps(fc: NonNullable<ReturnType<typeof chainByKey>>, tc: NonNullable<ReturnType<typeof chainByKey>>, asset: string, amount: number): string[] {
  if (fc.kind === 'utxo') {
    return [
      `פתח את הארנק שלך (${asset}) ושלח בדיוק ${amount} ${asset} לכתובת-הכספת שלמטה`,
      'הוסף פלט OP_RETURN (memo) עם המחרוזת-המוצגת — בלי-הממואר ההחלפה לא תתבצע',
      `הרשת תשלח את ${tc.native.symbol} ישירות לכתובת-הקבלה-שלך (אין-משמורת, אין-חשבון)`,
      'שמור על דמי-מכרה סבירים — הפקדה-איטית עלולה-לפקוע-את-השער',
    ];
  }
  return [
    `שלח בדיוק ${amount} ${asset} (${fc.name}) לכתובת-הכספת שלמטה — מארנק-חוץ-רגיל`,
    `צרף את המחרוזת כ-data/memo של העסקה (רוב-הארנקים המתקדמים תומכים)`,
    `${tc.native.symbol} יגיע ישירות לכתובת-הקבלה שסיפקת — בלי-חשבון ובלי-משמורת`,
  ];
}

function sideShiftSteps(fc: NonNullable<ReturnType<typeof chainByKey>>, tc: NonNullable<ReturnType<typeof chainByKey>>, depositCoin: string): string[] {
  return [
    `שלח ${depositCoin} (${fc.name}) לכתובת-ההפקדה שלמטה — השער-נעול 15 דק'`,
    `SideShift תשלח ${tc.native.symbol} ישירות לכתובת-הקבלה-שלך`,
    'אל-תשלח אחרי-פקיעת-השער; החזרות-אוטומטיות לכתובת-ההחזרה-שסיפקת',
  ];
}
