// ═══ צופה-האוצר — משטח-מכונה (EXEC-CD-26) ═══════════════════════════════════
// GET  → מצב-האוצר: בדיקות-חי של-כתובות-כספת-הריפו + אירועי-מימון מה-DB (אפס-סודות —
//        כתובות-ציבוריות ויתרות-ציבוריות-מטבען; המעטפת-המוצפנת-לא-נפתחת-כאן).
// POST → סיבוב-צפייה (watch tick): בדיקה + רישום-תצפיות + גילוי-אירועי-שינוי-יתרה.
//        זו-היכולת-שהאוטונומיה-מריצה-בלופ (instrumentation · כל-15-דקות) וגם-כפתור
//        "סיבוב-צפייה" בקונסולה. מוגבל-קצב — לא-להציק-ל-RPC-ציבוריים.
import { NextRequest, NextResponse } from 'next/server';
import { getTreasuryState, watchOnce } from '@/lib/treasury-watcher';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { requireOwner, agentFrom } from '@/lib/auth';
import { denyAndLog } from '@/lib/deny-audit';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const state = await getTreasuryState();
    return NextResponse.json(state);
  } catch (e) {
    return NextResponse.json({
      ok: false, exists: false,
      error: e instanceof Error ? e.message.slice(0, 200) : 'treasury state failed',
    }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  // §1 deny-by-default (EMERGENCY DIRECTIVE 2026-10-25): the watch tick mutates
  // state (TreasurySighting/TreasuryEvent rows + RPC sweeps). Anonymous POSTs are
  // refused AND recorded. The 15-min autonomy loop is unaffected — it calls
  // watchOnce() in-process (instrumentation.ts), never through this HTTP route.
  const owner = await requireOwner(req);
  const agent = owner ? null : await agentFrom(req);
  if (!owner && !agent) {
    return denyAndLog(req, '/api/vault/treasury', 'watch-tick POST without owner session or agent token');
  }
  const ip = clientIp(req);
  const rl = rateLimit(`treasury-watch:${ip}`, 4, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: `הגבלת-קצב — נסה-שוב-בעוד ${rl.retryAfterSec}ש׳` },
      { status: 429, headers: { 'retry-after': String(rl.retryAfterSec) } },
    );
  }
  try {
    const summary = await watchOnce();
    return NextResponse.json(summary);
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message.slice(0, 200) : 'watch tick failed',
    }, { status: 500 });
  }
}
