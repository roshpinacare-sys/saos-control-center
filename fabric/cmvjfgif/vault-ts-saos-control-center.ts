import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { headers } from 'next/headers';
import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { SiweMessage } from 'siwe';
import { getMasterKey, deriveKey } from './master-key';
import { rateLimit, RateLimitConfig } from './rate-limit';
import { safeError, SafeError } from './safe-error';
import { secretScrub } from './secret-scrub';
import { db } from './db';
import { auditLog } from './audit';

// ─── Types ──────────────────────────────────────────────────────────────
export interface VaultSession {
  address: string;
  chainId: number;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  scope: 'vault:read' | 'vault:write' | 'vault:admin';
}

export interface VaultNonceRecord {
  nonce: string;
  address: string;
  used: boolean;
  usedAt?: number;
  createdAt: number;
}

export interface OriginPolicy {
  allowedOrigins: string[];
  allowedReferrers: string[];
  requireHttps: boolean;
}

const DEFAULT_ORIGIN_POLICY: OriginPolicy = {
  allowedOrigins: [
    'https://saos.control-center',
    'https://vault.saos.control-center',
    'http://localhost:3000',
    'http://localhost:3010',
  ],
  allowedReferrers: [
    'https://saos.control-center/',
    'https://vault.saos.control-center/',
    'http://localhost:3000/',
    'http://localhost:3010/',
  ],
  requireHttps: process.env.NODE_ENV === 'production',
};

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ─── Nonce Store (in-memory with DB persistence) ────────────────────────
const nonceCache = new Map<string, VaultNonceRecord>();

async function loadNonceFromDb(nonce: string): Promise<VaultNonceRecord | null> {
  try {
    const row = await db.vaultNonce.findUnique({ where: { nonce } });
    return row ? { ...row, used: row.used } : null;
  } catch {
    return null;
  }
}

async function saveNonceToDb(record: VaultNonceRecord): Promise<void> {
  try {
    await db.vaultNonce.upsert({
      where: { nonce: record.nonce },
      create: record,
      update: { used: record.used, usedAt: record.usedAt },
    });
  } catch (e) {
    auditLog('vault_nonce_persist_failed', { nonce: record.nonce, error: safeError(e) });
  }
}

// ─── Core Security Functions ────────────────────────────────────────────

export function generateNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export async function issueNonce(address: string): Promise<string> {
  const nonce = generateNonce();
  const record: VaultNonceRecord = {
    nonce,
    address: address.toLowerCase(),
    used: false,
    createdAt: Date.now(),
  };
  nonceCache.set(nonce, record);
  await saveNonceToDb(record);
  return nonce;
}

export async function consumeNonce(nonce: string, address: string): Promise<boolean> {
  const normalizedAddress = address.toLowerCase();
  let record = nonceCache.get(nonce);
  
  if (!record) {
    record = await loadNonceFromDb(nonce);
    if (record) nonceCache.set(nonce, record);
  }
  
  if (!record) {
    await auditLog('vault_nonce_not_found', { nonce, address: normalizedAddress });
    return false;
  }
  
  if (record.used) {
    await auditLog('vault_nonce_replay_attempt', { nonce, address: normalizedAddress, usedAt: record.usedAt });
    return false;
  }
  
  if (record.address !== normalizedAddress) {
    await auditLog('vault_nonce_address_mismatch', { nonce, expected: record.address, got: normalizedAddress });
    return false;
  }
  
  const now = Date.now();
  if (now - record.createdAt > NONCE_TTL_MS) {
    await auditLog('vault_nonce_expired', { nonce, address: normalizedAddress, ageMs: now - record.createdAt });
    return false;
  }
  
  record.used = true;
  record.usedAt = now;
  nonceCache.set(nonce, record);
  await saveNonceToDb(record);
  
  return true;
}

// ─── Origin Validation ──────────────────────────────────────────────────
export function validateOrigin(origin: string | null, referrer: string | null, policy = DEFAULT_ORIGIN_POLICY): boolean {
  if (!origin) {
    auditLog('vault_origin_missing', { referrer });
    return false;
  }
  
  try {
    const originUrl = new URL(origin);
    
    if (policy.requireHttps && originUrl.protocol !== 'https:') {
      auditLog('vault_origin_http_blocked', { origin });
      return false;
    }
    
    const originMatch = policy.allowedOrigins.some(allowed => {
      const allowedUrl = new URL(allowed);
      return originUrl.hostname === allowedUrl.hostname && originUrl.protocol === allowedUrl.protocol;
    });
    
    if (!originMatch) {
      auditLog('vault_origin_not_allowed', { origin, allowed: policy.allowedOrigins });
      return false;
    }
    
    if (referrer) {
      const referrerUrl = new URL(referrer);
      const referrerMatch = policy.allowedReferrers.some(allowed => {
        const allowedUrl = new URL(allowed);
        return referrerUrl.hostname === allowedUrl.hostname && referrerUrl.protocol === allowedUrl.protocol;
      });
      
      if (!referrerMatch) {
        auditLog('vault_referrer_not_allowed', { referrer, allowed: policy.allowedReferrers });
        return false;
      }
    }
    
    return true;
  } catch (e) {
    auditLog('vault_origin_parse_failed', { origin, referrer, error: safeError(e) });
    return false;
  }
}

// ─── Signature Verification (SIWE) ──────────────────────────────────────
export async function verifySiweSignature(
  message: string,
  signature: string,
  nonce: string
): Promise<{ success: boolean; address?: string; error?: string }> {
  try {
    const siweMessage = new SiweMessage(JSON.parse(message));
    const result = await siweMessage.verify({ signature, nonce });
    
    if (!result.success) {
      await auditLog('vault_siwe_verify_failed', { error: result.error, address: siweMessage.address });
      return { success: false, error: 'Invalid signature' };
    }
    
    return { success: true, address: result.data?.address };
  } catch (e) {
    await auditLog('vault_siwe_parse_failed', { error: safeError(e) });
    return { success: false, error: 'Malformed SIWE message' };
  }
}

// ─── Session Management ─────────────────────────────────────────────────
export async function createVaultSession(
  address: string,
  chainId: number,
  scope: VaultSession['scope'] = 'vault:read'
): Promise<string> {
  const session = await getIronSession<VaultSession>(await cookies(), {
    password: (await getMasterKey()).slice(0, 32),
    cookieName: 'saos_vault_session',
    cookieOptions: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: SESSION_TTL_MS / 1000,
      path: '/api/vault',
    },
  });
  
  const now = Date.now();
  session.address = address.toLowerCase();
  session.chainId = chainId;
  session.nonce = generateNonce();
  session.issuedAt = now;
  session.expiresAt = now + SESSION_TTL_MS;
  session.scope = scope;
  await session.save();
  
  return session.nonce;
}

export async function getVaultSession(): Promise<VaultSession | null> {
  try {
    const session = await getIronSession<VaultSession>(await cookies(), {
      password: (await getMasterKey()).slice(0, 32),
      cookieName: 'saos_vault_session',
      cookieOptions: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: SESSION_TTL_MS / 1000,
        path: '/api/vault',
      },
    });
    
    if (!session.address || !session.nonce) return null;
    
    if (Date.now() > session.expiresAt) {
      await session.destroy();
      return null;
    }
    
    return session;
  } catch {
    return null;
  }
}

export async function requireVaultSession(scope?: VaultSession['scope']): Promise<VaultSession> {
  const session = await getVaultSession();
  if (!session) throw safeError('UNAUTHORIZED', 'No valid vault session');
  if (scope && session.scope !== scope && session.scope !== 'vault:admin') {
    throw safeError('FORBIDDEN', 'Insufficient scope');
  }
  return session;
}

// ─── Rate Limiting per Vault Path ───────────────────────────────────────
const VAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
  '/api/vault/login': { windowMs: 60_000, maxRequests: 10, keyPrefix: 'vault:login' },
  '/api/vault/challenge': { windowMs: 60_000, maxRequests: 20, keyPrefix: 'vault:challenge' },
  '/api/vault/verify': { windowMs: 60_000, maxRequests: 30, keyPrefix: 'vault:verify' },
  '/api/vault/status': { windowMs: 60_000, maxRequests: 60, keyPrefix: 'vault:status' },
  '/api/vault/addresses': { windowMs: 60_000, maxRequests: 30, keyPrefix: 'vault:addresses' },
  '/api/vault/estate': { windowMs: 60_000, maxRequests: 20, keyPrefix: 'vault:estate' },
  '/api/vault/crossing': { windowMs: 60_000, maxRequests: 10, keyPrefix: 'vault:crossing' },
  '/api/vault/sovereign': { windowMs: 60_000, maxRequests: 5, keyPrefix: 'vault:sovereign' },
  '/api/vault/treasury': { windowMs: 60_000, maxRequests: 10, keyPrefix: 'vault:treasury' },
  '/api/vault/logout': { windowMs: 60_000, maxRequests: 20, keyPrefix: 'vault:logout' },
};

export async function applyVaultRateLimit(pathname: string, identifier: string): Promise<{ success: boolean; retryAfter?: number }> {
  const config = VAULT_RATE_LIMITS[pathname] || { windowMs: 60_000, maxRequests: 30, keyPrefix: 'vault:default' };
  return rateLimit(identifier, config);
}

// ─── Request Validation Middleware ──────────────────────────────────────
export interface VaultRequestContext {
  session: VaultSession;
  originValid: boolean;
  clientIp: string;
}

export async function validateVaultRequest(
  requiredScope?: VaultSession['scope']
): Promise<{ success: boolean; context?: VaultRequestContext; error?: SafeError }> {
  const h = await headers();
  const origin = h.get('origin');
  const referrer = h.get('referer');
  const clientIp = h.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  
  // Origin validation
  if (!validateOrigin(origin, referrer)) {
    return { success: false, error: safeError('FORBIDDEN', 'Invalid origin') };
  }
  
  // Session validation
  let session: VaultSession;
  try {
    session = await requireVaultSession(requiredScope);
  } catch (e) {
    return { success: false, error: e as SafeError };
  }
  
  // Rate limiting
  const pathname = h.get('x-pathname') || '/api/vault/unknown';
  const rateResult = await applyVaultRateLimit(pathname, session.address);
  if (!rateResult.success) {
    return { success: false, error: safeError('RATE_LIMITED', 'Too many requests', { retryAfter: rateResult.retryAfter }) };
  }
  
  return { success: true, context: { session, originValid: true, clientIp } };
}

// ─── Secure Error Response ──────────────────────────────────────────────
export function vaultErrorResponse(error: unknown, context?: Record<string, unknown>): Response {
  const safe = safeError(error);
  const scrubbed = secretScrub(safe);
  
  auditLog('vault_api_error', { ...context, error: scrubbed });
  
  const status = safe.code === 'UNAUTHORIZED' ? 401 :
                 safe.code === 'FORBIDDEN' ? 403 :
                 safe.code === 'RATE_LIMITED' ? 429 :
                 safe.code === 'NOT_FOUND' ? 404 : 500;
  
  return new Response(JSON.stringify({ error: scrubbed }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  });
}

// ─── Vault Data Operations (stubs for API routes) ───────────────────────
export async function getVaultAddresses(address: string): Promise<string[]> {
  // Implementation depends on vault schema
  return [];
}

export async function getVaultEstate(address: string): Promise<unknown> {
  // Implementation depends on estate schema
  return {};
}

export async function executeVaultCrossing(params: unknown): Promise<unknown> {
  // Implementation depends on crossing logic
  return {};
}

export async function getSovereignStatus(address: string): Promise<unknown> {
  // Implementation depends on sovereign logic
  return {};
}

export async function getTreasuryData(address: string): Promise<unknown> {
  // Implementation depends on treasury schema
  return {};
}

// ─── Cleanup ────────────────────────────────────────────────────────────
export function cleanupExpiredNonces(): void {
  const now = Date.now();
  for (const [nonce, record] of nonceCache.entries()) {
    if (record.used || now - record.createdAt > NONCE_TTL_MS) {
      nonceCache.delete(nonce);
    }
  }
}

// Run cleanup every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupExpiredNonces, 5 * 60 * 1000);
}
