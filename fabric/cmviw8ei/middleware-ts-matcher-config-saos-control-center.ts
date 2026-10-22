import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyMessage, verifyJwt } from '@/lib/siwe';
import { rateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/utils';

// ─── Matcher Configuration ────────────────────────────────────────────────────
// Covers all /api/* routes except /api/health (which should be publicly accessible)
const config = {
  matcher: [
    '/api/:path*',
    '/api/health/:path*',
  ],
};

// ─── Middleware Implementation ────────────────────────────────────────────────
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Skip health endpoint (public access)
  if (pathname.startsWith('/api/health')) {
    return NextResponse.next();
  }

  // Rate limiting - global level
  const rateLimitResult = await rateLimit(request);
  if (!rateLimitResult.success) {
    logger(`Rate limit exceeded for IP: ${request.ip}`, 'rate-limit');
    return new NextResponse('Too Many Requests', { status: 429 });
  }

  // Authentication flow
  const authHeader = request.headers.get('authorization');
  
  if (!authHeader) {
    logger(`Missing auth header for path: ${pathname}`, 'auth');
    return new NextResponse('Unauthorized', { status: 401 });
  }

  // Try SIWE first (for wallet-based auth)
  let verified = false;
  let userId = null;
  
  try {
    const siweVerified = await verifyMessage(authHeader);
    if (siweVerified) {
      verified = true;
      userId = siweVerified.address; // Use wallet address as user ID
      logger(`SIWE auth successful for: ${userId}`, 'auth');
    }
  } catch (error) {
    logger(`SIWE verification failed: ${error}`, 'auth');
  }

  // Fallback to JWT if SIWE fails
  if (!verified) {
    try {
      const jwtPayload = await verifyJwt(authHeader.replace('Bearer ', ''));
      if (jwtPayload) {
        verified = true;
        userId = jwtPayload.sub; // Use subject claim as user ID
        logger(`JWT auth successful for: ${userId}`, 'auth');
      }
    } catch (error) {
      logger(`JWT verification failed: ${error}`, 'auth');
    }
  }

  // If neither SIWE nor JWT succeeded
  if (!verified) {
    logger(`Authentication failed for path: ${pathname}`, 'auth');
    return new NextResponse('Unauthorized', { status: 401 });
  }

  // Add user ID to headers for downstream use
  const response = NextResponse.next();
  response.headers.set('x-user-id', userId);
  
  return response;
}

// ─── Fallback for Node Runtime ────────────────────────────────────────────────
// This export ensures the middleware runs in Node.js for auth methods that
// don't work with Edge runtime (like certain JWT libraries)
export const config = {
  matcher: [
    '/api/:path*',
    '/api/health/:path*',
  ],
};