import { NextRequest, NextResponse } from 'next/server';
import { applyRateLimit } from '@/lib/rate-limit';

export async function GET(request: NextRequest) {
  // Apply rate limiting: 60 requests per minute per identity
  const rateLimitResult = await applyRateLimit(request);
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Too many requests' },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': rateLimitResult.limit.toString(),
          'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
          'X-RateLimit-Reset': rateLimitResult.reset.toString(),
          'Retry-After': rateLimitResult.reset.toString(),
        },
      }
    );
  }

  try {
    // Get the current status of SAOS
    const statusResponse = await fetch('http://localhost:3010/api/saos/status', {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!statusResponse.ok) {
      throw new Error(`SAOS status request failed with status ${statusResponse.status}`);
    }

    const statusData = await statusResponse.json();
    
    return NextResponse.json(statusData);
  } catch (error) {
    console.error('Error fetching SAOS status:', error);
    return NextResponse.json(
      { error: 'Failed to fetch SAOS status' },
      { status: 500 }
    );
  }
}
