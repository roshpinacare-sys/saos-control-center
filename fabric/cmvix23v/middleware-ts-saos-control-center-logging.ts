import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyJWT } from '@/lib/auth';
import { verifySIWE } from '@/lib/siwe';
import { rateLimit } from '@/lib/rate-limit';
import { createLogger } from '@/lib/logger';

const logger = createLogger('middleware');

// Matcher configuration - all API routes except health
export const config = {
  matcher: [
    '/api/:path*',
    '!/api/health',
  ],
};

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Apply rate limiting to all protected paths
  const clientIP = request.ip || request.headers.get('x-forwarded-for') || 'unknown';
  const rateLimitResult = await rateLimit(clientIP);
  
  if (rateLimitResult.error) {
    logger.warn('Rate limit exceeded', { 
      ip: clientIP, 
      path: pathname,
      resetTime: rateLimitResult.resetTime
    });
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'X-RateLimit-Reset': rateLimitResult.resetTime.toString() } }
    );
  }
  
  // Skip authentication for health endpoint
  if (pathname === '/api/health') {
    return NextResponse.next();
  }
  
  // Extract token from Authorization header
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
  
  // Extract SIWE signature from headers
  const siweSignature = request.headers.get('x-siwe-signature');
  const siweMessage = request.headers.get('x-siwe-message');
  
  let isAuthenticated = false;
  let authMethod = 'none';
  
  // Try SIWE authentication first
  if (siweSignature && siweMessage) {
    try {
      const isValid = await verifySIWE(siweMessage, siweSignature);
      if (isValid) {
        isAuthenticated = true;
        authMethod = 'siwe';
      }
    } catch (error) {
      logger.error('SIWE verification failed', { error: (error as Error).message });
    }
  }
  
  // Fallback to JWT if SIWE failed
  if (!isAuthenticated && token) {
    try {
      const isValid = await verifyJWT(token);
      if (isValid) {
        isAuthenticated = true;
        authMethod = 'jwt';
      }
    } catch (error) {
      logger.error('JWT verification failed', { error: (error as Error).message });
    }
  }
  
  // Log access attempt
  logger.info('Access attempt', {
    ip: clientIP,
    path: pathname,
    method: request.method,
    authenticated: isAuthenticated,
    authMethod,
    timestamp: new Date().toISOString()
  });
  
  // Handle unauthenticated requests
  if (!isAuthenticated) {
    logger.warn('Unauthenticated access attempt', { ip: clientIP, path: pathname });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  // Add auth info to request headers for downstream use
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-auth-method', authMethod);
  requestHeaders.set('x-authenticated', 'true');
  
  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}
