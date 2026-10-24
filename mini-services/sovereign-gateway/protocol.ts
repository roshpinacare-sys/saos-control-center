// ═══ שער-ה-RPC-הריבוני · פרוטוקול-מסגרות-שרשרת-גיבוב ═══════════════════════
// כל-מסגרת חתומה: hash = sha256(canonJson(frame − hash)) · prev = קודם-באותו-נושא.
// חוק-הצי: canonical-JSON יציב-מפתחות · שרשרת-נושא-בפני-עצמה · אימות-כנה-של-פסיים.

import { createHash } from 'node:crypto';

export const GENESIS = '0'.repeat(64);

export const TOPICS = ['ledger.health', 'ledger.state', 'mesh.status', 'gateway.stats'] as const;
export type Topic = (typeof TOPICS)[number];

export interface Frame<P = unknown> {
  v: 1;
  topic: Topic;
  seq: number;
  ts: number;
  payload: P;
  prev: string;
  hash: string;
}

/** JSON קאנוני: מפתחות-ממוינים-רקורסיבית · סדר-מערכים-נשמר · דחייה-קולנית-של-לא-בטוח. */
export function canonJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (v === null) return null;
    const t = typeof v;
    if (t === 'string' || t === 'boolean') return v;
    if (t === 'number') {
      if (!Number.isFinite(v as number)) throw new TypeError('canonJson: non-finite number');
      return v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (t === 'object') {
      const o = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(o).sort()) {
        const w = walk(o[k]);
        if (w !== undefined) out[k] = w;
      }
      return out;
    }
    throw new TypeError(`canonJson: unsupported value of type ${t}`);
  };
  const walked = walk(value);
  if (walked === undefined) throw new TypeError('canonJson: empty value');
  return JSON.stringify(walked);
}

function frameHash(f: Omit<Frame, 'hash'>): string {
  return createHash('sha256').update(canonJson(f)).digest('hex');
}

/** אוטמת-מסגרת-חדשה על-גבי-השרשרת-של-הנושא. */
export function sealFrame<P>(topic: Topic, seq: number, ts: number, payload: P, prev: string): Frame<P> {
  const base = { v: 1 as const, topic, seq, ts, payload, prev };
  return { ...base, hash: frameHash(base) };
}

export interface ChainVerdict { ok: boolean; verified: number; seams: number[] }

/**
 * אימות-שרשרת:
 *  (1) שלמות-עצמית של כל-מסגרת — hash == חישוב-מחדש (ה-hash מכסה גם prev וגם seq).
 *  (2) קישוריות-עמדתית — prev/hash-של-הקודם-ברשימה-באותו-נושא ו-seq-עוקב.
 * verified = מסגרות-שעברו-שלמות-עצמית · פסיים כנים · תואם-פרוסות (slice-friendly).
 */
export function verifyChain(frames: Frame[]): ChainVerdict {
  const seams: number[] = [];
  let verified = 0;
  const lastByTopic = new Map<Topic, Frame>();
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const { hash, ...rest } = f;
    const ownOk = f.v === 1 && frameHash(rest) === hash;
    if (ownOk) {
      verified++;
    } else {
      seams.push(i);
    }
    const prevSame = lastByTopic.get(f.topic);
    if (prevSame && (f.prev !== prevSame.hash || f.seq !== prevSame.seq + 1) && !seams.includes(i)) {
      seams.push(i);
    }
    lastByTopic.set(f.topic, f);
  }
  return { ok: seams.length === 0, verified, seams };
}
