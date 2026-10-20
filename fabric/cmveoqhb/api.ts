import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { db as prisma } from '@/lib/db';

// Define types
interface UserPayload {
  userId: string;
  email: string;
  role: 'admin' | 'user' | 'guest';
}

interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user' | 'guest';
}

// Secret key for JWT (should be in environment variables)
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';

// Middleware function to verify JWT and extract user role
const verifyToken = (token: string): UserPayload | null => {
  try {
    return jwt.verify(token, JWT_SECRET) as UserPayload;
  } catch (error) {
    console.error('JWT verification failed:', error);
    return null;
  }
};

// Log access attempt
const logAccessAttempt = async (
  userId: string,
  action: string,
  success: boolean,
  details: string = ''
) => {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        success,
        details,
        timestamp: new Date(),
      },
    });
  } catch (error) {
    console.error('Failed to log access attempt:', error);
  }
};

// Main handler for /api/v1/users
export async function GET(request: NextRequest) {
  // Extract token from Authorization header
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.split(' ')[1]; // Bearer <token>

  if (!token) {
    await logAccessAttempt('unknown', 'GET /api/v1/users', false, 'No token provided');
    return NextResponse.json(
      { error: 'Authorization token required' },
      { status: 401 }
    );
  }

  const user = verifyToken(token);
  if (!user) {
    await logAccessAttempt('unknown', 'GET /api/v1/users', false, 'Invalid token');
    return NextResponse.json(
      { error: 'Invalid or expired token' },
      { status: 401 }
    );
  }

  // Log the access attempt
  await logAccessAttempt(user.userId, 'GET /api/v1/users', true);

  try {
    // Fetch users based on role
    let users: User[] = [];
    
    switch (user.role) {
      case 'admin':
        // Admin can see all users
        users = await prisma.user.findMany({
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        });
        break;
      
      case 'user':
        // Regular users can only see their own profile
        const currentUser = await prisma.user.findUnique({
          where: { id: user.userId },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        });
        
        if (currentUser) {
          users = [currentUser];
        }
        break;
      
      case 'guest':
        // Guests have no access
        return NextResponse.json(
          { error: 'Insufficient permissions' },
          { status: 403 }
        );
      
      default:
        return NextResponse.json(
          { error: 'Invalid user role' },
          { status: 403 }
        );
    }

    return NextResponse.json({ users });
  } catch (error) {
    console.error('Error fetching users:', error);
    await logAccessAttempt(user.userId, 'GET /api/v1/users', false, 'Database error');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  // Extract token from Authorization header
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.split(' ')[1]; // Bearer <token>

  if (!token) {
    await logAccessAttempt('unknown', 'POST /api/v1/users', false, 'No token provided');
    return NextResponse.json(
      { error: 'Authorization token required' },
      { status: 401 }
    );
  }

  const user = verifyToken(token);
  if (!user) {
    await logAccessAttempt('unknown', 'POST /api/v1/users', false, 'Invalid token');
    return NextResponse.json(
      { error: 'Invalid or expired token' },
      { status: 401 }
    );
  }

  // Only admins can create new users
  if (user.role !== 'admin') {
    await logAccessAttempt(user.userId, 'POST /api/v1/users', false, 'Insufficient permissions');
    return NextResponse.json(
      { error: 'Insufficient permissions' },
      { status: 403 }
    );
  }

  try {
    const { email, name, role } = await request.json();
    
    // Validate input
    if (!email || !name || !role) {
      await logAccessAttempt(user.userId, 'POST /api/v1/users', false, 'Missing required fields');
      return NextResponse.json(
        { error: 'Missing required fields: email, name, role' },
        { status: 400 }
      );
    }
    
    if (!['admin', 'user', 'guest'].includes(role)) {
      await logAccessAttempt(user.userId, 'POST /api/v1/users', false, 'Invalid role');
      return NextResponse.json(
        { error: 'Invalid role. Must be admin, user, or guest' },
        { status: 400 }
      );
    }
    
    // Create new user
    const newUser = await prisma.user.create({
      data: {
        email,
        name,
        role,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
      },
    });
    
    // Log the creation
    await logAccessAttempt(user.userId, 'POST /api/v1/users', true, `Created user: ${email}`);
    
    return NextResponse.json({ user: newUser }, { status: 201 });
  } catch (error) {
    console.error('Error creating user:', error);
    await logAccessAttempt(user.userId, 'POST /api/v1/users', false, 'Database error');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  // Extract token from Authorization header
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.split(' ')[1]; // Bearer <token>

  if (!token) {
    await logAccessAttempt('unknown', 'PUT /api/v1/users', false, 'No token provided');
    return NextResponse.json(
      { error: 'Authorization token required' },
      { status: 401 }
    );
  }

  const user = verifyToken(token);
  if (!user) {
    await logAccessAttempt('unknown', 'PUT /api/v1/users', false, 'Invalid token');
    return NextResponse.json(
      { error: 'Invalid or expired token' },
      { status: 401 }
    );
  }

  try {
    const { id, email, name, role } = await request.json();
    
    // Validate input
    if (!id) {
      await logAccessAttempt(user.userId, 'PUT /api/v1/users', false, 'Missing user ID');
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }
    
    // Check if the user exists
    const targetUser = await prisma.user.findUnique({
      where: { id },
    });
    
    if (!targetUser) {
      await logAccessAttempt(user.userId, 'PUT /api/v1/users', false, `User not found: ${id}`);
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }
    
    // Admins can update any user, regular users can only update their own profile
    if (user.role !== 'admin' && user.userId !== id) {
      await logAccessAttempt(user.userId, 'PUT /api/v1/users', false, 'Insufficient permissions');
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }
    
    // Only admins can change roles
    if (role && user.role !== 'admin') {
      await logAccessAttempt(user.userId, 'PUT /api/v1/users', false, 'Cannot change role');
      return NextResponse.json(
        { error: 'Insufficient permissions to change role' },
        { status: 403 }
      );
    }
    
    // Update user
    const updatedUser = await prisma.user.update({
      where: { id },
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
      },
    });
    
    // Log the update
    await logAccessAttempt(user.userId, 'PUT /api/v1/users', true, `Updated user: ${email}`);
    
    return NextResponse.json({ user: updatedUser });
  } catch (error) {
    console.error('Error updating user:', error);
    await logAccessAttempt(user.userId, 'PUT /api/v1/users', false, 'Database error');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  // Extract token from Authorization header
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.split(' ')[1]; // Bearer <token>

  if (!token) {
    await logAccessAttempt('unknown', 'DELETE /api/v1/users', false, 'No token provided');
    return NextResponse.json(
      { error: 'Authorization token required' },
      { status: 401 }
    );
  }

  const user = verifyToken(token);
  if (!user) {
    await logAccessAttempt('unknown', 'DELETE /api/v1/users', false, 'Invalid token');
    return NextResponse.json(
      { error: 'Invalid or expired token' },
      { status: 401 }
    );
  }

  // Only admins can delete users
  if (user.role !== 'admin') {
    await logAccessAttempt(user.userId, 'DELETE /api/v1/users', false, 'Insufficient permissions');
    return NextResponse.json(
      { error: 'Insufficient permissions' },
      { status: 403 }
    );
  }

  try {
    const { id } = await request.json();
    
    // Validate input
    if (!id) {
      await logAccessAttempt(user.userId, 'DELETE /api/v1/users', false, 'Missing user ID');
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }
    
    // Check if the user exists
    const targetUser = await prisma.user.findUnique({
      where: { id },
    });
    
    if (!targetUser) {
      await logAccessAttempt(user.userId, 'DELETE /api/v1/users', false, `User not found: ${id}`);
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }
    
    // Prevent admins from deleting themselves
    if (user.userId === id) {
      await logAccessAttempt(user.userId, 'DELETE /api/v1/users', false, 'Cannot delete self');
      return NextResponse.json(
        { error: 'Admin cannot delete themselves' },
        { status: 400 }
      );
    }
    
    // Delete user
    await prisma.user.delete({
      where: { id },
    });
    
    // Log the deletion
    await logAccessAttempt(user.userId, 'DELETE /api/v1/users', true, `Deleted user: ${targetUser.email}`);
    
    return NextResponse.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    await logAccessAttempt(user.userId, 'DELETE /api/v1/users', false, 'Database error');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
