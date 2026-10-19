import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { db } from '@/lib/db';

// טיפול בבקשות GET לנתיב /api/v1/users
export async function GET(request: NextRequest) {
  try {
    // 1. אימות JWT
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Missing or invalid authorization header' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret') as any;
    
    // 2. הרשאות מבוססות תפקידים
    if (decoded.role !== 'admin') {
      // משתמשים רגילים יכולים לראות רק את המידע שלהם
      const user = await db.user.findUnique({
        where: { id: decoded.userId },
        select: { id: true, username: true, email: true, role: true }
      });
      
      if (!user) {
        return NextResponse.json(
          { error: 'User not found' },
          { status: 404 }
        );
      }
      
      // לוגינג
      console.log(`User ${decoded.username} accessed their own data`);
      
      return NextResponse.json({ user });
    }
    
    // מנהלי מערכת יכולים לראת את כל המשתמשים
    const users = await db.user.findMany({
      select: { id: true, username: true, email: true, role: true, createdAt: true }
    });
    
    // לוגינג
    console.log(`Admin ${decoded.username} accessed all users`);
    
    return NextResponse.json({ users });
  } catch (error) {
    // טיפול בשגיאות אימות
    if (error instanceof jwt.JsonWebTokenError) {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }
    
    // טיפול בשגיאות כלליות
    console.error('Error in /api/v1/users GET:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// טיפול בבקשות PUT לנתיב /api/v1/users
export async function PUT(request: NextRequest) {
  try {
    // 1. אימות JWT
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Missing or invalid authorization header' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret') as any;
    
    // 2. הרשאות מבוססות תפקידים
    if (decoded.role !== 'admin') {
      return NextResponse.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }
    
    const { userId, ...updateData } = await request.json();
    
    // 3. עדכון המשתמש
    const updatedUser = await db.user.update({
      where: { id: userId },
      data: updateData,
      select: { id: true, username: true, email: true, role: true }
    });
    
    // לוגינג
    console.log(`Admin ${decoded.username} updated user ${updatedUser.username}`);
    
    return NextResponse.json({ user: updatedUser });
  } catch (error) {
    // טיפול בשגיאות אימות
    if (error instanceof jwt.JsonWebTokenError) {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }
    
    // טיפול בשגיאות כלליות
    console.error('Error in /api/v1/users PUT:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// טיפול בבקשות DELETE לנתיב /api/v1/users
export async function DELETE(request: NextRequest) {
  try {
    // 1. אימות JWT
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Missing or invalid authorization header' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret') as any;
    
    // 2. הרשאות מבוססות תפקידים
    if (decoded.role !== 'admin') {
      return NextResponse.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }
    
    const { userId } = await request.json();
    
    // 3. מחיקת המשתמש
    const deletedUser = await db.user.delete({
      where: { id: userId },
      select: { id: true, username: true, email: true }
    });
    
    // לוגינג
    console.log(`Admin ${decoded.username} deleted user ${deletedUser.username}`);
    
    return NextResponse.json({ message: 'User deleted successfully', user: deletedUser });
  } catch (error) {
    // טיפול בשגיאות אימות
    if (error instanceof jwt.JsonWebTokenError) {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }
    
    // טיפול בשגיאות כלליות
    console.error('Error in /api/v1/users DELETE:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
