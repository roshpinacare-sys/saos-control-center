// FIX(R16-b·M3): מגביל-קצב בזיכרון-תהליך — הנתיבים-הכבדים (login→RPC-חוץ בכל-ניסיון,
// challenge→הנפקת-אתגרים) היו פתוחים ללא-הגבלה: גורם-זר יכול-היה לכוון-את-הפלטפורמה
// להציק-לצמתי-RPC-ציבוריים ולרוקן-משבצות-חיבור. עתה: חלון-החלקה פר-IP + תקרה-מקבילית
// לאימותי-מפתח. אין-תלות-חוץ; פריסה-לוקלית (מוצהר: מוגבל-לתהליך-אחד).
import type { NextRequest } from 'next/server';

type Bucket = { hits: number[] };
const g = globalThis as unknown as { __svRate?: Map<string, Bucket> };
const store: Map<string, Bucket> = g.__svRate ?? (g.__svRate = new Map());

const gFlight = globalThis as unknown as { __svInflight?: { n: number } };
const inflight: { n: number } = gFlight.__svInflight ?? (gFlight.__svInflight = { n: 0 });

// FIX(R17-a·F1): clientIp סמך-על-**הקופץ-הראשון** ב-X-Forwarded-For — הראשון הוא
// הראש-הקלט-מהלקוח-עצמו (spoofable); מאחר-ש-:3000 קשור-לכל-הממשקים (נמדד: *:3000),
// כל-לקוח-עם-גישה-ישירה היה מסובב-דליים-פר-בקשה-עם-XFF-זיוף ועוקף-את-מגבלות-
// ה-login/challenge (מדוד-חי: spoof 8.8.8.8 → דלי-טרי-מיידי). עתה: XFF-מפורק-רק
// כש-TRUST_PROXY=1 (מאחורי-Caddy, שכותב-את-הכותר מחדש), והקופץ-**האחרון** נלקח
// (הנוסף-ע"י-הפרוקסי-שלנו); אחרת x-real-ip בלבד (Caddy) או 'local' — fail-closed.
// FIX(3-b · F6): x-real-ip נשאר-לא-נאמן-מחוץ-לשער-TRUST_PROXY בדיוק-כמו-XFF —
// קופץ-ישיר-ל-:3000 היה מזייף-x-real-ip פר-בקשה ומקבל-דלי-טרי (אותה-מחלקת-
// ליקוי-שנאטמה-ל-XFF). עתה: הכותרת נחשבת רק-מאחורי-הפרוקסי-שלנו; אחרת 'local'.
export function clientIp(req: NextRequest): string {
  if (process.env.TRUST_PROXY === '1') {
    const xf = req.headers.get('x-forwarded-for');
    if (xf) {
      const hops = xf.split(',').map((h) => h.trim()).filter(Boolean);
      if (hops.length > 0) return hops[hops.length - 1]!;
    }
    return req.headers.get('x-real-ip') ?? 'local';
  }
  return 'local';
}

/** חלון-החלקה: max-בקשות ל-windowMs-פר-מפתח. ok=false → 429 כנה עם retryAfterSec. */
export function rateLimit(key: string, max: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const b = store.get(key) ?? { hits: [] };
  b.hits = b.hits.filter((t) => now - t < windowMs);
  if (b.hits.length >= max) {
    store.set(key, b);
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - b.hits[0]!)) / 1000));
    return { ok: false, retryAfterSec };
  }
  b.hits.push(now);
  store.set(key, b);
  if (store.size > 10_000) {
    for (const [k, v] of store) {
      if (v.hits.every((t) => now - t >= windowMs)) store.delete(k);
      if (store.size <= 5_000) break;
    }
  }
  return { ok: true, retryAfterSec: 0 };
}

/** תקרה-מקבילית לאימותי-מפתח-הכבדים (RPC-חוץ) — גורם-זר לא יכול-לרוקן-משבצות. */
export const MAX_CONCURRENT_VERIFY = 4;

export function verifySlotAcquire(): boolean {
  if (inflight.n >= MAX_CONCURRENT_VERIFY) return false;
  inflight.n += 1;
  return true;
}

export function verifySlotRelease(): void {
  inflight.n = Math.max(0, inflight.n - 1);
}
