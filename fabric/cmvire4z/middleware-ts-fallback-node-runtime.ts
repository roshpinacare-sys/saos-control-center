import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySIWE } from '@/lib/siwe';
import { verifyJWT } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';

// רשימת הנתיבים שלא דורשים אימות (כגון נתיבי בריאות)
const publicPaths = ['/api/health'];

// Matcher config שמכסה את כל נתיבי ה-API למעט /api/health
export const config = {
  matcher: ['/api/:path*'],
};

// פונקציית middleware המרכזית
export async function middleware(request: NextRequest) {
  // רישום מרכזי של כל ניסיונות הגישה
  const logData = {
    timestamp: new Date().toISOString(),
    path: request.nextUrl.pathname,
    method: request.method,
    userAgent: request.headers.get('user-agent'),
    ip: request.ip || 'unknown',
  };
  
  // הדפסת לוג לקונסול בסביבת פיתוח, בפרודוקציה ניתן לשלוח למערכת לוגים
  if (process.env.NODE_ENV === 'development') {
    console.log('[Middleware Access Log]', logData);
  }

  // בדיקת האם הנתיב ציבורי
  const isPublicPath = publicPaths.some(path => 
    request.nextUrl.pathname.startsWith(path)
  );

  // אם הנתיב ציבורי, מאפשר גישה ללא אימות
  if (isPublicPath) {
    return NextResponse.next();
  }

  // יישום rate limiting גלובלי
  try {
    const { success, limit, remaining, reset } = await rateLimit(request);
    
    // אם חרג ממגבלת ה-rate limit
    if (!success) {
      return new NextResponse(
        JSON.stringify({ 
          error: 'Too many requests', 
          limit, 
          remaining, 
          reset 
        }),
        { 
          status: 429,
          headers: {
            'X-RateLimit-Limit': limit.toString(),
            'X-RateLimit-Remaining': remaining.toString(),
            'X-RateLimit-Reset': reset.toString(),
            'Content-Type': 'application/json',
          },
        }
      );
    }
  } catch (error) {
    // אם יש בעיה ב-rate limiting, מאפשר גישה עם אזהרה בלוג
    console.error('[Rate Limit Error]', error);
  }

  // אימות מדורג: ניסיון אימות SIWE ואם נכשל, ניסיון אימות JWT
  let token: string | null = null;
  let isAuthenticated = false;

  // ניסוח טוקן מה-header או מה-cookie
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else {
    token = request.cookies.get('token')?.value || null;
  }

  // אם אין טוקן, מחזיר שגיאת אימות
  if (!token) {
    return new NextResponse(
      JSON.stringify({ error: 'Authentication required' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // ניסיון אימות SIWE
  try {
    const siweVerified = await verifySIWE(token);
    if (siweVerified) {
      isAuthenticated = true;
    }
  } catch (error) {
    // אימות SIWE נכשל, ממשיך לניסיון JWT
    console.error('[SIWE Verification Error]', error);
  }

  // אם SIWE נכשל, ניסיון אימות JWT
  if (!isAuthenticated) {
    try {
      const jwtVerified = await verifyJWT(token);
      if (jwtVerified) {
        isAuthenticated = true;
      }
    } catch (error) {
      // אימות JWT נכשל
      console.error('[JWT Verification Error]', error);
    }
  }

  // אם אף אחד משיטות האימות לא צלח
  if (!isAuthenticated) {
    return new NextResponse(
      JSON.stringify({ error: 'Invalid authentication' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // הוספת הטוקן המאומת ל-header לשימוש בקובץ ה-Route
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-auth-token', token);

  // המשך לקובץ ה-Route עם ה-header המעודכן
  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}
