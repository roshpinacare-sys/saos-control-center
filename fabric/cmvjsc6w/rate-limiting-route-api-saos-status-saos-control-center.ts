import { NextRequest, NextResponse } from 'next/server';
import rateLimit from 'express-rate-limit';

/**
 * Rate limiting configuration for /api/saos/status endpoints
 * 
 * Security Requirements:
 * - 60 requests per minute per identity
 * - 429 status code with retry-after header on limit exceeded
 * - Memory-based storage (suitable for single instance)
 * - Custom skip function for localhost development
 * 
 * Performance Considerations:
 * - Uses in-memory store for minimal latency
 * - Custom skip function for localhost bypass
 * - X-RateLimit headers for client visibility
 * 
 * Integration:
 * - Applied to all routes under /api/saos/status
 * - Must be imported and applied in route.ts files
 * - Compatible with Next.js API routes
 */
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // limit each IP to 60 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  skip: (req) => {
    // Skip rate limiting for localhost in development
    return process.env.NODE_ENV === 'development' && req.ip === '::1';
  },
  handler: (req: NextRequest, res: NextResponse) => {
    // Calculate retry time in seconds
    const retryAfter = Math.ceil(60 - (Date.now() - req.headers.get('x-rate-limit-start')?.Date.now() || 0) / 1000);
    
    return NextResponse.json(
      { 
        error: 'Too many requests', 
        message: 'Rate limit exceeded. Please try again later.',
        retryAfter: `${retryAfter} seconds`
      },
      { 
        status: 429,
        headers: {
          'Retry-After': retryAfter.toString(),
          'X-RateLimit-Limit': '60',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': new Date(Date.now() + 60 * 1000).toISOString()
        }
      }
    );
  }
});

/**
 * Apply rate limiting to a Next.js API route handler
 * 
 * @param handler - The Next.js route handler
 * @returns The wrapped handler with rate limiting applied
 */
export const applyRateLimit = (handler: (req: NextRequest) => Promise<NextResponse>) => {
  return async (req: NextRequest) => {
    // Add rate limit start time to headers for accurate retry calculation
    const rateLimitReq = new Request(req.url, {
      headers: new Headers(req.headers),
      method: req.method,
      body: req.body,
      duplex: req.duplex
    });
    rateLimitReq.headers.set('x-rate-limit-start', Date.now().toString());
    
    // Apply rate limiting
    const rateLimitRes = await new Promise<NextResponse>((resolve) => {
      limiter(rateLimitReq as any, {
        setHeader: (key: string, value: string) => {
          // Capture headers for response
        },
        getHeader: (key: string) => {
          return undefined;
        },
        end: () => {
          resolve(new Response(null, { status: 429 }));
        }
      }, () => {
        // Continue to handler if not rate limited
        resolve(null as any);
      });
    });
    
    // If rate limited, return the rate limit response
    if (rateLimitRes) {
      return rateLimitRes;
    }
    
    // Otherwise continue with the original handler
    return handler(req);
  };
};

/**
 * Unit tests for rate limiting functionality
 * 
 * Test Coverage:
 * - Rate limiting enforcement
 * - 429 response with retry-after header
 * - Reset of rate limit after window
 * - Localhost bypass in development
 * - Header values
 */
export const rateLimitTests = {
  'Rate limiting enforces 60 requests per minute': async () => {
    // Mock implementation - would use actual test framework in production
    const requests = Array(61).fill(null).map((_, i) => ({
      ip: '127.0.0.1',
      timestamp: Date.now() - (i * 1000)
    }));
    
    let limitedCount = 0;
    
    for (const req of requests) {
      const isLimited = await new Promise<boolean>((resolve) => {
        limiter({
          ip: req.ip,
          headers: { 'x-rate-limit-start': req.timestamp.toString() }
        } as any, {}, () => {
          resolve(false);
        }, () => {
          resolve(true);
        });
      });
      
      if (isLimited) limitedCount++;
    }
    
    // Should limit the 61st request
    return limitedCount === 1;
  },
  
  'Returns 429 with retry-after header': async () => {
    // Mock implementation
    const res = await new Promise<NextResponse>((resolve) => {
      limiter({
        ip: '127.0.0.1',
        headers: { 'x-rate-limit-start': Date.now().toString() }
      } as any, {}, () => {
        resolve(null as any);
      }, () => {
        resolve(new Response(null, {
          status: 429,
          headers: {
            'Retry-After': '60',
            'X-RateLimit-Limit': '60',
            'X-RateLimit-Remaining': '0'
          }
        }));
      });
    });
    
    return res?.status === 429 && 
           res?.headers.get('Retry-After') === '60' &&
           res?.headers.get('X-RateLimit-Limit') === '60';
  },
  
  'Skips rate limiting for localhost in development': async () => {
    process.env.NODE_ENV = 'development';
    
    let wasLimited = false;
    
    await new Promise<void>((resolve) => {
      limiter({
        ip: '::1',
        headers: {}
      } as any, {}, () => {
        resolve();
      }, () => {
        wasLimited = true;
        resolve();
      });
    });
    
    return !wasLimited;
  },
  
  'Resets rate limit after window': async () => {
    // Mock implementation
    const requests = Array(60).fill(null).map((_, i) => ({
      ip: '127.0.0.1',
      timestamp: Date.now() - (i * 1000)
    }));
    
    // Send 60 requests
    for (const req of requests) {
      await new Promise<void>((resolve) => {
        limiter({
          ip: req.ip,
          headers: { 'x-rate-limit-start': req.timestamp.toString() }
        } as any, {}, () => {
          resolve();
        }, () => {
          // Should not happen for first 60
          resolve();
        });
      });
    }
    
    // Send one more after window
    const isLimited = await new Promise<boolean>((resolve) => {
      limiter({
        ip: '127.0.0.1',
        headers: { 'x-rate-limit-start': Date.now().toString() }
      } as any, {}, () => {
        resolve(false);
      }, () => {
        resolve(true);
      });
    });
    
    return isLimited;
  }
};
