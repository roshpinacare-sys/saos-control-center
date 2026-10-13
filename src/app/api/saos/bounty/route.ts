import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { getAgentEconomy, bountyTick, spawnBounties } from '@/lib/bounty-engine';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/* ══ שער-כלכלת-הסוכנים (EXEC-CD-31) ══════════════════════════════════════════
 * GET  → פני-הכלכלה (פומבי לקריאה — אפס-סודות): תור-הבונטים, פנקס-התשלומים,
 *        סטטיסטיקות-מדידה, מצב-הפעימה האוטונומית.
 * POST → פעולות-מפעיל (requireOwner): {op: "tick"|"spawn"} — פעימה-ידנית או
 *        הזרעה. הלופ-האוטונומי ב-instrumentation רץ-בעצמו כל-20 דק'
 *        (SAOS_BOUNTY_ENGINE=off כיבוי-כנה). */

export async function GET(req: NextRequest) {
  const rl = rateLimit(`bounty-get:${clientIp(req)}`, 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: 'rate-limited', retryAfterSec: rl.retryAfterSec }, { status: 429 });
  }
  const state = await getAgentEconomy();
  return NextResponse.json(state);
}

export async function POST(req: NextRequest) {
  const owner = await requireOwner(req);
  if (!owner) {
    return NextResponse.json({ ok: false, error: 'auth-required', note: 'התחבר דרך הכספת כדי לפקד על כלכלת-הסוכנים' }, { status: 401 });
  }
  const rl = rateLimit(`bounty-post:${clientIp(req)}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: 'rate-limited', retryAfterSec: rl.retryAfterSec }, { status: 429 });
  }
  const body = await req.json().catch(() => ({})) as { op?: string };
  const op = String(body.op ?? '');

  if (op === 'tick') {
    const r = await bountyTick();
    return NextResponse.json({ ok: r.ok, note: r.note, result: r });
  }
  if (op === 'spawn') {
    const r = await spawnBounties();
    await audit('bounty-spawn', `spawned=${r.spawned.length} skipped=${r.skipped.length} by=${owner.label}`);
    return NextResponse.json({ ok: true, spawned: r.spawned, skipped: r.skipped });
  }
  return NextResponse.json({ ok: false, error: 'bad-op', note: 'tick | spawn' }, { status: 400 });
}
