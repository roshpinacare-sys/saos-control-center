import { NextRequest, NextResponse } from 'next/server';
import { verifySiweMessage } from '@/lib/siwe';
import { verifyJwt } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { safeError } from '@/lib/safe-error';

// Public API routes that skip authentication
const PUBLIC_API_ROUTES = new Set([
  '/api/health',
  '/api/vault/login',
  '/api/vault/challenge',
  '/api/vault/verify',
  '/api/saos/status',
  '/api/live/networks',
  '/api/live/tokens',
  '/api/live/markets',
  '/api/swap/chains',
  '/api/swap/universe',
]);

// Rate limit configuration
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 120; // 120 requests per minute per IP

// In-memory rate limit store (use Redis in production)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const record = rateLimitStore.get(ip);
  
  if (!record || now > record.resetAt) {
    const resetAt = now + RATE_LIMIT_WINDOW_MS;
    rateLimitStore.set(ip, { count: 1, resetAt });
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1, resetAt };
  }
  
  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, remaining: 0, resetAt: record.resetAt };
  }
  
  record.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - record.count, resetAt: record.resetAt };
}

function logAccess(
  ip: string,
  method: string,
  path: string,
  authenticated: boolean,
  authMethod: string | null,
  error?: string
) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    ip,
    method,
    path,
    authenticated,
    authMethod,
    ...(error && { error }),
  };
  
  // In production, ship to structured logging (e.g., Loki, Datadog)
  console.log('[AUTH-MIDDLEWARE]', JSON.stringify(logEntry));
}

async function authenticateRequest(request: NextRequest): Promise<
  | { success: true; method: 'siwe' | 'jwt'; address: string }
  | { success: false; error: string; status: number }
> {
  // 1. Try SIWE authentication (Authorization: Bearer <siwe-message>)
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    
    // Check if it's a SIWE message (contains 'nonce' and 'issuedAt')
    try {
      const parsed = JSON.parse(token);
      if (parsed.message && parsed.signature && parsed.message.nonce && parsed.message.issuedAt) {
        const result = await verifySiweMessage(parsed.message, parsed.signature);
        if (result.success && result.address) {
          return { success: true, method: 'siwe', address: result.address };
        }
      }
    } catch {
      // Not a SIWE message, try JWT
    }
    
    // 2. Try JWT authentication
    const jwtResult = await verifyJwt(token);
    if (jwtResult.success && jwtResult.payload) {
      return { success: true, method: 'jwt', address: jwtResult.payload.address };
    }
  }
  
  // 3. Check for SIWE in x-siwe-message header (alternative)
  const siweMessage = request.headers.get('x-siwe-message');
  const siweSignature = request.headers.get('x-siwe-signature');
  if (siweMessage && siweSignature) {
    try {
      const message = JSON.parse(siweMessage);
      const result = await verifySiweMessage(message, siweSignature);
      if (result.success && result.address) {
        return { success: true, method: 'siwe', address: result.address };
      }
    } catch {
      // Invalid SIWE format
    }
  }
  
  // 4. Check for session cookie (fallback for browser clients)
  const sessionCookie = request.cookies.get('saos_session')?.value;
  if (sessionCookie) {
    const jwtResult = await verifyJwt(sessionCookie);
    if (jwtResult.success && jwtResult.payload) {
      return { success: true, method: 'jwt', address: jwtResult.payload.address };
    }
  }
  
  return { success: false, error: 'Authentication required: provide valid SIWE message, JWT token, or session', status: 401 };
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() 
    || request.headers.get('x-real-ip') 
    || 'unknown';
  const method = request.method;
  
  // Skip non-API routes
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }
  
  // Skip public routes
  if (PUBLIC_API_ROUTES.has(pathname)) {
    logAccess(ip, method, pathname, true, 'public', undefined);
    return NextResponse.next();
  }
  
  // Apply rate limiting
  const rateLimitResult = checkRateLimit(ip);
  if (!rateLimitResult.allowed) {
    logAccess(ip, method, pathname, false, null, 'Rate limit exceeded');
    return new NextResponse(
      JSON.stringify(safeError('RATE_LIMITED', 'Too many requests', { retryAfter: Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000) })),
      { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000)) } }
    );
  }
  
  // Authenticate request
  const authResult = await authenticateRequest(request);
  
  if (!authResult.success) {
    logAccess(ip, method, pathname, false, null, authResult.error);
    return new NextResponse(
      JSON.stringify(safeError('UNAUTHORIZED', authResult.error)),
      { status: authResult.status, headers: { 'Content-Type': 'application/json' } }
    );
  }
  
  // Authentication successful - add user info to headers for downstream use
  const response = NextResponse.next();
  response.headers.set('x-authenticated-address', authResult.address);
  response.headers.set('x-auth-method', authResult.method);
  response.headers.set('x-rate-limit-remaining', String(rateLimitResult.remaining));
  response.headers.set('x-rate-limit-reset', String(Math.ceil(rateLimitResult.resetAt / 1000)));
  
  logAccess(ip, method, pathname, true, authResult.method);
  return response;
}

export const config = {
  matcher: [
    '/api/:path*',
  ],
};