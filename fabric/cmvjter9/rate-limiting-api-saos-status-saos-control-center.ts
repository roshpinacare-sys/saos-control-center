import { NextRequest, NextResponse } from 'next/server';
import rateLimit from 'express-rate-limit';

// יצירת middleware של rate limiting עם הגדרות מותאמות
const createRateLimitMiddleware = () => {
  return rateLimit({
    windowMs: 60 * 1000, // 1 דקה
    max: 60, // 60 בקשות לחלון זמן
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: NextRequest) => {
      // ניסיון למצוא API key מה-header
      const apiKey = req.headers.get('x-api-key');
      
      // אם יש API key, השתמש בו כמפתח
      if (apiKey) {
        return `api-key:${apiKey}`;
      }
      
      // אחרת, השתמש ב-IP
      const ip = req.ip || req.headers.get('x-forwarded-for') || 'unknown-ip';
      return `ip:${ip}`;
    },
    handler: (req: NextRequest, res: NextResponse) => {
      // חישוב הערכים ל-header
      const remaining = Math.max(0, 60 - res.get('X-RateLimit-Remaining') || 0);
      
      // החזרת תגובה עם קוד 429 ו-header מתאימים
      return NextResponse.json(
        { error: 'Too many requests, please try again later.' },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': '60',
            'X-RateLimit-Remaining': remaining.toString(),
            'Retry-After': '60',
          },
        }
      );
    },
  });
};

// יישום ה-rate limiting על ה-route הספציפי
export async function GET(request: NextRequest) {
  // יצירת ה-rate limit middleware
  const rateLimitMiddleware = createRateLimitMiddleware();
  
  // הפעלת ה middleware
  const response = await rateLimitMiddleware(request, {} as any);
  
  // אם קיבלנו תגובת 429, החזר אותה
  if (response.status === 429) {
    return response;
  }
  
  // אם הבקשה מותרת, המשך ללוגיקה של ה-route
  try {
    // כאן יהיה הלוגיקה המקורית של ה-route /api/saos/status
    // לדוגמה:
    const statusData = {
      status: 'operational',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    };
    
    return NextResponse.json(statusData);
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
