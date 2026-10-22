import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';

export async function GET(request: Request) {
  // יישום rate limiting עם 60 בקשות לדקה לכל זהות
  const limiter = rateLimit({
    interval: 60 * 1000, // 60 שניות
    uniqueTokenPerRequest: true,
  });

  try {
    // בדיקת rate limit
    await limiter.check(request, 60);
    
    // אם הקצב לא עולה על המגבלה, ממשיכים עם הלוגיקה הקיימת
    // כאן יהיה הקוד הקיים של ה-endpoint
    
    // לדוגמה: החזרת נתוני הסטטוס
    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      message: 'SAOS status endpoint with rate limiting',
    });
  } catch (error) {
    // אם הקצב עולה על המגבלה, החזרת תגובה עם קוד 429
    return new NextResponse(
      JSON.stringify({
        error: 'Too Many Requests',
        message: 'Rate limit exceeded. Please try again later.',
      }),
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': '60',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': Math.floor(Date.now() / 1000 + 60).toString(),
          'Content-Type': 'application/json',
        },
      }
    );
  }
}