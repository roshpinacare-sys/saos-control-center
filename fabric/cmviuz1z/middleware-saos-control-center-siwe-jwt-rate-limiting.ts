import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySIWE } from '@/lib/siwe';
import { verifyJWT } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { createLogger } from '@/lib/utils';

const logger = createLogger('middleware');

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Skip health endpoint
  if (pathname === '/api/health') {
    return NextResponse.next();
  }
  
  // Apply rate limiting globally
  const rateLimitResult = await rateLimit(request);
  if (rateLimitResult) {
    logger.warn(`Rate limit exceeded for IP: ${request.ip}`);
    return new NextResponse('Too many requests', { status: 429 });
  }
  
  // Log access attempt
  logger.info(`Access attempt to: ${pathname} from IP: ${request.ip}`);
  
  // Check for SIWE or JWT token
  const siweToken = request.headers.get('authorization')?.replace('Bearer ', '');
  const jwtToken = request.headers.get('x-jwt-token');
  
  let authenticated = false;
  
  // Verify SIWE token if present
  if (siweToken) {
    try {
      const isValid = await verifySIWE(siweToken);
      if (isValid) {
        authenticated = true;
        logger.info('SIWE authentication successful');
      }
    } catch (error) {
      logger.error('SIWE verification failed:', error);
    }
  }
  
  // Verify JWT token if present and SIWE failed
  if (!authenticated && jwtToken) {
    try {
      const isValid = await verifyJWT(jwtToken);
      if (isValid) {
        authenticated = true;
        logger.info('JWT authentication successful');
      }
    } catch (error) {
      logger.error('JWT verification failed:', error);
    }
  }
  
  if (!authenticated) {
    logger.warn(`Authentication failed for path: ${pathname}`);
    return new NextResponse('Authentication required', { status: 401 });
  }
  
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/api/:path*',
    '/api/health',
  ],
};
