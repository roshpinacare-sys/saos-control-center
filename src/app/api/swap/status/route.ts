// ═══ /api/swap/status — מעקב-הזמנה חי ═════════════════════════════════════════
// GET ?provider=sideshift&id=<shiftId>  → סטטוס-אמת מ-SideShift (keyless)
// GET ?provider=maya                    → כנות: אין-אינדקס-ציבורי — מוצע-קישור-סייר
import { NextResponse } from 'next/server';
import { ssShiftStatus } from '@/lib/live/universal';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: { nextUrl: { searchParams: URLSearchParams } }) {
  const sp = request.nextUrl.searchParams;
  const provider = sp.get('provider') || '';
  const id = (sp.get('id') || '').trim();

  if (provider === 'sideshift') {
    if (!id) return NextResponse.json({ ok: false, error: 'חסר מזהה-הזמנה' }, { status: 400 });
    try {
      const s = await ssShiftStatus(id);
      return NextResponse.json({ ok: true, provider, shift: s, at: new Date().toISOString() });
    } catch (e) {
      return NextResponse.json({ ok: false, error: `סטטוס-נכשל (כנות): ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
    }
  }

  if (provider === 'maya') {
    return NextResponse.json({
      ok: true, provider, tracking: 'explorer',
      note: 'Maya Protocol: אין-אינדקס-ציבורי-לעסקאות-בודדות — עקוב-אחר-כתובת-הקבלה-בסייר-של-רשת-היעד',
      at: new Date().toISOString(),
    });
  }

  return NextResponse.json({ ok: false, error: 'מקור-לא-מוכר' }, { status: 400 });
}
