import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getRateLimitKey } from '@/lib/rate-limit';

const limiter = rateLimit({
  windowMs: 60_000, // 1 minute
  max: 60, // 60 requests per minute
  keyGenerator: (req: NextRequest) => getRateLimitKey(req),
});

export async function GET(req: NextRequest) {
  const rl = await limiter(req);
  
  const headers = new Headers();
  headers.set('X-RateLimit-Limit', String(rl.limit));
  headers.set('X-RateLimit-Remaining', String(rl.remaining));
  headers.set('X-RateLimit-Reset', String(Math.ceil(rl.reset / 1000)));
  
  if (!rl.success) {
    headers.set('Retry-After', String(Math.ceil((rl.reset - Date.now()) / 1000)));
    return new NextResponse(JSON.stringify({ error: 'Too Many Requests' }), {
      status: 429,
      headers,
    });
  }

  // Existing status logic
  const status = {
    ok: true,
    timestamp: Date.now(),
    version: process.env.npm_package_version || '0.2.1',
  };

  return NextResponse.json(status, { headers });
}