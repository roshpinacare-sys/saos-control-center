import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';

// תצורה מרכזית ל-rate limiting עבור /api/saos/status
const rateLimitConfig = {
  // הגבלת burst: 5 בקשות ב-15 שניות
  burst: 5,
  window: 15,
  // הגבלה יציבה: 20 בקשות לדקה
  steady: 20,
  windowSteady: 60,
};

export async function GET(request: Request) {
  // יישום middleware rate limiting
  const result = await rateLimit(request, rateLimitConfig);
  
  // אם הבקשת עלתה על הגבלת ה-rate limiting
  if (!result.success) {
    return new NextResponse(
      JSON.stringify({ 
        error: 'Too Many Requests', 
        message: 'Rate limit exceeded. Please try again later.' 
      }),
      { 
        status: 429,
        headers: {
          'X-RateLimit-Limit': result.limit.toString(),
          'X-RateLimit-Remaining': result.remaining.toString(),
          'X-RateLimit-Reset': result.reset.toString(),
          'Retry-After': Math.ceil(result.reset - Date.now() / 1000).toString(),
          'Content-Type': 'application/json',
        }
      }
    );
  }

  // אם הבקשה עברה את ה-rate limiting, המשך עם הלוגיקה הרגילה
  try {
    // כאן יהיה הלוגיקה הקיימת של ה-endpoint
    // לדוגמה:
    const statusData = {
      status: 'operational',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    };

    return NextResponse.json(statusData, {
      headers: {
        'X-RateLimit-Limit': result.limit.toString(),
        'X-RateLimit-Remaining': result.remaining.toString(),
        'X-RateLimit-Reset': result.reset.toString(),
      }
    });
  } catch (error) {
    console.error('Error in /api/saos/status:', error);
    return new NextResponse(
      JSON.stringify({ error: 'Internal Server Error' }),
      { status: 500 }
    );
  }
}

// תיעוד ההגנה
/**
 * Rate Limiting Protection for /api/saos/status
 * 
 * ה-endpoint מוגן במנגנון rate limiting מרכזי שמופעל דרך src/lib/rate-limit.ts
 * 
 * תצורה:
 * - Burst limit: 5 בקשות ב-15 שניות (מאפשר תגובה מהירה לשינויים)
 * - Steady limit: 20 בקשות לדקה (מגביל עומס כללי)
 * 
 * Headers סטנדרטיים:
 * - X-RateLimit-Limit: מספר הבקשות המותרות בחלון הזמן הנוכחי
 * - X-RateLimit-Remaining: מספר הבקשות הנותרות בחלון הזמן הנוכחי
 * - X-RateLimit-Reset: זמן UNIX שבו חלון הזמן יאפס
 * - Retry-After: מופיע רק עם status 429, מציין כמה שניות לחכות לפני הבקשה הבאה
 * 
 * התנהגות:
 * - בקשות העולות על הגבלות ה-rate limiting יחזרו עם status 429
 * - ה-header Retry-After יוסיף המתנה מתאימה כדי למנוע ניסיונות מיידיים חוזרים
 * - הגנה זו מונעת עומס מיותר על השרת ומתקיפות DoS
 */