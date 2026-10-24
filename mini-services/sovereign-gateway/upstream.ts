// ═══ שער-ה-RPC-הריבוני · מתאם-ספר-כלכלת-הצי (fleet-economy) ═════════════════
// הספר-החי ב-:3016 — /health (seq·lastH) · /ledger?limit=N (tail).
// חוק-הכנות: כישלון-מקור = null כנה — לעולם לא ממציאים-מצב-ספר.

export interface LedgerHealth {
  ok: boolean;
  engine: string;
  seq: number;
  uptimeMs: number;
  lastH: string;
}

export interface LedgerEntry {
  seq: number;
  ts: number;
  kind: string;
  from: string;
  to: string;
  asset: string;
  amount: number;
  fee?: number;
  price?: number;
  outUsds?: number;
  reason?: string;
  h: string;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

async function fetchJson<T>(f: FetchLike, url: string, timeoutMs: number): Promise<T | null> {
  try {
    const res = await f(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function pollHealth(baseUrl: string, f: FetchLike = fetch, timeoutMs = 3000): Promise<LedgerHealth | null> {
  const j = await fetchJson<Partial<LedgerHealth>>(f, `${baseUrl}/health`, timeoutMs);
  if (!j || j.ok !== true || typeof j.seq !== 'number' || typeof j.engine !== 'string' || typeof j.lastH !== 'string') return null;
  return { ok: true, engine: j.engine, seq: j.seq, uptimeMs: typeof j.uptimeMs === 'number' ? j.uptimeMs : 0, lastH: j.lastH };
}

export async function pollLedger(baseUrl: string, limit: number, f: FetchLike = fetch, timeoutMs = 3000): Promise<{ tail: LedgerEntry[] } | null> {
  const j = await fetchJson<{ tail?: unknown }>(f, `${baseUrl}/ledger?limit=${limit}`, timeoutMs);
  if (!j || !Array.isArray(j.tail)) return null;
  const tail = j.tail.filter(
    (e): e is LedgerEntry =>
      !!e && typeof e === 'object' &&
      typeof (e as LedgerEntry).seq === 'number' &&
      typeof (e as LedgerEntry).kind === 'string' &&
      typeof (e as LedgerEntry).h === 'string',
  );
  return { tail };
}

/** הפרש-חי: רק seq>lastSeq, עולה; nextSeq תמיד נאמן (גם בריק). */
export function deltaSince(tail: LedgerEntry[], lastSeq: number): { entries: LedgerEntry[]; nextSeq: number } {
  const entries = tail.filter((e) => e.seq > lastSeq).sort((a, b) => a.seq - b.seq);
  const nextSeq = entries.length > 0 ? entries[entries.length - 1].seq : lastSeq;
  return { entries, nextSeq };
}
