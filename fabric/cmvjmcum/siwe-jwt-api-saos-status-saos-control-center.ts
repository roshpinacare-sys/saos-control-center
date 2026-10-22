import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getSession } from '@/lib/auth';
import { getSaosStatus } from '@/lib/saos/kernel';

// Helper to extract token from Authorization header or cookie
function extractToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  // Fallback to cookie (common for SIWE sessions)
  const cookieToken = request.cookies.get('siwe_token')?.value;
  if (cookieToken) {
    return cookieToken;
  }
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const token = extractToken(request);
    if (!token) {
      return NextResponse.json(
        { error: 'unauthorized', message: 'Valid SIWE/JWT required' },
        { status: 401 }
      );
    }

    // Verify token and get session
    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: 'unauthorized', message: 'Valid SIWE/JWT required' },
        { status: 401 }
      );
    }

    const session = await getSession(payload.sub);
    if (!session) {
      return NextResponse.json(
        { error: 'unauthorized', message: 'Valid SIWE/JWT required' },
        { status: 401 }
      );
    }

    // Token valid, session exists — proceed with existing logic
    const status = await getSaosStatus();
    return NextResponse.json(status);
  } catch (err) {
    console.error('[saos/status] auth error:', err);
    return NextResponse.json(
      { error: 'internal_error', message: 'Authentication failed' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = extractToken(request);
    if (!token) {
      return NextResponse.json(
        { error: 'unauthorized', message: 'Valid SIWE/JWT required' },
        { status: 401 }
      );
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: 'unauthorized', message: 'Valid SIWE/JWT required' },
        { status: 401 }
      );
    }

    const session = await getSession(payload.sub);
    if (!session) {
      return NextResponse.json(
        { error: 'unauthorized', message: 'Valid SIWE/JWT required' },
        { status: 401 }
      );
    }

    // For POST, we might have body data — but status endpoint is typically GET.
    // Keep POST for compatibility, delegate to same logic.
    const status = await getSaosStatus();
    return NextResponse.json(status);
  } catch (err) {
    console.error('[saos/status] auth error:', err);
    return NextResponse.json(
      { error: 'internal_error', message: 'Authentication failed' },
      { status: 500 }
    );
  }
}
