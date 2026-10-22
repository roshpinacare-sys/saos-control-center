import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySiweMessage, generateJwt, verifyJwt } from '@/lib/siwe';
import { rateLimit } from '@/lib/rate-limit';

// רשימת נתיבים שאינם דורשים אימות
const PUBLIC_PATHS = [
  '/api/health',
  '/api/vault/login',
  '/api/vault/logout',
  '/api/vault/verify',
  '/api/vault/status',
  '/api/swap/chains'
];

// רשימת נתיבים שדורשים rate limiting נוסף
const RATE_LIMITED_PATHS = [
  '/api/vault/login',
  '/api/vault/verify'
];

// פונקציית עזר לבדיקת נתיב ציבורי
function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.some(publicPath => path.startsWith(publicPath));
}

// פונקציית עזר לבדיקת נתיב מוגבל ב-rate limiting
function isRateLimitedPath(path: string): boolean {
  return RATE_LIMITED_PATHS.some(rateLimitedPath => path.startsWith(rateLimitedPath));
}

// פונקציית עזר לחילוץ טוקן מ-header
function getTokenFromHeader(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return null;
}

// פונקציית עזר לחילוץ SIWE message מ-header
function getSiweMessageFromHeader(request: NextRequest): string | null {
  return request.headers.get('x-siwe-message');
}

// פונקציית עזר לחילוץ vault token מ-header
function getVaultTokenFromHeader(request: NextRequest): string | null {
  return request.headers.get('x-vault-token');
}

// פונקציית עזר לחילוץ agent signature מ-header
function getAgentSignatureFromHeader(request: NextRequest): string | null {
  return request.headers.get('x-agent-sig');
}

// פונקציית עזר לבדיקת סוג אימות
function getAuthType(request: NextRequest): 'jwt' | 'siwe' | 'vault' | 'agent' | null {
  const jwtToken = getTokenFromHeader(request);
  const siweMessage = getSiweMessageFromHeader(request);
  const vaultToken = getVaultTokenFromHeader(request);
  const agentSig = getAgentSignatureFromHeader(request);

  if (jwtToken) return 'jwt';
  if (siweMessage) return 'siwe';
  if (vaultToken) return 'vault';
  if (agentSig) return 'agent';

  return null;
}

// פונקציית עזר לאימות JWT
async function verifyJwtToken(token: string): Promise<boolean> {
  try {
    const isValid = await verifyJwt(token);
    return isValid;
  } catch (error) {
    console.error('JWT verification error:', error);
    return false;
  }
}

// פונקציית עזר לאימות SIWE
async function verifySiweToken(message: string, signature: string): Promise<boolean> {
  try {
    const isValid = await verifySiweMessage(message, signature);
    return isValid;
  } catch (error) {
    console.error('SIWE verification error:', error);
    return false;
  }
}

// פונקציית עזר לאימות Vault token
async function verifyVaultToken(token: string): Promise<boolean> {
  try {
    // כאן יש ליישם את הלוגיקה לאימות token של הכספת
    // לדוגמה: בדיקה מול מסד הנתונים או שירות חיצוני
    const isValid = true; // לדוגמה בלבד
    return isValid;
  } catch (error) {
    console.error('Vault token verification error:', error);
    return false;
  }
}

// פונקציית עזר לאימות agent signature
async function verifyAgentSignature(signature: string, data: string): Promise<boolean> {
  try {
    // כאן יש ליישם את הלוגיקה לאימות חתימת הסוכן
    // לדוגמה: בדיקת חתימה מול מפתח ציבורי של הסוכן
    const isValid = true; // לדוגמה בלבד
    return isValid;
  } catch (error) {
    console.error('Agent signature verification error:', error);
    return false;
  }
}

// פונקציית עזר להוספת headers לתגובה
function addAuthHeaders(response: NextResponse, userId?: string): NextResponse {
  if (userId) {
    response.headers.set('x-user-id', userId);
  }
  response.headers.set('x-auth-method', 'middleware');
  return response;
}

// פונקציית ה-middleware הראשית
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // בדיקת נתיב ציבורי
  if (isPublicPath(pathname)) {
    // בדיקת rate limiting עבור נתיבים ציבוריים מסוימים
    if (isRateLimitedPath(pathname)) {
      const rateLimitResult = await rateLimit(request);
      if (!rateLimitResult.success) {
        return NextResponse.json(
          { error: 'Rate limit exceeded', retryAfter: rateLimitResult.retryAfter },
          { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter.toString() } }
        );
      }
    }
    return NextResponse.next();
  }

  // בדיקת rate limiting עבור כל הנתיבים האחרים
  const rateLimitResult = await rateLimit(request);
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', retryAfter: rateLimitResult.retryAfter },
      { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter.toString() } }
    );
  }

  // קביעת סוג האימות
  const authType = getAuthType(request);
  
  if (!authType) {
    return NextResponse.json(
      { error: 'Authentication required', methods: ['jwt', 'siwe', 'vault', 'agent'] },
      { status: 401 }
    );
  }

  let isValid = false;
  let userId: string | null = null;

  // ביצוע אימות לפי סוג האימות
  switch (authType) {
    case 'jwt':
      const jwtToken = getTokenFromHeader(request)!;
      isValid = await verifyJwtToken(jwtToken);
      if (isValid) {
        // חילוץ userId מה JWT
        try {
          const payload = JSON.parse(atob(jwtToken.split('.')[1]));
          userId = payload.sub || payload.userId;
        } catch (error) {
          console.error('JWT payload extraction error:', error);
        }
      }
      break;

    case 'siwe':
      const siweMessage = getSiweMessageFromHeader(request)!;
      const signature = request.headers.get('x-siwe-signature') || '';
      isValid = await verifySiweToken(siweMessage, signature);
      if (isValid) {
        // חילוץ address מה SIWE message
        try {
          const message = JSON.parse(siweMessage);
          userId = message.address;
        } catch (error) {
          console.error('SIWE message parsing error:', error);
        }
      }
      break;

    case 'vault':
      const vaultToken = getVaultTokenFromHeader(request)!;
      isValid = await verifyVaultToken(vaultToken);
      if (isValid) {
        // חילוץ userId מה vault token
        try {
          // כאן יש ליישם את הלוגיקה לחילוץ userId מ-token הכספת
          userId = 'vault-user-id'; // לדוגמה בלבד
        } catch (error) {
          console.error('Vault token parsing error:', error);
        }
      }
      break;

    case 'agent':
      const agentSig = getAgentSignatureFromHeader(request)!;
      const body = await request.text();
      isValid = await verifyAgentSignature(agentSig, body);
      if (isValid) {
        // חילוץ userId מה agent signature
        try {
          // כאן יש ליישם את הלוגיקה לחילוץ userId מחתימת הסוכן
          userId = 'agent-user-id'; // לדוגמה בלבד
        } catch (error) {
          console.error('Agent signature parsing error:', error);
        }
      }
      break;
  }

  if (!isValid) {
    return NextResponse.json(
      { error: 'Invalid authentication', type: authType },
      { status: 401 }
    );
  }

  // הוספת headers לתגובה
  const response = NextResponse.next();
  return addAuthHeaders(response, userId || undefined);
}

// קביעת הנתיבים שעליהם יוחל ה-middleware
export const config = {
  matcher: '/api/:path*',
};
