import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySIWE } from '@/lib/siwe';
import { verifyJWT } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';

// הגדרת נתיבים מותרים ללא אימות
const PUBLIC_PATHS = ['/api/health'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // רישום גישה ל-API
  console.log(`[${new Date().toISOString()}] API Access: ${request.method} ${pathname}`);
  
  // בדיקת rate limiting
  const rateLimitResult = await rateLimit(request);
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Too many requests', retryAfter: rateLimitResult.retryAfter },
      { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter.toString() } }
    );
  }
  
  // דילוג על אימות עבור נתיבים פומביים
  if (PUBLIC_PATHS.some(path => pathname.startsWith(path))) {
    return NextResponse.next();
  }
  
  // הגנה על כל נתיבי ה-API
  if (pathname.startsWith('/api/')) {
    // ניסיון אימות דרך SIWE
    const siweToken = request.headers.get('authorization')?.replace('Bearer ', '');
    if (siweToken) {
      const siweVerified = await verifySIWE(siweToken);
      if (siweVerified) {
        const response = NextResponse.next();
        response.headers.set('x-auth-method', 'SIWE');
        return response;
      }
    }
    
    // ניסיון אימות דרך JWT
    const jwtToken = request.cookies.get('auth-token')?.value;
    if (jwtToken) {
      const jwtVerified = await verifyJWT(jwtToken);
      if (jwtVerified) {
        const response = NextResponse.next();
        response.headers.set('x-auth-method', 'JWT');
        return response;
      }
    }
    
    // אם אין אימות תקף
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};