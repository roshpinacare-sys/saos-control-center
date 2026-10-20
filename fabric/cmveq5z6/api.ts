import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { db as prisma } from '@/lib/db';
import { Logger } from '@/lib/utils';

// טיפוסים למערכת הרשאות
interface UserPayload {
  id: string;
  email: string;
  role: 'user' | 'admin';
}

interface DecodedToken extends UserPayload {}

// קבועי אבטחה
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';
const JWT_EXPIRES_IN = '24h';

// פונקציית עזר לאימות טוקן
function verifyToken(token: string): DecodedToken | null {
  try {
    return jwt.verify(token, JWT_SECRET) as DecodedToken;
  } catch (error) {
    Logger.error('Token verification failed', { error });
    return null;
  }
}

// Middleware לאימות והרשאה
async function authMiddleware(request: NextRequest): Promise<NextResponse | null> {
  const authHeader = request.headers.get('authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    Logger.warn('Missing or invalid authorization header');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = authHeader.substring(7); // הסרת 'Bearer '
  const decoded = verifyToken(token);

  if (!decoded) {
    Logger.warn('Invalid token');
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }

  // בדיקת הרשאות על סמך הנתיב והתפקיד
  const { pathname } = request.nextUrl;
  const isAdmin = decoded.role === 'admin';

  // ניתוח הנתיב כדי לקבוע את סוג הפעולה
  const isMeOperation = pathname.endsWith('/me');
  const isGetAllUsers = pathname === '/api/v1/users';
  const isPutUser = pathname.match(/\/api\/v1\/users\/[^/]+$/);
  
  // בדיקת הרשאות
  if (isMeOperation) {
    // משתמש רגיל יכול לגשת למידע על עצמו
    return null; // מאפשר גישה
  } else if (isGetAllUsers || isPutUser) {
    // פעולות על כל המשתמשים או משתמש ספציפי דורשות הרשאת מנהל
    if (!isAdmin) {
      Logger.warn('Unauthorized access attempt', { 
        userId: decoded.id, 
        email: decoded.email,
        attemptedPath: pathname
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return null; // מאפשר גישה
  }

  // נתיב לא ידוע
  Logger.warn('Unknown API path', { pathname });
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

// רישום לוג לפעולות
async function logAccess(request: NextRequest, userId: string, success: boolean) {
  const { method, pathname } = request;
  const userAgent = request.headers.get('user-agent') || 'unknown';
  
  try {
    await prisma.accessLog.create({
      data: {
        userId,
        method,
        path: pathname,
        userAgent,
        success,
      }
    });
  } catch (error) {
    Logger.error('Failed to log access', { error });
  }
}

// נתיב עצמי (GET /api/v1/users/me)
export async function GET(request: NextRequest) {
  const authResult = await authMiddleware(request);
  if (authResult) return authResult;

  const token = request.headers.get('authorization')?.substring(7) || '';
  const decoded = verifyToken(token);
  
  if (!decoded) {
    await logAccess(request, 'unknown', false);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      }
    });

    if (!user) {
      await logAccess(request, decoded.id, false);
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    await logAccess(request, decoded.id, true);
    return NextResponse.json({ user });
  } catch (error) {
    Logger.error('Failed to fetch user', { error });
    await logAccess(request, decoded.id, false);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// נתיב לכל המשתמשים (GET /api/v1/users)
export async function GET_ALL(request: NextRequest) {
  const authResult = await authMiddleware(request);
  if (authResult) return authResult;

  const token = request.headers.get('authorization')?.substring(7) || '';
  const decoded = verifyToken(token);
  
  if (!decoded) {
    await logAccess(request, 'unknown', false);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      }
    });

    await logAccess(request, decoded.id, true);
    return NextResponse.json({ users });
  } catch (error) {
    Logger.error('Failed to fetch users', { error });
    await logAccess(request, decoded.id, false);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// נתיב לעדכון משתמש (PUT /api/v1/users/:id)
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const authResult = await authMiddleware(request);
  if (authResult) return authResult;

  const token = request.headers.get('authorization')?.substring(7) || '';
  const decoded = verifyToken(token);
  
  if (!decoded) {
    await logAccess(request, 'unknown', false);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { email, name, role } = await request.json();
    
    // מנהל יכול לעדכן רק תפקיד של משתמש אחר, לא את עצמו
    if (decoded.id === params.id && role && role !== decoded.role) {
      await logAccess(request, decoded.id, false);
      return NextResponse.json({ error: 'Cannot change your own role' }, { status: 403 });
    }

    const updatedUser = await prisma.user.update({
      where: { id: params.id },
      data: {
        ...(email && { email }),
        ...(name && { name }),
        ...(role && { role }),
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        updatedAt: true,
      }
    });

    await logAccess(request, decoded.id, true);
    return NextResponse.json({ user: updatedUser });
  } catch (error) {
    Logger.error('Failed to update user', { error });
    await logAccess(request, decoded.id, false);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// נתיב ליצירת משתמש חדש (POST /api/v1/users)
export async function POST(request: NextRequest) {
  const authResult = await authMiddleware(request);
  if (authResult) return authResult;

  const token = request.headers.get('authorization')?.substring(7) || '';
  const decoded = verifyToken(token);
  
  if (!decoded) {
    await logAccess(request, 'unknown', false);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { email, password, name, role = 'user' } = await request.json();
    
    // בדיקת הרשאת מנהל
    if (decoded.role !== 'admin') {
      await logAccess(request, decoded.id, false);
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // בדיקת קיום המשתמש
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      await logAccess(request, decoded.id, false);
      return NextResponse.json({ error: 'User already exists' }, { status: 409 });
    }

    // יצירת המשתמש
    const newUser = await prisma.user.create({
      data: {
        email,
        name,
        role,
        // באמתלה: הצפנת הסיסמה צריכה להיות מיושמת כאן
        // password: await bcrypt.hash(password, 10),
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      }
    });

    await logAccess(request, decoded.id, true);
    return NextResponse.json({ user: newUser }, { status: 201 });
  } catch (error) {
    Logger.error('Failed to create user', { error });
    await logAccess(request, decoded.id, false);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// נתיב למחיקת משתמש (DELETE /api/v1/users/:id)
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const authResult = await authMiddleware(request);
  if (authResult) return authResult;

  const token = request.headers.get('authorization')?.substring(7) || '';
  const decoded = verifyToken(token);
  
  if (!decoded) {
    await logAccess(request, 'unknown', false);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // מנהל לא יכול למחוק את עצמו
    if (decoded.id === params.id) {
      await logAccess(request, decoded.id, false);
      return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 403 });
    }

    // בדיקת הרשאת מנהל
    if (decoded.role !== 'admin') {
      await logAccess(request, decoded.id, false);
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await prisma.user.delete({ where: { id: params.id } });

    await logAccess(request, decoded.id, true);
    return NextResponse.json({ message: 'User deleted successfully' });
  } catch (error) {
    Logger.error('Failed to delete user', { error });
    await logAccess(request, decoded.id, false);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}