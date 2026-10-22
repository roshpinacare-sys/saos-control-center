import { NextRequest, NextResponse } from 'next/server';
import { rateLimiter } from '@/lib/rate-limit';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

// Rate limit configuration: 60 requests per minute per identity
const RATE_LIMIT_CONFIG = {
  limit: 60,
  windowMs: 60 * 1000, // 1 minute
};

function getIdentity(req: NextRequest): string {
  // Try to get user ID from session first
  const session = await getServerSession(authOptions);
  if (session?.user?.id) {
    return `user:${session.user.id}`;
  }
  
  // Fallback to IP address
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : 
               req.headers.get('x-real-ip') || 
               'unknown';
  return `ip:${ip}`;
}

export async function GET(req: NextRequest) {
  try {
    const identity = await getIdentity(req);
    
    // Apply rate limiting
    const rateLimitResult = await rateLimiter.check(identity, RATE_LIMIT_CONFIG.limit, RATE_LIMIT_CONFIG.windowMs);
    
    // Set rate limit headers on all responses
    const headers = new Headers();
    headers.set('X-RateLimit-Limit', String(RATE_LIMIT_CONFIG.limit));
    headers.set('X-RateLimit-Remaining', String(rateLimitResult.remaining));
    headers.set('X-RateLimit-Reset', String(Math.ceil(rateLimitResult.resetTime / 1000)));
    
    if (!rateLimitResult.allowed) {
      headers.set('Retry-After', String(Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000)));
      
      return NextResponse.json(
        { error: 'Too Many Requests', retryAfter: Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000) },
        { status: 429, headers }
      );
    }
    
    // Your existing status logic here
    // This is a placeholder - replace with actual implementation
    const statusData = { 
      status: 'operational',
      timestamp: new Date().toISOString(),
      // ... rest of your status data
    };
    
    return NextResponse.json(statusData, { headers });
  } catch (error) {
    console.error('[saos/status] Rate limiter error:', error);
    
    // Graceful degradation - allow request through if rate limiter fails
    // but log the error for monitoring
    try {
      // Your existing status logic here
      const statusData = { 
        status: 'operational',
        timestamp: new Date().toISOString(),
      };
      
      return NextResponse.json(statusData);
    } catch (innerError) {
      console.error('[saos/status] Handler error:', innerError);
      return NextResponse.json(
        { error: 'Internal Server Error' },
        { status: 500 }
      );
    }
  }
}