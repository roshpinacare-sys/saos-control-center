// ═══ rc-rebalance · auth — bearer token, fail-closed, constant-time (§1 law) ══
// Zero secrets in code: the token arrives from the environment only. An empty
// configured token refuses EVERYTHING (fail-closed) — the data surface never
// opens "by accident". Comparison is over sha256 digests so length and content
// both run in constant time (timingSafeEqual).

import { createHash, timingSafeEqual } from 'node:crypto';

export function extractBearer(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

export function verifyBearerToken(presented: string, configured: string): boolean {
  if (!configured || !presented) return false; // fail-closed: no token configured → refuse all
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(configured).digest();
  return timingSafeEqual(a, b);
}
