import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySIWE } from '@/lib/siwe';
import { verifyJWT } from '@/lib/auth';
import { verifyVaultToken } from '@/lib/vault';
import { verifyAgentSignature } from '@/lib/keys';
import { createSafeError } from '@/lib/safe-error';

// נתיבים שצריכים להיות פתוחים ללא אימות
const PUBLIC_PATHS = [
  '/api/health',
  '/api/chat',
  '/api/swap/universe',
  '/api/live/markets',
  '/api/live/tokens',
  '/api/live/networks',
  '/api/live/bridge',
  '/api/live/quote',
  '/api/live/versus',
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // בדיקה אם הנתיב הוא נתיב ציבורי
  if (PUBLIC_PATHS.some(path => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  // בדיקה אם זה נתיב API
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // ניסיון אימות בסדר עדיפות
  let authResult;
  
  // 1. אימות Vault Token
  const vaultToken = request.headers.get('x-vault-token');
  if (vaultToken) {
    try {
      authResult = await verifyVaultToken(vaultToken);
      if (authResult.success) {
        // הוספת המידע המאומת ל-header לשימוש בפונקציות הבאות
        const requestHeaders = new Headers(request.headers);
        requestHeaders.set('x-authenticated-user', authResult.user);
        requestHeaders.set('x-auth-method', 'vault');
        return NextResponse.next({
          request: {
            headers: requestHeaders,
          },
        });
      }
    } catch (error) {
      return NextResponse.json(
        createSafeError('Vault token verification failed', 401),
        { status: 401 }
      );
    }
  }

  // 2. אימות Agent Signature
  const agentSig = request.headers.get('x-agent-sig');
  if (agentSig) {
    try {
      authResult = await verifyAgentSignature(agentSig);
      if (authResult.success) {
        const requestHeaders = new Headers(request.headers);
        requestHeaders.set('x-authenticated-user', authResult.user);
        requestHeaders.set('x-auth-method', 'agent');
        return NextResponse.next({
          request: {
            headers: requestHeaders,
          },
        });
      }
    } catch (error) {
      return NextResponse.json(
        createSafeError('Agent signature verification failed', 401),
        { status: 401 }
      );
    }
  }

  // 3. אימות SIWE/JWT (ניתן לביצוע ב-Node runtime)
  const authHeader = request.headers.get('authorization');
  if (authHeader) {
    const token = authHeader.replace('Bearer ', '');
    
    try {
      // ניסיון אימות כ-SIWE
      const siweResult = await verifySIWE(token);
      if (siweResult.success) {
        const requestHeaders = new Headers(request.headers);
        requestHeaders.set('x-authenticated-user', siweResult.user);
        requestHeaders.set('x-auth-method', 'siwe');
        return NextResponse.next({
          request: {
            headers: requestHeaders,
          },
        });
      }
      
      // אם SIWE נכשל, ניסיון אימות כ-JWT
      const jwtResult = await verifyJWT(token);
      if (jwtResult.success) {
        const requestHeaders = new Headers(request.headers);
        requestHeaders.set('x-authenticated-user', jwtResult.user);
        requestHeaders.set('x-auth-method', 'jwt');
        return NextResponse.next({
          request: {
            headers: requestHeaders,
          },
        });
      }
    } catch (error) {
      return NextResponse.json(
        createSafeError('Authentication token verification failed', 401),
        { status: 401 }
      );
    }
  }

  // אם אף אחת משיטות האימות לא צלחה
  return NextResponse.json(
    createSafeError('Authentication required', 401),
    { status: 401 }
  );
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ],
};