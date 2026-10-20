import { NextRequest, NextResponse } from 'next/server';
import { getToken } from '@/components/sv/shared';
import { db as prisma } from '@/lib/db';

// Middleware function to authenticate and authorize requests to /api/v1/users
async function authMiddleware(request: NextRequest) {
  const token = getToken(request);
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Verify the token and get the user
    const user = await prisma.user.findUnique({
      where: { id: token.userId },
      select: { id: true, role: true }
    });

    if (!user) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    // Add user to request context for downstream handlers
    (request as any).user = user;
    return null; // Continue to the handler
  } catch (error) {
    console.error('Authentication error:', error);
    return NextResponse.json({ error: 'Authentication failed' }, { status: 401 });
  }
}

export async function GET(request: NextRequest) {
  // Authenticate the request
  const authResult = await authMiddleware(request);
  if (authResult) return authResult;

  const user = (request as any).user;
  
  // Log access attempt
  console.info(`User ${user.id} (${user.role}) attempted to access users list`);

  try {
    if (user.role === 'ADMIN') {
      // Admin can see all users
      const users = await prisma.user.findMany({
        select: { id: true, username: true, email: true, role: true, createdAt: true }
      });
      
      return NextResponse.json(users);
    } else {
      // Regular users can only see their own profile
      const userProfile = await prisma.user.findUnique({
        where: { id: user.id },
        select: { id: true, username: true, email: true, role: true, createdAt: true }
      });
      
      if (!userProfile) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }
      
      return NextResponse.json([userProfile]);
    }
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  // Authenticate the request
  const authResult = await authMiddleware(request);
  if (authResult) return authResult;

  const user = (request as any).user;
  const { userId, ...updateData } = await request.json();
  
  // Log access attempt
  console.info(`User ${user.id} (${user.role}) attempted to update user ${userId}`);

  try {
    if (user.role !== 'ADMIN') {
      // Non-admin users can only update their own profile
      if (userId !== user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      
      // Regular users can only update certain fields
      const allowedFields = ['username', 'email'];
      const filteredData = {};
      
      for (const key of allowedFields) {
        if (updateData[key] !== undefined) {
          filteredData[key] = updateData[key];
        }
      }
      
      const updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: filteredData,
        select: { id: true, username: true, email: true, role: true, createdAt: true }
      });
      
      return NextResponse.json(updatedUser);
    } else {
      // Admin can update any user's profile
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: updateData,
        select: { id: true, username: true, email: true, role: true, createdAt: true }
      });
      
      return NextResponse.json(updatedUser);
    }
  } catch (error) {
    console.error('Error updating user:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}