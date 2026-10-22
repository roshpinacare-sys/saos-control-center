import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyJWT, verifySIWE } from '@/lib/auth';

// Middleware matcher - החל על כל נתיבי /api/* למעט /api/health
export const config = {
  matcher: ['/api((?!/health).*)'],
};

/**
 * Middleware אימות מרכזי עבור נתיבי ה-API
 * בודק JWT token ו-SIWE token בכל בקשות ה-API
 * מאפשר גישה לנתיב /api/health ללא אימות
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // פסולת תגובה סטנדרטית לשגיאות אימות
  const authError = (message: string, status: number = 401) => {
    return NextResponse.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message,
          timestamp: new Date().toISOString(),
        },
      },
      { status }
    );
  };

  // נתיבים פטורים מאימות
  if (pathname === '/api/health') {
    return NextResponse.next();
  }

  // בדיקת הימצאות Authorization header
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return authError('Missing or malformed authorization header');
  }

  const token = authHeader.substring(7); // הסרת 'Bearer '

  try {
    // ניסיון לאמת כ-JWT סטנדרטי
    const jwtPayload = verifyJWT(token);
    
    // הוספת מידע המשתמש ל-header עבור ה-handler
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-user-id', jwtPayload.sub);
    requestHeaders.set('x-user-role', jwtPayload.role || 'user');
    
    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  } catch (jwtError) {
    // אם JWT נכשל, נסה כ-SIWE
    try {
      const siwePayload = await verifySIWE(token);
      
      // הוספת מידע המשתמש ל-header עבור ה-handler
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set('x-user-address', siwePayload.address);
      requestHeaders.set('x-siwe-message', siwePayload.message);
      
      return NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      });
    } catch (siweError) {
      // אם גם SIWE נכשל, החזר שגיאת אימות
      return authError('Invalid or expired token');
    }
  }
}

/**
 * פונקציית עזר לחילוץ claims מטוקן JWT
 * @param token - JWT token
 * @returns ה-claims בטוקן
 * @throws אם הטוקן לא תקף
 */
export function getTokenClaims(token: string) {
  try {
    const payload = verifyJWT(token);
    return payload;
  } catch (error) {
    throw new Error('Invalid token');
  }
}

/**
 * פונקציית עזר לבדיקת הרשאות משתמש
 * @param request - NextRequest עם ה-headerים שהוספנו
 * @param requiredRole - הרשאה נדרשת
 * @returns true אם המשתמש בעל ההרשאה הנדרשת
 */
export function hasRole(request: NextRequest, requiredRole: string): boolean {
  const userRole = request.headers.get('x-user-role');
  return userRole === requiredRole;
}