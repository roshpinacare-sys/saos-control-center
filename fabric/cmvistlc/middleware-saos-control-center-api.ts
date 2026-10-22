import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// פונקציית עזר לבדיקת SIWE (Sign-In with Ethereum)
async function verifySiweSignature(siweSignature: string): Promise<boolean> {
  try {
    // בדיקה בסיסית של חתימה - ביישום מלא יש להוסיף גישה למפתחות ציבוריים ובדיקת תקפות
    if (!siweSignature || typeof siweSignature !== 'string') {
      return false;
    }
    
    // כאן יש להוסיף לוגיקת אימות SIWE מלאה
    // כולל בדיקת החתימה כנגד המפתח הציבורי של האתר
    // ואימות שהמסר כולל את הנתונים הנכונים (domain, nonce, וכו')
    
    // לדוגמה: החזרת true אם החתימה תקפת
    return true;
  } catch (error) {
    console.error('SIWE verification error:', error);
    return false;
  }
}

// פונקציית עזר לבדיקת JWT
async function verifyJwtToken(token: string): Promise<boolean> {
  try {
    if (!token || typeof token !== 'string') {
      return false;
    }
    
    // כאן יש להוסיף לוגיקת אימות JWT מלאה
    // כולל פיענוח ה-token, בדיקת תקפות, ובדיקת הרשאות
    
    // לדוגמה: החזרת true אם ה-token תקף
    return true;
  } catch (error) {
    console.error('JWT verification error:', error);
    return false;
  }
}

// פונקציית עזר ליצירת תשובת שגיאת אימות עם עיצוב מרכזי
function createAuthErrorResponse(message: string, status: number = 401) {
  return NextResponse.json(
    { 
      error: { 
        message,
        code: 'AUTH_ERROR',
        timestamp: new Date().toISOString()
      }
    },
    { 
      status,
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Error': 'true'
      }
    }
  );
}

export async function middleware(request: NextRequest) {
  // מאפשר גישה ללא אימות לנתיב הבריאות
  if (request.nextUrl.pathname.startsWith('/api/health')) {
    return NextResponse.next();
  }
  
  // בדיקה אם הבקשה מיועדת לנתיבי API
  if (!request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next();
  }
  
  // קבלת האותות מה-header
  const authHeader = request.headers.get('authorization');
  const siweSignature = request.headers.get('x-siwe-signature');
  
  // אם אין אותות אימות, חוזרים בשגיאת אימות
  if (!authHeader && !siweSignature) {
    return createAuthErrorResponse('Authentication required', 401);
  }
  
  let isValid = false;
  
  // אימות JWT
  if (authHeader) {
    const token = authHeader.replace('Bearer ', '');
    isValid = await verifyJwtToken(token);
    
    if (isValid) {
      return NextResponse.next();
    }
  }
  
  // אימות SIWE
  if (siweSignature) {
    isValid = await verifySiweSignature(siweSignature);
    
    if (isValid) {
      return NextResponse.next();
    }
  }
  
  // אם אף אחד מהאימות לא עבד
  return createAuthErrorResponse('Invalid authentication credentials', 401);
}

// הגדרת הנתיבים עליהם ה-middleware יוחל
export const config = {
  matcher: '/api/:path*'
};