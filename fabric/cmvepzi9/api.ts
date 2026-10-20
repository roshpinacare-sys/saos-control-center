import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { db as prisma } from '@/lib/db';

// Define roles and permissions
const ROLES = {
  ADMIN: 'admin',
  OPERATOR: 'operator',
  USER: 'user'
} as const;

type Role = typeof ROLES[keyof typeof ROLES];

// Define permissions for each role
const PERMISSIONS = {
  [ROLES.ADMIN]: ['read:users', 'write:users', 'delete:users'],
  [ROLES.OPERATOR]: ['read:users', 'write:users'],
  [ROLES.USER]: ['read:users']
};

// Middleware to authenticate and authorize requests
export async function middleware(request: NextRequest) {
  // Skip middleware for non-API routes
  if (!request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Get the token from the Authorization header
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: 'Authorization token required' },
      { status: 401 }
    );
  }

  const token = authHeader.substring(7);

  try {
    // Verify the token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret') as {
      userId: string;
      role: Role;
    };

    // Check if user exists and has the required role
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, role: true }
    });

    if (!user || user.role !== decoded.role) {
      return NextResponse.json(
        { error: 'Invalid token or user not found' },
        { status: 401 }
      );
    }

    // Add user info to request for later use
    const requestUser = {
      id: user.id,
      role: user.role
    };

    // Clone the request and add user info
    const requestClone = request.clone();
    requestClone.user = requestUser;

    // Check permissions for the specific endpoint
    const method = request.method;
    const path = request.nextUrl.pathname;
    
    let permission: string | null = null;
    
    if (path.includes('/api/users') && method === 'GET') {
      permission = 'read:users';
    } else if (path.includes('/api/users') && method === 'PUT') {
      permission = 'write:users';
    } else if (path.includes('/api/users') && method === 'DELETE') {
      permission = 'delete:users';
    }
    
    if (permission && !PERMISSIONS[user.role].includes(permission)) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    return NextResponse.next();
  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid or expired token' },
      { status: 401 }
    );
  }
}

// Configure the middleware to only run on API routes
export const config = {
  matcher: '/api/:path*'
};

// API route handler for users
export async function GET(request: NextRequest) {
  try {
    // Extract user info from request (added by middleware)
    const user = (request as any).user;
    
    // Check if user has permission to read users
    if (!PERMISSIONS[user.role].includes('read:users')) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    // Fetch users from database
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true
      }
    });

    return NextResponse.json(users);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch users' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    // Extract user info from request (added by middleware)
    const user = (request as any).user;
    
    // Check if user has permission to write users
    if (!PERMISSIONS[user.role].includes('write:users')) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    const { userId, updates } = await request.json();
    
    // Validate input
    if (!userId || !updates) {
      return NextResponse.json(
        { error: 'User ID and updates are required' },
        { status: 400 }
      );
    }

    // Update user in database
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updates,
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        updatedAt: true
      }
    });

    return NextResponse.json(updatedUser);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update user' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // Extract user info from request (added by middleware)
    const user = (request as any).user;
    
    // Check if user has permission to delete users
    if (!PERMISSIONS[user.role].includes('delete:users')) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    
    // Validate input
    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    // Delete user from database
    await prisma.user.delete({
      where: { id: userId }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to delete user' },
      { status: 500 }
    );
  }
}
