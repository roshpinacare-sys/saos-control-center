import { NextRequest, NextResponse } from 'next/server';
import { verifySIWE, verifyJWT } from '@/lib/auth';
import { rateLimit, RateLimitExceeded } from '@/lib/rate-limit';
import { checkPermission, Permission } from '@/lib/rbac';
import { auditLog, AuditEvent } from '@/lib/audit';
import { getSaosStatus, SaosStatus } from '@/lib/saos/kernel';

const RATE_LIMIT_CONFIG = { maxRequests: 60, windowMs: 60_000 };

const FIELD_PERMISSIONS: Record<string, (keyof SaosStatus)[]> = {
  admin: [
    'version',
    'uptime',
    'chains',
    'vault',
    'relay',
    'legion',
    'economy',
    'config',
    'lastAudit',
    'health'
  ],
  operator: [
    'version',
    'uptime',
    'chains',
    'vault',
    'relay',
    'legion',
    'economy',
    'health'
  ],
  viewer: [
    'version',
    'uptime',
    'chains',
    'health'
  ]
};

function filterFields(status: SaosStatus, role: string): Partial<SaosStatus> {
  const allowed = FIELD_PERMISSIONS[role] || FIELD_PERMISSIONS.viewer;
  const filtered: Partial<SaosStatus> = {};
  for (const key of allowed) {
    if (key in status) {
      filtered[key] = status[key];
    }
  }
  return filtered;
}

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

export async function GET(req: NextRequest) {
  const startTime = Date.now();
  const ip = getClientIp(req);
  const userAgent = req.headers.get('user-agent') || 'unknown';
  let identity = 'anonymous';
  let role = 'viewer';
  let outcome: 'success' | 'failure' = 'failure';
  let errorMessage = '';

  try {
    // Rate limiting
    await rateLimit(ip, RATE_LIMIT_CONFIG);

    // Authentication
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    let payload: { address: string; role: string } | null = null;

    // Try SIWE first, then JWT
    try {
      payload = await verifySIWE(token);
    } catch {
      try {
        payload = await verifyJWT(token);
      } catch {
        throw new Error('Invalid or expired token');
      }
    }

    if (!payload) {
      throw new Error('Authentication failed');
    }

    identity = payload.address;
    role = payload.role || 'viewer';

    // Authorization (RBAC)
    const hasPermission = await checkPermission(identity, Permission.SAOS_STATUS_READ);
    if (!hasPermission) {
      throw new Error('Insufficient permissions');
    }

    // Fetch status
    const status = await getSaosStatus();

    // Field-level filtering
    const filteredStatus = filterFields(status, role);

    outcome = 'success';
    return NextResponse.json(filteredStatus);
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : 'Unknown error';

    if (err instanceof RateLimitExceeded) {
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: 429, headers: { 'Retry-After': '60' } }
      );
    }

    if (errorMessage.includes('authorization') || errorMessage.includes('token') || errorMessage.includes('Authentication')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (errorMessage.includes('permissions') || errorMessage.includes('Insufficient')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    // Structured audit logging
    const duration = Date.now() - startTime;
    const fieldsAccessed = outcome === 'success' ? Object.keys(FIELD_PERMISSIONS[role] || FIELD_PERMISSIONS.viewer) : [];

    await auditLog({
      timestamp: new Date().toISOString(),
      identity,
      ip,
      userAgent,
      endpoint: '/api/saos/status',
      method: 'GET',
      outcome,
      error: errorMessage || undefined,
      fieldsAccessed,
      durationMs: duration,
      role
    } as AuditEvent);
  }
}
