import { NextRequest, NextResponse } from 'next/server';
import { getToken } from '@/components/sv/shared';
import { db as prisma } from '@/lib/db';

// Define permission levels
enum PermissionLevel {
  BASIC = 'BASIC',
  ADMIN = 'ADMIN',
}

// Function to check if user has required permission
async function hasPermission(request: NextRequest, requiredPermission: PermissionLevel): Promise<boolean> {
  try {
    const token = getToken(request);
    if (!token) return false;

    // Find user in database
    const user = await prisma.user.findUnique({
      where: { id: token.userId },
      select: { permissionLevel: true }
    });

    if (!user) return false;

    // Check if user has required permission level
    return user.permissionLevel === requiredPermission;
  } catch (error) {
    console.error('Permission check error:', error);
    return false;
  }
}

export async function GET(request: NextRequest) {
  try {
    // Check if user has admin permission to view API keys
    if (!(await hasPermission(request, PermissionLevel.ADMIN))) {
      return NextResponse.json(
        { error: 'Unauthorized: Admin access required' },
        { status: 403 }
      );
    }

    // Get all API keys for the user
    const token = getToken(request);
    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized: No valid token' },
        { status: 401 }
      );
    }

    const apiKeys = await prisma.apiKey.findMany({
      where: { userId: token.userId },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        createdAt: true,
        lastUsed: true,
        expiresAt: true,
      }
    });

    return NextResponse.json({ apiKeys });
  } catch (error) {
    console.error('Error fetching API keys:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Check if user has admin permission to create API keys
    if (!(await hasPermission(request, PermissionLevel.ADMIN))) {
      return NextResponse.json(
        { error: 'Unauthorized: Admin access required' },
        { status: 403 }
      );
    }

    const token = getToken(request);
    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized: No valid token' },
        { status: 401 }
      );
    }

    const { name, expiresAt } = await request.json();
    
    if (!name) {
      return NextResponse.json(
        { error: 'API key name is required' },
        { status: 400 }
      );
    }

    // Generate a secure API key
    const key = `saos_${crypto.randomUUID().replace(/-/g, '')}`;
    const keyPrefix = key.substring(0, 8);

    // Store the API key in the database
    const newApiKey = await prisma.apiKey.create({
      data: {
        userId: token.userId,
        name,
        key,
        keyPrefix,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      }
    });

    // Return only the key (it can't be retrieved again)
    return NextResponse.json({
      id: newApiKey.id,
      name: newApiKey.name,
      key: newApiKey.key,
      createdAt: newApiKey.createdAt,
      expiresAt: newApiKey.expiresAt,
    });
  } catch (error) {
    console.error('Error creating API key:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // Check if user has admin permission to delete API keys
    if (!(await hasPermission(request, PermissionLevel.ADMIN))) {
      return NextResponse.json(
        { error: 'Unauthorized: Admin access required' },
        { status: 403 }
      );
    }

    const token = getToken(request);
    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized: No valid token' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const keyId = searchParams.get('id');
    
    if (!keyId) {
      return NextResponse.json(
        { error: 'API key ID is required' },
        { status: 400 }
      );
    }

    // Delete the API key
    await prisma.apiKey.delete({
      where: {
        id: keyId,
        userId: token.userId, // Ensure user can only delete their own keys
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting API key:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}