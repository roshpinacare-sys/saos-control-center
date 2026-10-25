// ═══ middleware — the §1 deny-by-default edge (EMERGENCY DIRECTIVE, 2026-10-25) ═══
// Thin executor: ALL decisions live in the tested core (src/lib/security-gate.ts —
// pure, edge-safe, no db/fs). Any anonymous request outside the measured public
// read allowlist is dropped with 401 + logged (ring + structured line). Requests
// that CARRY credentials pass through to the route's own fail-closed verification
// (the edge never grants authority — it only refuses anonymous non-public traffic).
import { NextRequest, NextResponse } from 'next/server';
import { gateDecision, recordDeny } from '@/lib/security-gate';

export const config = {
  // the law rides on the API surface only — pages/assets are not owner endpoints
  matcher: ['/api/:path*'],
};

export function middleware(req: NextRequest) {
  const decision = gateDecision(
    req.method,
    req.nextUrl.pathname,
    req.headers,
    req.cookies.get('sv_session')?.value ?? null,
  );
  if (decision.allowed) return NextResponse.next();

  // drop + log (fail-closed). IP extraction mirrors rate-limit's proxy law:
  // untrusted headers are only honored behind our own proxy (TRUST_PROXY=1).
  let ip = 'local';
  if (process.env.TRUST_PROXY === '1') {
    const xf = req.headers.get('x-forwarded-for');
    if (xf) {
      const hops = xf.split(',').map((s) => s.trim()).filter(Boolean);
      if (hops.length > 0) ip = hops[hops.length - 1];
      else ip = req.headers.get('x-real-ip') ?? 'local';
    }
  }
  recordDeny({
    method: req.method,
    path: req.nextUrl.pathname,
    ip,
    ua: (req.headers.get('user-agent') || '').slice(0, 120),
  });
  return NextResponse.json(
    { ok: false, error: 'denied — unauthenticated access to a protected endpoint (deny-by-default §1)' },
    { status: 401, headers: { 'x-saos-deny': 'deny-by-default' } },
  );
}
