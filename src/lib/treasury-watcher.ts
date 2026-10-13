// ═══ צופה-האוצר (Treasury Watcher · EXEC-CD-26) ══════════════════════════════
// הריבונות עוקבת-בעצמה אחרי-היתרות-החיות של כתובות-כספת-הריפו — החיבור החסר בין
// כספת-הגיט (EXEC-CD-24) והחלפת-הכל (EXEC-CD-23): כשערך-נכנס לכתובות-הכספת,
// האוטונומיה יודעת-מיד (אירוע-מימון נרשם-ומוצג בקונסולה) — ויכולה-לפעול לפי-הדוקטרינה.
//
// חוקי-הצופה (דוקטרינה §7):
//   · קריאה-ציבורית-בלבד: RPC-ציבוריים מול-כתובות-מה-manifest. המעטפת-המוצפנת
//     לא-נפתחת-כאן-לעולם — אפס-סודות במנוע-הזה.
//   · fail-honest: RPC-נופל → תצפית ok=false + אירוע probe-error — לעולם לא 0-מזויף.
//   · כל-תצפית נרשמת (TreasurySighting), כל-שינוי-יתרה = אירוע (TreasuryEvent):
//     funding (כניסת-ערך — האירוע-הקריטי), decrease (יציאה), probe-error.
//   · לופ-אוטונומי: הדמון-הנלווה (instrumentation) מריץ סיבוב-צפייה כל-15-דקות.
import fs from 'fs';
import { MANIFEST, vaultFile, vaultExists } from './repo-vault';

export type WatchNetwork = 'evm' | 'tron' | 'bitcoin' | 'solana';

const UNITS: Record<WatchNetwork, { unit: string; decimals: number }> = {
  evm: { unit: 'ETH', decimals: 18 },
  tron: { unit: 'TRX', decimals: 6 },
  bitcoin: { unit: 'BTC', decimals: 8 },
  solana: { unit: 'SOL', decimals: 9 },
};

const ENDPOINTS: Record<WatchNetwork, string> = {
  evm: 'https://ethereum-rpc.publicnode.com',
  tron: 'https://api.trongrid.io',
  bitcoin: 'https://blockstream.info/api',
  solana: 'https://api.mainnet-beta.solana.com',
};

export interface VaultAddress {
  network: WatchNetwork;
  address: string;
}

/** כתובות-הכספת מה-manifest-הציבורי — אפס-נגיעה במעטפת. */
export function readVaultAddresses(): { label: string | null; addresses: VaultAddress[] } {
  if (!fs.existsSync(vaultFile(MANIFEST))) return { label: null, addresses: [] };
  const m = JSON.parse(fs.readFileSync(vaultFile(MANIFEST), 'utf8')) as {
    label?: string;
    networks?: Array<{ network: string; address: string }>;
  };
  const allowed: WatchNetwork[] = ['evm', 'tron', 'bitcoin', 'solana'];
  const addresses = (m.networks ?? [])
    .filter(n => allowed.includes(n.network as WatchNetwork))
    .map(n => ({ network: n.network as WatchNetwork, address: n.address }));
  return { label: m.label ?? null, addresses };
}

// ─── יחידות ───────────────────────────────────────────────────────────────────
function rawToHuman(raw: string, network: WatchNetwork): string {
  const dec = UNITS[network].decimals;
  const neg = raw.startsWith('-');
  const abs = (neg ? raw.slice(1) : raw).replace(/^0+(?=\d)/, '') || '0';
  const padded = abs.padStart(dec + 1, '0');
  const int = padded.slice(0, padded.length - dec).replace(/^0+(?=\d)/, '');
  let frac = padded.slice(padded.length - dec).replace(/0+$/, '');
  if (frac.length > 8) frac = frac.slice(0, 8).replace(/0+$/, ''); // 8-ספרות-משמעות-מספיקות-לתצוגה
  return (neg ? '-' : '') + (int || '0') + (frac ? '.' + frac : '');
}

function humanDelta(prevRaw: string, curRaw: string, network: WatchNetwork): { deltaHuman: string; kind: 'funding' | 'decrease' } {
  const p = BigInt(prevRaw || '0');
  const c = BigInt(curRaw || '0');
  const d = c - p;
  const sign = d >= BigInt(0) ? '+' : '-';
  return {
    deltaHuman: sign + rawToHuman((d >= BigInt(0) ? d : -d).toString(), network),
    kind: d >= BigInt(0) ? 'funding' : 'decrease',
  };
}

// ─── בדיקות-חי (raw-מדויק מה-RPC — fail-honest) ───────────────────────────────
export interface LiveProbe {
  network: WatchNetwork;
  address: string;
  ok: boolean;
  activated?: boolean;
  balanceRaw: string; // מחרוזת-מספר-שלם (wei/sun/sat/lamports); "0" כשנכשל
  balanceHuman: string | null;
  unit: string;
  latencyMs: number | null;
  checkedAt: string;
  error?: string;
}

async function probeOne(v: VaultAddress): Promise<LiveProbe> {
  const t0 = Date.now();
  const ep = ENDPOINTS[v.network];
  const checkedAt = new Date().toISOString();
  try {
    if (v.network === 'evm') {
      const r = await fetch(ep, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [v.address, 'latest'] }),
        signal: AbortSignal.timeout(9000),
      });
      const j = await r.json() as { result?: string; error?: unknown };
      if (!j.result) throw new Error(`rpc: ${JSON.stringify(j.error).slice(0, 120)}`);
      const raw = BigInt(j.result).toString();
      return { network: v.network, address: v.address, ok: true, activated: true, balanceRaw: raw, balanceHuman: rawToHuman(raw, 'evm'), unit: 'ETH', latencyMs: Date.now() - t0, checkedAt };
    }
    if (v.network === 'solana') {
      const r = await fetch(ep, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [v.address] }),
        signal: AbortSignal.timeout(9000),
      });
      const j = await r.json() as { result?: { value?: number }; error?: unknown };
      if (!j.result) throw new Error(`rpc: ${JSON.stringify(j.error).slice(0, 120)}`);
      const raw = String(j.result.value ?? 0);
      return { network: v.network, address: v.address, ok: true, activated: true, balanceRaw: raw, balanceHuman: rawToHuman(raw, 'solana'), unit: 'SOL', latencyMs: Date.now() - t0, checkedAt };
    }
    if (v.network === 'tron') {
      // FIX(EXEC-CD-31 · truth): /v1/accounts (REST) מדלג-על שדה-balance במצבי-מטמון
      // — נמדד-חי: זה ייצר אירוע-decrease-כוזב (1.8-TRX "נעלמו" בעוד-ה-full-node מאשר
      // שהם-במקום). עתה: /wallet/getaccount — ה-API-הסמכותי של ה-full-node, מחזיר
      // balance תמיד-כשהחשבון-קיים. חשבון-לא-מופעל (אין-address) = 0 אמיתי.
      const r = await fetch(`${ep}/wallet/getaccount`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: v.address, visible: true }),
        signal: AbortSignal.timeout(9000),
      });
      const j = await r.json() as { address?: string; balance?: number };
      if (!r.ok) throw new Error(`trongrid ${r.status}`);
      const activated = typeof j.address === 'string' && j.address.length > 0;
      const raw = String(j.balance ?? 0);
      return { network: v.network, address: v.address, ok: true, activated, balanceRaw: raw, balanceHuman: rawToHuman(raw, 'tron'), unit: 'TRX', latencyMs: Date.now() - t0, checkedAt };
    }
    // bitcoin
    const r = await fetch(`${ep}/address/${v.address}`, { signal: AbortSignal.timeout(9000) });
    if (!r.ok) throw new Error(`blockstream ${r.status}`);
    const j = await r.json() as { chain_stats: { funded_txo_sum: number; spent_txo_sum: number } };
    const raw = String(j.chain_stats.funded_txo_sum - j.chain_stats.spent_txo_sum);
    return { network: v.network, address: v.address, ok: true, activated: j.chain_stats.funded_txo_sum > 0, balanceRaw: raw, balanceHuman: rawToHuman(raw, 'bitcoin'), unit: 'BTC', latencyMs: Date.now() - t0, checkedAt };
  } catch (e) {
    return {
      network: v.network, address: v.address, ok: false, balanceRaw: '0', balanceHuman: null,
      unit: UNITS[v.network].unit, latencyMs: Date.now() - t0, checkedAt,
      error: e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160),
    };
  }
}

export async function probeAll(addresses: VaultAddress[]): Promise<LiveProbe[]> {
  return Promise.all(addresses.map(probeOne));
}

// ─── סיבוב-צפייה (watch tick) — תצפית + גילוי-אירועים ─────────────────────────
export interface WatchSummary {
  ok: boolean;
  label: string | null;
  probed: number;
  eventsCreated: number;
  probes: LiveProbe[];
  events: Array<{ network: string; kind: string; deltaHuman: string; balanceHuman: string | null; unit: string }>;
  errors: string[];
  watchedAt: string;
}

export async function watchOnce(): Promise<WatchSummary> {
  const { label, addresses } = readVaultAddresses();
  const errors: string[] = [];
  if (!vaultExists() || addresses.length === 0) {
    return { ok: false, label, probed: 0, eventsCreated: 0, probes: [], events: [], errors: ['repo-vault manifest חסר — אין-מה-לצפות'], watchedAt: new Date().toISOString() };
  }
  const probes = await probeAll(addresses);

  // תצפית-קודמת-אחרונה-פר-רשת (לגילוי-דלתא)
  const { db } = await import('./db');
  const events: WatchSummary['events'] = [];
  for (const p of probes) {
    try {
      // קודם-התצפית-הקודמת (בסיס-הדלתא), אחר-כך כתיבת-החדשה — סדר-יציב
      const prev = p.ok
        ? await db.treasurySighting.findFirst({
            where: { network: p.network, ok: true },
            orderBy: { checkedAt: 'desc' },
          })
        : null;
      await db.treasurySighting.create({
        data: {
          network: p.network, address: p.address, ok: p.ok,
          balanceRaw: p.ok ? p.balanceRaw : '0',
          balanceHuman: p.balanceHuman, unit: p.unit,
          latencyMs: p.latencyMs ?? null, error: p.error ?? null,
        },
      });
      if (p.ok && prev) {
        const { deltaHuman, kind } = humanDelta(prev.balanceRaw, p.balanceRaw, p.network);
        if (deltaHuman !== '+0' && deltaHuman !== '-0') {
          // FIX(EXEC-CD-31 · anti-false-positive): כל-ירידה מאומתת-פעמיים — פרובה-חוזרת
          // לפני-רישום האירוע. RPC-שמחזיר-0-כוזב-פעם-אחת (נמדד-חי על TRON) לא ירשום
          // אירוע-שקר לפנקס. אם-הפרובה-השנייה-סותרת → probe-error כן.
          if (kind === 'decrease') {
            await new Promise(r2 => setTimeout(r2, 1500));
            const again = await probeOne({ network: p.network, address: p.address });
            if (!again.ok) {
              await db.treasuryEvent.create({
                data: { network: p.network, address: p.address, kind: 'probe-error', deltaHuman: '0', balanceHuman: null, unit: p.unit, note: `ירידה-נצפתה-אך-פרובת-אימות-נכשלה: ${(again.error ?? '').slice(0, 100)}` },
              });
              events.push({ network: p.network, kind: 'probe-error', deltaHuman: '0', balanceHuman: null, unit: p.unit });
              continue;
            }
            const re = humanDelta(prev.balanceRaw, again.balanceRaw, p.network);
            if (re.kind !== 'decrease') {
              await db.treasuryEvent.create({
                data: { network: p.network, address: p.address, kind: 'probe-error', deltaHuman: '0', balanceHuman: again.balanceHuman, unit: p.unit, note: `ירידה-כוזבת-נתפסה: פרובה-שנייה מראה ${re.deltaHuman} ${p.unit} — האמת-לפרובה-החוזרת (RPC-שיקר)` },
              });
              // FIX(EXEC-CD-31): תצפית-מתקנת מיד — אחרת-הסיבוב-הבא יראה את-ה-0-הכוזב
              // כ-baseline וירשום funding-כוזב חזרה. כנות: התצפית-הכוזבת נשארת-בהיסטוריה.
              await db.treasurySighting.create({
                data: {
                  network: again.network, address: again.address, ok: true,
                  balanceRaw: again.balanceRaw, balanceHuman: again.balanceHuman, unit: again.unit,
                  latencyMs: again.latencyMs ?? null, error: null,
                },
              });
              events.push({ network: p.network, kind: 'probe-error', deltaHuman: '0', balanceHuman: again.balanceHuman, unit: p.unit });
              continue;
            }
          }
          const note = kind === 'funding'
            ? 'כניסת-ערך-לכספת-הריבונית — לטיפול-לפי-דוקטרינה §6 (משפך)'
            : 'ירידת-יתרה בכתובת-כספת (אומתה-פעמיים)';
          await db.treasuryEvent.create({
            data: {
              network: p.network, address: p.address, kind,
              deltaHuman, balanceHuman: p.balanceHuman, unit: p.unit, note,
            },
          });
          events.push({ network: p.network, kind, deltaHuman, balanceHuman: p.balanceHuman, unit: p.unit });
        }
      } else if (!p.ok && p.error) {
        await db.treasuryEvent.create({
          data: { network: p.network, address: p.address, kind: 'probe-error', deltaHuman: '0', balanceHuman: null, unit: p.unit, note: p.error.slice(0, 140) },
        });
        events.push({ network: p.network, kind: 'probe-error', deltaHuman: '0', balanceHuman: null, unit: p.unit });
      }
    } catch (e) {
      errors.push(`${p.network}: ${e instanceof Error ? e.message.slice(0, 120) : 'db-write failed'}`);
    }
  }

  // היגיינה: תצפיות-ישנות מ-30-ימים (אירועים-נשמרים-לעד)
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    await db.treasurySighting.deleteMany({ where: { checkedAt: { lt: cutoff } } });
  } catch { /* housekeeping best-effort */ }

  return {
    ok: errors.length === 0, label,
    probed: probes.length, eventsCreated: events.length,
    probes, events, errors,
    watchedAt: new Date().toISOString(),
  };
}

// ─── מצב-האוצר לתצוגה (בלי-כתיבה) ─────────────────────────────────────────────
export interface TreasuryState {
  ok: boolean;
  exists: boolean;
  label: string | null;
  addresses: Array<VaultAddress & { probe: LiveProbe | null }>;
  lastSightings: Array<{ network: string; ok: boolean; balanceHuman: string | null; unit: string | null; checkedAt: string }>;
  events: Array<{ network: string; address: string; kind: string; deltaHuman: string; balanceHuman: string | null; unit: string; note: string; seenAt: string }>;
  stats: { sightings: number; events: number; fundingEvents: number; lastWatchAt: string | null };
  checkedAt: string;
}

export async function getTreasuryState(): Promise<TreasuryState> {
  const { label, addresses } = readVaultAddresses();
  const exists = vaultExists() && addresses.length > 0;
  const empty: TreasuryState = {
    ok: true, exists, label, addresses: addresses.map(a => ({ ...a, probe: null })),
    lastSightings: [], events: [],
    stats: { sightings: 0, events: 0, fundingEvents: 0, lastWatchAt: null },
    checkedAt: new Date().toISOString(),
  };
  if (!exists) return empty;
  const probes = await probeAll(addresses);
  try {
    const { db } = await import('./db');
    const [lastPerNet, recentEvents, sightingsCount, eventsCount, fundingCount, lastWatch] = await Promise.all([
      db.treasurySighting.findMany({ orderBy: { checkedAt: 'desc' }, take: 40 }),
      db.treasuryEvent.findMany({ orderBy: { seenAt: 'desc' }, take: 30 }),
      db.treasurySighting.count(),
      db.treasuryEvent.count(),
      db.treasuryEvent.count({ where: { kind: 'funding' } }),
      db.treasurySighting.findFirst({ orderBy: { checkedAt: 'desc' } }),
    ]);
    const seen = new Set<string>();
    const lastSightings = lastPerNet.filter(s => { if (seen.has(s.network)) return false; seen.add(s.network); return true; })
      .map(s => ({ network: s.network, ok: s.ok, balanceHuman: s.balanceHuman, unit: s.unit, checkedAt: s.checkedAt.toISOString() }));
    return {
      ok: true, exists: true, label,
      addresses: addresses.map(a => ({ ...a, probe: probes.find(p => p.network === a.network) ?? null })),
      lastSightings,
      events: recentEvents.map(e => ({
        network: e.network, address: e.address, kind: e.kind, deltaHuman: e.deltaHuman,
        balanceHuman: e.balanceHuman, unit: e.unit, note: e.note, seenAt: e.seenAt.toISOString(),
      })),
      stats: { sightings: sightingsCount, events: eventsCount, fundingEvents: fundingCount, lastWatchAt: lastWatch?.checkedAt.toISOString() ?? null },
      checkedAt: new Date().toISOString(),
    };
  } catch {
    // DB-לא-זמין — עדיין-מחזיר תצפיות-חיות (fail-honest, בלי-היסטוריה)
    return {
      ok: true, exists: true, label,
      addresses: addresses.map(a => ({ ...a, probe: probes.find(p => p.network === a.network) ?? null })),
      lastSightings: [], events: [],
      stats: { sightings: 0, events: 0, fundingEvents: 0, lastWatchAt: null },
      checkedAt: new Date().toISOString(),
    };
  }
}
