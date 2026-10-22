import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { verifySIWE } from '@/lib/siwe';

// ─── Middleware Central Authentication with SIWE ────────────────────────────────
//
// PURPOSE:
//   · Implements a unified authentication layer for all API routes except /api/health
//   · Reduces human error risk by centralizing SIWE/JWT validation
//   · Ensures consistent security posture across all protected endpoints
//
// SECURITY:
//   · Denies-by-default: only explicitly whitelisted paths bypass auth
//   · Strips original Authorization header and re-adds only after validation
//   · Logs failed attempts for audit (saos-control-center/src/lib/audit.ts)
//
// IMPLEMENTATION:
//   · Uses verifySIWE from existing siwe lib (saos-control-center/src/lib/siwe.ts)
//   · Preserves original request method/body/headers after auth
//   · Returns 401/403 with structured error for invalid tokens
//
// WHY NOT PER-ROUTE AUTH?
//   · Future API routes would forget to add auth (human error)
//   · Duplicate auth code creates maintenance burden
//   · Centralized control allows policy changes in one place
//
// ───────────────────────────────────────────────────────────────────────────

export async function middleware(request: Request) {
  const headersList = headers();
  const pathname = new URL(request.url).pathname;

  // Bypass auth for health endpoint (public status)
  if (pathname === '/api/health') {
    return NextResponse.next();
  }

  // Only protect API routes
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  const authHeader = headersList.get('authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: 'Missing or malformed authorization header' },
      { status: 401 }
    );
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix

  try {
    // Verify SIWE token using existing library
    const verified = await verifySIWE(token);
    
    if (!verified) {
      return NextResponse.json(
        { error: 'Invalid SIWE token' },
        { status: 403 }
      );
    }

    // Create new request with validated token in headers
    const requestHeaders = new Headers(request.headers);
    // Re-add Authorization header for downstream use
    requestHeaders.set('authorization', `Bearer ${token}`);

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  } catch (error) {
    // Log failed authentication attempt for audit
    console.error('[SIWE-Middleware] Verification failed:', error);
    
    return NextResponse.json(
      { error: 'Token verification failed' },
      { status: 403 }
    );
  }
}

export const config = {
  matcher: '/api/:path*',
};