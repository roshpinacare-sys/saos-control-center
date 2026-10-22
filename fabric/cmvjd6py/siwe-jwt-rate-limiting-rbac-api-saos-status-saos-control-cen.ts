// src/lib/auth.ts
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { verifyMessage } from 'viem';
import { type Hex } from 'viem';
import { auditLog } from './audit-log';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'dev-secret-change-in-production'
);
const JWT_ISSUER = 'saos-control-center';
const JWT_AUDIENCE = 'saos-api';
const SIWE_EXPIRY_MS = 1000 * 60 * 10; // 10 minutes

/**
 * Verifies a SIWE (Sign-In with Ethereum) message and signature.
 * Returns the recovered address on success, throws on failure.
 */
export async function verifySIWE(
  message: string,
  signature: `0x${string}`
): Promise<`0x${string}`> {
  try {
    const address = await verifyMessage({
      message,
      signature: signature as Hex,
    });
    
    // Verify message is recent (within expiry window)
    const issuedAtMatch = message.match(/Issued At: (.+)/);
    if (issuedAtMatch) {
      const issuedAt = new Date(issuedAtMatch[1]).getTime();
      if (Date.now() - issuedAt > SIWE_EXPIRY_MS) {
        throw new Error('SIWE message expired');
      }
    }
    
    await auditLog({
      event: 'siwe_verify_success',
      address,
      metadata: { messageLength: message.length }
    });
    
    return address;
  } catch (error) {
    await auditLog({
      event: 'siwe_verify_failure',
      error: error instanceof Error ? error.message : 'unknown',
      metadata: { messageLength: message.length }
    });
    throw new Error('Invalid SIWE signature');
  }
}

/**
 * Creates a JWT token for an authenticated address with roles.
 */
export async function createJWT(
  address: `0x${string}`,
  roles: string[] = ['user']
): Promise<string> {
  return new SignJWT({ address, roles } as JWTPayload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime('2h')
    .sign(JWT_SECRET);
}

/**
 * Verifies a JWT token and returns the payload.
 * Throws if token is invalid, expired, or has wrong issuer/audience.
 */
export async function verifyJWT(token: string): Promise<{ address: `0x${string}`; roles: string[] }> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    
    if (!payload.address || !payload.roles) {
      throw new Error('Invalid token payload');
    }
    
    await auditLog({
      event: 'jwt_verify_success',
      address: payload.address as `0x${string}`,
      roles: payload.roles as string[]
    });
    
    return {
      address: payload.address as `0x${string}`,
      roles: payload.roles as string[],
    };
  } catch (error) {
    await auditLog({
      event: 'jwt_verify_failure',
      error: error instanceof Error ? error.message : 'unknown'
    });
    throw new Error('Invalid or expired token');
  }
}

/**
 * Extracts Bearer token from Authorization header.
 */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}

/**
 * Checks if roles include required role (admin/operator).
 */
export function hasRole(userRoles: string[], required: string | string[]): boolean {
  const requiredRoles = Array.isArray(required) ? required : [required];
  return requiredRoles.some(r => userRoles.includes(r));
}
