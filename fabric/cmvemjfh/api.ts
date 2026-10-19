import { NextRequest, NextResponse } from 'next/server';
import { getToken } from '@/components/sv/shared';
import { prisma } from '@/lib/db';

// Middleware לבדיקת הרשאות מנהל
async function isAdmin(user: any) {
  return user.role === 'ADMIN';
}

// Middleware לבדיקת הרשאות בעלים
async function isOwnerOrAdmin(user: any, targetUserId: string) {
  return user.id === targetUserId || await isAdmin(user);
}

// פונקציית עזר לרישום לוגים
async function logAccess(
  userId: string,
  action: string,
  targetUserId: string,
  success: boolean,
  details?: any
) {
  try {
    await prisma.accessLog.create({
      data: {
        userId,
        action,
        targetUserId,
        success,
        details,
      },
    });
  } catch (error) {
    console.error('Failed to log access:', error);
  }
}

// פונקציית עזר לטיפול בשגיאות
function handleError(error: any, message: string, status: number = 401) {
  console.error(message, error);
  return NextResponse.json({ error: message }, { status });
}

// נתיב GET עם אימות והרשאות
export async function GET(request: NextRequest) {
  try {
    // 1. אימות המשתמש
    const token = getToken(request);
    if (!token) {
      await logAccess('unknown', 'GET /api/v1/users', 'unknown', false, { reason: 'No token' });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // קבלת מידע על המשתמש
    const user = await prisma.user.findUnique({
      where: { id: token.userId },
      select: { id: true, role: true },
    });

    if (!user) {
      await logAccess(token.userId, 'GET /api/v1/users', 'unknown', false, { reason: 'User not found' });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. קבלת פרמטרי ה-URL
    const { searchParams } = new URL(request.url);
    const targetUserId = searchParams.get('id');

    // 3. בדיקת הרשאות
    if (targetUserId) {
      // ניסיון לגשת למידע של משתמש ספציפי
      if (!(await isOwnerOrAdmin(user, targetUserId))) {
        await logAccess(
          user.id,
          'GET /api/v1/users',
          targetUserId,
          false,
          { reason: 'Unauthorized access attempt' }
        );
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      // קבלת מידע על משתמש ספציפי
      const targetUser = await prisma.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, name: true, email: true, role: true, createdAt: true },
      });

      if (!targetUser) {
        await logAccess(user.id, 'GET /api/v1/users', targetUserId, false, { reason: 'Target user not found' });
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      await logAccess(user.id, 'GET /api/v1/users', targetUserId, true);
      return NextResponse.json({ user: targetUser });
    } else {
      // ניסיון לקבל רשימת כל המשתמשים - רק מנהלים
      if (!(await isAdmin(user))) {
        await logAccess(user.id, 'GET /api/v1/users', 'all', false, { reason: 'Non-admin access attempt' });
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      const users = await prisma.user.findMany({
        select: { id: true, name: true, email: true, role: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      });

      await logAccess(user.id, 'GET /api/v1/users', 'all', true);
      return NextResponse.json({ users });
    }
  } catch (error) {
    return handleError(error, 'Failed to process GET request');
  }
}

// נתיב PUT עם אימות והרשאות
export async function PUT(request: NextRequest) {
  try {
    // 1. אימות המשתמש
    const token = getToken(request);
    if (!token) {
      await logAccess('unknown', 'PUT /api/v1/users', 'unknown', false, { reason: 'No token' });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // קבלת מידע על המשתמש
    const user = await prisma.user.findUnique({
      where: { id: token.userId },
      select: { id: true, role: true },
    });

    if (!user) {
      await logAccess(token.userId, 'PUT /api/v1/users', 'unknown', false, { reason: 'User not found' });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. קבלת נתוני הבקשה
    const { id, ...updateData } = await request.json();
    const targetUserId = id;

    // 3. בדיקת הרשאות
    if (!(await isOwnerOrAdmin(user, targetUserId))) {
      await logAccess(
        user.id,
        'PUT /api/v1/users',
        targetUserId,
        false,
        { reason: 'Unauthorized update attempt' }
      );
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 4. ביצוע העדכון
    const updatedUser = await prisma.user.update({
      where: { id: targetUserId },
      data: updateData,
      select: { id: true, name: true, email: true, role: true, updatedAt: true },
    });

    await logAccess(user.id, 'PUT /api/v1/users', targetUserId, true, { updatedFields: Object.keys(updateData) });
    return NextResponse.json({ user: updatedUser });
  } catch (error) {
    return handleError(error, 'Failed to process PUT request');
  }
}
