import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from '@/components/sv/shared';
import { verifySiweSignature } from '@/lib/siwe';

// רשימת נתיבים שאינם דורשים אימות
const publicPaths = [
  '/api/health',
  '/api/vault/login',
  '/api/vault/logout',
  '/api/agent/register',
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // בדיקה אם הנתיב הוא נתיב ציבורי
  const isPublicPath = publicPaths.some(path => pathname.startsWith(path));
  
  if (isPublicPath) {
    return NextResponse.next();
  }
  
  // בדיקה אם הנתיב הוא נתיב API
  if (pathname.startsWith('/api/')) {
    // קבלת ה-token מ-header ה-Authorization
    const authHeader = request.headers.get('authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Missing or invalid authorization header' },
        { status: 401 }
      );
    }
    
    const token = authHeader.substring(7);
    
    try {
      // אימות ה-token כנגד הכספת הריבונית
      const payload = await verifySiweSignature(token);
      
      // הוספת מידע המשתמש ל-context של ה-request
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set('x-user-address', payload.address);
      requestHeaders.set('x-user-domain', payload.domain);
      
      return NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      });
    } catch (error) {
      console.error('Token verification failed:', error);
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 401 }
      );
    }
  }
  
  // עבור נתיבים שאינם API, המשך כרגיל
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};