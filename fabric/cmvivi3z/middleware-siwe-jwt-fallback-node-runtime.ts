import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySIWE } from './lib/siwe';
import { verifyJWT } from './lib/auth';
import { verifyVaultToken } from './lib/vault';
import { verifyAgentSignature } from './lib/keys';
import { createSafeError } from './lib/safe-error';

type AuthMethod = 'siwe' | 'jwt' | 'vault' | 'agent';
type AuthResult = {
  success: boolean;
  method: AuthMethod | null;
  userId: string | null;
  error?: string;
};

// נתיבים שלא דורשים אימות
const publicPaths = [
  '/api/health',
  '/api/chat',
  '/api/swap/chains',
  '/api/swap/quotes',
  '/api/swap/universe',
  '/api/live/markets',
];

// פונקציית fallback ל-Node runtime
async function nodeRuntimeFallback(request: NextRequest): Promise<NextResponse> {
  // בדיקה אם הנתיד דורש פונקציות שאינן תואמות Edge
  const url = request.nextUrl.pathname;
  
  // אם הנתיב ברשימה הציבורית, מחזירים המשך
  if (publicPaths.some(path => url.startsWith(path))) {
    return NextResponse.next();
  }
  
  // אחרת, מחזירים שגיאת 501 לא מיושם
  return NextResponse.json(
    createSafeError('This endpoint requires Node runtime fallback which is not implemented'),
    { status: 501 }
  );
}

// פונקציית אימות ספציפית למתודה
async function verifyAuthHeader(
  request: NextRequest,
  method: AuthMethod
): Promise<AuthResult> {
  const header = request.headers.get(`x-${method === 'jwt' ? 'authorization' : method}-token`);
  
  if (!header) {
    return { success: false, method: null, userId: null };
  }
  
  try {
    switch (method) {
      case 'siwe': {
        const message = request.headers.get('x-siwe-message');
        if (!message) {
          return { success: false, method: 'siwe', userId: null, error: 'Missing SIWE message' };
        }
        const result = await verifySIWE(message, header);
        return { success: true, method: 'siwe', userId: result.userId };
      }
      case 'jwt':
        const result = await verifyJWT(header);
        return { success: true, method: 'jwt', userId: result.userId };
      case 'vault':
        const vaultResult = await verifyVaultToken(header);
        return { success: true, method: 'vault', userId: vaultResult.userId };
      case 'agent':
        const agentResult = await verifyAgentSignature(header);
        return { success: true, method: 'agent', userId: agentResult.userId };
      default:
        return { success: false, method: null, userId: null, error: 'Unknown auth method' };
    }
  } catch (error) {
    return { success: false, method, userId: null, error: error instanceof Error ? error.message : 'Auth verification failed' };
  }
}

// פונקציית ה-middleware המרכזית
export async function middleware(request: NextRequest) {
  const url = request.nextUrl.pathname;
  
  // בדיקה אם הנתיב ציבורי
  if (publicPaths.some(path => url.startsWith(path))) {
    return NextResponse.next();
  }
  
  // ניסיון אימות לפי סדר עדיפות
  const authMethods: AuthMethod[] = ['siwe', 'jwt', 'vault', 'agent'];
  let lastAuthError: string | null = null;
  
  for (const method of authMethods) {
    const authResult = await verifyAuthHeader(request, method);
    
    if (authResult.success) {
      // הוספת מידע על המשתמש ל-header לשימוש בפונקציות ה-API
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set('x-auth-method', method);
      requestHeaders.set('x-user-id', authResult.userId || '');
      
      return NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      });
    }
    
    lastAuthError = authResult.error || null;
  }
  
  // אם כל האימותים נכשלו, מחזירים שגיאת 401
  return NextResponse.json(
    createSafeError(`Authentication failed${lastAuthError ? `: ${lastAuthError}` : ''}`),
    { status: 401 }
  );
}

// הגדרת המסלולים שה-middleware יופעל עבורם
export const config = {
  matcher: [
    '/api/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
