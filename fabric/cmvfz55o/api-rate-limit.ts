import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';

type RequestContext = {
  isInternal: boolean;
  clientIp: string;
  userId?: string;
};

/**
 * זיהוי אמין של בקשות פנימיות למניעת עקיפת rate-limit
 * @param request - הבקשה הנכנסת
 * @returns אובייקט עם הקשר הבקשה
 */
export function getRequestContext(request: NextRequest): RequestContext {
  // כתובות IP של השרתים הפנימיים שלנו
  const INTERNAL_IPS = [
    '127.0.0.1', // localhost
    '::1',       // IPv6 localhost
    '10.0.0.0/8', // רשת פרטית RFC 1918
    '172.16.0.0/12', // רשת פרטית RFC 1918
    '192.168.0.0/16', // רשת פרטית RFC 1918
    'fc00::/7',  // IPv6 Unique Local Address
  ];

  // קבלת כתובת ה-IP האמיתית מהכותרות המסורתיות
  const forwardedFor = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  const connectingIp = request.headers.get('x-connecting-ip');
  
  // קבלת כתובת ה-IP של הלקוח
  let clientIp = forwardedFor?.split(',')[0]?.trim() || 
                 realIp?.trim() || 
                 connectingIp?.trim() || 
                 request.ip || 
                 'unknown';

  // בדיקה אם הבקשה הגיעה מכתובת פנימית
  const isInternal = INTERNAL_IPS.some(ipRange => {
    if (ipRange.includes('/')) {
      // טווחי רשת
      const [network, prefixLength] = ipRange.split('/');
      const mask = parseInt(prefixLength, 10);
      const ipInt = ipToLong(clientIp);
      const networkInt = ipToLong(network);
      const maskInt = (-1 << (32 - mask)) >>> 0;
      return (ipInt & maskInt) === (networkInt & maskInt);
    } else {
      // כתובת ספציפית
      return clientIp === ipRange;
    }
  });

  // קבלת מזהה המשתמש אם קיים
  const userId = request.headers.get('x-user-id') || undefined;

  return {
    isInternal,
    clientIp,
    userId
  };
}

/**
 * פונקציית עזר להמרת כתובת IP למספר שלם
 */
function ipToLong(ip: string): number {
  const octets = ip.split('.').map(Number);
  return (octets[0] << 24) + (octets[1] << 16) + (octets[2] << 8) + octets[3];
}

/**
 * מידלוור להגנה על API עם rate-limit מדויק
 * תומך בהפרדה בין בקשות פנימיות לציבוריות
 */
export async function apiRateLimit(request: NextRequest, handler: () => Promise<NextResponse>): Promise<NextResponse> {
  const context = getRequestContext(request);
  
  // קביעת מפתח ייחודי ל-rate-limit לפי סוג הבקשה
  const rateLimitKey = context.isInternal 
    ? `internal:${context.clientIp}`
    : `public:${context.clientIp}${context.userId ? `:${context.userId}` : ''}`;
  
  // הגדרת מגבלות שונות לבקשות פנימיות לעומת ציבוריות
  const limit = context.isInternal ? 100 : 10; // בקשות פנימיות יכולות להיות תדירות יותר
  const window = context.isInternal ? 60000 : 60000; // חלון זמן של דקה
  
  // ביצוע בדיקת rate-limit
  const rateLimitResult = await rateLimit(rateLimitKey, {
    limit,
    window,
  });
  
  if (rateLimitResult.success) {
    // הבקשה מותרת, המשך לטיפול
    return handler();
  }
  
  // חריגת rate-limit
  return NextResponse.json(
    { 
      error: 'Rate limit exceeded',
      limit,
      remaining: rateLimitResult.remaining,
      reset: new Date(rateLimitResult.reset).toISOString(),
      type: context.isInternal ? 'internal' : 'public'
    },
    { status: 429 }
  );
}

/**
 * ניתוב מיוחד לבקשות פנימיות שאינן כפופות ל-rate-limit
 * משמש לתקשורת בין שירותים פנימיים
 */
export function internalRouteHandler(handler: (request: NextRequest) => Promise<NextResponse>) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const context = getRequestContext(request);
    
    if (!context.isInternal) {
      return NextResponse.json(
        { error: 'Internal route access denied' },
        { status: 403 }
      );
    }
    
    return handler(request);
  };
}
