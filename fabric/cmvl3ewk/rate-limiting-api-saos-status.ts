import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';

// Rate limiting configuration
const RATE_LIMIT_CONFIG = {
  // Number of requests allowed in a time window
  maxRequests: 100,
  // Time window in seconds (1 minute)
  windowMs: 60,
  // Burst protection: allow a sudden burst of requests
  maxRequestsBurst: 20,
  // Time window for burst protection in seconds (10 seconds)
  burstWindowMs: 10,
};

// Track rate limit violations
const rateLimitViolations = new Map<string, { count: number; lastViolation: number }>();

export async function GET(request: NextRequest) {
  // Get client IP, accounting for proxies
  const clientIp = request.headers.get('x-forwarded-for') || 
                   request.headers.get('x-real-ip') || 
                   request.ip || 
                   'unknown';
  
  // Clean up IP if it contains multiple IPs (from x-forwarded-for)
  const ip = clientIp.split(',')[0].trim();
  
  try {
    // Apply rate limiting
    const result = await rateLimit({
      ip,
      ...RATE_LIMIT_CONFIG
    });
    
    // Check if limit was exceeded
    if (!result.success) {
      // Track violation
      const now = Date.now();
      const violation = rateLimitViolations.get(ip) || { count: 0, lastViolation: 0 };
      violation.count += 1;
      violation.lastViolation = now;
      rateLimitViolations.set(ip, violation);
      
      // Log violation
      console.warn(`Rate limit exceeded for IP: ${ip}. Count: ${violation.count}`);
      
      return new NextResponse(
        JSON.stringify({ 
          error: 'Too Many Requests', 
          message: 'Rate limit exceeded. Please try again later.' 
        }),
        { 
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': RATE_LIMIT_CONFIG.maxRequests.toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': Math.ceil((now + RATE_LIMIT_CONFIG.windowMs * 1000) / 1000).toString(),
            'Retry-After': RATE_LIMIT_CONFIG.windowMs.toString(),
          }
        }
      );
    }
    
    // If request is allowed, proceed with the original API logic
    // In a real implementation, you would have your actual API logic here
    // For this example, we'll return a mock response
    const mockResponse = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      data: {
        uptime: '24h 15m',
        version: '1.2.3',
        activeConnections: 42,
        lastBlock: 12345678,
      }
    };
    
    return new NextResponse(
      JSON.stringify(mockResponse),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Limit': RATE_LIMIT_CONFIG.maxRequests.toString(),
          'X-RateLimit-Remaining': result.remaining.toString(),
          'X-RateLimit-Reset': Math.ceil((Date.now() + RATE_LIMIT_CONFIG.windowMs * 1000) / 1000).toString(),
        }
      }
    );
  } catch (error) {
    console.error('Rate limiting error:', error);
    
    // Fallback response if rate limiting fails
    return new NextResponse(
      JSON.stringify({ 
        error: 'Internal Server Error', 
        message: 'Rate limiting service unavailable' 
      }),
      { 
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        }
      }
    );
  }
}

// Optional: Function to get rate limit violation reports
export function getRateLimitViolations() {
  const violations: Record<string, { count: number; lastViolation: number }> = {};
  
  for (const [ip, data] of rateLimitViolations.entries()) {
    violations[ip] = {
      count: data.count,
      lastViolation: data.lastViolation
    };
  }
  
  return violations;
}

// Optional: Function to reset rate limit violations (for admin use)
export function resetRateLimitViolations(ip?: string) {
  if (ip) {
    rateLimitViolations.delete(ip);
  } else {
    rateLimitViolations.clear();
  }
}
