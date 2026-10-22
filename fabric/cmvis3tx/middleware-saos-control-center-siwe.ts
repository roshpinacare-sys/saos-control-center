import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySiweToken } from '@/lib/siwe';

export async function middleware(request: NextRequest) {
  // Skip middleware for health endpoint
  if (request.nextUrl.pathname.startsWith('/api/health')) {
    return NextResponse.next();
  }

  // Get the authorization header
  const authHeader = request.headers.get('authorization');
  
  // Check if authorization header exists
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized: Missing or malformed token' }, { status: 401 });
  }

  // Extract the token
  const token = authHeader.substring(7);

  try {
    // Verify the SIWE token
    const payload = await verifySiweToken(token);
    
    // Add verified token to request context
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-user-address', payload.address);
    
    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: 'Unauthorized: Invalid token' }, { status: 401 });
  }
}

export const config = {
  matcher: '/api/:path*',
};