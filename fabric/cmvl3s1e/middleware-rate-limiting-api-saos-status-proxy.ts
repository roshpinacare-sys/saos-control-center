import { NextRequest, NextResponse } from 'next/server';
import rateLimit from 'express-rate-limit';
import { createHash } from 'crypto';

// רשימת ה-IPs המהימנים של ה-proxy המורשים
const TRUSTED_PROXIES = [
  '192.168.1.1', // דוגמה - יש להחליף ב-IP אמיתי של ה-proxy
  '203.0.113.1', // דוגמה - יש להחליף ב-IP אמיתי של ה-proxy
];

// פונקציית עזר להגדרת ה-middleware של rate limiting
const createRateLimitMiddleware = () => {
  return rateLimit({
    windowMs: 15 * 60 * 1000, // 15 דקות
    max: 100, // מספר הבקשות המקסימלי בחלון הזמן
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: NextRequest) => {
      // יצירת מפתח ייחודי לכל IP ונתיב
      const ip = getClientIP(req);
      const path = req.nextUrl.pathname;
      return createHash('md5').update(`${ip}${path}`).digest('hex');
    },
    handler: (req: NextRequest, res: NextResponse) => {
      // דיווח למערכת monitoring על ניסיות עומס
      const ip = getClientIP(req);
      console.error(`Rate limit exceeded for IP: ${ip}`);
      
      // החזרת תגובת שגיאה עם headers מתאימים
      return NextResponse.json(
        { error: 'Too many requests' },
        { 
          status: 429,
          headers: {
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': Math.floor(Date.now() / 1000 + 900).toString(),
            'Retry-After': '900',
          },
        }
      );
    },
    skip: (req: NextRequest) => {
      // דילוג על rate limiting עבור נתיבים פנימיים או פיתוח
      return process.env.NODE_ENV === 'development' || 
             req.nextUrl.pathname.startsWith('/api/internal');
    },
  });
};

// פונקצייה לקביעת ה-IP האמיתי של הלקוח
const getClientIP = (req: NextRequest): string => {
  const forwardedFor = req.headers.get('x-forwarded-for');
  
  if (forwardedFor) {
    // בדיקה אם ה-Forwarded-For מגיע מ-IP מהימן
    const ips = forwardedFor.split(',').map(ip => ip.trim());
    
    // ה-IP האמיתי הוא האחרון ברשימה (הכי קרוב לשרת)
    const clientIP = ips[ips.length - 1];
    
    // בדיקה אם ה-IP המקורי הוא מהימן
    if (TRUSTED_PROXIES.includes(ips[0])) {
      return clientIP;
    }
    
    // אם ה-Forwarded-For לא מגיע מ-IP מהימן, נחזור ל-IP ישיר
    return req.ip || 'unknown';
  }
  
  // אם אין Forwarded-For, נחזור ל-IP ישיר
  return req.ip || 'unknown';
};

// ייצור המידלוור
const rateLimitMiddleware = createRateLimitMiddleware();

// הגנה נוספת נגד זיוף IP
const validateIP = (req: NextRequest): boolean => {
  const ip = getClientIP(req);
  
  // בדיקה אם ה-IP המקורי הוא מהימן
  const realIP = req.headers.get('x-real-ip');
  if (realIP && !TRUSTED_PROXIES.includes(realIP)) {
    return false;
  }
  
  // בדיקת תבנית IP
  const ipRegex = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
  if (!ipRegex.test(ip)) {
    return false;
  }
  
  return true;
};

// פונקציית המידלוור לנתיב המדויק
export async function middleware(req: NextRequest) {
  // בדיקת נתיב מדויק
  if (req.nextUrl.pathname !== '/api/saos/status') {
    return NextResponse.next();
  }
  
  // בדיקת אימות IP
  if (!validateIP(req)) {
    return NextResponse.json(
      { error: 'Unauthorized IP address' },
      { status: 403 }
    );
  }
  
  // הפעלת ה-rate limiting
  return rateLimitMiddleware(req, NextResponse.next());
}

// הגדרת הנתיבים שעליהם יופעל המידלוור
export const config = {
  matcher: '/api/saos/status',
};