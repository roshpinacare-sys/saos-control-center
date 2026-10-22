import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';

export async function GET(request: NextRequest) {
  // Rate limiting: 60 requests per minute per identity
  const limiter = rateLimit({
    interval: 60 * 1000, // 60 seconds in milliseconds
    uniqueTokenPerInterval: 100, // Max 100 users per interval
  });

  try {
    // Check rate limit
    limiter.check(100, 'API_RATE_LIMIT');
  } catch (error) {
    // Return 429 status code when rate limit exceeded
    return new NextResponse(
      JSON.stringify({ error: 'Rate limit exceeded' }),
      { 
        status: 429,
        headers: {
          'X-RateLimit-Limit': '60',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': Math.floor(Date.now() / 1000 + 60).toString(),
          'Retry-After': '60',
        }
      }
    );
  }

  // Your existing API logic here
  try {
    // Implementation of /api/saos/status endpoint
    const statusData = {
      // Placeholder for actual status data
      status: 'operational',
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(statusData);
  } catch (error) {
    console.error('Error in /api/saos/status:', error);
    return new NextResponse(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500 }
    );
  }
}
