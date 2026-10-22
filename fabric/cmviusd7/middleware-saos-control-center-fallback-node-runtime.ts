import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySIWE } from '@/lib/siwe';
import { verifyJWT } from '@/lib/auth';
import { verifyVaultToken } from '@/lib/vault';
import { verifyAgentSignature } from '@/lib/arb-scanner';

// מגדירים סוגי אימות תומכים
type AuthType = 'siwe' | 'jwt' | 'vault' | 'agent';

// רשימת הנתיבים שיש להגן עליהם עם middleware
const PROTECTED_PATHS = [
  '/api/audit',
  '/api/chat',
  '/api/dx',
  '/api/fuel',
  '/api/guard',
  '/api/guardian',
  '/api/health',
  '/api/legion',
  '/api/relay-token',
  '/api/task',
  '/api/agent/bounty',
  '/api/agent/message',
  '/api/agent/register',
  '/api/agent/task',
  '/api/live/bridge',
  '/api/live/markets',
  '/api/live/networks',
  '/api/live/quote',
  '/api/live/tokens',
  '/api/live/versus',
  '/api/saos/bounty',
  '/api/saos/custody-alert',
  '/api/saos/economy',
  '/api/saos/energy',
  '/api/saos/kernel',
  '/api/saos/proof-status',
  '/api/saos/research',
  '/api/saos/revenue',
  '/api/saos/rpc-mesh',
  '/api/saos/seal',
  '/api/saos/soldiers',
  '/api/saos/status',
  '/api/saos/value-engine',
  '/api/saos/verify-pack',
  '/api/swap/chains',
  '/api/swap/execute',
  '/api/swap/quotes',
  '/api/swap/status',
  '/api/swap/universe',
  '/api/vault/addresses',
  '/api/vault/challenge',
  '/api/vault/crossing',
  '/api/vault/estate',
  '/api/vault/login',
  '/api/vault/logout',
  '/api/vault/sovereign',
  '/api/vault/status',
  '/api/vault/treasury',
  '/api/vault/verify',
];

// פונקציית fallback ל-Node runtime עבור סקריפטים שאינם תואמי Edge runtime
const nodeRuntimeFallback = async (request: NextRequest) => {
  // כאן ניתן להוסיף לוגיקת fallback לסקריפטים שאינם תואמי Edge
  // למשל: בדיקות נוספות או טיפול במקרים ספציפיים
  return NextResponse.next();
};

// פונקציית עזר לקביעת סוג האימות מהבקשה
const detectAuthType = (request: NextRequest): AuthType | null => {
  const headers = request.headers;
  
  // בדיקת SIWE
  if (headers.get('x-siwe-message')) {
    return 'siwe';
  }
  
  // בדיקת JWT
  const authHeader = headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return 'jwt';
  }
  
  // בדיקת Vault Token
  if (headers.get('x-vault-token')) {
    return 'vault';
  }
  
  // בדיקת Agent Signature
  if (headers.get('x-agent-sig')) {
    return 'agent';
  }
  
  return null;
};

// פונקציית עזר לקביעת הרשאות מספיקות
const checkPermissions = (authType: AuthType, request: NextRequest): boolean => {
  // כאן ניתן להוסיף לוגיקה לבדיקת הרשאות ספציפיות לפי סוג האימות
  // למשל: בדיקת הרשאות עבור נתיבים מסוימים או פעולות
  
  // דוגמה: נתיבי SAOS דורשים הרשאות מיוחדות
  if (request.nextUrl.pathname.startsWith('/api/saos/')) {
    return authType === 'vault' || authType === 'agent';
  }
  
  // נתיבי Agent דורשים אימות סוכן
  if (request.nextUrl.pathname.startsWith('/api/agent/')) {
    return authType === 'agent';
  }
  
  // נתיבי Vault דורשים אימות כספת
  if (request.nextUrl.pathname.startsWith('/api/vault/')) {
    return authType === 'vault' || authType === 'siwe';
  }
  
  // כל שאר הנתיבים דורשים רק אימות בסיסי
  return true;
};

// פונקציית עזר לטיפול בשגיאות אימות
const handleAuthError = (error: Error, type: AuthType): NextResponse => {
  console.error(`[${type.toUpperCase()} Auth Error]:`, error.message);
  
  // טיפול מדוד בשגיאות אימות
  if (error.message.includes('expired') || error.message.includes('invalid')) {
    return NextResponse.json(
      { error: 'Authentication failed', details: error.message },
      { status: 401 }
    );
  }
  
  // טיפול בשגיאות הרשאה
  if (error.message.includes('forbidden') || error.message.includes('unauthorized')) {
    return NextResponse.json(
      { error: 'Insufficient permissions', details: error.message },
      { status: 403 }
    );
  }
  
  // שגיאות פנימיות
  return NextResponse.json(
    { error: 'Internal server error', details: error.message },
    { status: 500 }
  );
};

// הפונקציה הראשית של ה-middleware
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // בדיקה אם הנתיב דורש אימות
  const isProtectedPath = PROTECTED_PATHS.some(path => 
    pathname.startsWith(path)
  );
  
  // אם הנתיב לא מוגן, מאפשרים גישה ללא אימות
  if (!isProtectedPath) {
    return NextResponse.next();
  }
  
  // קביעת סוג האימות מהבקשה
  const authType = detectAuthType(request);
  
  // אם לא נמצא סוג אימות, מחזירים שגיאת אימות
  if (!authType) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }
  
  try {
    // בדיקת הרשאות מספיקות
    const hasPermissions = checkPermissions(authType, request);
    if (!hasPermissions) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }
    
    // ביצוע אימות לפי סוג
    let isValid = false;
    
    switch (authType) {
      case 'siwe': {
        const siweMessage = request.headers.get('x-siwe-message');
        const siweSignature = request.headers.get('x-siwe-signature');
        if (!siweMessage || !siweSignature) {
          throw new Error('Missing SIWE message or signature');
        }
        isValid = await verifySIWE(siweMessage, siweSignature);
        break;
      }
      
      case 'jwt': {
        const token = request.headers.get('authorization')?.replace('Bearer ', '');
        if (!token) {
          throw new Error('Missing JWT token');
        }
        isValid = await verifyJWT(token);
        break;
      }
      
      case 'vault': {
        const vaultToken = request.headers.get('x-vault-token');
        if (!vaultToken) {
          throw new Error('Missing vault token');
        }
        isValid = await verifyVaultToken(vaultToken);
        break;
      }
      
      case 'agent': {
        const agentSig = request.headers.get('x-agent-sig');
        const agentData = request.headers.get('x-agent-data');
        if (!agentSig || !agentData) {
          throw new Error('Missing agent signature or data');
        }
        isValid = await verifyAgentSignature(agentSig, agentData);
        break;
      }
    }
    
    // אם האימות נכשל, מחזירים שגיאת 401
    if (!isValid) {
      return NextResponse.json(
        { error: 'Authentication failed' },
        { status: 401 }
      );
    }
    
    // אם הכל בסדר, ממשיכים לבקשה הבאה
    return NextResponse.next();
    
  } catch (error) {
    // טיפול בשגיאות והחזרת תגובה מתאימה
    if (error instanceof Error) {
      return handleAuthError(error, authType);
    }
    
    // טיפול בשגיאות לא צפויות
    return NextResponse.json(
      { error: 'Unexpected error during authentication' },
      { status: 500 }
    );
  }
}

// הגדרת הנתיבים שעליהם יוחל ה-middleware
export const config = {
  matcher: [
    '/api/:path*',
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ],
};