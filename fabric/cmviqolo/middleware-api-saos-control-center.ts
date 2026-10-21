import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySIWE } from '@/lib/siwe';
import { verifyJWT } from '@/lib/auth';
import { verifyVaultToken } from '@/lib/vault';
import { verifyAgentSignature } from '@/lib/agent';

// נתיבים שלא דורשים אימות
const PUBLIC_PATHS = [
  '/api/health',
  '/api/live',
  '/api/live/bridge',
  '/api/live/markets',
  '/api/live/networks',
  '/api/live/quote',
  '/api/live/tokens',
  '/api/live/versus',
  '/api/saos/status',
  '/api/saos/rpc-mesh',
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // בדיקה אם הנתיב הוא נתיב ציבורי
  const isPublicPath = PUBLIC_PATHS.some(path => pathname.startsWith(path));
  
  if (isPublicPath) {
    return NextResponse.next();
  }

  // קבלת הכותרות מהבקשה
  const authHeader = request.headers.get('authorization');
  const siweMessage = request.headers.get('x-siwe-message');
  const vaultToken = request.headers.get('x-vault-token');
  const agentSig = request.headers.get('x-agent-sig');

  // גילוי אוטומטי של סוג האימות
  let authResult = null;
  let authType = null;

  // ניסיון אימות SIWE
  if (siweMessage) {
    try {
      authResult = await verifySIWE(siweMessage);
      authType = 'SIWE';
    } catch (error) {
      console.error('SIWE verification failed:', error);
    }
  }

  // ניסיון אימות JWT
  if (!authResult && authHeader) {
    try {
      const token = authHeader.replace('Bearer ', '');
      authResult = await verifyJWT(token);
      authType = 'JWT';
    } catch (error) {
      console.error('JWT verification failed:', error);
    }
  }

  // ניסיון אימות Vault
  if (!authResult && vaultToken) {
    try {
      authResult = await verifyVaultToken(vaultToken);
      authType = 'Vault';
    } catch (error) {
      console.error('Vault token verification failed:', error);
    }
  }

  // ניסיון אימות Agent Signature
  if (!authResult && agentSig) {
    try {
      authResult = await verifyAgentSignature(agentSig);
      authType = 'Agent';
    } catch (error) {
      console.error('Agent signature verification failed:', error);
    }
  }

  // אם אף אחד מסוגי האימות לא צלח
  if (!authResult) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Invalid or missing authentication' },
      { status: 401 }
    );
  }

  // הוספת מידע על סוג האימות לכותרות התגובה
  const response = NextResponse.next();
  response.headers.set('x-auth-type', authType);
  response.headers.set('x-auth-user', authResult.address || authResult.userId || '');

  return response;
}

export const config = {
  matcher: '/api/:path*',
};