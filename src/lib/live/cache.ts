// ═══ גשר-החי · זיכרון-מטמון ריבוני ══════════════════════════════════════════
// מטמון-TTL בזיכרון-התהליך בלבד + single-flight — אפס-תשתית-חוץ (Redis/MySQL
// נמנעו לפי הדוקטרינה הריבונית: הקונסולה מחזיקה את האמת שלה בעצמה).
// כל-ערך-שנשמר = נתון-אמת שהגיע-ממקור-חוץ-אמת; פקיעת-TTL = שליפה-מחדש או
// כישלון-גלוי — אף-פעם לא מגישים-ישן-כ"חי" בלי סימון-stale.

export interface CacheEntry<T> {
  value: T;
  cachedAt: number;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();
const MAX_ENTRIES = 600;

export function cacheGet<T>(key: string, allowExpired = false): CacheEntry<T> | null {
  const e = store.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) {
    if (!allowExpired) {
      store.delete(key);
      return null;
    }
    // allowExpired: ידוע-אחרון — מוחזר-למטרות-כנות-עם סימון-stale (הקורא מחויב לסמן)
  }
  return e as CacheEntry<T>;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): CacheEntry<T> {
  const entry: CacheEntry<T> = { value, cachedAt: Date.now(), expiresAt: Date.now() + ttlMs };
  store.set(key, entry as CacheEntry<unknown>);
  if (store.size > MAX_ENTRIES) {
    const now = Date.now();
    for (const [k, v] of store) if (now > v.expiresAt) store.delete(k);
    while (store.size > MAX_ENTRIES) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
  }
  return entry;
}

/** מטמון-שקוף: מחזיר אם-טרי, אחרת מבצע ושומר. */
export async function cached<T>(key: string, ttlMs: number, produce: () => Promise<T>): Promise<CacheEntry<T>> {
  const hit = cacheGet<T>(key);
  if (hit) return hit;
  const value = await produce();
  return cacheSet(key, value, ttlMs);
}

const flights = new Map<string, Promise<unknown>>();

/** dedup-פרוצדורלי: בקשות-מקבילות-זהות חולקות טיסה-אחת (מגן-על-מגבלות-קצב של מקורות-חוץ). */
export async function singleFlight<T>(key: string, produce: () => Promise<T>): Promise<T> {
  const existing = flights.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = produce().finally(() => flights.delete(key));
  flights.set(key, p);
  return p;
}

/** fetch-קפדני: timeout-כפוי + no-store + שגיאת-HTTP-גלויה (אין-בליעה). */
export async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = 10000): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status} מ-${url.split('/')[2]}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}
