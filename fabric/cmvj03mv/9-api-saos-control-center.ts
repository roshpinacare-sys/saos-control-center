import { NextRequest, NextResponse } from 'next/server';
import { verifySIWE } from '@/lib/auth/siwe';
import { verifyJWT } from '@/lib/auth/jwt';
import { verifyAPIKey } from '@/lib/auth/api-key';
import { authPolicy, AuthRequirement } from '@/lib/auth/policy';
import { logAuthAttempt } from '@/lib/auth/audit';

// Edge-compatible middleware - no Node.js dependencies
export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  
  // Only protect API routes
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  const policy = authPolicy[pathname as keyof typeof authPolicy];
  if (!policy) {
    // No policy defined - allow but log
    await logAuthAttempt({ pathname, authenticated: true, method: 'none', success: true });
    return NextResponse.next();
  }

  // Try authentication methods in order of preference
  let authenticated = false;
  let authMethod = 'none';
  let userIdentity: string | null = null;

  // 1. Try SIWE signature (most secure for sensitive data)
  const siweHeader = request.headers.get('x-siwe-signature');
  const siweMessage = request.headers.get('x-siwe-message');
  if (siweHeader && siweMessage && policy.allowSIWE) {
    const result = await verifySIWE(siweMessage, siweHeader);
    if (result.valid) {
      authenticated = true;
      authMethod = 'siwe';
      userIdentity = result.address;
    }
  }

  // 2. Try JWT token
  if (!authenticated && policy.allowJWT) {
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const result = await verifyJWT(token);
      if (result.valid) {
        authenticated = true;
        authMethod = 'jwt';
        userIdentity = result.sub;
      }
    }
  }

  // 3. Try API Key (for monitoring endpoints)
  if (!authenticated && policy.allowAPIKey) {
    const apiKey = request.headers.get('x-api-key');
    if (apiKey) {
      const result = await verifyAPIKey(apiKey);
      if (result.valid) {
        authenticated = true;
        authMethod = 'api-key';
        userIdentity = result.keyId;
      }
    }
  }

  // Log attempt
  await logAuthAttempt({
    pathname,
    authenticated,
    method: authMethod,
    identity: userIdentity,
    success: authenticated,
    ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
    userAgent: request.headers.get('user-agent') || 'unknown'
  });

  if (!authenticated) {
    return NextResponse.json(
      { 
        error: 'Unauthorized',
        message: 'Authentication required',
        required: policy.requiredMethods,
        code: 'AUTH_REQUIRED'
      },
      { status: 401 }
    );
  }

  // Add auth info to request headers for downstream use
  const response = NextResponse.next();
  response.headers.set('x-auth-method', authMethod);
  response.headers.set('x-auth-identity', userIdentity || '');
  return response;
}

export const config = {
  matcher: [
    '/api/health',
    '/api/live/bridge',
    '/api/live/markets',
    '/api/live/networks',
    '/api/live/quote',
    '/api/live/tokens',
    '/api/live/versus',
    '/api/saos/status',
    '/api/saos/rpc-mesh'
  ]
};