// ═══ מנוע-הערך-האמתי — משטח-מכונה (EXEC-CD-30) ══════════════════════════════
// GET  → מצב-מלא: האוצר-האמיתי (יתרות-חי × מחירי-שוק) + סולם-העתודה של הדקס +
//        מכ"ם-הסטיות (פנימי מול שוק-אמת) + השערים ותשואתם + היסטוריית-השטיפה.
// POST → פעימה (value tick): מדידה + רישום-ValueSnapshot. זו-הלולאה-שהאוטונומיה
//        מריצה (instrumentation · כל-30-דקות) וגם-כפתור-ידני בקונסולה.
//        מוגבל-קצב — מדידות-חי לא-להציק-ל-RPC-ציבוריים.
import { NextRequest, NextResponse } from 'next/server';
import { getValueEngineState, valueTick } from '@/lib/value-engine';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { requireOwner } from '@/lib/auth'; // FIX(FZ-redteam-R14): פעימה-היא-פעולת-מפעיל

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const state = await getValueEngineState();
    return NextResponse.json(state);
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message.slice(0, 200) : 'value-engine state failed',
    }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rl = rateLimit(`value-tick:${ip}`, 4, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: `הגבלת-קצב — נסה-שוב-בעוד ${rl.retryAfterSec}ש׳` },
      { status: 429, headers: { 'retry-after': String(rl.retryAfterSec) } },
    );
  }
  // FIX(FZ-redteam-R14 · 2026-10-08): הירי-האדום-החי מצא — הפעימה-היתה בלי-אימות-מפעיל
  // (4/דקה-מכל-IP, גורמת-RPC-פאואאוט-חוץ + כתיבת-סנאפשוט). הלולאה-האוטונומית קוראת
  // ל-valueTick ישירות-מ-instrumentation (בפנים) — השער-החיצוני נעול למפעיל-בלבד.
  const owner = await requireOwner(req);
  if (!owner) {
    return NextResponse.json(
      { ok: false, error: 'auth-required', note: 'פעימת-הערך היא-פעולת-מפעיל — התחבר דרך הכספת' },
      { status: 401 },
    );
  }
  try {
    const result = await valueTick();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message.slice(0, 200) : 'value tick failed',
    }, { status: 500 });
  }
}
