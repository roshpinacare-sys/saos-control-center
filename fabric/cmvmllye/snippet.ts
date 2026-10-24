import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';

// ניטור זמן ממוצע וכמות בקשות
const requestMetrics = {
  avgWaitTime: 0,
  totalRequests: 0,
  activeRequests: 0,
  highLoadThreshold: 1000, // 1000 בקשות/שנייה
  lastResetTime: Date.now(),
};

// אסטרטגיות הגבלת קצב
const rateLimitStrategies = {
  normal: {
    requestsPerSecond: 100,
    burstLimit: 200,
  },
  highLoad: {
    requestsPerSecond: 50,
    burstLimit: 100,
  },
  critical: {
    requestsPerSecond: 20,
    burstLimit: 50,
  },
};

// זיהוי עומס גבוה
function isSystemUnderHighLoad(): boolean {
  const timeSinceLastReset = (Date.now() - requestMetrics.lastResetTime) / 1000;
  if (timeSinceLastReset < 1) return false; // לא מספיק זמן לניתוח
  
  const requestsPerSecond = requestMetrics.totalRequests / timeSinceLastReset;
  return requestsPerSecond > requestMetrics.highLoadThreshold;
}

// קביעת אסטרטגיה מתאימה
function getRateLimitStrategy() {
  if (isSystemUnderHighLoad()) {
    return rateLimitStrategies.critical;
  }
  
  // יכול להיות מורכב יותר - למשל בדיקת זיכרון זמין
  return rateLimitStrategies.normal;
}

// API לניהול הגבלות הקצב
export async function GET() {
  const strategy = getRateLimitStrategy();
  
  return NextResponse.json({
    status: 'ok',
    strategy: Object.keys(rateLimitStrategies).find(
      key => rateLimitStrategies[key] === strategy
    ),
    metrics: {
      avgWaitTime: requestMetrics.avgWaitTime,
      totalRequests: requestMetrics.totalRequests,
      activeRequests: requestMetrics.activeRequests,
      requestsPerSecond: requestMetrics.totalRequests / 
        ((Date.now() - requestMetrics.lastResetTime) / 1000),
    },
    limits: {
      requestsPerSecond: strategy.requestsPerSecond,
      burstLimit: strategy.burstLimit,
    },
  });
}

// מידלוור להגבלת קצב דינמי
export async function middleware(request: NextRequest) {
  const startTime = Date.now();
  requestMetrics.activeRequests++;
  
  try {
    const strategy = getRateLimitStrategy();
    
    // בדיקת הגבלות הקצב
    const { success, limit, remaining, reset } = await rateLimit(request, {
      interval: 1000, // שנייה
      max: strategy.requestsPerSecond,
    });
    
    if (!success) {
      // הגבלת בקשות בזמן עומס
      if (isSystemUnderHighLoad()) {
        const waitTime = Math.min(5000, requestMetrics.avgWaitTime * 2);
        return new NextResponse(
          JSON.stringify({
            error: 'System under high load',
            message: `Please wait ${Math.ceil(waitTime/1000)} seconds before retrying`,
            retryAfter: waitTime / 1000,
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'X-RateLimit-Limit': limit.toString(),
              'X-RateLimit-Remaining': remaining.toString(),
              'X-RateLimit-Reset': reset.toString(),
              'Retry-After': waitTime.toString(),
            },
          }
        );
      }
      
      // הגבלה רגילה
      return new NextResponse(
        JSON.stringify({
          error: 'Too Many Requests',
          message: 'Please try again later',
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': limit.toString(),
            'X-RateLimit-Remaining': remaining.toString(),
            'X-RateLimit-Reset': reset.toString(),
          },
        }
      );
    }
    
    const response = await NextResponse.next();
    
    // הוספת כותרות הגבלת קצב
    response.headers.set('X-RateLimit-Limit', limit.toString());
    response.headers.set('X-RateLimit-Remaining', remaining.toString());
    response.headers.set('X-RateLimit-Reset', reset.toString());
    
    return response;
  } finally {
    // עדכון מטריקות
    const waitTime = Date.now() - startTime;
    requestMetrics.totalRequests++;
    requestMetrics.activeRequests--;
    
    // חישוב זמן המתנה ממוצע
    requestMetrics.avgWaitTime = 
      (requestMetrics.avgWaitTime * (requestMetrics.totalRequests - 1) + waitTime) / 
      requestMetrics.totalRequests;
    
    // איפוס מטריקות כל שנייה
    if (Date.now() - requestMetrics.lastResetTime > 1000) {
      requestMetrics.totalRequests = 0;
      requestMetrics.lastResetTime = Date.now();
    }
  }
}

export const config = {
  matcher: '/api/:path*',
};