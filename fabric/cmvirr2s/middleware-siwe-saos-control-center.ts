import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from '@/components/sv/shared';
import { verifySIWE } from '@/lib/siwe';

// מידע על ה-middlewares
// ה-middlewares זמין עבור כל נתיבי ה-API פרט ל-/api/health
// ה-middlewares תומך בשני סוגי אימות:
// 1. JWT - טוקן סטנדרטי של NextAuth
// 2. SIWE - Sign-In with Ethereum - חתימת משתמש מפתח פרטי
//
// איך להתאים את ה-middlewares לנתיבי API חדשים:
// 1. כל נתיב חדש תחת /api/* יישאר מוגן על ידי ה-middlewares כברירת מחדל
// 2. אם נתיב חדש צריך להיות פתוח ללא אימות, יש להוסיף אותו לרשימת ה-exceptions
// 3. אם נתיב חדש צריך אימות מותאם אישית, יש ליצור middleware ספציפי לאותו נתיב

export async function middleware(request: NextRequest) {
  // נתיבים שאינם דורשים אימות
  const publicPaths = ['/api/health'];
  
  // בדיקה אם הנתיב הוא נתיב ציבורי
  if (publicPaths.includes(request.nextUrl.pathname)) {
    return NextResponse.next();
  }
  
  // קבלת הטוקן מה-header
  const token = getToken(request);
  
  // אם אין טוקן, דחה את הבקשה
  if (!token) {
    return NextResponse.json(
      { error: 'Unauthorized - Missing token' },
      { status: 401 }
    );
  }
  
  try {
    // אימות הטוקן
    // הפונקציה verifySIWE תאמת גם JWT וגם SIWE tokens
    const isValid = await verifySIWE(token);
    
    if (!isValid) {
      return NextResponse.json(
        { error: 'Unauthorized - Invalid token' },
        { status: 401 }
      );
    }
    
    // אם הטוקן תקף, המשך לבקשה הבאה
    return NextResponse.next();
  } catch (error) {
    console.error('Authentication error:', error);
    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 401 }
    );
  }
}

// הגדרת ה-middlewares להיות זמינים רק עבור נתיבי API
export const config = {
  matcher: '/api/:path*',
};