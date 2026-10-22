import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function GET(request: NextRequest) {
  // Rate limiting - must be first
  const session = await getServerSession(authOptions);
  const identity = session?.user?.id || request.ip || request.headers.get('x-forwarded-for') || 'anonymous';
  
  const rateLimitResult = await rateLimit(identity, 60, 60000); // 60 requests per minute
  
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Too Many Requests', message: 'Rate limit exceeded. Please try again later.' },
      {
        status: 429,
        headers: {
          'Retry-After': Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000).toString(),
          'X-RateLimit-Limit': '60',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': Math.ceil(rateLimitResult.resetTime / 1000).toString(),
        },
      }
    );
  }

  // Add rate limit headers to successful response
  const response = NextResponse.json({
    status: 'operational',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '0.2.1',
  });
  
  response.headers.set('X-RateLimit-Limit', '60');
  response.headers.set('X-RateLimit-Remaining', rateLimitResult.remaining.toString());
  response.headers.set('X-RateLimit-Reset', Math.ceil(rateLimitResult.resetTime / 1000).toString());
  
  return response;
}