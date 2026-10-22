import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';

export async function GET(request: NextRequest) {
  // הגדרות rate limiting: 60 בקשות לדקה לכל זהות
  const limiter = rateLimit({
    interval: 60 * 1000, // 1 דקה
    uniqueTokenPerInterval: 60,
  });

  try {
    // קבלת זהות המשתמש מה-IP או מהאימות (כאן נשתמש ב-IP כדוגמה)
    const identity = request.ip || 'anonymous';
    
    // בדיקת rate limit
    const result = await limiter.check(identity);

    // אם חריגה מגבלת הקצב
    if (!result.success) {
      return new NextResponse(
        JSON.stringify({ error: 'Rate limit exceeded' }),
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': result.limit.toString(),
            'X-RateLimit-Remaining': result.remaining.toString(),
            'X-RateLimit-Reset': Math.floor(result.reset / 1000).toString(),
            'Retry-After': Math.ceil((result.reset - Date.now()) / 1000).toString(),
          },
        }
      );
    }

    // אם הבקשה תקינה, המשך עם ה-headers של rate limit
    const response = NextResponse.json({ status: 'ok' });
    
    // הוספת headers תגובה סטנדרטיים עבור rate limiting
    response.headers.set('X-RateLimit-Limit', result.limit.toString());
    response.headers.set('X-RateLimit-Remaining', result.remaining.toString());
    response.headers.set('X-RateLimit-Reset', Math.floor(result.reset / 1000).toString());
    
    return response;
  } catch (error) {
    console.error('Rate limiting error:', error);
    return new NextResponse(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500 }
    );
  }
}
