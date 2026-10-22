import { NextRequest, NextResponse } from 'next/server';
import { auditLog } from '@/lib/audit';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';

// Edge Runtime compatibility
// export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const startTime = Date.now();
  
  // 1. Extract or generate correlationId
  const correlationId = req.headers.get('x-correlation-id') || uuidv4();
  
  // 2. Extract identity and role from session
  let identity = 'anonymous';
  let role = 'none';
  
  try {
    const session = await getServerSession(authOptions);
    if (session?.user) {
      identity = session.user.email || session.user.name || 'unknown';
      role = (session.user as any).role || 'user';
    }
  } catch (e) {
    // Session parsing failed, keep defaults
  }
  
  // 3. Prepare audit context
  const auditContext = {
    correlationId,
    identity,
    role,
    method: req.method,
    path: req.url,
    query: Object.fromEntries(req.nextUrl.searchParams),
    statusCode: 200, // default, will be updated
    decision: 'success' as const,
  };
  
  // 4. Local console log for dev debugging
  if (process.env.NODE_ENV === 'development') {
    console.log(`[AUDIT][${correlationId}] ${req.method} ${req.url} - identity: ${identity}, role: ${role}`);
  }
  
  try {
    // Simulate actual status logic (replace with real implementation)
    const statusData = {
      ok: true,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.2.1',
      uptime: process.uptime(),
      correlationId,
    };
    
    const response = NextResponse.json(statusData);
    response.headers.set('x-correlation-id', correlationId);
    
    // Update audit context with actual status
    auditContext.statusCode = 200;
    auditContext.decision = 'success';
    
    return response;
  } catch (error) {
    auditContext.statusCode = 500;
    auditContext.decision = 'error';
    
    if (process.env.NODE_ENV === 'development') {
      console.error(`[AUDIT][${correlationId}] Error:`, error);
    }
    
    return NextResponse.json(
      { ok: false, error: 'Internal server error', correlationId },
      { status: 500 }
    );
  } finally {
    // 5. Call auditLog after response is prepared
    try {
      await auditLog(auditContext);
    } catch (auditError) {
      // Never let audit logging break the main response
      if (process.env.NODE_ENV === 'development') {
        console.error(`[AUDIT][${correlationId}] Failed to write audit log:`, auditError);
      }
    }
  }
}