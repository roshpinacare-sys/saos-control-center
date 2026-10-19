import { NextRequest, NextResponse } from 'next/server';
import { getToken } from '@/components/sv/shared';

// מבנה המשתמש לדוגמה (בפרויקט אמיתי זה יגיע ממסד הנתונים)
type User = {
  id: string;
  username: string;
  email: string;
  role: 'user' | 'admin';
  createdAt: Date;
  updatedAt: Date;
};

// מאגר משתמשים לדוגמה
const users: User[] = [
  { id: '1', username: 'admin', email: 'admin@example.com', role: 'admin', createdAt: new Date(), updatedAt: new Date() },
  { id: '2', username: 'user1', email: 'user1@example.com', role: 'user', createdAt: new Date(), updatedAt: new Date() },
  { id: '3', username: 'user2', email: 'user2@example.com', role: 'user', createdAt: new Date(), updatedAt: new Date() },
];

// פונקציית עזר לבדיקת הרשאות
function checkAuthorization(userRole: string, requiredRole: string): boolean {
  if (requiredRole === 'admin' && userRole === 'admin') {
    return true;
  }
  
  // משתמשים רגילים יכולים לגשת למידע על עצמם בלבד
  if (requiredRole === 'self' && userRole === 'user') {
    return true;
  }
  
  return false;
}

// פונקציית עזר ללוגינג
function logActivity(userId: string, action: string, targetId?: string, success: boolean = true) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    userId,
    action,
    targetId,
    success
  };
  
  // בפרויקט אמיתי, כאן יש לשמור את הלוג במסד נתונים או בקובץ לוג
  console.log('API Activity Log:', logEntry);
}

export async function GET(request: NextRequest) {
  try {
    // אימות המשתמש
    const token = getToken(request);
    if (!token) {
      logActivity('unknown', 'users_get', undefined, false);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // בדיקת הרשאות
    const userRole = token.role; // בפרויקט אמיתי, זה יגיע מהטוקן
    
    // קבלת ה-ID של המשתמש מהטוקן
    const userId = token.sub; // בפויקט אמיתי, זה יגיע מהטוקן
    
    // קבלת ה-ID מהפרמטרים של ה-URL
    const { searchParams } = new URL(request.url);
    const targetUserId = searchParams.get('id');
    
    if (targetUserId) {
      // בקשה למשתמש ספציפי
      if (!checkAuthorization(userRole, targetUserId === userId ? 'self' : 'admin')) {
        logActivity(userId, 'users_get', targetUserId, false);
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      
      const user = users.find(u => u.id === targetUserId);
      if (!user) {
        logActivity(userId, 'users_get', targetUserId, false);
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }
      
      logActivity(userId, 'users_get', targetUserId, true);
      return NextResponse.json({ user });
    } else {
      // בקשה לכל המשתמשים
      if (userRole !== 'admin') {
        logActivity(userId, 'users_get_all', undefined, false);
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      
      logActivity(userId, 'users_get_all', undefined, true);
      return NextResponse.json({ users });
    }
  } catch (error) {
    console.error('Error in /api/v1/users GET:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    // אימות המשתמש
    const token = getToken(request);
    if (!token) {
      logActivity('unknown', 'users_put', undefined, false);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // בדיקת הרשאות
    const userRole = token.role; // בפרויקט אמיתי, זה יגיע מהטוקן
    const userId = token.sub; // בפויקט אמיתי, זה יגיע מהטוקן
    
    const { searchParams } = new URL(request.url);
    const targetUserId = searchParams.get('id');
    
    if (!targetUserId) {
      logActivity(userId, 'users_put', undefined, false);
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }
    
    // מנהלים יכולים לערוך כל משתמש, משתמשים רגילים רק את עצמם
    if (!checkAuthorization(userRole, targetUserId === userId ? 'self' : 'admin')) {
      logActivity(userId, 'users_put', targetUserId, false);
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    
    const body = await request.json();
    const { username, email } = body;
    
    // בדיקת תקינות הנתונים
    if (!username || !email) {
      logActivity(userId, 'users_put', targetUserId, false);
      return NextResponse.json({ error: 'Username and email are required' }, { status: 400 });
    }
    
    // בפרויקט אמיתי, כאן יש לעדכן את המשתמש במסד הנתונים
    const userIndex = users.findIndex(u => u.id === targetUserId);
    if (userIndex === -1) {
      logActivity(userId, 'users_put', targetUserId, false);
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    
    // עדכון המשתמש
    users[userIndex] = {
      ...users[userIndex],
      username,
      email,
      updatedAt: new Date()
    };
    
    logActivity(userId, 'users_put', targetUserId, true);
    return NextResponse.json({ user: users[userIndex] });
  } catch (error) {
    console.error('Error in /api/v1/users PUT:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
