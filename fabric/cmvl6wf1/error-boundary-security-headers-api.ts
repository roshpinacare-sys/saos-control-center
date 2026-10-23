import { NextResponse } from 'next/server';

// Security headers configuration
const securityHeaders = {
  // Content Security Policy - prevents XSS attacks
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' wss: https:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';",
  // HTTP Strict Transport Security - enforces HTTPS
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  // Prevents clickjacking
  'X-Frame-Options': 'DENY',
  // Prevents MIME-type sniffing
  'X-Content-Type-Options': 'nosniff',
  // Controls referrer information
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // Controls permissions for browser features
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  // Cross-Origin Resource Sharing
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  // Remove server info
  'Server': '',
  // Set content type to JSON
  'Content-Type': 'application/json',
};

/**
 * Centralized error boundary for API responses
 * Applies security headers to all responses including errors
 */
export function apiErrorBoundary(handler: Function) {
  return async (...args: any[]) => {
    try {
      // Execute the original handler
      const response = await handler(...args);
      
      // If response is already a NextResponse, merge headers
      if (response instanceof NextResponse) {
        const headers = new Headers(response.headers);
        Object.entries(securityHeaders).forEach(([key, value]) => {
          headers.set(key, value);
        });
        return new NextResponse(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      }
      
      // If response is not a NextResponse, create one with security headers
      return NextResponse.json(response, {
        headers: securityHeaders,
      });
    } catch (error: any) {
      // Create error response with security headers
      const errorResponse = {
        error: error.message || 'Internal Server Error',
        status: error.status || 500,
        timestamp: new Date().toISOString(),
      };
      
      return NextResponse.json(errorResponse, {
        status: errorResponse.status,
        headers: securityHeaders,
      });
    }
  };
}

/**
 * Middleware to apply security headers to all API routes
 * This should be applied in your middleware.ts or in each route
 */
export function applySecurityHeaders(response: NextResponse) {
  const headers = new Headers(response.headers);
  Object.entries(securityHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });
  return new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
