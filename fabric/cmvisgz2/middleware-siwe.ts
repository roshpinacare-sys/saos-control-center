import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySIWESignature } from '@/lib/siwe';
import { getVaultSovereignAddress } from '@/lib/vault';

// Matcher for all API routes except /api/health
export const config = {
  matcher: ['/api/:path*'],
  exclude: ['/api/health'],
};

interface ApiResponse {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
}

function createResponse(
  success: boolean,
  message: string,
  data?: any,
  error?: string
): NextResponse<ApiResponse> {
  return NextResponse.json(
    {
      success,
      message,
      ...(data && { data }),
      ...(error && { error }),
    },
    { status: success ? 200 : 401 }
  );
}

export async function middleware(request: NextRequest) {
  // Skip authentication for excluded paths
  if (request.nextUrl.pathname === '/api/health') {
    return NextResponse.next();
  }

  // Get the token from the Authorization header
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return createResponse(
      false,
      'Missing or invalid authorization header',
      undefined,
      'AUTH_REQUIRED'
    );
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix

  try {
    // Verify SIWE signature
    const siweVerification = await verifySIWESignature(token);
    if (!siweVerification.valid) {
      return createResponse(
        false,
        'Invalid SIWE signature',
        undefined,
        'SIWE_INVALID_SIGNATURE'
      );
    }

    // Check token expiration
    if (siweVerification.expired) {
      return createResponse(
        false,
        'SIWE token expired',
        undefined,
        'SIWE_EXPIRED'
      );
    }

    // Get sovereign address from vault
    const sovereignAddress = await getVaultSovereignAddress();
    if (!sovereignAddress) {
      return createResponse(
        false,
        'Sovereign address not configured',
        undefined,
        'VAULT_NOT_CONFIGURED'
      );
    }

    // Verify address matches sovereign address
    if (siweVerification.address.toLowerCase() !== sovereignAddress.toLowerCase()) {
      return createResponse(
        false,
        'Address does not match sovereign address',
        undefined,
        'ADDRESS_MISMATCH'
      );
    }

    // Add verified address to request headers for downstream use
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-authenticated-address', siweVerification.address);

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  } catch (error) {
    console.error('Authentication middleware error:', error);
    return createResponse(
      false,
      'Authentication failed',
      undefined,
      'AUTH_ERROR'
    );
  }
}

export { createResponse };
