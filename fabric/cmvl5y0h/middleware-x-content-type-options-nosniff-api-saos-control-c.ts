import { NextResponse } from 'next/server';

export function middleware(request: Request) {
  // בדיקה אם ה-URL מתאים לנתיב /api/saos/status
  if (request.url.includes('/api/saos/status')) {
    // יצירת תגובה עם ה-header הנדרש
    const response = NextResponse.next();
    response.headers.set('X-Content-Type-Options', 'nosniff');
    return response;
  }
  
  // אם זה לא ה-endpoint הספציפי, המשך כרגיל
  return NextResponse.next();
}

// הגדרת ה-matchers כדי להגביל את ה-middleware רק ל-endpoint הספציפי
export const config = {
  matcher: '/api/saos/status',
};