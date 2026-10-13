import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/* ═══ שער-הלגיון (EXEC-CD-22 · SAEC) ═══════════════════════════════════════
 * GET  → מצב-הלגיון החי (:3012 — 11 סוכנים-ריבוניים, ציבורי-לקריאה).
 * POST → פקודות-מפעיל (kill|resume|start|stop|bootstrap) — דורש סשן-כספת
 *        (requireOwner) ואז השרת מצרף LEGION_OPERATOR_TOKEN שלעולם לא יוצא
 *        לדפדפן. מתג-הרג = גבול-הנזק האנושי האחרון. */

const LEGION = 'http://127.0.0.1:3012/api/legion';

export async function GET() {
  try {
    const r = await fetch(`${LEGION}/state`, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
    const j = await r.json();
    return NextResponse.json(j, { status: r.ok ? 200 : 502 });
  } catch {
    return NextResponse.json(
      { ok: false, error: 'legion-unreachable', note: 'מרכז-הביצוע-הריבוני לא מגיב — הדיווח כנה; הלגיון יוקם-מחדש אוטומטית עם-השרת-האם (instrumentation guardian)' },
      { status: 502 },
    );
  }
}

export async function POST(req: NextRequest) {
  const owner = await requireOwner(req);
  if (!owner) {
    return NextResponse.json({ ok: false, error: 'auth-required', note: 'התחבר דרך הכספת כדי לפקד על הלגיון' }, { status: 401 });
  }
  const token = process.env.LEGION_OPERATOR_TOKEN;
  if (!token) {
    return NextResponse.json({ ok: false, error: 'legion-unconfigured', note: 'טוקן-הפיקוד לא מוגדר בשרת' }, { status: 503 });
  }
  let body: { op?: string; agent?: string } = {};
  try { body = await req.json(); } catch { /* נשאר ריק */ }
  const op = String(body.op ?? '');
  if (!['kill', 'resume', 'start', 'stop', 'bootstrap'].includes(op)) {
    return NextResponse.json({ ok: false, error: 'bad-op', note: 'kill|resume|start|stop|bootstrap' }, { status: 400 });
  }
  try {
    const r = await fetch(`${LEGION}/control`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-legion-key': token },
      body: JSON.stringify({ op, agent: body.agent }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json() as { ok?: boolean; note?: string; error?: string };
    await audit('legion_control', `${op} agent=${body.agent ?? '-'} by=${owner}`);
    return NextResponse.json(j, { status: r.ok ? 200 : 502 });
  } catch {
    return NextResponse.json({ ok: false, error: 'legion-unreachable', note: 'הפיקוד לא הגיע — הלגיון לא מגיב' }, { status: 502 });
  }
}
