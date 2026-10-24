// ═══ שער-ה-RPC-הריבוני · נושאים: סינון-הרשמות + דלי-אסימונים דטרמיניסטי ════

import type { Topic } from './protocol';
import { TOPICS } from './protocol';

export function makeFilter(subscribed: Topic[]): (t: Topic) => boolean {
  const set = new Set<Topic>(subscribed);
  return (t) => set.has(t);
}

export function isTopic(t: string): t is Topic {
  return (TOPICS as readonly string[]).includes(t);
}

export interface TokenBucket {
  capacity: number;
  tokens: number;
  refillPerMs: number;
  lastMs: number;
}

export function newTokenBucket({ capacity, refillPerMs }: { capacity: number; refillPerMs: number }): TokenBucket {
  return { capacity, tokens: capacity, refillPerMs, lastMs: 0 };
}

/** רפלוקס-דטרמיניסטי על-שעון-מוזרק; מחזיר true אם אסימון נלקח. */
export function takeToken(b: TokenBucket, nowMs: number): boolean {
  const elapsed = Math.max(0, nowMs - b.lastMs);
  b.tokens = Math.min(b.capacity, b.tokens + elapsed * b.refillPerMs);
  b.lastMs = nowMs;
  if (b.tokens >= 1) {
    b.tokens -= 1;
    return true;
  }
  return false;
}
