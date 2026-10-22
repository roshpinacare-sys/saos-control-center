import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, type JWTPayload } from '@/lib/auth';
import { verifySIWEMessage } from '@/lib/siwe';

// User type returned after successful authentication
export interface AuthUser {
  id: string;
  address: string;
  roles: string[];
  permissions: string[];
}

// Map JWT payload to AuthUser
export function mapPayloadToUser(payload: JWTPayload): AuthUser {
  return {
    id: payload.sub,
    address: payload.address,
    roles: payload.roles ?? [],
    permissions: payload.permissions ?? [],
  };
}

// Extract token from cookie or Authorization header
function extractToken(request: NextRequest): string | null {
  // Try Authorization header first
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  // Fallback to cookie
  const cookieToken = request.cookies.get('saos_auth_token')?.value;
  if (cookieToken) {
    return cookieToken;
  }
  return null;
}

// Main authentication middleware
export async function requireAuth(
  request: NextRequest
): Promise<{ user: AuthUser } | NextResponse> {
  const token = extractToken(request);

  if (!token) {
    return new NextResponse(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': 'Bearer realm="saos", error="missing_token", error_description="No authentication token provided"',
      },
    });
  }

  try {
    // Verify JWT token
    const payload = await verifyToken(token);
    if (!payload) {
      throw new Error('Invalid token');
    }
    return { user: mapPayloadToUser(payload) };
  } catch (jwtError) {
    // If JWT verification fails, try SIWE signature verification
    // This handles the case where a SIWE-signed message is sent directly
    const siweMessage = request.headers.get('x-siwe-message');
    const siweSignature = request.headers.get('x-siwe-signature');

    if (siweMessage && siweSignature) {
      try {
        const siweResult = await verifySIWEMessage(siweMessage, siweSignature);
        if (siweResult.success && siweResult.data) {
          return {
            user: {
              id: siweResult.data.address,
              address: siweResult.data.address,
              roles: ['operator'],
              permissions: ['saos:read'],
            },
          };
        }
      } catch (siweError) {
        // SIWE verification failed, fall through to error response
      }
    }

    // Both JWT and SIWE failed
    const errorMessage = jwtError instanceof Error ? jwtError.message : 'Invalid token';
    return new NextResponse(JSON.stringify({ error: 'Authentication failed', details: errorMessage }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer realm="saos", error="invalid_token", error_description="${errorMessage}"`, 
      },
    });
  }
}