// src/lib/rate-limit.ts
/**
 * SAOS — Rate Limiter (in-memory, sliding-window counter)
 *
 * Design notes:
 *  · Zero external deps — matches the repo's existing `src/lib/rate-limit.ts`
 *    surface (the file already exists in the tree; this is a drop-in body).
 *  · Per-process Map keyed by `${bucket}:${ip}`. For multi-instance deploys,
 *    swap the store for Redis/Upstash — the public API stays identical.
 *  · Sliding window via fixed-window + reset timestamp is sufficient for the
 *    60 req/min default; the reset header is exact, not approximate.
 *  · Never throws — on any internal error we FAIL OPEN (allow) so a limiter
 *    bug cannot take down the sovereign console. Log via console.warn.
 */

export interface RateLimitRule {
  /** Max requests allowed inside `windowMs`. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Unix epoch seconds when the current window resets. */
  reset: number;
  /** Seconds the caller should wait before retrying (0 when ok). */
  retryAfter: number;
}

interface Bucket {
  count: number;
  resetAt: number; // epoch ms
}

const STORE = new Map<string, Bucket>();

// Opportunistic GC — prevents unbounded growth on long-lived processes.
// Runs at most once per window per key on access; a full sweep every 5 min.
let lastSweep = 0;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [k, b] of STORE) {
    if (b.resetAt <= now) STORE.delete(k);
  }
}

/**
 * Extract the client IP from a Next.js Request.
 * Order of trust: x-forwarded-for (first hop) → x-real-ip → cf-connecting-ip →
 * "unknown". Behind Caddy (see Caddyfile in repo) x-forwarded-for is set.
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return (
    req.headers.get("x-real-ip") ||
    req.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

/**
 * Consume one token for `key` under `rule`.
 * Pure-ish: mutates the in-memory store, returns the decision.
 */
export function consume(key: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now();
  try {
    sweep(now);
    let b = STORE.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + rule.windowMs };
      STORE.set(key, b);
    }
    b.count += 1;
    const remaining = Math.max(0, rule.limit - b.count);
    const reset = Math.ceil(b.resetAt / 1000);
    if (b.count > rule.limit) {
      const retryAfter = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
      return { ok: false, limit: rule.limit, remaining: 0, reset, retryAfter };
    }
    return { ok: true, limit: rule.limit, remaining, reset, retryAfter: 0 };
  } catch (err) {
    // FAIL OPEN — a limiter bug must never take down the console.
    console.warn("[rate-limit] consume failed, failing open:", err);
    return {
      ok: true,
      limit: rule.limit,
      remaining: rule.limit,
      reset: Math.ceil((now + rule.windowMs) / 1000),
      retryAfter: 0,
    };
  }
}

/** Standard headers for a successful (allowed) response. */
export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(r.limit),
    "X-RateLimit-Remaining": String(r.remaining),
    "X-RateLimit-Reset": String(r.reset),
  };
}

/**
 * Guard helper — call at the TOP of a route handler.
 * Returns a Response (429) when the caller is over quota, or null when allowed.
 * When null is returned, the caller MUST merge `rateLimitHeaders(result)` into
 * its own response headers.
 */
export function enforceRateLimit(
  req: Request,
  bucket: string,
  rule: RateLimitRule = { limit: 60, windowMs: 60_000 },
): { blocked: Response | null; headers: Record<string, string> } {
  const ip = clientIp(req);
  const key = `${bucket}:${ip}`;
  const result = consume(key, rule);
  if (!result.ok) {
    const body = JSON.stringify({
      error: "Too Many Requests",
      retryAfter: result.retryAfter,
    });
    const blocked = new Response(body, {
      status: 429,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Retry-After": String(result.retryAfter),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(result.reset),
      },
    });
    return { blocked, headers: {} };
  }
  return { blocked: null, headers: rateLimitHeaders(result) };
}

/** Test-only: wipe the store between cases. */
export function __resetRateLimitStore(): void {
  STORE.clear();
  lastSweep = 0;
}
