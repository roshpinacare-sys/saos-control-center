import { NextRequest, NextResponse } from 'next/server';
import rateLimit from 'express-rate-limit';

// יצירת middleware של rate limiting
const rateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 דקה
  max: 60, // מקסימום 60 בקשות לדקה לכל זהות
  standardHeaders: true, // שולח headers סטנדרטיים
  legacyHeaders: false, // מבטל את ה-headers הישנים
  keyGenerator: (req: NextRequest) => {
    // מזהה ייחודי למשתמש - IP, משתמש מאומת או API key
    const forwarded = req.headers.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0] : req.ip;
    
    // אם יש טוקן אימות, נשתמש בו כמזהה במקום ה-IP
    const authHeader = req.headers.get('authorization');
    if (authHeader) {
      return authHeader;
    }
    
    return ip || 'unknown';
  },
  handler: (req: NextRequest, res: NextResponse) => {
    // יצירת תגובה עם קוד 429 כאשר המכסה חורגת
    return NextResponse.json(
      { error: 'Too many requests, please try again later.' },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': '60',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': Math.floor(Date.now() / 1000 + 60).toString(),
          'Retry-After': '60',
        },
      }
    );
  },
});

// הפונקציה המייצגת את ה-middleware של rate limiting
export function withRateLimit(handler: (req: NextRequest, res: NextResponse) => Promise<NextResponse>) {
  return async (req: NextRequest, res: NextResponse) => {
    // הפעלת ה-rate limiter
    const rateLimitResponse = await new Promise<NextResponse | undefined>((resolve) => {
      rateLimiter(req, res as any, () => {
        resolve(undefined);
      });
    });
    
    // אם ה-rate limiter החזיר תגובה, מחזירים אותה
    if (rateLimitResponse) {
      return rateLimitResponse;
    }
    
    // אחרת ממשיכים ל-handler המקורי
    return handler(req, res);
  };
}

// הפונקציה המקורית של ה-route
async function getStatusHandler(req: NextRequest, res: NextResponse) {
  try {
    // כאן יהיה הלוגיקה המקורית של ה-route
    // לדוגמה:
    // const data = await getStatusFromDatabase();
    // return NextResponse.json(data);
    
    return NextResponse.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// הגדרת ה-route עם rate limiting
export async function GET(req: NextRequest, res: NextResponse) {
  return withRateLimit(getStatusHandler)(req, res);
}