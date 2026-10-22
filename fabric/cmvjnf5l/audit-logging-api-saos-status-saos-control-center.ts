import { NextRequest, NextResponse } from 'next/server';
import { auditLog } from '@/lib/audit';

// Helper to extract client IP from request headers
function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }
  // Fallback - in Next.js 15+ we can't access connection.remoteAddress directly
  // This would need to be handled at the infrastructure level (nginx, Cloudflare, etc.)
  return 'unknown';
}

// Helper to extract user identity from request
// This assumes you have some auth mechanism - adjust based on your actual auth implementation
function getUserIdentity(request: NextRequest): { userId: string; role: string } {
  // Example: Check for session cookie, JWT token, or API key
  // This is a placeholder - replace with your actual auth logic
  const authHeader = request.headers.get('authorization');
  const sessionCookie = request.cookies.get('session')?.value;
  
  if (authHeader || sessionCookie) {
    // In a real implementation, you would validate the token/session here
    // and extract userId and role from the validated payload
    return { userId: 'authenticated-user', role: 'operator' };
  }
  
  return { userId: 'anonymous', role: 'none' };
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const method = request.method;
  const ip = getClientIp(request);
  const { userId, role } = getUserIdentity(request);
  let statusCode = 200;
  let success = true;
  let errorMessage: string | null = null;

  try {
    // Your existing status logic here
    // Example:
    // const status = await getSaosStatus();
    // return NextResponse.json(status);
    
    // Placeholder response - replace with actual implementation
    const responseData = { 
      status: 'operational',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    };
    
    return NextResponse.json(responseData);
  } catch (error) {
    statusCode = 500;
    success = false;
    errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  } finally {
    // Audit logging in finally block to ensure it runs regardless of success/failure
    try {
      await auditLog({
        userId,
        role,
        timestamp: new Date().toISOString(),
        ip,
        method,
        endpoint: '/api/saos/status',
        statusCode,
        success,
        errorMessage,
        durationMs: Date.now() - startTime,
      });
    } catch (auditError) {
      // Silent failure for audit logging - don't break the main response
      console.error('[AUDIT_LOG_FAILED]', auditError);
    }
  }
}

// If you need to support other HTTP methods, add them with the same pattern
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const method = request.method;
  const ip = getClientIp(request);
  const { userId, role } = getUserIdentity(request);
  let statusCode = 200;
  let success = true;
  let errorMessage: string | null = null;

  try {
    // Your existing POST logic here
    const body = await request.json();
    // Process the request...
    
    return NextResponse.json({ success: true });
  } catch (error) {
    statusCode = error instanceof SyntaxError ? 400 : 500;
    success = false;
    errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { error: statusCode === 400 ? 'Invalid JSON' : 'Internal server error' },
      { status: statusCode }
    );
  } finally {
    try {
      await auditLog({
        userId,
        role,
        timestamp: new Date().toISOString(),
        ip,
        method,
        endpoint: '/api/saos/status',
        statusCode,
        success,
        errorMessage,
        durationMs: Date.now() - startTime,
      });
    } catch (auditError) {
      console.error('[AUDIT_LOG_FAILED]', auditError);
    }
  }
}