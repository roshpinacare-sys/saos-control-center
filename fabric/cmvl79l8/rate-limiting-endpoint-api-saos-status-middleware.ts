import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';

export async function GET(request: Request) {
  // Apply rate limiting: 60 requests per minute per identity
  const result = await rateLimit(request, { interval: 60, limit: 60 });
  
  if (!result.success) {
    return new NextResponse(
      JSON.stringify({ error: 'Rate limit exceeded', retryAfter: result.retryAfter }),
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': '60',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': result.reset.toString(),
          'Retry-After': result.retryAfter.toString(),
        },
      }
    );
  }

  try {
    // Implementation of the actual endpoint would go here
    // For now, returning a mock response
    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      message: 'SAOS status endpoint',
    });
  } catch (error) {
    return new NextResponse(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500 }
    );
  }
}