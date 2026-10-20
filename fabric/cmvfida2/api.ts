import { NextRequest, NextResponse } from 'next/server';
import { getToken } from '@/components/sv/shared';
import { db as prisma } from '@/lib/db';

// פונקציית עזר לבדיקת הרשאות מנהל מערכת
async function requireAdmin(request: NextRequest): Promise<boolean> {
  const token = getToken(request);
  if (!token) return false;

  try {
    const user = await prisma.user.findUnique({
      where: { id: token.userId },
      select: { role: true }
    });

    return user?.role === 'ADMIN';
  } catch (error) {
    console.error('Error checking admin role:', error);
    return false;
  }
}

export async function GET(request: NextRequest) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json(
      { error: 'Unauthorized: Admin access required' },
      { status: 403 }
    );
  }

  try {
    const keys = await prisma.apiKey.findMany({
      select: {
        id: true,
        name: true,
        permissions: true,
        createdAt: true,
        lastUsed: true,
        userId: true
      },
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json(keys);
  } catch (error) {
    console.error('Error fetching API keys:', error);
    return NextResponse.json(
      { error: 'Failed to fetch API keys' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json(
      { error: 'Unauthorized: Admin access required' },
      { status: 403 }
    );
  }

  try {
    const { name, permissions } = await request.json();
    
    if (!name || !permissions) {
      return NextResponse.json(
        { error: 'Name and permissions are required' },
        { status: 400 }
      );
    }

    const token = getToken(request);
    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const newKey = await prisma.apiKey.create({
      data: {
        name,
        permissions,
        userId: token.userId
      }
    });

    // הסתרת המפתח הסודי לאחר יצירה
    const { secretKey, ...keyData } = newKey;
    
    return NextResponse.json({
      ...keyData,
      secretKey: '••••••••••••••••'
    });
  } catch (error) {
    console.error('Error creating API key:', error);
    return NextResponse.json(
      { error: 'Failed to create API key' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json(
      { error: 'Unauthorized: Admin access required' },
      { status: 403 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const keyId = searchParams.get('id');
    
    if (!keyId) {
      return NextResponse.json(
        { error: 'Key ID is required' },
        { status: 400 }
      );
    }

    await prisma.apiKey.delete({
      where: { id: keyId }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting API key:', error);
    return NextResponse.json(
      { error: 'Failed to delete API key' },
      { status: 500 }
    );
  }
}