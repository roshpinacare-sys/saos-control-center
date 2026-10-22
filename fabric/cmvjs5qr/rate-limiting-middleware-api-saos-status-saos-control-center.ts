import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';

export async function GET(request: Request) {
  // הגדרת rate limiting: 60 בקשות לדקה לכל זהות
  const limiter = rateLimit({
    interval: 60 * 1000, // 60 שניות
    uniqueTokenPerInterval: 60, // מגבלת 60 בקשות
  });

  try {
    // הפעלת ה-limit
    await limiter.check(1, 'api-saos-status');

    // קבלת הפרמטרים מהבקשה
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address');
    const chain = searchParams.get('chain');

    // כאן יהיה הלוגיקה הראשית של ה-endpoint
    // לדוגמה, שאילתת נתונים ממסד הנתונים או קריאה לשירות חיצוני
    const statusData = {
      address,
      chain,
      timestamp: new Date().toISOString(),
      status: 'operational',
      // ... נתוני סטטוס נוספים
    };

    // יצירת התגובה עם כותרות rate limiting
    const response = NextResponse.json(statusData, {
      status: 200,
      headers: {
        'X-RateLimit-Limit': '60',
        'X-RateLimit-Remaining': limiter.remaining.toString(),
      },
    });

    return response;
  } catch (error) {
    // טיפול בחריגה כאשר חוצים את גבול ה-rate limiting
    if (error instanceof Error && error.message.includes('Rate limit exceeded')) {
      const response = NextResponse.json(
        { error: 'Too Many Requests', message: 'Rate limit exceeded' },
        { status: 429 }
      );
      
      response.headers.set('X-RateLimit-Limit', '60');
      response.headers.set('X-RateLimit-Remaining', '0');
      
      return response;
    }
    
    // טיפול בשגיאות אחרות
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}

// הגנה נגד DoS/הצפה - פונקציית עזר לאימות קלט
function validateInput(address?: string, chain?: string): boolean {
  if (!address || !chain) return false;
  
  // בדיקות נוספות לפי צורך
  // לדוגמה: אורך מינימלי, פורמט נכון של address וכו'
  if (address.length < 10 || chain.length < 3) return false;
  
  return true;
}