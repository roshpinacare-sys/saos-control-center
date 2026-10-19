import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { logger } from '@/lib/utils';

// סוד מפתח ה-JWT - בייצור זה יילקח ממשתני הסביבה
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// טיפוסים למשתמש ולטוקן
interface User {
  id: string;
  email: string;
  role: 'admin' | 'user' | 'moderator';
}

interface DecodedToken {
  userId: string;
  email: string;
  role: string;
  iat: number;
  exp: number;
}

// פונקציית עזר לאימות JWT
function verifyToken(token: string): DecodedToken | null {
  try {
    return jwt.verify(token, JWT_SECRET) as DecodedToken;
  } catch (error) {
    logger.error('JWT verification failed:', error);
    return null;
  }
}

// פונקציית עזר לבדיקת הרשאות
function hasPermission(userRole: string, requiredRole: string): boolean {
  const roleHierarchy: Record<string, number> = {
    'user': 1,
    'moderator': 2,
    'admin': 3
  };
  
  return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
}

// מידלוור לאימות JWT
export function withAuth(handler: (req: NextRequest, user: DecodedToken) => Promise<NextResponse>, requiredRole: string) {
  return async (req: NextRequest): Promise<NextResponse> => {
    // רשימת נתיבים שלא דורשים אימות (למשל לוגין)
    const publicPaths = ['/api/auth/login'];
    
    if (publicPaths.some(path => req.nextUrl.pathname.startsWith(path))) {
      return handler(req, null as any);
    }
    
    // קבלת הטוקן מה-Header
    const authHeader = req.headers.get('authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn('Access attempt without authorization header');
      return NextResponse.json({ error: 'Unauthorized: No token provided' }, { status: 401 });
    }
    
    const token = authHeader.substring(7); // הסרת 'Bearer '
    
    // אימות הטוקן
    const decoded = verifyToken(token);
    
    if (!decoded) {
      logger.warn('Invalid token provided');
      return NextResponse.json({ error: 'Unauthorized: Invalid token' }, { status: 401 });
    }
    
    // בדיקת הרשאות
    if (!hasPermission(decoded.role, requiredRole)) {
      logger.warn(`Access denied for user ${decoded.email} with role ${decoded.role}`);
      return NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403 });
    }
    
    // הוספת מידע על המשתמש לבקשה לשימוש בהמשך
    const reqWithUser = req.clone();
    (reqWithUser as any).user = decoded;
    
    // לוג של גישה מוצלחת
    logger.info(`Access granted to ${decoded.email} for ${req.nextUrl.pathname}`);
    
    return handler(reqWithUser, decoded);
  };
}

// פונקציית עזר להחזרת שגיאות אימות
export function authError(error: string, status: number = 401): NextResponse {
  return NextResponse.json({ error }, { status });
}

// פונקציית עזר להחזרת שגיאות הרשאה
export function permissionError(error: string = 'Insufficient permissions'): NextResponse {
  return NextResponse.json({ error }, { status: 403 });
}
