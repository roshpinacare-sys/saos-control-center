import { NextRequest, NextResponse } from 'next/server';
import { getToken } from '@/components/sv/shared';

// פונקציית עזר לבדיקת הרשאות מנהל
async function isAdmin(request: NextRequest): Promise<boolean> {
  const token = getToken(request);
  if (!token) return false;
  
  try {
    // כאן ניתן להוסיף לוגיקה לאימות הטוקן ובדיקת הרשאות
    // לדוגמה: בדיקה מול מסד הנתונים או שירות אימות
    const response = await fetch(`${process.env.INTERNAL_API_URL}/auth/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ role: 'admin' })
    });
    
    if (!response.ok) return false;
    
    const data = await response.json();
    return data.isAdmin || false;
  } catch (error) {
    console.error('Error verifying admin status:', error);
    return false;
  }
}

// פונקציית מידלוור לאימות מנהל
export async function adminMiddleware(request: NextRequest): Promise<NextResponse | null> {
  const isAdminUser = await isAdmin(request);
  
  if (!isAdminUser) {
    return NextResponse.json(
      { error: 'Unauthorized access - admin privileges required' },
      { status: 403 }
    );
  }
  
  return null; // ממשיך בבקשה המקורית
}

// הנתיב המקורי לניהול משתמשים
export async function GET(request: NextRequest) {
  // בדיקת הרשאות מנהל
  const authCheck = await adminMiddleware(request);
  if (authCheck) return authCheck;
  
  try {
    // לוגיקה לקבלת כל המשתמשים
    const users = await fetch(`${process.env.INTERNAL_API_URL}/users`, {
      headers: {
        'Authorization': `Bearer ${getToken(request)}`
      }
    });
    
    if (!users.ok) {
      throw new Error('Failed to fetch users');
    }
    
    const usersData = await users.json();
    return NextResponse.json(usersData);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to retrieve users' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  // בדיקת הרשאות מנהל
  const authCheck = await adminMiddleware(request);
  if (authCheck) return authCheck;
  
  try {
    const { userId, ...updateData } = await request.json();
    
    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }
    
    // לוגיקה לעדכון משתמש
    const response = await fetch(`${process.env.INTERNAL_API_URL}/users/${userId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken(request)}`
      },
      body: JSON.stringify(updateData)
    });
    
    if (!response.ok) {
      throw new Error('Failed to update user');
    }
    
    const updatedUser = await response.json();
    return NextResponse.json(updatedUser);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update user' },
      { status: 500 }
    );
  }
}