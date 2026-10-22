import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { jwtVerify, createRemoteJWKSet } from 'jose';
import { prisma } from '@/lib/db';
import { verifySiweMessage, type SiweMessage } from '@/lib/siwe';
import { validateJwt, type JwtPayload } from '@/lib/auth';
import { getVaultUser } from '@/lib/vault';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, siweMessage, operation } = body;

    if (operation === 'siwe') {
      if (!siweMessage) {
        return NextResponse.json({ valid: false, error: 'SIWE message required' }, { status: 400 });
      }
      const result = await verifySiweMessage(siweMessage);
      if (!result.valid) {
        return NextResponse.json({ valid: false, error: result.error }, { status: 401 });
      }
      // Create JWT for the verified user
      const jwt = await createJwtForUser(result.data!.address);
      return NextResponse.json({ valid: true, user: { address: result.data!.address }, token: jwt });
    }

    if (operation === 'jwt') {
      if (!token) {
        return NextResponse.json({ valid: false, error: 'JWT token required' }, { status: 400 });
      }
      const result = await validateJwt(token);
      if (!result.valid) {
        return NextResponse.json({ valid: false, error: result.error }, { status: 401 });
      }
      // Fetch vault user data
      const vaultUser = await getVaultUser(result.data!.sub);
      return NextResponse.json({ valid: true, user: { ...result.data, vault: vaultUser } });
    }

    if (operation === 'vault') {
      if (!token) {
        return NextResponse.json({ valid: false, error: 'JWT token required' }, { status: 400 });
      }
      const jwtResult = await validateJwt(token);
      if (!jwtResult.valid) {
        return NextResponse.json({ valid: false, error: jwtResult.error }, { status: 401 });
      }
      const vaultUser = await getVaultUser(jwtResult.data!.sub);
      return NextResponse.json({ valid: true, user: vaultUser });
    }

    return NextResponse.json({ valid: false, error: 'Invalid operation' }, { status: 400 });
  } catch (error) {
    console.error('[auth/verify] Error:', error);
    return NextResponse.json({ valid: false, error: 'Internal server error' }, { status: 500 });
  }
}

async function createJwtForUser(address: string): Promise<string> {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'dev-secret-change-in-production');
  const { SignJWT } = await import('jose');
  return new SignJWT({ sub: address, role: 'operator' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(secret);
}