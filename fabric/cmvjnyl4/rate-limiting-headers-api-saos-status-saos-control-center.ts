import { NextRequest, NextResponse } from 'next/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

// Initialize Redis client - uses existing KV/Redis in project
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Rate limiter: 60 requests per minute per identity
const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, '60 s'),
  analytics: true,
  prefix: 'saos:status:ratelimit',
});

// Health check IPs that should bypass rate limiting (internal services)
const HEALTH_CHECK_IPS = new Set([
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
  // Add internal load balancer / monitoring IPs here if needed
]);

function getIdentity(req: NextRequest): string {
  // Prefer authenticated user ID, fallback to IP
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : req.ip || 'unknown';
  return ip;
}

function isHealthCheck(req: NextRequest): boolean {
  const ip = getIdentity(req);
  const userAgent = req.headers.get('user-agent') || '';
  
  // Allow common health check user agents
  const isHealthCheckUA = /(health|check|monitor|probe|kube|ready|live)/i.test(userAgent);
  
  return HEALTH_CHECK_IPS.has(ip) || isHealthCheckUA;
}

export async function GET(req: NextRequest) {
  try {
    const identity = getIdentity(req);
    
    // Skip rate limiting for internal health checks
    if (isHealthCheck(req)) {
      return handleRequest(req);
    }

    const { success, limit, remaining, reset } = await ratelimit.limit(identity);

    const headers = new Headers();
    headers.set('X-RateLimit-Limit', limit.toString());
    headers.set('X-RateLimit-Remaining', remaining.toString());
    headers.set('X-RateLimit-Reset', Math.ceil(reset / 1000).toString()); // Unix seconds

    if (!success) {
      const retryAfter = Math.ceil((reset - Date.now()) / 1000);
      headers.set('Retry-After', Math.max(1, retryAfter).toString());
      
      return new NextResponse(JSON.stringify({ 
        error: 'Too Many Requests',
        message: 'Rate limit exceeded. Please try again later.'
      }), {
        status: 429,
        headers,
      });
    }

    const response = await handleRequest(req);
    
    // Add rate limit headers to successful response
    response.headers.set('X-RateLimit-Limit', limit.toString());
    response.headers.set('X-RateLimit-Remaining', remaining.toString());
    response.headers.set('X-RateLimit-Reset', Math.ceil(reset / 1000).toString());
    
    return response;
  } catch (error) {
    console.error('[saos/status] Rate limiter error:', error);
    // Fail open - don't block requests if rate limiter is down
    return handleRequest(req);
  }
}

async function handleRequest(req: NextRequest): Promise<NextResponse> {
  try {
    // Existing status logic - placeholder for actual implementation
    const session = await getServerSession(authOptions);
    
    const statusData = {
      status: 'operational',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.2.1',
      authenticated: !!session,
      // Add actual status checks here (DB, Redis, external services, etc.)
    };

    return NextResponse.json(statusData);
  } catch (error) {
    console.error('[saos/status] Error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to fetch status' },
      { status: 500 }
    );
  }
}