import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';

// רשימת IP פנימיות מורשות (hardcoded)
const INTERNAL_IPS = new Set([
  '10.0.0.1',
  '10.0.0.2',
  '192.168.1.1',
  '172.16.0.1',
]);

// פונקציה לאימות IP מקור
function isInternalIp(ip: string): boolean {
  return INTERNAL_IPS.has(ip);
}

// מנגנון token bucket עם קצבים שונים
const tokenBuckets = new Map<string, {
  tokens: number;
  lastRefill: number;
  rate: number;
  capacity: number;
}>();

// הגדרות rate limit לפי סוג משתמש
const RATE_LIMITS = {
  internal: {
    rate: 100, // בקשות לשנייה
    capacity: 200,
  },
  public: {
    rate: 5, // בקשות לשנייה
    capacity: 10,
  },
};

// פונקציה לניהול token bucket
function refillBucket(ip: string, rate: number, capacity: number) {
  const now = Date.now();
  const bucket = tokenBuckets.get(ip);
  
  if (!bucket) {
    tokenBuckets.set(ip, {
      tokens: capacity,
      lastRefill: now,
      rate,
      capacity,
    });
    return true;
  }
  
  const timePassed = (now - bucket.lastRefill) / 1000; // בשניות
  const tokensToAdd = timePassed * rate;
  
  bucket.tokens = Math.min(bucket.capacity, bucket.tokens + tokensToAdd);
  bucket.lastRefill = now;
  
  return true;
}

// פונקציה לבדיקת rate limit
function checkRateLimit(ip: string, isInternal: boolean): boolean {
  const { rate, capacity } = isInternal ? RATE_LIMITS.internal : RATE_LIMITS.public;
  refillBucket(ip, rate, capacity);
  
  const bucket = tokenBuckets.get(ip);
  if (!bucket || bucket.tokens < 1) {
    return false;
  }
  
  bucket.tokens -= 1;
  return true;
}

// פונקציה לזיהוי IP אמיתי מ-X-Forwarded-For
function getRealIp(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  
  // אם יש X-Real-IP, נשתמש בו
  if (realIp) {
    return realIp;
  }
  
  // אחרת, נחלץ את ה-IP הראשון מ-X-Forwarded-For
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }
  
  // אחרונה - נשתמש ב-IP של הפרוקסי/לוד באלנסר
  return request.ip || 'unknown';
}

// פונקציה לרישום ניסיונות חשודים
function logSuspiciousAttempt(ip: string, headers: Headers) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    ip,
    headers: Object.fromEntries(headers.entries()),
    message: 'Suspicious X-Forwarded-For attempt detected',
  };
  
  // כאן ניתן לשלוח למערכת התראות
  console.error('Rate Limit Alert:', logEntry);
  
  // במערכת ממשית, כאן יהיה שילוח למערכת התראות (Slack, Email, וכו')
}

// מידלוור ליישום ה-rate limit
export async function rateLimitMiddleware(request: NextRequest): Promise<NextResponse | null> {
  // קבלת ה-IP האמיתי
  const ip = getRealIp(request);
  const isInternal = isInternalIp(ip);
  
  // בדיקת rate limit
  if (!checkRateLimit(ip, isInternal)) {
    // רישום ניסיון חשוד אם זה לא IP פנימי
    if (!isInternal) {
      logSuspiciousAttempt(ip, request.headers);
    }
    
    return new NextResponse(
      JSON.stringify({ error: 'Rate limit exceeded', isInternal }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    );
  }
  
  // המשך לטיפול הבא במעלה שרשרת המידלוור
  return null;
}

// פונקציית עזר ליישום ב-API routes
export function applyRateLimit(request: NextRequest): NextResponse | null {
  return rateLimitMiddleware(request);
}

// פונקציית עזר ליישום במידלוורים גלובליים
export function applyGlobalRateLimit(request: NextRequest): NextResponse | null {
  return rateLimitMiddleware(request);
}

// ייצוא הפונקציות לשימוש בכל ה-API
export { applyRateLimit, applyGlobalRateLimit };
