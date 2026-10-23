import { NextResponse } from 'next/server';

/**
 * Adds security headers to a NextResponse object
 * @param response - The NextResponse to add headers to
 * @returns The updated NextResponse with security headers
 */
export function addSecurityHeaders(response: NextResponse): NextResponse {
  // Content Security Policy - restricts sources of content
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' wss: https:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'"
  );
  
  // HTTP Strict Transport Security - enforces HTTPS
  response.headers.set(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains; preload'
  );
  
  // Prevents clickjacking
  response.headers.set('X-Frame-Options', 'DENY');
  
  // Prevents MIME-type sniffing
  response.headers.set('X-Content-Type-Options', 'nosniff');
  
  // Controls referrer information
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Permissions Policy - controls browser features
  response.headers.set(
    'Permissions-Policy',
    'geolocation=(), microphone=(), camera=(), payment=()'
  );
  
  // Additional security headers
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Cache-Control', 'no-store, max-age=0');
  
  return response;
}