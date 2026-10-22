import { NextRequest, NextResponse } from 'next/server';
import rateLimit from 'express-rate-limit';

// ייצור middleware של rate limiting
const rateLimitingMiddleware = rateLimit({
  windowMs: 60 * 1000, // 1 דקה
  max: 60, // מגבלה של 60 בקשות לדקה
  standardHeaders: true, // החזרת headers סטנדרטיים
  legacyHeaders: false, // השבתת headers ישנים
  handler: (req: NextRequest, res: NextResponse) => {
    // החזרת תגובה 429 עם הודעה מתאימה כאשר נחצה תקרת ה-rate limit
    return NextResponse.json(
      { error: 'תקרת קצב בקשות חריגה. נסה שוב בעוד דקה.' },
      { 
        status: 429,
        headers: {
          'X-RateLimit-Limit': '60',
          'X-RateLimit-Remaining': '0',
          'Retry-After': '60'
        }
      }
    );
  },
  // פונקציה לקביעת המפתח הייחודי לכל לקוח (מבוסס IP)
  keyGenerator: (req: NextRequest) => {
    return req.ip || req.headers.get('x-forwarded-for') || 'unknown';
  }
});

// הפונקציה המקורית של ה-route
async function getStatusHandler(req: NextRequest): Promise<NextResponse> {
  try {
    // כאן יהיה הלוגיקה המקורית של ה-route
    // לדוגמה:
    // const status = await getSaosStatus();
    // return NextResponse.json(status);
    
    // דוגמה להחזרת נתונים מדומים
    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      message: 'SAOS status response'
    });
  } catch (error) {
    console.error('Error in /api/saos/status:', error);
    return NextResponse.json(
      { error: 'שגיאה בקבלת הסטטוס' },
      { status: 500 }
    );
  }
}

// ייצור ה-wrapper להחלת ה-rate limiting
export async function GET(req: NextRequest): Promise<NextResponse> {
  // החלת ה-rate limiting middleware
  const rateLimitResponse = await rateLimitingMiddleware(req, {} as any);
  
  // אם התגובה מה-rate limiting היא 429, החזר אותה
  if (rateLimitResponse.status === 429) {
    return rateLimitResponse;
  }
  
  // אחרת, הפעל את ה-handler המקורי
  return getStatusHandler(req);
}

// ניתן להוסיף גם עבור שיטות HTTP אחרות אם נדרש
export async function POST(req: NextRequest): Promise<NextResponse> {
  // החלת ה-rate limiting middleware
  const rateLimitResponse = await rateLimitingMiddleware(req, {} as any);
  
  // אם התגובה מה-rate limiting היא 429, החזר אותה
  if (rateLimitResponse.status === 429) {
    return rateLimitResponse;
  }
  
  // אחרת, הפעל את ה-handler המקורי
  return getStatusHandler(req);
}
