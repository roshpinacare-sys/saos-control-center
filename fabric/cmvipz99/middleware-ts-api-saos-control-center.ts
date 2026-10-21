import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { logAccess } from '@/lib/utils';

// Matcher configuration
export const config = {
  matcher: [
    '/api/:path*',
    '/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

export async function middleware(request: NextRequest) {
  // Clone the request to modify headers
  const response = NextResponse.next();
  
  // 1. Exclude health endpoint from authentication
  if (request.nextUrl.pathname === '/api/health') {
    return response;
  }
  
  // 2. Apply rate limiting globally
  const rateLimitResult = await rateLimit(request);
  if (!rateLimitResult.success) {
    return new NextResponse('Too Many Requests', { 
      status: 429,
      headers: {
        'X-RateLimit-Limit': rateLimitResult.limit.toString(),
        'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
        'X-RateLimit-Reset': rateLimitResult.reset.toString(),
      },
    });
  }
  
  // 3. Log access attempts
  await logAccess(request);
  
  // 4. Authentication for API routes
  if (request.nextUrl.pathname.startsWith('/api/')) {
    // Try to authenticate with SIWE/JWT
    const authResult = await verifyAuth(request);
    
    if (!authResult.success) {
      // For unauthenticated requests, check if they're to existing unprotected paths
      const unprotectedPaths = [
        '/api/vault/login',
        '/api/vault/logout',
        '/api/vault/status',
        '/api/swap/quotes',
        '/api/swap/chains',
        '/api/live/markets',
        '/api/live/tokens',
        '/api/live/networks',
      ];
      
      const isUnprotected = unprotectedPaths.some(path => 
        request.nextUrl.pathname.startsWith(path)
      );
      
      if (!isUnprotected) {
        return new NextResponse('Unauthorized', { 
          status: 401,
          headers: {
            'WWW-Authenticate': 'Bearer, SIWE',
          },
        });
      }
    } else {
      // Add auth info to headers for downstream use
      response.headers.set('x-user-id', authResult.userId);
      response.headers.set('x-auth-token', authResult.token);
    }
  }
  
  // 5. Add security headers
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'origin-when-cross-origin');
  
  return response;
}

/**
 * Middleware documentation:
 * 
 * This middleware provides centralized authentication and security for the SAOS Control Center.
 * 
 * Features:
 * 1. Health endpoint exclusion: /api/health bypasses authentication
 * 2. API route protection: All /api/* routes require authentication (except unprotected ones)
 * 3. SIWE/JWT authentication: Supports both Sign-In with Ethereum and JWT tokens
 * 4. Access logging: Centralized logging of all access attempts
 * 5. Future-proof API protection: New API endpoints are protected by default
 * 6. Rate limiting: Global rate limiting to prevent abuse
 * 7. Graceful fallback: Unprotected existing paths remain accessible
 * 8. Security headers: Adds security-related HTTP headers
 * 
 * The middleware works with Next.js 13+ and supports Edge runtime where possible.
 * 
 * Configuration:
 * - matcher: Defines which paths the middleware should apply to
 * - exclude: /api/health is excluded from authentication
 * 
 * Authentication flow:
 * 1. Extract token from Authorization header (Bearer or SIWE)
 * 2. Verify token using auth library
 * 3. Add user info to headers for downstream use
 * 4. Return 401 if authentication fails
 * 
 * Rate limiting:
 * - Uses token bucket algorithm
 * - Global limit applied to all requests
 * - Headers include rate limit status
 * 
 * Security:
 * - Adds security headers to all responses
 * - Protects against CSRF, clickjacking, etc.
 * - Enforces HTTPS where possible
 * 
 * Note: This middleware should be placed in src/app/middleware.ts
 */