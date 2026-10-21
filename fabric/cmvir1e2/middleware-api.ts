import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyAuth } from '@/lib/auth';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Skip health endpoint
  if (pathname.startsWith('/api/health')) {
    return NextResponse.next();
  }
  
  // Skip auth for non-API routes
  if (!pathname.startsWith('/api')) {
    return NextResponse.next();
  }
  
  // Get token from Authorization header
  const authHeader = request.headers.get('authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new NextResponse(
      JSON.stringify({ error: 'Unauthorized', message: 'Missing or invalid token' }),
      { 
        status: 401,
        headers: { 
          'Content-Type': 'application/json',
          'X-Auth-Status': 'missing'
        }
      }
    );
  }
  
  const token = authHeader.substring(7);
  
  try {
    // Verify the token
    const user = verifyAuth(token);
    
    // Create a response with user info in headers
    const response = NextResponse.next();
    
    // Add user info to response headers
    response.headers.set('X-User-ID', user.id);
    response.headers.set('X-User-Role', user.role);
    response.headers.set('X-Auth-Status', 'authenticated');
    
    // Add user to request locals for access in route handlers
    request.user = user;
    
    return response;
  } catch (error) {
    return new NextResponse(
      JSON.stringify({ error: 'Unauthorized', message: 'Invalid or expired token' }),
      { 
        status: 401,
        headers: { 
          'Content-Type': 'application/json',
          'X-Auth-Status': 'invalid'
        }
      }
    );
  }
}

export const config = {
  matcher: ['/api((?!/health).*)'],
};