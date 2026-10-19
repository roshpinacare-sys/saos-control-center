import { NextRequest, NextResponse } from 'next/server';
import { verifyJwtToken } from '@/lib/auth';

export async function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith('/api/v1/keys')) {
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    try {
      const payload = await verifyJwtToken(token);
      if (payload.role !== 'admin') {
        return NextResponse.json({ error: 'Forbidden: Admin role required' }, { status: 403 });
      }
    } catch (error) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }
  }
  return NextResponse.next();
}
