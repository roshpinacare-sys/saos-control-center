import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyJWT } from '@/lib/auth';
import { verifySIWE } from '@/lib/siwe';
import { logSecurityEvent } from '@/lib/audit';

// Matcher config — כל נתיבי /api/* פרט ל-/api/health
export const config = {
  matcher: ['/api/:path*'],
};

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // פסול מראש: נתיבי סטטיים וקבצי Next.js פנימיים
  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/static/') ||
    pathname.startsWith('/favicon.ico') ||
    pathname.startsWith('/robots.txt')
  ) {
    return NextResponse.next();
  }

  // התעלמות מנתיב הבריאות
  if (pathname === '/api/health') {
    return NextResponse.next();
  }

  // הפרדת נתיבי API מנתיבי UI
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // אימות גישה לנתיבי API
  const authHeader = request.headers.get('authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // רישום ניסיון גישה לא מורשה
    await logSecurityEvent({
      event: 'AUTH_MISSING',
      path: pathname,
      ip: request.ip || 'unknown',
      userAgent: request.headers.get('user-agent') || 'unknown',
    });

    return NextResponse.json(
      { error: 'Unauthorized: Missing or malformed authorization header' },
      { status: 401 }
    );
  }

  const token = authHeader.substring(7); // הסרת 'Bearer '
  let isValid = false;
  let user = null;

  // ניסיון אימות JWT
  try {
    user = await verifyJWT(token);
    isValid = true;
  } catch (jwtError) {
    // JWT לא תקף, ניסיון SIWE
    try {
      user = await verifySIWE(token);
      isValid = true;
    } catch (siweError) {
      // שני הניסיונות נכשלו
      await logSecurityEvent({
        event: 'AUTH_FAILED',
        path: pathname,
        ip: request.ip || 'unknown',
        userAgent: request.headers.get('user-agent') || 'unknown',
        error: jwtError instanceof Error ? jwtError.message : 'JWT verification failed',
        error2: siweError instanceof Error ? siweError.message : 'SIWE verification failed',
      });

      return NextResponse.json(
        { error: 'Unauthorized: Invalid token' },
        { status: 401 }
      );
    }
  }

  // אם האימות הצליח, הוסף את המשתמש ל-header והמשך
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-user-id', user.id);
  requestHeaders.set('x-user-role', user.role);

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}
