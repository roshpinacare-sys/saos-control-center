import { NextRequest, NextResponse } from 'next/server';
import { verify } from '@/lib/auth';
import { createSafeError, safeJson } from '@/lib/safe-error';

/**
 * Middleware אימות מרכזי לכל נתיבי /api/*
 * 
 * מדלג על /api/health (health-check ציבורי)
 * מאמת JWT/SIWE token דרך verify() מ-lib/auth
 * מחזיר 401 עם safe-error מובנה במקרה כישלון
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // נתיבי בריאות ציבוריים — ללא אימות
  if (pathname === '/api/health' || pathname.startsWith('/api/health/')) {
    return NextResponse.next();
  }

  // רק נתיבי API — middleware מוחל על /api/* דרך matcher
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  try {
    // שליפת Authorization header
    const authHeader = request.headers.get('authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      const err = createSafeError('AUTH_MISSING_TOKEN', 'נדרש Authorization header מסוג Bearer', 401);
      return safeJson(err, { status: 401 });
    }

    const token = authHeader.slice(7); // הסרת 'Bearer '
    
    // אימות token דרך ספריית האימות המרכזית
    const payload = await verify(token);
    
    if (!payload) {
      const err = createSafeError('AUTH_INVALID_TOKEN', 'Token לא תקף או פג תוקף', 401);
      return safeJson(err, { status: 401 });
    }

    // הוספת payload ל-headers עבור route handlers
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-auth-payload', JSON.stringify(payload));
    requestHeaders.set('x-auth-address', payload.address || '');
    requestHeaders.set('x-auth-chain', payload.chain || '');

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  } catch (error) {
    console.error('[auth-middleware] שגיאת אימות:', error);
    
    const err = createSafeError(
      'AUTH_VERIFICATION_FAILED',
      'כשל באימות token',
      401,
      error instanceof Error ? error.message : undefined
    );
    
    return safeJson(err, { status: 401 });
  }
}

/**
 * הגדרת matcher — מוחל על כל /api/* פרט ל-/api/health
 * 
 * הערה: matcher תומך ב-glob patterns של Next.js
 * - '/api/:path*' — תופס כל נתיב תחת /api/
 * - החרגת health דרך לוגיקה פנימית (גמיש יותר מ-negative lookahead)
 */
export const config = {
  matcher: [
    '/api/:path*',
  ],
};
