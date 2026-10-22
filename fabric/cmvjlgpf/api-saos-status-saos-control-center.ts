import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { auditLog } from '@/lib/audit';
import { getSaosStatus } from '@/lib/saos/kernel';

// ─── RBAC Field-Level Filtering ─────────────────────────────────────────────

export type UserRole = 'admin' | 'operator' | 'viewer' | 'unauthenticated';

export interface FieldPermissionMatrix {
  [role: string]: string[];
}

const FIELD_PERMISSIONS: FieldPermissionMatrix = {
  admin: [
    'status',
    'uptime',
    'version',
    'activeConnections',
    'kernel',
    'anchors',
    'treasury',
    'vault',
    'relay',
    'dex',
    'legion',
    'economy',
    'audit',
    'secrets',
    'keys',
    'config',
  ],
  operator: [
    'status',
    'uptime',
    'version',
    'activeConnections',
    'kernel',
    'anchors',
    'treasury',
    'vault',
    'relay',
    'dex',
    'legion',
    'economy',
  ],
  viewer: [
    'status',
    'version',
    'kernel',
    'anchors',
    'treasury',
    'relay',
    'dex',
  ],
  unauthenticated: [
    'status',
  ],
} as const;

function getUserRole(session: Awaited<ReturnType<typeof getServerSession>>): UserRole {
  if (!session?.user) return 'unauthenticated';
  const role = (session.user as { role?: string }).role;
  if (role === 'admin' || role === 'operator' || role === 'viewer') return role;
  return 'viewer';
}

export function filterResponseByRole<T extends Record<string, unknown>>(
  userRole: UserRole,
  fullResponse: T
): Partial<T> {
  const allowedFields = FIELD_PERMISSIONS[userRole] ?? FIELD_PERMISSIONS.unauthenticated;
  const filtered: Partial<T> = {};
  for (const key of allowedFields) {
    if (key in fullResponse) {
      filtered[key] = fullResponse[key];
    }
  }
  return filtered;
}

// ─── Route Handler ──────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const start = Date.now();
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';

  // Rate limiting
  const rl = rateLimit(ip, 30, 60_000); // 30 req/min
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    );
  }

  // Authentication & Authorization
  const session = await getServerSession(authOptions);
  const userRole = getUserRole(session);

  // Audit logging
  await auditLog({
    action: 'saos.status.read',
    userId: session?.user?.id ?? 'anonymous',
    role: userRole,
    ip,
    userAgent: request.headers.get('user-agent') ?? 'unknown',
    timestamp: new Date().toISOString(),
    metadata: { endpoint: '/api/saos/status' },
  });

  try {
    const fullStatus = await getSaosStatus();
    const filteredStatus = filterResponseByRole(userRole, fullStatus);

    return NextResponse.json(filteredStatus, {
      headers: {
        'X-RateLimit-Limit': '30',
        'X-RateLimit-Remaining': String(rl.remaining),
        'X-Response-Filter': userRole,
      },
    });
  } catch (error) {
    console.error('[saos/status] error:', error);
    await auditLog({
      action: 'saos.status.error',
      userId: session?.user?.id ?? 'anonymous',
      role: userRole,
      ip,
      error: error instanceof Error ? error.message : 'unknown',
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
