import { NextRequest, NextResponse } from 'next/server';
import { getToken } from '@/lib/auth';

// Define roles and permissions
const ROLES = {
  ADMIN: 'admin',
  USER: 'user',
  API_MANAGER: 'api_manager'
} as const;

type Role = keyof typeof ROLES;

const ROLE_PERMISSIONS: Record<Role, string[]> = {
  ADMIN: ['api_keys:read', 'api_keys:create', 'api_keys:update', 'api_keys:delete'],
  USER: ['api_keys:read'],
  API_MANAGER: ['api_keys:read', 'api_keys:create', 'api_keys:update']
};

// API Key CRUD operations
const API_KEY_OPERATIONS = {
  GET: 'read',
  POST: 'create',
  PUT: 'update',
  DELETE: 'delete'
} as const;

type ApiKeyOperation = keyof typeof API_KEY_OPERATIONS;

/**
 * Check if the user has the required permission for the API key operation
 * @param userRole - The user's role
 * @param operation - The API key operation being performed
 * @returns True if the user has permission, false otherwise
 */
function hasApiKeyPermission(userRole: Role, operation: ApiKeyOperation): boolean {
  const permission = `api_keys:${API_KEY_OPERATIONS[operation]}`;
  return ROLE_PERMISSIONS[userRole]?.includes(permission) || false;
}

/**
 * Middleware to check API key permissions
 * @param request - The incoming request
 * @param operation - The operation being performed
 * @returns NextResponse or throws an error if unauthorized
 */
async function checkApiKeyPermissions(request: NextRequest, operation: ApiKeyOperation): Promise<NextResponse | null> {
  try {
    const token = await getToken(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // In a real implementation, you would decode the token to get the user's role
    // For this example, we'll simulate getting the user role from the token
    const userRole = token.role as Role;

    if (!hasApiKeyPermission(userRole, operation)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    return null; // Permission granted
  } catch (error) {
    return NextResponse.json({ error: 'Authentication failed' }, { status: 401 });
  }
}

// Mock database functions (in a real implementation, these would interact with your database)
const mockApiKeyDb = {
  async createKey(userId: string, keyData: any) {
    // Implementation for creating an API key
    return { id: 'key-123', userId, ...keyData, createdAt: new Date() };
  },

  async getKeys(userId: string) {
    // Implementation for retrieving API keys
    return [
      { id: 'key-123', userId, name: 'Key 1', permissions: ['read'], createdAt: new Date() },
      { id: 'key-124', userId, name: 'Key 2', permissions: ['read', 'write'], createdAt: new Date() }
    ];
  },

  async updateKey(keyId: string, userId: string, updateData: any) {
    // Implementation for updating an API key
    return { id: keyId, userId, ...updateData, updatedAt: new Date() };
  },

  async deleteKey(keyId: string, userId: string) {
    // Implementation for deleting an API key
    return { success: true, deletedKey: keyId };
  }
};

export async function GET(request: NextRequest) {
  const permissionCheck = await checkApiKeyPermissions(request, 'GET');
  if (permissionCheck) return permissionCheck;

  try {
    const userId = 'user-123'; // In a real implementation, get this from the authenticated user
    const keys = await mockApiKeyDb.getKeys(userId);
    return NextResponse.json({ keys });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to retrieve API keys' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const permissionCheck = await checkApiKeyPermissions(request, 'POST');
  if (permissionCheck) return permissionCheck;

  try {
    const body = await request.json();
    const { name, permissions } = body;
    
    if (!name || !permissions) {
      return NextResponse.json({ error: 'Name and permissions are required' }, { status: 400 });
    }

    const userId = 'user-123'; // In a real implementation, get this from the authenticated user
    const newKey = await mockApiKeyDb.createKey(userId, { name, permissions });
    
    return NextResponse.json({ key: newKey }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create API key' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const permissionCheck = await checkApiKeyPermissions(request, 'PUT');
  if (permissionCheck) return permissionCheck;

  try {
    const body = await request.json();
    const { keyId, name, permissions } = body;
    
    if (!keyId) {
      return NextResponse.json({ error: 'Key ID is required' }, { status: 400 });
    }

    const userId = 'user-123'; // In a real implementation, get this from the authenticated user
    const updatedKey = await mockApiKeyDb.updateKey(keyId, userId, { name, permissions });
    
    return NextResponse.json({ key: updatedKey });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update API key' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const permissionCheck = await checkApiKeyPermissions(request, 'DELETE');
  if (permissionCheck) return permissionCheck;

  try {
    const { searchParams } = new URL(request.url);
    const keyId = searchParams.get('id');
    
    if (!keyId) {
      return NextResponse.json({ error: 'Key ID is required' }, { status: 400 });
    }

    const userId = 'user-123'; // In a real implementation, get this from the authenticated user
    const result = await mockApiKeyDb.deleteKey(keyId, userId);
    
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete API key' }, { status: 500 });
  }
}
