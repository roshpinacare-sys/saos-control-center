import { NextResponse } from 'next/server';

/**
 * Middleware to protect /api/saos/status from clickjacking attacks
 * by adding X-Frame-Options: DENY header to all responses.
 * 
 * This prevents the API endpoint from being embedded in iframes or frames
 * from other domains, which could be used in clickjacking attacks.
 * 
 * Usage:
 * 1. Add this file to `src/middleware.ts` or create a new middleware file
 *    and include this route handler.
 * 2. Ensure the middleware runs before the API route is processed.
 * 
 * Configuration:
 * - The middleware specifically targets the `/api/saos/status` endpoint
 * - For other endpoints, you may need different headers or no headers
 * - In production, consider adding additional security headers like:
 *   - Content-Security-Policy
 *   - X-Content-Type-Options: nosniff
 *   - Strict-Transport-Security (when using HTTPS)
 */
export function middleware(request: Request) {
  // Check if the request is for the specific endpoint we want to protect
  if (request.nextUrl.pathname === '/api/saos/status') {
    const response = NextResponse.next();
    
    // Add X-Frame-Options header with DENY value
    // DENY means the page cannot be displayed in a frame, regardless of the site
    response.headers.set('X-Frame-Options', 'DENY');
    
    return response;
  }
  
  // For all other requests, just continue without modification
  return NextResponse.next();
}

// Optional: Configure the matcher to only run for specific paths
// export const config = {
//   matcher: '/api/saos/status',
// };
