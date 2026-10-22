import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';

export async function middleware(request: Request) {
  // Apply rate limiting to all API routes
  if (request.url.startsWith('/api/')) {
    const ip = request.headers.get('x-forwarded-for') || 'unknown';
    const identifier = ip; // Use IP as identifier for rate limiting
    
    const { success, limit, remaining, reset } = await rateLimit(identifier);
    
    if (!success) {
      return new NextResponse(
        JSON.stringify({ 
          error: 'Rate limit exceeded',
          limit,
          remaining,
          reset
        }),
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': limit.toString(),
            'X-RateLimit-Remaining': remaining.toString(),
            'X-RateLimit-Reset': reset.toString(),
            'Retry-After': '60',
            'Content-Type': 'application/json'
          }
        }
      );
    }
    
    // Add rate limit headers to successful responses
    const response = NextResponse.next();
    response.headers.set('X-RateLimit-Limit', limit.toString());
    response.headers.set('X-RateLimit-Remaining', remaining.toString());
    response.headers.set('X-RateLimit-Reset', reset.toString());
    
    return response;
  }
  
  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};