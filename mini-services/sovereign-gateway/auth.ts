// ═══ שער-ה-RPC-הריבוני · אימות HMAC — אתגר→פגישה, fail-closed ═══════════════
// סוד-ריק נדחה-בבנייה · מאקרו-זמן-קבוע · חלון-צנצנת-חד-פעמית (ריפליי נדחה)
// · שעון-מוזרק לדטרמיניזם · אפס-סודות-בקוד — הסוד מגיע מהסביבה בלבד.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface AuthPayload {
  agentId: string;
  scopes: string[];
  iat: number;
  exp: number;
  jti: string;
}

export interface VerifyOk { ok: true; payload: AuthPayload }
export interface VerifyFail { ok: false; error: string }
export type VerifyResult = VerifyOk | VerifyFail;

const b64u = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const unb64u = (s: string) => Buffer.from(s, 'base64url').toString('utf8');

const hmacHex = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('hex');

function safeEqHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export interface AuthOpts {
  secret: string;
  now?: () => number;
  rng?: () => Uint8Array;
  challengeTtlMs?: number;
}

export interface SovereignAuth {
  issueChallenge(): { nonce: string; expiresAt: number };
  verifyChallenge(nonce: string, mac: string): boolean;
  issueSession(agentId: string, scopes: string[], ttlMs: number): string;
  verifySession(token: string): VerifyResult;
}

export function createAuth(opts: AuthOpts): SovereignAuth {
  if (!opts.secret) throw new Error('createAuth: secret must be non-empty (fail-closed)');
  const now = opts.now ?? Date.now;
  const rng = opts.rng ?? (() => new Uint8Array(randomBytes(16)));
  const challengeTtl = opts.challengeTtlMs ?? 60_000;
  const pending = new Map<string, number>(); // nonce → expiresAt

  const purge = () => {
    const t = now();
    for (const [n, exp] of pending) if (exp <= t) pending.delete(n);
  };

  return {
    issueChallenge() {
      purge();
      const nonce = Buffer.from(rng()).toString('hex');
      const expiresAt = now() + challengeTtl;
      pending.set(nonce, expiresAt);
      return { nonce, expiresAt };
    },

    verifyChallenge(nonce: string, mac: string): boolean {
      purge();
      const exp = pending.get(nonce);
      if (exp === undefined || exp <= now()) {
        pending.delete(nonce);
        return false;
      }
      const expected = hmacHex(opts.secret, nonce);
      if (!safeEqHex(mac, expected)) return false;
      pending.delete(nonce); // single-use — replay refused
      return true;
    },

    issueSession(agentId: string, scopes: string[], ttlMs: number): string {
      const payload: AuthPayload = {
        agentId,
        scopes: [...scopes],
        iat: now(),
        exp: now() + ttlMs,
        jti: Buffer.from(rng()).toString('hex'),
      };
      const body = b64u(JSON.stringify(payload));
      return `${body}.${hmacHex(opts.secret, body)}`;
    },

    verifySession(token: string): VerifyResult {
      const parts = token.split('.');
      if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, error: 'malformed-token' };
      const expected = hmacHex(opts.secret, parts[0]);
      if (!safeEqHex(parts[1], expected)) return { ok: false, error: 'bad-signature' };
      let payload: AuthPayload;
      try {
        payload = JSON.parse(unb64u(parts[0])) as AuthPayload;
      } catch {
        return { ok: false, error: 'bad-payload' };
      }
      if (typeof payload.exp !== 'number' || payload.exp <= now()) return { ok: false, error: 'expired' };
      return { ok: true, payload };
    },
  };
}

export function assertScope(payload: AuthPayload, scope: string): boolean {
  return payload.scopes.includes(scope);
}
