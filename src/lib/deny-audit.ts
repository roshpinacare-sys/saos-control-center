// ═══ deny-audit — persistent record for the §1 deny-by-default law ════════════
// The edge middleware (memory ring + structured log) drops anonymous non-public
// traffic; THIS layer is the durable ledger at the guarded routes themselves:
// every unauthenticated mutation attempt is written to DeniedAttempt (ip, method,
// path, reason, ua) and answered 401. Defense in depth: even if the edge list
// drifts, the route-level guard still refuses AND records.
//
// fail-closed law: the audit write NEVER upgrades a deny into an allow; an audit
// failure still returns 401 (the record is best-effort, the refusal is absolute).
import { NextRequest, NextResponse } from 'next/server';

export interface DenyAuditDB {
  deniedAttempt: {
    create(args: { data: { ip: string; method: string; path: string; reason: string; ua: string } }): Promise<unknown>;
  };
}

export function ipFrom(req: NextRequest): string {
  if (process.env.TRUST_PROXY === '1') {
    const xf = req.headers.get('x-forwarded-for');
    if (xf) {
      const hops = xf.split(',').map((s) => s.trim()).filter(Boolean);
      if (hops.length > 0) return hops[hops.length - 1];
    }
    return req.headers.get('x-real-ip') ?? 'local';
  }
  return 'local';
}

/** Record the attempt (best-effort) and ALWAYS return the 401 refusal. */
export async function denyAndLog(
  req: NextRequest,
  route: string,
  reason: string,
  injected?: { db?: DenyAuditDB },
): Promise<NextResponse> {
  let db: DenyAuditDB | null = null;
  if (injected?.db) db = injected.db;
  else {
    try {
      const mod = await import('@/lib/db');
      db = mod.db as unknown as DenyAuditDB;
    } catch {
      db = null; // audit unavailable — the refusal still stands (fail-closed)
    }
  }
  const data = {
    ip: ipFrom(req),
    method: req.method,
    path: route,
    reason: reason.slice(0, 200),
    ua: (req.headers.get('user-agent') || '').slice(0, 120),
  };
  if (db) {
    try {
      await db.deniedAttempt.create({ data });
    } catch {
      console.warn(JSON.stringify({ sev: 'security-deny-audit-failed', ...data }));
    }
  }
  console.warn(JSON.stringify({ sev: 'security-deny', ...data }));
  return NextResponse.json(
    { ok: false, error: 'denied — owner authorization required (deny-by-default §1)' },
    { status: 401, headers: { 'x-saos-deny': route } },
  );
}
