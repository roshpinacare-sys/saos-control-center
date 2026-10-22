import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySIWE } from '@/lib/siwe';
import { verifyJWT } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { createLogger } from '@/lib/utils';

const logger = createLogger('middleware');

const publicPaths = ['/api/health'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Skip middleware for public paths
  if (publicPaths.some(path => pathname.startsWith(path))) {
    return NextResponse.next();
  }
  
  // Rate limiting check
  const rateLimitResult = await rateLimit(request);
  if (!rateLimitResult.success) {
    logger.warn(`Rate limit exceeded for IP: ${request.ip}`);
    return new NextResponse('Too Many Requests', { 
      status: 429,
      headers: {
        'X-RateLimit-Limit': rateLimitResult.limit.toString(),
        'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
        'X-RateLimit-Reset': rateLimitResult.reset.toString(),
      }
    });
  }
  
  // Authentication check for API routes
  if (pathname.startsWith('/api/')) {
    const authHeader = request.headers.get('authorization');
    
    let authenticated = false;
    
    // Try SIWE verification first
    if (authHeader?.startsWith('SIWE ')) {
      const siweToken = authHeader.substring(5);
      try {
        const result = await verifySIWE(siweToken);
        if (result.success) {
          authenticated = true;
          // Add user info to request headers for downstream use
          request.headers.set('x-user-address', result.address);
        }
      } catch (error) {
        logger.error(`SIWE verification failed: ${error}`);
      }
    }
    
    // Try JWT verification if SIWE failed
    if (!authenticated && authHeader?.startsWith('Bearer ')) {
      const jwtToken = authHeader.substring(7);
      try {
        const result = await verifyJWT(jwtToken);
        if (result.success) {
          authenticated = true;
          // Add user info to request headers for downstream use
          request.headers.set('x-user-id', result.userId);
          request.headers.set('x-user-role', result.role);
        }
      } catch (error) {
        logger.error(`JWT verification failed: ${error}`);
      }
    }
    
    if (!authenticated) {
      logger.warn(`Authentication failed for path: ${pathname} from IP: ${request.ip}`);
      return new NextResponse('Unauthorized', { status: 401 });
    }
  }
  
  // For non-API routes that might need authentication but aren't covered by Edge runtime
  // Fallback to Node runtime
  if (pathname.startsWith('/vault') || 
      pathname.startsWith('/sovereign') || 
      pathname.startsWith('/settings') ||
      pathname.startsWith('/ops') ||
      pathname.startsWith('/audit') ||
      pathname.startsWith('/towers')) {
    const response = NextResponse.next();
    response.headers.set('x-runtime', 'node');
    return response;
  }
  
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};