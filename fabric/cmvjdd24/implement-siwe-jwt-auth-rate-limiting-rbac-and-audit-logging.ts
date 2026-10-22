import { NextRequest, NextResponse } from 'next/server';
import { verifySIWE, createSession, verifySession, type SIWEMessage } from '@/lib/siwe';
import { checkRateLimit, type RateLimitConfig } from '@/lib/rate-limit';
import { hasPermission, type Permission } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import { getSaosStatus } from '@/lib/saos/kernel';

const RATE_LIMIT_CONFIG: RateLimitConfig = {
  windowMs: 60_000, // 1 minute
  maxRequests: 30,  // 30 requests per minute per address
  keyPrefix: 'saos:status',
};

const REQUIRED_PERMISSION: Permission = 'saos:status:read';

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

export async function GET(req: NextRequest) {
  const start = Date.now();
  const ip = getClientIp(req);
  const userAgent = req.headers.get('user-agent') || 'unknown';
  let address = 'unknown';
  let chainId = 0;
  let outcome = 'failure';
  let sessionValid = false;

  try {
    // 1. Extract and verify SIWE signature from Authorization header
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('SIWE ')) {
      return unauthorized('Missing or invalid SIWE authorization header');
    }

    const siweMessage: SIWEMessage = JSON.parse(authHeader.slice(5));
    const verification = await verifySIWE(siweMessage);
    
    if (!verification.valid) {
      return unauthorized(`Invalid SIWE signature: ${verification.error}`);
    }

    address = verification.address.toLowerCase();
    chainId = verification.chainId;

    // 2. Verify JWT session token (issued after successful SIWE)
    const sessionToken = req.headers.get('x-session-token');
    if (!sessionToken) {
      return unauthorized('Missing session token');
    }

    const session = await verifySession(sessionToken);
    if (!session.valid || session.address?.toLowerCase() !== address || session.chainId !== chainId) {
      return unauthorized('Invalid or mismatched session');
    }
    sessionValid = true;

    // 3. Rate limiting per address
    const rateLimitKey = `${address}:${chainId}`;
    const rateLimit = await checkRateLimit(rateLimitKey, RATE_LIMIT_CONFIG);
    if (!rateLimit.allowed) {
      outcome = 'rate_limited';
      await auditLog({
        timestamp: new Date().toISOString(),
        address,
        chainId,
        ip,
        userAgent,
        outcome,
        latencyMs: Date.now() - start,
        details: { retryAfter: rateLimit.retryAfter },
      });
      return NextResponse.json(
        { error: 'Rate limit exceeded', retryAfter: rateLimit.retryAfter },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rateLimit.retryAfter / 1000)) } }
      );
    }

    // 4. RBAC check
    const permitted = await hasPermission(address, chainId, REQUIRED_PERMISSION);
    if (!permitted) {
      outcome = 'forbidden';
      await auditLog({
        timestamp: new Date().toISOString(),
        address,
        chainId,
        ip,
        userAgent,
        outcome,
        latencyMs: Date.now() - start,
        details: { requiredPermission: REQUIRED_PERMISSION },
      });
      return NextResponse.json(
        { error: 'Insufficient permissions', required: REQUIRED_PERMISSION },
        { status: 403 }
      );
    }

    // 5. Fetch and return status (sanitized for the caller's permission level)
    const status = await getSaosStatus();
    
    // Sanitize sensitive fields - only include what's allowed for this permission
    const sanitizedStatus = {
      ...status,
      fleetKeys: undefined,           // Never expose fleet keys
      anchorAccounts: status.anchorAccounts?.map(acc => ({
        ...acc,
        privateKey: undefined,        // Never expose private keys
        mnemonic: undefined,
      })) || [],
      relayAgent: status.relayAgent ? {
        ...status.relayAgent,
        signingKey: undefined,        // Never expose signing keys
      } : null,
    };

    outcome = 'success';
    await auditLog({
      timestamp: new Date().toISOString(),
      address,
      chainId,
      ip,
      userAgent,
      outcome,
      latencyMs: Date.now() - start,
    });

    return NextResponse.json(sanitizedStatus, {
      headers: {
        'X-RateLimit-Limit': String(RATE_LIMIT_CONFIG.maxRequests),
        'X-RateLimit-Remaining': String(rateLimit.remaining),
        'X-RateLimit-Reset': String(Math.ceil((Date.now() + RATE_LIMIT_CONFIG.windowMs) / 1000)),
      },
    });
  } catch (error) {
    await auditLog({
      timestamp: new Date().toISOString(),
      address,
      chainId,
      ip,
      userAgent,
      outcome: 'error',
      latencyMs: Date.now() - start,
      details: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    console.error('[saos/status] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function unauthorized(message: string) {
  return NextResponse.json({ error: message }, { status: 401 });
}