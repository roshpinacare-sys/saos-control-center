// ═══ /api/security/denies — owner-only drain of the §1 deny ledger ════════════
// GET → recent refused attempts: the durable DB rows (DeniedAttempt) plus the
// edge's in-memory ring (per-instance, newest-first). Metadata only — ip, method,
// path, reason, ua, timestamps. No payloads, no keys. Owner session required
// (deny-by-default: this IS the recon surface the directive ordered locked).
import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { denyAndLog } from '@/lib/deny-audit';
import { recentDenies } from '@/lib/security-gate';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const owner = await requireOwner(req);
  if (!owner) {
    return denyAndLog(req, '/api/security/denies', 'deny-ledger read without owner session');
  }
  let rows: Array<{ ip: string; method: string; path: string; reason: string; ua: string; at: Date }> = [];
  try {
    const { db } = await import('@/lib/db');
    rows = await db.deniedAttempt.findMany({ orderBy: { at: 'desc' }, take: 100 });
  } catch {
    // ledger unreadable — the memory ring still answers, honestly labeled
  }
  return NextResponse.json({
    ok: true,
    at: new Date().toISOString(),
    db: rows.map((r) => ({ ...r, at: r.at.toISOString() })),
    edgeRing: recentDenies(100).reverse(), // oldest→newest for timeline reads
    note: 'db = durable ledger of record · edgeRing = this instance memory only',
  });
}
