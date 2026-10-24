// ═══ שער-ה-RPC-הריבוני · גרעין-הניתוב (חף-סוקטים — ניתן-לבדיקה-טהורה) ══════
// ניתוב-לפי-הרשמות · שרשרת-פר-נושא · לחץ-אחורה-כן (דלי-אסימונים לכל-לקוח)
// · סטטיסטיקה-כנה — נשלח/נשרף לעולם לא מתואמים.

import { GENESIS, sealFrame, type Frame, type Topic } from './protocol';
import type { SovereignAuth } from './auth';
import { createAuth } from './auth';
import { newTokenBucket, takeToken, type TokenBucket } from './topics';

export interface ClientHandle {
  id: string;
  subscribed: Topic[];
  send(frame: Frame): boolean;
  stats: { sent: number; dropped: number };
}

export interface GatewayCoreOpts {
  nowMs: () => number;
  secret?: string;
  bucket?: { capacity: number; refillPerMs: number };
}

export interface GatewayStats {
  frames: number;
  dropped: number;
  clients: number;
}

export class GatewayCore {
  readonly auth: SovereignAuth | null;
  private readonly clients = new Map<string, ClientHandle>();
  private readonly buckets = new Map<string, TokenBucket>();
  private readonly prevByTopic = new Map<Topic, string>();
  private readonly seqByTopic = new Map<Topic, number>();
  private readonly lastByTopic = new Map<Topic, Frame>();
  private frames = 0;
  private dropped = 0;
  private readonly nowMs: () => number;
  private readonly bucketOpts: { capacity: number; refillPerMs: number };

  constructor(opts: GatewayCoreOpts) {
    this.nowMs = opts.nowMs;
    this.bucketOpts = opts.bucket ?? { capacity: 240, refillPerMs: 8 };
    this.auth = opts.secret ? createAuth({ secret: opts.secret, now: opts.nowMs }) : null;
  }

  registerClient(h: ClientHandle, bucketOverride?: { capacity: number; refillPerMs: number }): void {
    h.subscribed = [];
    this.clients.set(h.id, h);
    this.buckets.set(h.id, newTokenBucket(bucketOverride ?? this.bucketOpts));
  }

  removeClient(id: string): void {
    this.clients.delete(id);
    this.buckets.delete(id);
  }

  setSubscriptions(id: string, topics: Topic[]): boolean {
    const h = this.clients.get(id);
    if (!h) return false;
    h.subscribed = [...new Set(topics)];
    return true;
  }

  /** מפרסם-מסגרת-חתומה-על-השרשרת-של-הנושא אל כל-הרשומים-הבריאים. */
  publish<P>(topic: Topic, payload: P, ts?: number): Frame<P> {
    const t = ts ?? this.nowMs();
    const seq = (this.seqByTopic.get(topic) ?? 0) + 1;
    const prev = this.prevByTopic.get(topic) ?? GENESIS;
    const frame = sealFrame(topic, seq, t, payload, prev);
    this.seqByTopic.set(topic, seq);
    this.prevByTopic.set(topic, frame.hash);
    this.lastByTopic.set(topic, frame);
    this.frames++;

    for (const h of this.clients.values()) {
      if (!h.subscribed.includes(topic)) continue;
      const bucket = this.buckets.get(h.id) as TokenBucket;
      if (!takeToken(bucket, this.nowMs())) {
        this.dropped++;
        h.stats.dropped++;
        continue;
      }
      if (h.send(frame)) {
        h.stats.sent++;
      } else {
        this.dropped++;
        h.stats.dropped++;
      }
    }
    return frame;
  }

  stats(): GatewayStats {
    return { frames: this.frames, dropped: this.dropped, clients: this.clients.size };
  }

  lastFrame(topic: Topic): Frame | null {
    return this.lastByTopic.get(topic) ?? null;
  }

  lastFrameHashes(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [t, f] of this.lastByTopic) out[t] = f.hash;
    return out;
  }
}
