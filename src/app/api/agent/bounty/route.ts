// כלכלת-הסוכנים — שער-הסוכן (EXEC-CD-31):
// GET  → רשימת-בונטים-פתוחים לסוכן (אימות-Bearer מ-AgentNode).
// POST → claim | complete — תביעה והגשת-ראיה. התשלום-עצמו רק-דרך-הפעימה
//        האוטונומית שמאמתת-את-הראיה מול-מציאות (report↔מדידה · code↔git · trade↔מנוע).
// כנות: אין-תשלום-ישיר-בשום-נתיב — האימות-המבני הוא-החוק.
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { agentFrom } from '@/lib/auth';
import { audit, relayBroadcast } from '@/lib/audit';
import { scrub } from '@/lib/secret-scrub';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { engineIdOk, CATEGORY_META } from '@/lib/bounty-engine';

export async function GET(req: NextRequest) {
  const agent = await agentFrom(req);
  if (!agent) return NextResponse.json({ ok: false, error: 'invalid agent token' }, { status: 401 });
  const rl = rateLimit(`agent-bounty-get:${clientIp(req)}`, 60, 60_000);
  if (!rl.ok) return NextResponse.json({ ok: false, error: 'rate-limited', retryAfterSec: rl.retryAfterSec }, { status: 429 });

  const open = await db.agentBounty.findMany({
    where: { status: { in: ['open', 'claimed'] } },
    orderBy: { createdAt: 'asc' }, take: 24,
  });
  const mine = await db.agentBounty.findMany({
    where: { agent: agent.name, status: { in: ['claimed', 'done', 'paid'] } },
    orderBy: { updatedAt: 'desc' }, take: 12,
  });
  return NextResponse.json({
    ok: true,
    open: open.map(b => ({
      id: b.id, title: b.title, category: b.category, detail: b.detail, rewardMu: b.rewardMu,
      status: b.status, agent: b.agent, expiresAt: b.expiresAt.toISOString(),
      verifyRule: CATEGORY_META[b.category as keyof typeof CATEGORY_META]?.verify ?? 'ייבדק-מול-מציאות',
    })),
    mine: mine.map(b => ({
      id: b.id, title: b.title, category: b.category, rewardMu: b.rewardMu, status: b.status,
      verifyNote: b.verifyNote, engineNote: b.engineNote, paidAt: b.paidAt?.toISOString() ?? null,
    })),
    wallet: engineIdOk(agent.name)
      ? agent.name
      : null, // כנות: שם-עם-קו-תחתי וכדומה אינו-ארנק-קנוני — התשלום-ייפול-בכנות
    note: 'זהה-למנוע: שם-הסוכן שלך הוא ארנק-הדקס שאליו ישולם הבונטי (µ-USDS). הראיה נבדקת-מול-מציאות — מה-שלא-מתאים לא-משולם.',
  });
}

export async function POST(req: NextRequest) {
  const agent = await agentFrom(req);
  if (!agent) return NextResponse.json({ ok: false, error: 'invalid agent token' }, { status: 401 });
  const rl = rateLimit(`agent-bounty-post:${clientIp(req)}`, 30, 60_000);
  if (!rl.ok) return NextResponse.json({ ok: false, error: 'rate-limited', retryAfterSec: rl.retryAfterSec }, { status: 429 });

  const body = await req.json().catch(() => ({})) as { action?: string; id?: string; evidence?: string };
  const action = String(body.action ?? '');
  const id = String(body.id ?? '');

  if (action === 'claim') {
    // תביעה-אטומית: open→claimed ע"י-הסוכן-הזה בלבד (updateMany = בלי-תחרות-גזע)
    const t = await db.agentBounty.updateMany({
      where: { id, status: 'open', expiresAt: { gt: new Date() } },
      data: { status: 'claimed', agent: agent.name, claimedAt: new Date() },
    });
    if (!t.count) return NextResponse.json({ ok: false, error: 'bounty not claimable (תפוס/פקע/לא-קיים)' }, { status: 409 });
    await audit('bounty-claimed', `${agent.name} → ${id}`);
    await relayBroadcast('task', { type: 'bounty-claimed', bountyId: id, agent: agent.name });
    return NextResponse.json({ ok: true, note: 'נתבע — הגש-ראיה עם action=complete' });
  }

  if (action === 'complete') {
    const evidence = scrub(String(body.evidence ?? '').slice(0, 2000));
    if (!evidence) return NextResponse.json({ ok: false, error: 'evidence required' }, { status: 400 });
    // רק-הסוכן-שתבע, ומעבר-חד-פעמי claimed→done (אותו-משטר-כמו-task/result)
    const t = await db.agentBounty.updateMany({
      where: { id, agent: agent.name, status: 'claimed' },
      data: { status: 'done', evidence, completedAt: new Date(), verifyNote: 'הוגש — ממתין-לאימות-מול-מציאות בפעימה' },
    });
    if (!t.count) return NextResponse.json({ ok: false, error: 'bounty not completable: חייב להיות נתבע על-ידך ובמצב claimed' }, { status: 409 });
    await audit('bounty-completed', `${agent.name} → ${id}`);
    await relayBroadcast('task', { type: 'bounty-completed', bountyId: id, agent: agent.name });
    return NextResponse.json({ ok: true, note: 'הראיה נקלטה — הפעימה האוטונומית תאמת-מול-מציאות ותשלם אם-תתאים' });
  }

  return NextResponse.json({ ok: false, error: 'unknown action (claim|complete)' }, { status: 400 });
}
