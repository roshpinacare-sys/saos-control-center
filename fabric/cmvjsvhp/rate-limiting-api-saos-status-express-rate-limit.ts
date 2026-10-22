import { NextRequest, NextResponse } from 'next/server';
import rateLimit from 'express-rate-limit';

// יצירת middleware של rate limiting
const rateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 דקה
  max: 60, // מקסימום 60 בקשות לדקה לכל IP
  standardHeaders: true,
  legacyHeaders: false,
  handler: (request: NextRequest, response: NextResponse) => {
    return NextResponse.json(
      { error: 'Too many requests, please try again later.' },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  },
  skip: (request) => {
    // דילוג על rate limiting לבקשות מקומיות בפיתוח
    return process.env.NODE_ENV === 'development' && request.ip === '::1';
  },
});

// הפונקציה המקורית של ה-route
async function getStatusHandler(request: NextRequest) {
  // כאן יהיה הלוגיקה המקורית של ה-route
  // לדוגמה:
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'saos-status',
  });
}

// הוספת ה-rate limiting ל-route
export async function GET(request: NextRequest) {
  // הפעלת ה-rate limiter
  const response = await rateLimiter(request, {} as any);
  
  // אם הבקשה נחסמה על ידי ה-rate limiter
  if (response.status === 429) {
    return response;
  }
  
  // אחרת, הפעלת ה-handler המקורי
  return getStatusHandler(request);
}

// Unit tests ל-rate limiting
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest, NextResponse } from 'next/server';

jest.mock('express-rate-limit');
const mockedRateLimit = jest.mocked(rateLimit);

// טסט לבדיקת הפעולה הרגילה של ה-route
describe('/api/saos/status rate limiting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRateLimit.mockImplementation((options) => {
      return (req: NextRequest, res: any, next: Function) => {
        // סימולציה של ה-rate limiter
        if (req.headers.get('x-test-limit') === 'exceeded') {
          return options.handler(req, NextResponse.json({}, { status: 429 }));
        }
        next();
      };
    });
  });

  it('should return 200 status when within rate limit', async () => {
    const request = new NextRequest('http://localhost:3000/api/saos/status', {
      headers: {
        'x-test-limit': 'within',
      },
    });
    
    const response = await GET(request);
    expect(response.status).toBe(200);
  });

  it('should return 429 status when rate limit is exceeded', async () => {
    const request = new NextRequest('http://localhost:3000/api/saos/status', {
      headers: {
        'x-test-limit': 'exceeded',
      },
    });
    
    const response = await GET(request);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'Too many requests, please try again later.' });
  });

  it('should include Retry-After header when rate limit is exceeded', async () => {
    const request = new NextRequest('http://localhost:3000/api/saos/status', {
      headers: {
        'x-test-limit': 'exceeded',
      },
    });
    
    const response = await GET(request);
    expect(response.headers.get('retry-after')).toBe('60');
  });

  it('should skip rate limiting in development for localhost', async () => {
    process.env.NODE_ENV = 'development';
    
    const request = new NextRequest('http://localhost:3000/api/saos/status', {
      headers: {
        'x-forwarded-for': '::1',
      },
    });
    
    const response = await GET(request);
    expect(response.status).toBe(200);
    
    // שינוי חזרה לסביבת הבדיקה
    process.env.NODE_ENV = 'test';
  });
});
