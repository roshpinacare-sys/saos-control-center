// ═══ /api/live/versus — מטריצת-השוואה מול 23 הפרוטוקולים המתקדמים ═══════════
// מקור-האמת: מחקר EXEC-CD-15-a (מוטמע ב-versus-data.ts). הסטטוס-ריבוני
// מדווח-בכנות: חי / חלקי / בתכנון / מחוץ-לתחום.
import { NextResponse } from 'next/server';
import { PROTOCOLS, CHECKLIST } from '@/lib/live/versus-data';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    ok: true,
    protocols: PROTOCOLS,
    checklist: CHECKLIST,
    score: {
      live: CHECKLIST.filter(c => c.adoption === 'live').length,
      partial: CHECKLIST.filter(c => c.adoption === 'partial').length,
      planned: CHECKLIST.filter(c => c.adoption === 'planned').length,
      out: CHECKLIST.filter(c => c.adoption === 'out').length,
      total: CHECKLIST.length,
    },
  });
}
