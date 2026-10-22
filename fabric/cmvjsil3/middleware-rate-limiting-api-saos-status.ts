import { NextRequest, NextResponse } from 'next/server';
import rateLimit from 'express-rate-limit';

// Middleware עצמאי ל-rate limiting על /api/saos/status
const createRateLimitMiddleware = () => {
  // יצירת instance של express-rate-limit
  const apiRateLimit = rateLimit({
    windowMs: 60 * 1000, // 1 דקה (במילישניות)
    max: 60, // מספר הבקשות המירבי לחלון הזמן
    standardHeaders: true, // שימוש ב-headers סטנדרטיים (X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset)
    legacyHeaders: false, // ביטול headers ישנים (X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset)
    handler: (request: NextRequest, response: NextResponse) => {
      // החזרת תגובה עם קוד 429 כאשר חורגים מהמגבלה
      return NextResponse.json(
        { 
          error: 'Too Many Requests', 
          message: 'Rate limit exceeded. Please try again later.' 
        },
        { 
          status: 429,
          headers: {
            'Retry-After': '60', // מומלץ לציין מתי ניתן לנסות שוב
            'Content-Type': 'application/json',
          }
        }
      );
    },
    keyGenerator: (request: NextRequest) => {
      // יצירת מפתח ייחודי לכל זהות (IP או מזהה משתמש)
      // במקרה זה, נשתמש ב-IP כמפתח
      return request.ip || request.headers.get('x-forwarded-for') || 'unknown';
    },
  });

  // פונקציית ה-wrapper שמתאימה את ה-middleware ל-Next.js
  return async (request: NextRequest) => {
    // יצירת אובייקט תגובה ריק להעברה ל-rate limit
    const response = new NextResponse();
    
    // הפעלת ה-rate limit
    await apiRateLimit(request, response);
    
    // אם הגענו לכאן, ה-rate limit התיר את הבקשה
    // ממשיכים לפונקציה המקורית של ה-route
    return response;
  };
};

// ייצוא ה-middleware לשימוש
export const config = {
  matcher: '/api/saos/status', // הגדרת ה-path שעליו יופעל ה-middleware
};

// ייצור ה-middleware
const rateLimitMiddleware = createRateLimitMiddleware();

// ייצוג ה-middleware לשימוש בקובץ route
export default rateLimitMiddleware;
