import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';

export async function GET(request: Request) {
  const limiter = rateLimit({
    interval: 60 * 1000, // 1 minute
    uniqueTokenPerRequest: true,
  });

  try {
    await limiter.check(60, request.headers.get('x-forwarded-for') || request.ip);
    
    // Mock implementation - replace with actual status logic
    const status = {
      uptime: '24h 15m',
      connectedNodes: 12,
      activeAgents: 8,
      lastBlock: '12345678',
    };
    
    return NextResponse.json(status);
  } catch (error) {
    return new NextResponse(
      JSON.stringify({ error: 'Too many requests' }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '60',
        },
      }
    );
  }
}
