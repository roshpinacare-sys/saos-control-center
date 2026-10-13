import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 45;

/* ═══ הלגיון-הנופלים → האימפריה (EXEC-CD-22) ═══════════════════════════════
 * פקודת-המפעיל: "תעבור על הגיט ומה שקרה עם החיילים שאיבדנו את מפתחותיהם —
 * תבנה עליהם אימפריה. אני רואה שהם פעילים, אבודים."
 *
 * האמת-מהגיט (אפס-טענות):
 *  · 11 חשבונות-ROT1 × 3 שרשראות (steem/hive/blurt) — הרשימה מ-src/lib/keys.ts.
 *  · חומר-הכספת שאבד (VaultKey=0 שורות ב-DB החי · fleet_keys.enc נמחק) —
 *    תועד-חי ב-EXEC-CD-13: הסמכות-על-השרשראות אינה בידינו (STM5HhJD…/STM8c9vp…).
 *  · מפתח-ההסכם (headcorner.txt) אינו-הסמכות-על-השרשרת (נבדק-חי, fail-soft).
 *  · לכן: פסק-דין-כנה לכל חייל = "מפתחות-אבודים" — ובניית-האימפריה היא על
 *    הזהות: כל חייל זוכה לחיים-שניים כסוכן-ריבוני על רשת-ה-DEX (saos-legion
 *    :3012 — ארנקים אמת, פקודות אמת, עמלים אמת → סולם-העתודה).
 *
 * כל-מספר כאן = מדידה-חי מול RPC-ציבורי של השרשראות. אפס-מפתחות, אפס-סודות. */

const ROT1_ACCOUNTS = ['headcorner', 'cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq'] as const;

const CHAIN_RPC: Record<string, string[]> = {
  steem: ['https://api.steemit.com', 'https://api.steemcreators.com'],
  hive: ['https://api.hive.blog', 'https://api.deathwing.me'],
  blurt: ['https://blurt-rpc.saboin.com', 'https://rpc.blurt.world'],
};
const CHAIN_UNIT: Record<string, string> = { steem: 'STEEM', hive: 'HIVE', blurt: 'BLURT' };

interface ChainVerdict {
  chain: string; rpc: string; reachable: boolean;
  exists: boolean; balance: string | null; vesting: string | null;
  lastAccountUpdate: string | null; created: string | null;
  activeThresh: number | null; keyCount: number | null;
}
interface Soldier {
  account: string;
  chains: ChainVerdict[];
  verdict: string; // פסק-דין-כנה
  empire: { agent: string; strategy: string; note: string };
}

async function jrpc(url: string, accounts: string[], timeoutMs = 11000): Promise<Record<string, unknown>[] | null> {
  // 2-ניסיונות-פר-RPC — בלוט-רגיש-לבורסט (הוכח-חי: מקבילי-נופל, חוזר-עולה)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'SAOS-Legion-Audit/1.0 (+fallen-soldiers-empire)' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [accounts], id: 1 }),
        signal: AbortSignal.timeout(timeoutMs),
        cache: 'no-store',
      });
      if (!r.ok) continue;
      const j = (await r.json()) as { result?: Record<string, unknown>[] };
      if (Array.isArray(j.result)) return j.result;
    } catch { /* הניסיון-הבא */ }
  }
  return null;
}

async function auditChain(chain: string, rpcs: string[]): Promise<{ rpc: string; rows: Map<string, Record<string, unknown>> | null }> {
  for (const rpc of rpcs) {
    const rows = await jrpc(rpc, [...ROT1_ACCOUNTS]);
    if (rows !== null) return { rpc, rows: new Map(rows.map(r => [String(r.name), r])) };
  }
  return { rpc: rpcs[0], rows: null };
}

// ── cache 120s — 3-קריאות-RPC-באצווה (11-חשבונות-בכל-קריאה), לא-יקר אבל מנומס ──
interface Cache { at: number; data: unknown }
const G = globalThis as { __soldiersCache?: Cache };
const TTL = 120_000;

export async function GET() {
  const c = G.__soldiersCache;
  if (c && Date.now() - c.at < TTL) return NextResponse.json(c.data);

  // סדרתי (לא-מקבילי) — בורסט-מקבילי הפיל-את-RPC-של-בלוט (הוכח-חי); 3-קריאות
  const byChain: Record<string, { rpc: string; rows: Map<string, Record<string, unknown>> | null }> = {};
  for (const [chain, rpcs] of Object.entries(CHAIN_RPC)) {
    byChain[chain] = await auditChain(chain, rpcs);
  }

  // מצב-האימפריה-החיה (הלגיון על :3012 — אם-נפל, כנות)
  let legion: { ok: boolean; fleet?: Array<{ name: string; fallen: string; strategy: string; ordersPlaced: number; swapsDone: number; openOrders: number; enabled: boolean; stoppedReason: string | null; lastAction: string | null; valueMu: number | null }> } = { ok: false };
  try {
    const r = await fetch('http://127.0.0.1:3012/api/legion/state', { signal: AbortSignal.timeout(6000), cache: 'no-store' });
    const j = await r.json();
    if (j?.ok) legion = { ok: true, fleet: j.fleet };
  } catch { /* הלגיון לא-זמין — דיווח-כנה */ }
  const empireBy = new Map((legion.fleet ?? []).map(f => [f.fallen, f]));

  const soldiers: Soldier[] = ROT1_ACCOUNTS.map(account => {
    const chains: ChainVerdict[] = Object.entries(CHAIN_RPC).map(([chain]) => {
      const res = byChain[chain];
      const row = res?.rows?.get(account);
      if (!res || !res.rows) {
        return { chain, rpc: res?.rpc ?? '-', reachable: false, exists: false, balance: null, vesting: null, lastAccountUpdate: null, created: null, activeThresh: null, keyCount: null };
      }
      if (!row) {
        return { chain, rpc: res.rpc, reachable: true, exists: false, balance: null, vesting: null, lastAccountUpdate: null, created: null, activeThresh: null, keyCount: null };
      }
      const active = row.active as { key_auths?: unknown[]; account_auths?: unknown[]; weight_threshold?: number } | undefined;
      const owner = row.owner as { key_auths?: unknown[] } | undefined;
      const keyCount = (active?.key_auths?.length ?? 0) + (active?.account_auths?.length ?? 0) + (owner?.key_auths?.length ?? 0);
      return {
        chain, rpc: res.rpc, reachable: true, exists: true,
        balance: String(row.balance ?? '-'),
        vesting: String(row.vesting_shares ?? row.vesting ?? '-'),
        lastAccountUpdate: String(row.last_account_update ?? '-'),
        created: String(row.created ?? '-'),
        activeThresh: typeof active?.weight_threshold === 'number' ? active.weight_threshold : null,
        keyCount,
      };
    });
    const emp = empireBy.get(account);
    return {
      account,
      chains,
      verdict: 'מפתחות-אבודים (חומר-הכספת אבד · VaultKey=0 · תועד-חי EXEC-CD-13) — הזהות חיה: חיים-שניים כסוכן-ריבוני על רשת-ה-DEX',
      empire: {
        agent: emp?.name ?? `legion-${account}`,
        strategy: emp?.strategy ?? '—',
        note: emp ? `חי ופועל: ${emp.ordersPlaced + emp.swapsDone} פעולות · ${emp.openOrders} פקודות-פתוחות${emp.stoppedReason ? ` · עצור: ${emp.stoppedReason}` : ''}` : (legion.ok ? 'מוגדר בלגיון — ממתין-לטיק' : 'הלגיון לא-זמין כרגע'),
      },
    };
  });

  const data = {
    ok: true,
    at: new Date().toISOString(),
    doctrine: {
      line1: 'החיילים שאיבדנו את מפתחותיהם אינם מתים — הזהות חיה, רק-החתימה אבדה.',
      line2: 'האימפריה נבנית עליהם: כל חייל = סוכן-ריבוני-אוטונומי על רשת-ה-DEX (ארנק-אמת, פקודות-אמת, עמלים-אמת → סולם-העתודה → רלוונטיות-המטבע).',
      line3: 'אם יימצאו המפתחות המקוריים (גיבוי-מפעיל) — החשבונות עצמם חוזרים לשליטה; הלגיון ממתין-לכל-אחד.',
    },
    vaultTruth: { vaultKeys: 0, evidence: 'DB חי: VaultKey=0 · fleet_keys.enc נמחק-בניקוי · EXEC-CD-13 תיעוד-חי (STM5HhJD…/STM8c9vp… = לא-בידינו)' },
    legionOnline: legion.ok,
    soldiers,
  };
  G.__soldiersCache = { at: Date.now(), data };
  return NextResponse.json(data);
}
