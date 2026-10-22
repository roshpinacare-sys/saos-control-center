// src/middleware/auth.ts
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth/edge-crypto';
import { rateLimit, RateLimitConfig } from '@/middleware/rate-limit';
import { createRequestLogger, logAudit } from '@/lib/audit';

// Path sensitivity classification
const PATH_CLASSIFICATION: Record<string, 'public-read' | 'authenticated-read' | 'admin-only'> = {
  '/api/health': 'public-read',
  '/api/live/bridge': 'authenticated-read',
  '/api/live/markets': 'authenticated-read',
  '/api/live/networks': 'authenticated-read',
  '/api/live/quote': 'authenticated-read',
  '/api/live/tokens': 'authenticated-read',
  '/api/live/versus': 'authenticated-read',
  '/api/saos/status': 'admin-only',
  '/api/saos/rpc-mesh': 'admin-only',
};

// Rate limit configs per classification
const RATE_LIMIT_CONFIGS: Record<string, RateLimitConfig> = {
  'public-read': { maxRequests: 20, windowMs: 60_000, keyPrefix: 'pub' },
  'authenticated-read': { maxRequests: 100, windowMs: 60_000, keyPrefix: 'auth' },
  'admin-only': { maxRequests: 100, windowMs: 60_000, keyPrefix: 'admin' },
};

export async function authMiddleware(request: NextRequest): Promise<NextResponse | null> {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();
  const path = request.nextUrl.pathname;
  const classification = PATH_CLASSIFICATION[path] || 'authenticated-read';
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
                   request.headers.get('x-real-ip') ||
                   'unknown';

  const logger = createRequestLogger(requestId, path, clientIp);

  // Rate limiting
  const rateLimitConfig = RATE_LIMIT_CONFIGS[classification];
  const rateLimitKey = `${rateLimitConfig.keyPrefix}:${clientIp}`;
  const rateLimitResult = await rateLimit(rateLimitKey, rateLimitConfig);

  if (!rateLimitResult.allowed) {
    const latencyMs = Date.now() - startTime;
    logAudit({
      requestId,
      path,
      authStatus: 'rate-limited',
      latencyMs,
      clientIp,
      classification,
      retryAfter: rateLimitResult.retryAfter,
    });

    return new NextResponse(
      JSON.stringify({
        error: 'Too Many Requests',
        code: 'RATE_LIMIT_EXCEEDED',
        requestId,
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(Math.ceil((rateLimitResult.retryAfter || 60000) / 1000)),
          'X-RateLimit-Limit': String(rateLimitConfig.maxRequests),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil((Date.now() + (rateLimitResult.retryAfter || 60000)) / 1000)),
        },
      }
    );
  }

  // Authentication check
  let authStatus: 'authenticated' | 'unauthorized' | 'invalid-token' | 'expired-token' = 'unauthorized';
  let userRole: 'user' | 'admin' | null = null;

  if (classification !== 'public-read') {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      authStatus = 'unauthorized';
    } else {
      const verification = await verifyToken(token);
      if (!verification.valid) {
        authStatus = verification.expired ? 'expired-token' : 'invalid-token';
      } else {
        authStatus = 'authenticated';
        userRole = verification.payload?.role === 'admin' ? 'admin' : 'user';

        // Admin-only check
        if (classification === 'admin-only' && userRole !== 'admin') {
          authStatus = 'unauthorized';
        }
      }
    }

    if (authStatus !== 'authenticated') {
      const latencyMs = Date.now() - startTime;
      logAudit({
        requestId,
        path,
        authStatus,
        latencyMs,
        clientIp,
        classification,
      });

      return new NextResponse(
        JSON.stringify({
          error: authStatus === 'expired-token' ? 'Token Expired' : 'Unauthorized',
          code: authStatus.toUpperCase().replace('-', '_'),
          requestId,
        }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'WWW-Authenticate': `Bearer realm="saos", error="${authStatus}"`,
          },
        }
      );
    }
  }

  // Success - add auth headers to request for downstream use
  const response = NextResponse.next();
  response.headers.set('x-request-id', requestId);
  response.headers.set('x-client-ip', clientIp);
  if (userRole) response.headers.set('x-user-role', userRole);

  const latencyMs = Date.now() - startTime;
  logAudit({
    requestId,
    path,
    authStatus,
    latencyMs,
    clientIp,
    classification,
    userRole,
  });

  return null; // Continue to route handler
}

// Export matcher for Next.js middleware.ts
export const matcher = Object.keys(PATH_CLASSIFICATION);
