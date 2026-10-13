// ═══ /api/live/networks — פרובות-חיות לכל-הרשתות ═════════════════════════════
import { NextResponse } from 'next/server';
import { probeAllChains } from '@/lib/live/chains';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const { chains, summary } = await probeAllChains();
    return NextResponse.json({ ok: true, chains, summary });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
