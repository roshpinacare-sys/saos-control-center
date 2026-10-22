import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, hasRole } from '@/lib/auth';
import { rateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { auditLog } from '@/lib/audit';
import { getSaosStatus } from '@/lib/saos/kernel';

const ALLOWED_ROLES = ['admin', 'operator', 'viewer'] as const;
const RATE_LIMIT_CONFIG = { maxRequests: 10, windowMs: 60_000 };

function buildAuditContext(req: NextRequest, wallet?: string) {
  return {
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
    userAgent: req.headers.get('user-agent') || 'unknown',
    wallet,
    path: '/api/saos/status',
    method: 'GET',
  };
}

export async function GET(req: NextRequest) {
  const start = Date.now();
  const auditCtx = buildAuditContext(req);

  // 1. Rate limiting
  const rlKey = getRateLimitKey(req, 'saos-status');
  const rl = rateLimit(rlKey, RATE_LIMIT_CONFIG);
  if (!rl.allowed) {
    await auditLog({
      ...auditCtx,
      action: 'rate_limited',
      success: false,
      meta: { retryAfterMs: rl.retryAfterMs },
    });
    return NextResponse.json(
      { error: 'Too Many Requests', retryAfter: Math.ceil((rl.retryAfterMs || 0) / 1000) },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.retryAfterMs || 60000) / 1000)) } }
    );
  }

  // 2. SIWE/JWT authentication
  const auth = await verifyAuth(req);
  if (!auth.ok) {
    await auditLog({
      ...auditCtx,
      action: 'unauthorized',
      success: false,
      meta: { reason: auth.error },
    });
    return NextResponse.json({ error: 'Unauthorized', message: auth.error }, { status: 401 });
  }
  auditCtx.wallet = auth.wallet;

  // 3. RBAC
  if (!hasRole(auth, ALLOWED_ROLES)) {
    await auditLog({
      ...auditCtx,
      action: 'forbidden',
      success: false,
      meta: { role: auth.role, allowedRoles: ALLOWED_ROLES },
    });
    return NextResponse.json({ error: 'Forbidden', message: 'Insufficient role' }, { status: 403 });
  }

  try {
    // 4. Business logic
    const status = await getSaosStatus();

    await auditLog({
      ...auditCtx,
      action: 'status_fetch',
      success: true,
      meta: { latencyMs: Date.now() - start },
    });

    return NextResponse.json(status, {
      headers: {
        'X-RateLimit-Limit': String(RATE_LIMIT_CONFIG.maxRequests),
        'X-RateLimit-Remaining': String(rl.remaining),
        'X-RateLimit-Reset': String(Math.ceil((Date.now() + RATE_LIMIT_CONFIG.windowMs) / 1000)),
      },
    });
  } catch (err) {
    await auditLog({
      ...auditCtx,
      action: 'status_fetch',
      success: false,
      meta: { error: err instanceof Error ? err.message : 'unknown' },
    });
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}