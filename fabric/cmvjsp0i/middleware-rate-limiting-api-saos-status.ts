import { NextRequest, NextResponse } from 'next/server';
import rateLimit from 'express-rate-limit';

// Middleware for rate limiting with API key identification
const rateLimitMiddleware = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per window per identity
  keyGenerator: (req: NextRequest) => {
    // Extract API key or token from request headers
    const apiKey = req.headers.get('x-api-key');
    const authToken = req.headers.get('authorization');
    
    // Use API key or token as identity identifier
    if (apiKey) {
      return `api_key:${apiKey}`;
    }
    
    if (authToken && authToken.startsWith('Bearer ')) {
      return `token:${authToken.substring(7)}`;
    }
    
    // Fallback to IP if no authentication is provided
    return req.ip || 'unknown';
  },
  handler: (req: NextRequest) => {
    return NextResponse.json(
      { error: 'Too many requests, please try again later.' },
      { 
        status: 429,
        headers: {
          'X-RateLimit-Limit': '60',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': Math.floor(Date.now() / 1000 + 60).toString(),
          'Retry-After': '60'
        }
      }
    );
  }
});

export async function GET(request: NextRequest) {
  // Apply rate limiting middleware
  await rateLimitMiddleware(request, {} as any);
  
  try {
    // Get the status data from your data source
    // This is a placeholder - replace with actual implementation
    const statusData = {
      uptime: '24h',
      activeConnections: 42,
      lastBlock: 12345678,
      networkLoad: 'medium'
    };
    
    return NextResponse.json(statusData);
  } catch (error) {
    console.error('Error fetching SAOS status:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  // Apply rate limiting middleware
  await rateLimitMiddleware(request, {} as any);
  
  try {
    const body = await request.json();
    // Process the request body
    // This is a placeholder - replace with actual implementation
    
    return NextResponse.json({ success: true, message: 'Status updated' });
  } catch (error) {
    console.error('Error updating SAOS status:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
