// src/lib/audit.ts
/**
 * audit.ts — Structured audit logging for SAOS control-plane routes.
 *
 * Design constraints (measured against the existing repo surface):
 *  · Zero new dependencies — uses node:crypto.randomUUID (Node 18+).
 *  · Edge-safe: no fs/net imports at module top-level; the sink is stdout
 *    (JSON-lines) which is what the log aggregator already consumes.
 *  · Never throws — audit failure must not break the request path.
 *  · Redacts secrets by key-name allowlist (WIF, token, secret, password,
 *    authorization, cookie, private, mnemonic, seed).
 *
 * The entry shape is intentionally flat + JSON-serializable so it can be
 * shipped to any aggregator (Loki/Datadog/CloudWatch) without a schema step.
 */

export type AuditDecision = "ALLOWED" | "DENIED" | "ERROR";

export interface AuditEntry {
  /** ISO-8601 timestamp of the decision. */
  ts: string;
  /** Correlation id — echoed back on the response as x-correlation-id. */
  correlationId: string;
  /** Logical route, e.g. "/api/saos/status". */
  route: string;
  /** HTTP method. */
  method: string;
  /** Decision taken by the handler. */
  decision: AuditDecision;
  /** Extracted caller identity (opaque id, never a secret). */
  identity: string | null;
  /** Extracted caller role, if any. */
  role: string | null;
  /** HTTP status code returned (0 if the handler threw before responding). */
  status: number;
  /** Wall-clock latency of the handler in milliseconds. */
  latencyMs: number;
  /** Approximate response body size in bytes (0 when unknown). */
  responseBytes: number;
  /** Sanitized request fields. */
  request: {
    path: string;
    query: Record<string, string>;
    headers: Record<string, string>;
    body: unknown;
  };
  /** Optional reason for DENIED/ERROR decisions. */
  reason?: string;
  /** Optional error message for ERROR decisions. */
  error?: string;
}

const SECRET_KEY_RE = /(authorization|cookie|token|secret|password|passwd|wif|private|mnemonic|seed|apikey|api_key|bearer)/i;

/** Redact a header/body map by key-name heuristic. */
export function redact<T extends Record<string, unknown>>(input: T | null | undefined): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (SECRET_KEY_RE.test(k)) {
      out[k] = "[REDACTED]";
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = redact(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Generate a correlation id. Falls back to a random hex string if randomUUID is unavailable. */
export function newCorrelationId(): string {
  try {
    // node:crypto — available in Node runtime; guarded for edge safety.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {
    /* fall through */
  }
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Emit a single audit entry as a JSON line on stdout.
 * Never throws — a broken sink must not break the request.
 */
export function logAudit(entry: AuditEntry): void {
  try {
    const line = JSON.stringify({ kind: "audit", ...entry });
    // stdout is the aggregator's ingestion point (see .zscripts/start.sh).
    // eslint-disable-next-line no-console
    console.log(line);
  } catch {
    /* swallow — audit must never break the request path */
  }
}

/**
 * Extract caller identity + role from request headers.
 * Order of precedence:
 *   1. x-user-id / x-user-role (explicit, set by an upstream gateway)
 *   2. Authorization: Bearer <jwt> — decode the payload (no signature check;
 *      signature verification is the job of the auth layer, not the auditor).
 *   3. Authorization: SIWE <address> — EIP-4361 style.
 * Returns { identity: null, role: null } when nothing is present.
 */
export function extractIdentity(headers: Headers): { identity: string | null; role: string | null } {
  const uid = headers.get("x-user-id");
  const role = headers.get("x-user-role");
  if (uid) return { identity: uid, role: role ?? null };

  const auth = headers.get("authorization");
  if (!auth) return { identity: null, role: null };

  const [scheme, ...rest] = auth.split(" ");
  const value = rest.join(" ").trim();
  if (!value) return { identity: null, role: null };

  if (/^bearer$/i.test(scheme)) {
    const parts = value.split(".");
    if (parts.length === 3) {
      try {
        const payload = JSON.parse(
          Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
        ) as { sub?: string; role?: string; address?: string };
        const id = payload.sub ?? payload.address ?? null;
        return { identity: id, role: payload.role ?? null };
      } catch {
        return { identity: null, role: null };
      }
    }
    return { identity: null, role: null };
  }

  if (/^siwe$/i.test(scheme)) {
    return { identity: value.toLowerCase(), role: null };
  }

  return { identity: null, role: null };
}

/** Snapshot request headers into a plain object (redacted). */
export function snapshotHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((v, k) => {
    out[k] = SECRET_KEY_RE.test(k) ? "[REDACTED]" : v;
  });
  return out;
}
