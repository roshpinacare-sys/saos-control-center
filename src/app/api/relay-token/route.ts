// FIX(R16-c·C1): טוקן-אפיק-האירועים — מוחזר **רק-לסשן-בעלים מאומת**.
// הדפדפן משתמש-בו ב-handshake של socket.io (auth.token) כדי לקבל את הזרם-המלא;
// אורחים-לא-מאומתים ממשיכים לקבל מה-relay רק את ערוצי-הצפייה-הפומבית (chat/task/guard)
// — הצפייה-הפומבית-החיה נשמרת, והזהויות/אירועי-הכספת נשארים סגורים (fail-closed).
import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const owner = await requireOwner(req);
  if (!owner) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const token = process.env.SOVEREIGN_RELAY_TOKEN ?? '';
  if (!token) {
    // כנות: בלי-טוקן בסביבה — אין-אפיק-מלא-לאף-אחד (ה-relay עצמו fail-closed)
    return NextResponse.json({ ok: false, error: 'relay-token-unconfigured' }, { status: 200 });
  }
  return NextResponse.json({ ok: true, token });
}
