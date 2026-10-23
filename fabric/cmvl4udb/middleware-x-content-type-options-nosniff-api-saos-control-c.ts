import { NextResponse } from 'next/server';

// Middleware to add security headers
export function middleware(request: Request) {
  const response = NextResponse.next();
  
  // Add X-Content-Type-Options: nosniff header
  response.headers.set('X-Content-Type-Options', 'nosniff');
  
  return response;
}

// Configure the middleware to run on all API routes
export const config = {
  matcher: '/api/:path*',
};