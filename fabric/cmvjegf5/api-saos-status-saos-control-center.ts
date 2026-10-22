import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, requireRole } from '@/lib/auth';
import { rateLimit, RateLimitConfig } from '@/lib/rate-limit';
import { auditLog, AuditEvent } from '@/lib/audit';
import { getSaosStatus } from '@/lib/saos/kernel';

const RATE_LIMIT_CONFIG: RateLimitConfig = {
  windowMs: 60_000, // 1 minute
  maxRequests: 30,  // 30 requests per minute
  keyPrefix: 'saos:status',
};

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const endpoint = '/api/saos/status';
  const action = 'status_check';
  let userId = 'anonymous';

  // 1. Rate limiting
  const rateLimitResult = await rateLimit(req, RATE_LIMIT_CONFIG);
  if (!rateLimitResult.allowed) {
    await auditLog({
      userId,
      endpoint,
      action,
      result: 'rate_limited',
      timestamp: new Date().toISOString(),
      ip,
      metadata: { retryAfter: rateLimitResult.retryAfter },
    } as AuditEvent);
    
    return NextResponse.json(
      { error: 'Too Many Requests', message: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rateLimitResult.retryAfter || 60000) / 1000)) } }
    );
  }

  // 2. SIWE/JWT Authentication
  const sessionUser = await getSessionUser(req);
  if (!sessionUser) {
    await auditLog({
      userId,
      endpoint,
      action,
      result: 'unauthorized',
      timestamp: new Date().toISOString(),
      ip,
    } as AuditEvent);
    
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Valid SIWE session required' },
      { status: 401 }
    );
  }

  userId = sessionUser.id;

  // 3. RBAC - require operator or admin role
  const roleCheck = requireRole(sessionUser, ['operator', 'admin']);
  if (!roleCheck.allowed) {
    await auditLog({
      userId,
      endpoint,
      action,
      result: 'forbidden',
      timestamp: new Date().toISOString(),
      ip,
      metadata: { userRole: sessionUser.role, requiredRoles: ['operator', 'admin'] },
    } as AuditEvent);
    
    return NextResponse.json(
      { error: 'Forbidden', message: 'Insufficient permissions. Operator or admin role required.' },
      { status: 403 }
    );
  }

  try {
    // 4. Fetch actual SAOS status (preserve existing functionality)
    const status = await getSaosStatus();
    
    // 5. Audit successful access
    await auditLog({
      userId,
      endpoint,
      action,
      result: 'success',
      timestamp: new Date().toISOString(),
      ip,
      metadata: { userRole: sessionUser.role },
    } as AuditEvent);

    return NextResponse.json(status);
  } catch (error) {
    // 6. Audit failed access (internal error)
    await auditLog({
      userId,
      endpoint,
      action,
      result: 'error',
      timestamp: new Date().toISOString(),
      ip,
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    } as AuditEvent);

    console.error('[SAOS Status] Error fetching status:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to fetch SAOS status' },
      { status: 500 }
    );
  }
}