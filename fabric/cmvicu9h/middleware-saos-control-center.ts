import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from '@/components/sv/shared';
import { verifySIWE } from '@/lib/siwe';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip authentication for health check and public assets
  if (pathname.startsWith('/api/health') || pathname.startsWith('/_next') || pathname.startsWith('/favicon.ico')) {
    return NextResponse.next();
  }

  // Protect all API routes except health
  if (pathname.startsWith('/api/')) {
    const token = getToken(request);
    
    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized: No token provided' },
        { status: 401 }
      );
    }

    try {
      // Verify SIWE token
      const user = await verifySIWE(token);
      
      if (!user) {
        return NextResponse.json(
          { error: 'Unauthorized: Invalid token' },
          { status: 401 }
        );
      }

      // Add verified user to request headers for downstream use
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set('x-saos-user', JSON.stringify(user));
      
      return NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      });
    } catch (error) {
      return NextResponse.json(
        { error: 'Unauthorized: Token verification failed' },
        { status: 401 }
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};