import { NextRequest, NextResponse } from 'next/server';
import rateLimit from 'express-rate-limit';
import { createHash } from 'crypto';

type IdentityType = 'ip' | 'jwt' | 'api-key';

interface RateLimitConfig {
  [key in IdentityType]: {
    windowMs: number;
    max: number;
    skipSuccessfulRequests?: boolean;
    skipFailedRequests?: boolean;
  };
}

const defaultConfig: RateLimitConfig = {
  ip: {
    windowMs: 60 * 1000, // 1 minute
    max: 60,
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
  },
  jwt: {
    windowMs: 60 * 1000, // 1 minute
    max: 60,
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
  },
  'api-key': {
    windowMs: 60 * 1000, // 1 minute
    max: 60,
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
  },
};

// Create a rate limiter instance
const createRateLimiter = (config: RateLimitConfig) => {
  return rateLimit({
    ...config,
    keyGenerator: (req: NextRequest) => {
      const identityType = getIdentityType(req);
      const identityKey = getIdentityKey(req, identityType);
      return `${identityType}:${identityKey}`;
    },
    handler: (req: NextRequest, res: NextResponse) => {
      const identityType = getIdentityType(req);
      const identityKey = getIdentityKey(req, identityType);
      
      // Log rate limit exceeded
      console.warn(`Rate limit exceeded for ${identityType}: ${identityKey}`);
      
      // Return 429 response
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: `Too many requests for ${identityType}. Try again later.`,
        identityType,
        identityKey,
        retryAfter: Math.ceil(config[identityType].windowMs / 1000),
      });
    },
    skip: (req: NextRequest, res: NextResponse) => {
      // Skip rate limiting for certain paths if needed
      return false;
    },
  });
};

// Get the identity type from the request
function getIdentityType(req: NextRequest): IdentityType {
  // Check for API key first
  const apiKey = req.headers.get('x-api-key');
  if (apiKey) {
    return 'api-key';
  }
  
  // Check for JWT token
  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return 'jwt';
  }
  
  // Default to IP
  return 'ip';
}

// Get the identity key from the request
function getIdentityKey(req: NextRequest, identityType: IdentityType): string {
  switch (identityType) {
    case 'ip':
      return req.ip || req.headers.get('x-forwarded-for') || 'unknown';
    case 'jwt':
      const authHeader = req.headers.get('authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        return hashString(authHeader.substring(7)); // Hash the JWT token
      }
      return 'unknown';
    case 'api-key':
      const apiKey = req.headers.get('x-api-key');
      return apiKey ? hashString(apiKey) : 'unknown';
    default:
      return 'unknown';
  }
}

// Hash a string for privacy
function hashString(str: string): string {
  return createHash('sha256').update(str).digest('hex');
}

// Apply rate limiting to a specific route
export async function applyRateLimit(req: NextRequest, res: NextResponse, customConfig?: Partial<RateLimitConfig>) {
  const config = { ...defaultConfig, ...customConfig };
  const limiter = createRateLimiter(config);
  
  // Express rate limiter expects Node.js request/response objects
  // We'll need to adapt Next.js request/response to work with it
  // For simplicity in this example, we'll implement the logic directly
  
  const identityType = getIdentityType(req);
  const identityKey = getIdentityKey(req, identityType);
  const rateLimitConfig = config[identityType];
  
  // In a real implementation, you would use a distributed store like Redis
  // For this example, we'll use a simple in-memory store
  const storeKey = `${identityType}:${identityKey}`;
  
  // Get current timestamp
  const now = Date.now();
  
  // Initialize store if it doesn't exist
  if (!global.rateLimitStore) {
    global.rateLimitStore = {};
  }
  
  if (!global.rateLimitStore[storeKey]) {
    global.rateLimitStore[storeKey] = {
      count: 1,
      resetTime: now + rateLimitConfig.windowMs,
    };
  } else {
    const entry = global.rateLimitStore[storeKey];
    
    // Reset count if window has passed
    if (now > entry.resetTime) {
      entry.count = 1;
      entry.resetTime = now + rateLimitConfig.windowMs;
    } else {
      entry.count++;
      
      // Check if rate limit exceeded
      if (entry.count > rateLimitConfig.max) {
        // Log rate limit exceeded
        console.warn(`Rate limit exceeded for ${identityType}: ${identityKey}`);
        
        // Return 429 response
        return NextResponse.json(
          {
            error: 'Rate limit exceeded',
            message: `Too many requests for ${identityType}. Try again later.`,
            identityType,
            identityKey,
            retryAfter: Math.ceil(rateLimitConfig.windowMs / 1000),
          },
          {
            status: 429,
            headers: {
              'X-RateLimit-Limit': rateLimitConfig.max.toString(),
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': entry.resetTime.toString(),
              'Retry-After': Math.ceil(rateLimitConfig.windowMs / 1000).toString(),
            },
          }
        );
      }
    }
  }
  
  // Add rate limit headers to response
  const entry = global.rateLimitStore[storeKey];
  const remaining = rateLimitConfig.max - entry.count;
  
  res.headers.set('X-RateLimit-Limit', rateLimitConfig.max.toString());
  res.headers.set('X-RateLimit-Remaining', remaining.toString());
  res.headers.set('X-RateLimit-Reset', entry.resetTime.toString());
  
  return res;
}

// Example usage in a route handler
export async function GET(req: NextRequest) {
  try {
    // Apply rate limiting before processing the request
    const response = await applyRateLimit(req, new NextResponse());
    
    // If rate limited, the response will be returned here
    if (response.status === 429) {
      return response;
    }
    
    // Continue with normal request processing
    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      message: 'SAOS status endpoint is operational',
    });
  } catch (error) {
    console.error('Error in /api/saos/status:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}