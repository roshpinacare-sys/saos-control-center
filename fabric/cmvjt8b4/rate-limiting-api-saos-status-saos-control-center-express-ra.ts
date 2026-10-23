import { NextRequest, NextResponse } from 'next/server';
import rateLimit from 'express-rate-limit';

// ייצור גבול rate limiting ל-endpoint /api/saos/status
const statusRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 דקה
  max: 60, // 60 בקשות לדקה
  standardHeaders: true,
  legacyHeaders: false,
  handler: (request: NextRequest, response: NextResponse) => {
    // חישוב זמן האיפוס הבא
    const resetTime = new Date(Date.now() + 60 * 1000);
    
    return NextResponse.json(
      { 
        error: 'Too many requests', 
        message: 'Rate limit exceeded. Try again later.' 
      }, 
      { 
        status: 429,
        headers: {
          'X-RateLimit-Limit': '60',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': Math.floor(resetTime.getTime() / 1000).toString(),
          'Retry-After': '60',
        }
      }
    );
  },
  keyGenerator: (request: NextRequest) => {
    // יצירת מפתח ייחודי לכל זהות (IP, משתמש מאומת או API key)
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0] : request.ip || 'unknown';
    
    // אם יש טוקן אימות, השתמש בו כמפתח
    const authHeader = request.headers.get('authorization');
    if (authHeader) {
      return `${authHeader}-${ip}`;
    }
    
    return ip;
  },
});

export async function GET(request: NextRequest) {
  // בדיקת rate limiting לפני ביצוע הלוגיקה
  const rateLimitResponse = await statusRateLimit(request);
  
  // אם הבדיקה חזרה עם תשובת 429, החזר אותה
  if (rateLimitResponse.status === 429) {
    return rateLimitResponse;
  }
  
  // לוגיקה קיימת של ה-endpoint
  try {
    // כאן יהיה הקוד הקיים של ה-endpoint
    // לדוגמה:
    const statusData = {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString(),
    };
    
    return NextResponse.json(statusData);
  } catch (error) {
    console.error('Error in /api/saos/status:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
