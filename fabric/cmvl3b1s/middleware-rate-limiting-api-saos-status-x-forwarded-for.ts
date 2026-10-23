import { NextRequest, NextResponse } from 'next/server';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { createHash } from 'crypto';

type RateLimitConfig = {
  windowMs: number;
  maxBurst: number;
  maxSustained: number;
  keyGenerator?: (req: NextRequest) => string;
  trustedProxies?: string[];
  whitelistedIPs?: string[];
};

const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 60 * 1000, // 1 minute
  maxBurst: 100, // max requests in burst
  maxSustained: 30, // max requests sustained per minute
  trustedProxies: [
    '127.0.0.1',
    '::1',
    // Add your trusted proxy IPs here
  ],
  whitelistedIPs: [
    // Add whitelisted IPs here
  ],
};

const rateLimiters = {
  burst: new RateLimiterMemory({
    points: DEFAULT_CONFIG.maxBurst,
    duration: DEFAULT_CONFIG.windowMs / 1000,
  }),
  sustained: new RateLimiterMemory({
    points: DEFAULT_CONFIG.maxSustained,
    duration: DEFAULT_CONFIG.windowMs / 1000,
  }),
};

function getClientIP(req: NextRequest, trustedProxies: string[]): string {
  const xForwardedFor = req.headers.get('x-forwarded-for');
  const xRealIP = req.headers.get('x-real-ip');
  const xClusterClientIP = req.headers.get('x-cluster-client-ip');
  const cfConnectingIP = req.headers.get('cf-connecting-ip');
  
  // Check if the request is coming from a trusted proxy
  const isTrustedProxy = trustedProxies.some(proxy => {
    return req.ip?.startsWith(proxy);
  });

  if (isTrustedProxy) {
    // If behind a trusted proxy, use the right-most IP in the chain
    if (xForwardedFor) {
      const ips = xForwardedFor.split(',').map(ip => ip.trim());
      return ips[ips.length - 1];
    }
    if (xRealIP) return xRealIP;
    if (xClusterClientIP) return xClusterClientIP;
    if (cfConnectingIP) return cfConnectingIP;
  }

  // Fallback to direct IP
  return req.ip || 'unknown';
}

function generateUserKey(userId: string | null): string {
  if (!userId) return 'anonymous';
  return `user_${createHash('sha256').update(userId).digest('hex')}`;
}

export function createRateLimitMiddleware(config: Partial<RateLimitConfig> = {}) {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  return async (req: NextRequest): Promise<NextResponse | null> => {
    // Check if the path matches
    if (!req.nextUrl.pathname.startsWith('/api/saos/status')) {
      return null;
    }

    // Get client IP
    const clientIP = getClientIP(req, finalConfig.trustedProxies || []);
    
    // Check if IP is whitelisted
    if (finalConfig.whitelistedIPs?.includes(clientIP)) {
      return null;
    }

    // Generate keys for rate limiting
    const userKey = generateUserKey(req.headers.get('x-user-id'));
    const ipKey = `ip_${clientIP}`;
    
    try {
      // Check both burst and sustained limits
      await Promise.all([
        rateLimiters.burst.consume(ipKey),
        rateLimiters.sustained.consume(ipKey),
        rateLimiters.burst.consume(userKey),
        rateLimiters.sustained.consume(userKey),
      ]);

      // If we get here, the request is allowed
      const response = NextResponse.next();
      
      // Add rate limit headers
      const remainingBurst = rateLimiters.burst.getRemainingPoints(ipKey);
      const remainingSustained = rateLimiters.sustained.getRemainingPoints(ipKey);
      const resetTime = Math.floor(Date.now() / 1000) + Math.floor(finalConfig.windowMs / 1000);
      
      response.headers.set('X-RateLimit-Limit', finalConfig.maxBurst.toString());
      response.headers.set('X-RateLimit-Remaining', Math.min(remainingBurst, remainingSustained).toString());
      response.headers.set('X-RateLimit-Reset', resetTime.toString());
      
      return response;
    } catch (rateLimiterRes) {
      // Request is rate limited
      const response = new NextResponse(
        JSON.stringify({
          error: 'Too many requests',
          message: 'Rate limit exceeded. Please try again later.',
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
      
      // Add rate limit headers
      const resetTime = Math.floor(Date.now() / 1000) + Math.floor(finalConfig.windowMs / 1000);
      
      response.headers.set('X-RateLimit-Limit', finalConfig.maxBurst.toString());
      response.headers.set('X-RateLimit-Remaining', '0');
      response.headers.set('X-RateLimit-Reset', resetTime.toString());
      response.headers.set('Retry-After', Math.ceil(finalConfig.windowMs / 1000).toString());
      
      // Log the rate-limited request
      console.warn(`[Rate Limit] Blocked request from IP: ${clientIP}, User: ${userKey}, Path: ${req.nextUrl.pathname}`);
      
      return response;
    }
  };
}

// Example usage in middleware.ts or route handler
// export const config = {
//   matcher: '/api/saos/status/:path*',
// };

// export default createRateLimitMiddleware({
//   windowMs: 60 * 1000, // 1 minute
//   maxBurst: 100,
//   maxSustained: 30,
//   trustedProxies: ['127.0.0.1', '::1'],
//   whitelistedIPs: ['192.168.1.1'],
// });
