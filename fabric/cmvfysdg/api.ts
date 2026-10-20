import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { isInternalRequest } from '@/lib/internal-request';

// רשימת IPs פנימיים מורשים (יש להתאים לרשת הפנימית האמיתית)
const INTERNAL_IPS = [
  '127.0.0.1',
  '::1',
  // הוסף כאן כתובות IP פנימיות נוספות
];

// פונקציית עזר לאימות IP מקור
function isTrustedIp(ip: string | null): boolean {
  if (!ip) return false;
  return INTERNAL_IPS.includes(ip);
}

// פונקציית עזר לזיהוי בקשות פנימיות/ציבוריות ללא תלות ב-X-Forwarded-For
function isInternalRequestNew(request: NextRequest): boolean {
  // בדיקת IP מקור ישיר (כאשר הבקשה מגיעה ישירות)
  const directIp = request.ip || request.headers.get('x-real-ip');
  if (isTrustedIp(directIp)) {
    return true;
  }
  
  // בדיקת רשתות פנימיות מכוסות (כאשר הבקשה עוברת דרך פרוקסי/טעון)
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const ips = forwardedFor.split(',').map(ip => ip.trim());
    // ה-IP האחרון ברשימה הוא המקור האמיתי
    const sourceIp = ips[ips.length - 1];
    return isTrustedIp(sourceIp);
  }
  
  // ברירת מחדל: נחשב כבקשה ציבורית אם לא זוהה כפנימי
  return false;
}

// פונקציית הגנה ל-API עם rate-limit משופר
export async function apiMiddleware(request: NextRequest): Promise<NextResponse> {
  // זיהוי סוג הבקשה
  const isInternal = isInternalRequestNew(request);
  
  // הגדרת מגבלות rate-limit לפי סוג בקשה
  const limit = isInternal ? 2000 : 240; // פנימי: 2000/דקה, ציבורי: 240/דקה
  const timeWindow = 60; // 60 שניות
  
  // יישום rate-limit
  const result = await rateLimit(request, {
    limit,
    timeWindow,
    key: isInternal ? 'internal_api' : 'public_api',
  });
  
  if (!result.success) {
    // ניתוח ניסיונות עקיפה
    const forwardedFor = request.headers.get('x-forwarded-for');
    if (forwardedFor && !isInternal) {
      // רישום ניסיון עקיפה פוטנציאלי
      console.warn(`Potential bypass attempt detected: IP ${request.ip} tried to spoof internal requests`);
      
      // ניתן להוסיף כאן התראה נוספת או פעולת מניעה
    }
    
    return new NextResponse(
      JSON.stringify({ error: 'Too many requests' }),
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': limit.toString(),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': result.reset.toString(),
          'Content-Type': 'application/json',
        },
      }
    );
  }
  
  // המשך בזרימה רגילה אם הבקשה מותרת
  return NextResponse.next();
}

// מתאם להחלת המידלוור על נתיבי API
export function applyApiMiddleware(handler: (req: NextRequest) => Promise<NextResponse>) {
  return async (req: NextRequest): Promise<NextResponse> => {
    // החלת הגנה על נתיבי API
    if (req.nextUrl.pathname.startsWith('/api/')) {
      const middlewareResponse = await apiMiddleware(req);
      if (middlewareResponse.status !== 200) {
        return middlewareResponse;
      }
    }
    
    // המשך לטיפול הרגיל
    return handler(req);
  };
}

// בדיקות יחידה
import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

describe('Internal Request Detection', () => {
  let mockRequest: Partial<NextRequest>;
  
  beforeEach(() => {
    mockRequest = {
      headers: new Headers(),
      ip: '192.168.1.100',
      nextUrl: { pathname: '/api/test' }
    };
  });
  
  it('should detect internal request from trusted IP', () => {
    mockRequest.ip = '127.0.0.1';
    expect(isInternalRequestNew(mockRequest as NextRequest)).toBe(true);
  });
  
  it('should detect internal request via x-real-ip header', () => {
    mockRequest.headers.set('x-real-ip', '127.0.0.1');
    expect(isInternalRequestNew(mockRequest as NextRequest)).toBe(true);
  });
  
  it('should detect internal request via trusted x-forwarded-for', () => {
    mockRequest.headers.set('x-forwarded-for', '10.0.0.1, 192.168.1.100');
    expect(isInternalRequestNew(mockRequest as NextRequest)).toBe(true);
  });
  
  it('should treat public request as non-internal', () => {
    mockRequest.ip = '8.8.8.8';
    expect(isInternalRequestNew(mockRequest as NextRequest)).toBe(false);
  });
  
  it('should detect potential bypass with spoofed x-forwarded-for', () => {
    mockRequest.ip = '8.8.8.8';
    mockRequest.headers.set('x-forwarded-for', '127.0.0.1, 8.8.8.8');
    const isInternal = isInternalRequestNew(mockRequest as NextRequest);
    expect(isInternal).toBe(false); // לא יוגדר כפנימי
    
    // בפועל, הלוגיקה של זיהוי ניסיון עקיפה תהיה בפונקציית apiMiddleware
  });
});

describe('Rate Limiting', () => {
  it('should apply internal rate limit for trusted requests', async () => {
    const mockRequest = {
      headers: new Headers(),
      ip: '127.0.0.1',
      nextUrl: { pathname: '/api/test' }
    } as NextRequest;
    
    const result = await rateLimit(mockRequest, {
      limit: 2000,
      timeWindow: 60,
      key: 'internal_api'
    });
    
    expect(result.success).toBe(true);
  });
  
  it('should apply public rate limit for untrusted requests', async () => {
    const mockRequest = {
      headers: new Headers(),
      ip: '8.8.8.8',
      nextUrl: { pathname: '/api/test' }
    } as NextRequest;
    
    const result = await rateLimit(mockRequest, {
      limit: 240,
      timeWindow: 60,
      key: 'public_api'
    });
    
    expect(result.success).toBe(true);
  });
});