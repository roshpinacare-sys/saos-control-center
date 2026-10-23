import { NextResponse } from 'next/server';

// Middleware to add security headers to all API responses
export async function securityHeadersMiddleware(request: Request) {
  const response = NextResponse.next();
  
  // Security Headers
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  response.headers.set('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'");
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=()');
  
  return response;
}

// Apply middleware to all API routes
export function middleware(request: Request) {
  if (request.url.startsWith('/api/')) {
    return securityHeadersMiddleware(request);
  }
  return NextResponse.next();
}

// Configure middleware to match all API routes
export const config = {
  matcher: '/api/:path*',
};