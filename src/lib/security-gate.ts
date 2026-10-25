// ═══ security-gate — the deny-by-default edge law (EMERGENCY DIRECTIVE §1) ════
// Owner order (trace 1a173c95d5ec1431, 2026-10-25): "Immediately locate and lock
// down all public web interfaces, API endpoints, and console views that allow
// unauthenticated interaction as 'Owner' … DENY-BY-DEFAULT POLICY: Immediately
// drop, log, and fail-closed any unauthenticated payload, unsigned owner request,
// or unauthorized access attempt across all endpoints."
//
// CONTRACT (pure, edge-safe — imported by src/middleware.ts; ZERO db/fs imports):
//  · gateDecision(method, pathname) is the ONE decision function:
//      - anonymous + public-read rule  → allowed (measured public surface only)
//      - request CARRIES credentials (Authorization Bearer / sv_session cookie)
//        → allowed THROUGH THE EDGE to the route's own session/agent verification
//        (the route remains fail-closed; the edge never grants anything)
//      - everything else → DENIED (deny-by-default), recorded in the deny ring
//  · DenyRing = bounded in-memory log (last DENY_RING_CAP) + one structured
//    console.warn JSON line per deny. Edge runtime cannot write the DB; the
//    persistent audit lives in src/lib/deny-audit.ts at the guarded routes.
//
// The public allowlist is READ-ONLY surface, measured from the route inventory
// (auth recon 2026-10-25): market-data proxies, public status/health reads, and
// the auth bootstrap (login/challenge/logout). NO mutation is public. NO vault
// read is anonymous. NO soldier/estate recon beyond what the routes themselves
// already publish by design law.

export interface GateDecision {
  allowed: boolean;
  /** why — machine-stable token for logs/audits: 'public-read' | 'carries-credentials' | 'deny-by-default' */
  reason: 'public-read' | 'carries-credentials' | 'deny-by-default';
}

/** Exact (method, path) or (method, prefix*) public-read rules. GET/HEAD only by law. */
const PUBLIC_RULES: Array<{ method: 'GET' | 'POST'; exact?: string[]; prefix?: string[] }> = [
  { method: 'GET', exact: ['/api/health', '/api/mesh', '/api/fuel'] },
  // market-data proxies (read-only, no state)
  { method: 'GET', prefix: ['/api/live/'] },
  { method: 'GET', exact: ['/api/swap/universe', '/api/swap/quotes', '/api/swap/chains', '/api/swap/status'] },
  // public status reads (measured public-by-design surface)
  {
    method: 'GET',
    exact: [
      '/api/saos/status', '/api/saos/revenue', '/api/saos/rpc-mesh', '/api/saos/kernel',
      '/api/saos/energy', '/api/saos/verify-pack', '/api/saos/economy', '/api/saos/custody-alert',
      '/api/saos/soldiers', '/api/saos/research',
    ],
  },
  // public GET tiers of dual-tier routes (POST stays authed)
  { method: 'GET', exact: ['/api/legion', '/api/task', '/api/chat', '/api/saos/bounty', '/api/saos/proof-status', '/api/saos/value-engine'] },
  // auth bootstrap — the door itself must be reachable
  { method: 'POST', exact: ['/api/vault/login', '/api/vault/challenge', '/api/vault/logout'] },
];

const READ_METHODS = new Set(['GET', 'HEAD']);

function ruleAllows(method: string, pathname: string): boolean {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  for (const rule of PUBLIC_RULES) {
    if (rule.method === 'GET' && !READ_METHODS.has(method)) continue;
    if (rule.method === 'POST' && method !== 'POST') continue;
    if (rule.exact?.some((p) => path === p)) return true;
    if (rule.prefix?.some((p) => path === p || path.startsWith(p))) return true;
  }
  return false;
}

/** True when the request carries credentials in EITHER carrier (Bearer header or
 * session cookie). The edge does NOT verify them (no DB on edge) — passing such
 * requests through is safe: every guarded route re-verifies and 401s on junk. */
export function carriesCredentials(headers: Headers, cookies: string | null): boolean {
  const auth = headers.get('authorization') || '';
  if (/^Bearer\s+\S+/i.test(auth)) return true;
  return typeof cookies === 'string' && cookies.length > 0;
}

/** THE decision. Fail-closed: anything not explicitly public and credential-less is denied. */
export function gateDecision(method: string, pathname: string, headers: Headers, cookies: string | null): GateDecision {
  if (carriesCredentials(headers, cookies)) return { allowed: true, reason: 'carries-credentials' };
  if (ruleAllows(method, pathname)) return { allowed: true, reason: 'public-read' };
  return { allowed: false, reason: 'deny-by-default' };
}

// ── the deny ring (bounded, honest about being per-instance memory) ──────────
export interface DenyRecord {
  at: string;
  method: string;
  path: string;
  ip: string;
  ua: string; // truncated user-agent — never any body/payload content
}

const DENY_RING_CAP = 500;
const denyRing: DenyRecord[] = [];

export function recordDeny(rec: Omit<DenyRecord, 'at'>): DenyRecord {
  const full: DenyRecord = { ...rec, at: new Date().toISOString() };
  denyRing.push(full);
  if (denyRing.length > DENY_RING_CAP) denyRing.splice(0, denyRing.length - DENY_RING_CAP);
  // structured line — drop+log per the directive; never logs payloads/keys
  console.warn(JSON.stringify({ sev: 'security-deny', ...full }));
  return full;
}

export function recentDenies(limit = 100): DenyRecord[] {
  return denyRing.slice(-Math.max(1, Math.min(limit, DENY_RING_CAP)));
}

export function clearDeniesForTest(): void {
  denyRing.length = 0;
}

export const DENY_RING_SIZE = DENY_RING_CAP;
