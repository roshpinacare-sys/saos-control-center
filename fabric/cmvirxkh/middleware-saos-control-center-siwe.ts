import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from '@/components/sv/shared';
import { SIWE } from '@/lib/siwe';
import { SafeError } from '@/lib/safe-error';

// מגדירים את הנתיבים שפטורים מאימות
const publicPaths = ['/api/health'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // בדיקה אם הנתיב הוא פומבי
  const isPublicPath = publicPaths.some(path => pathname.startsWith(path));
  
  if (isPublicPath) {
    return NextResponse.next();
  }
  
  // ניסיון לאחזר את הטוקן מהכותרת
  const authHeader = request.headers.get('authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: 'Unauthorized - Missing token' },
      { status: 401 }
    );
  }
  
  const token = authHeader.substring(7);
  
  try {
    // אימות הטוקן
    const payload = SIWE.verify(token);
    
    // הוספת המידע המאומת ל-context של ה-request
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-user-address', payload.address);
    requestHeaders.set('x-user-message', payload.message);
    requestHeaders.set('x-user-signature', payload.signature);
    
    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  } catch (error) {
    if (error instanceof SafeError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status || 401 }
      );
    }
    
    // טיפול בשגיאות אימות כלליות
    return NextResponse.json(
      { error: 'Unauthorized - Invalid token' },
      { status: 401 }
    );
  }
}

// מגדירים את הנתיבים שה-middleware יחול עליהם
export const config = {
  matcher: '/api/:path*',
};