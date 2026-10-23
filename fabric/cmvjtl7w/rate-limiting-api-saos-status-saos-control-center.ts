import { NextResponse } from 'next/server';
import { rateLimit } from 'express-rate-limit';

// יצירת middleware של rate limiting
const rateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 דקה
  max: 60, // 60 בקשות לדקה לכל זהות
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (request) => {
    // זיהוי זהות לפי IP, משתמש מאומת או API key
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0] : request.ip;
    
    // בדיקה אם יש משתמש מאומת (משתנה מסוג הזהות)
    const authHeader = request.headers.get('authorization');
    if (authHeader) {
      // בדיקה אם זה API key
      if (authHeader.startsWith('ApiKey ')) {
        return `api-key:${authHeader.substring(7)}`;
      }
      // אחרת נחשב כמשתמש מאומת
      return `user:${authHeader}`;
    }
    
    // אם לא נמצאה זהות, נשתמש ב-IP
    return `ip:${ip}`;
  },
  handler: (request) => {
    return NextResponse.json(
      { error: 'Too many requests, please try again later.' },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  },
});

// יישום ה-rate limiting על ה-route
export async function GET(request: Request) {
  // ביצוע בדיקת rate limiting
  await rateLimiter(request, {} as any, () => {});
  
  // אם עבר את הבדיקה, ממשיכים ללוגיקה הרגילה של ה-route
  return NextResponse.json({ status: 'ok', timestamp: new Date().toISOString() });
}