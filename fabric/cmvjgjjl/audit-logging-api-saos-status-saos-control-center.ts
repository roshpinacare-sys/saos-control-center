import { NextRequest, NextResponse } from 'next/server';
import { auditLog } from '@/lib/audit';
import { getClientIp, getUserAgent } from '@/lib/audit-helpers';

// Helper functions for extracting request metadata
function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp;
  // Fallback for local development
  return '127.0.0.1';
}

function getUserAgent(request: NextRequest): string {
  return request.headers.get('user-agent') || 'unknown';
}

// Fire-and-forget audit logging with silent error handling
async function writeAuditLog(entry: Parameters<typeof auditLog>[0]): Promise<void> {
  try {
    await auditLog(entry);
  } catch (error) {
    // Silent failure - audit logging must never block the response
    console.error('[AUDIT] Failed to write audit log:', error);
  }
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  let responseStatus = 200;
  let errorMessage: string | undefined;
  let callerIdentity = 'anonymous';

  try {
    // TODO: Replace with actual SIWE/JWT auth when implemented
    // const session = await getSession(request);
    // callerIdentity = session?.address || 'anonymous';
    
    // Simulate status data retrieval
    const statusData = {
      fleetKeys: 'REDACTED',
      anchorAccounts: 'REDACTED',
      relayAgent: 'REDACTED',
      treasuryBalance: 'REDACTED',
      custodyAlerts: 'REDACTED',
      legionStatus: 'REDACTED',
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(statusData);
  } catch (error) {
    responseStatus = 500;
    errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    const latencyMs = Date.now() - startTime;
    
    // Fire-and-forget audit logging
    writeAuditLog({
      callerIdentity,
      ip: getClientIp(request),
      userAgent: getUserAgent(request),
      timestamp: new Date().toISOString(),
      method: request.method,
      path: request.nextUrl.pathname,
      statusCode: responseStatus,
      latencyMs,
      success: responseStatus < 400,
      errorMessage,
    });
  }
}