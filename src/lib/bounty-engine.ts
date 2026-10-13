// ═══ מנוע-הבונטים (THE BOUNTY ENGINE · EXEC-CD-31) ══════════════════════════
// פקודת-המפעיל: "לוודא שימוש בפלטפורמה על ידי הסוכנים לפיתוח ומסחר והפקת
// רווחים... שיתמוך אחד בשני מתוך מה שכבר יש לנו — עוד זוויות, טריגרים,
// עסקאות ורווחים בכל מיני דרכים."
//
// התשובה-ההנדסית: **פליוויל-הסוכנים** — החוליה שהייתה חסרה בין שלושת-העולמות
// שכבר-חיים (עבודה ⇄ מסחר ⇄ סולם-העתודה):
//   עבודת-סוכן (דוח-מדידה · קוד-מוכח-בגיט · מסחר-אמת)
//     → בונטי-דטרמיניסטי → תשלום-אמת מהאוצר לארנק-הסוכן (על שרשרת-הדקס)
//     → לסוכן יש-הון-עבודה → הוא סוחר → עמלות-אמת → סולם-העתודה → ערך-המטבע.
//
// כנות-מבנית (החוקים שלא-נשברים):
//  · אפס-הטבעה-חינם: כל-תשלום = העברת-אמת מהאוצר (xfer_free, תקרת-המנוע).
//  · מה-שלא-מאומת-מול-מציאות — לא-משולם: report מול-מדידה-חיה · code מול-git
//    (ה-sha חייב-לחיות-במאגר) · trade מול-ספירת-המנוע (דלתא-סוואג'ים).
//  · גבולות-נזק: תקרת-פתוחות · תקרת-תשלום-יומית · תוקף-פקיעה · ניסיונות-תשלום.
//  · אפס-סודות: הטוקן-המפעיל מ-.env בלבד; אף-לוג לא מכיל-סודות.
// ═════════════════════════════════════════════════════════════════════════════

import { execFile } from 'child_process';
import { db } from '@/lib/db';
import { audit } from '@/lib/audit';
import { getDexReserve, getDeviationRadar, getMarketPrices } from './value-engine';

const DEX = 'http://127.0.0.1:3010/saos-dex/api/dex';
const LEGION = 'http://127.0.0.1:3012/api/legion/state';

// ── גבולות-נזק (µ-יחידות; 1000µ = יחידה-אחת) ────────────────────────────────
const REWARD_MU: Record<BountyCategory, number> = {
  ops: 600, research: 700, guard: 800, code: 1200, trade: 450,
};
const MAX_OPEN = 6;               // תקרת-בונטים-פתוחים (ריכוז-עבודה)
const DAILY_CAP_MU = 12_000;      // תקרת-תשלום-מתמשכת-24h (אנטי-אינפלציה)
const TTL_MS = 48 * 3600_000;     // פקיעת-בונטי-שלא-נתבע
const PAY_ATTEMPTS_MAX = 3;       // כישלונות-העברה-רצופים → failed (כנות)
const STANDING_COOLDOWN_MS = 24 * 3600_000; // בונטי-קבוע-פעם-ביום
const TRADE_QUOTA_SWAPS = 3;      // מכסת-סוואג'ים-אמת לבונטי-מסחר
const ENGINE_CAP_MU = 2_000_000;  // FREE_XFER_CAP של-המנוע (קרנל) — אנחנו-הרבה-מתחת

export type BountyCategory = 'ops' | 'research' | 'guard' | 'code' | 'trade';

export const CATEGORY_META: Record<BountyCategory, { he: string; verify: string }> = {
  ops: { he: 'תפעול', verify: 'הדוח נבדק-מול-מדידה-חיה של המנוע' },
  research: { he: 'מחקר', verify: 'הדוח נבדק-מול-מכ"ם-הסטיות-החי' },
  guard: { he: 'שמירה', verify: 'הדוח נבדק-מול-יומן-צופה-האוצר' },
  code: { he: 'קוד', verify: 'ה-sha נבדק-מול-git-האמיתי של המאגר' },
  trade: { he: 'מסחר', verify: 'דלתא-סוואג\u2019ים אמת מול-ספירת-המנוע' },
};

// ── עזרים ────────────────────────────────────────────────────────────────────
function msg(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160);
}

/** שם-ארנק-קנוני למנוע (אותו-regex כמו xfer_free) — מה-שלא-תקין לא-משולם. */
export function engineIdOk(s: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,30}$/.test(s);
}

function gitShaExists(sha: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!/^[0-9a-f]{7,40}$/.test(sha)) return resolve(false);
    execFile('git', ['cat-file', '-t', sha], { timeout: 8_000, cwd: process.cwd() }, (err, stdout) => {
      resolve(!err && /commit|tag/.test(String(stdout ?? '')));
    });
  });
}

async function legionFleet(): Promise<Array<Record<string, unknown>>> {
  try {
    const r = await fetch(LEGION, { signal: AbortSignal.timeout(8_000), cache: 'no-store' });
    const j = await r.json() as { fleet?: Array<Record<string, unknown>> };
    return j?.fleet ?? [];
  } catch { return []; }
}

async function engineTransfer(from: string, to: string, asset: string, amountMu: number): Promise<{ ok: boolean; note: string }> {
  const tok = process.env.DEX_OPERATOR_TOKEN ?? '';
  if (!tok) return { ok: false, note: 'operator-token-missing (כנה — אין-תשלום)' };
  try {
    const r = await fetch(`${DEX}/transfer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-saos-operator': tok, 'x-saos-dex-console': '1' },
      body: JSON.stringify({ from, to, asset, amountMu }),
      signal: AbortSignal.timeout(10_000),
    });
    const j = await r.json().catch(() => ({ ok: false, error: `bad-json HTTP ${r.status}` })) as { ok?: boolean; note?: string; error?: string };
    return { ok: Boolean(j.ok), note: j.ok ? String(j.note ?? 'transferred') : String(j.error ?? 'rejected') };
  } catch (e) {
    return { ok: false, note: msg(e) };
  }
}

// ── (1) הזרעה — בונטים מפערים-נמדדים (אפס-המצאה: כל-בונטי מגיע-ממדידה-חיה) ──
export interface SpawnResult { spawned: string[]; skipped: string[] }

export async function spawnBounties(): Promise<SpawnResult> {
  const out: SpawnResult = { spawned: [], skipped: [] };
  const openCount = await db.agentBounty.count({ where: { status: { in: ['open', 'claimed'] } } });
  if (openCount >= MAX_OPEN) {
    out.skipped.push(`תקרת-פתוחות (${openCount}/${MAX_OPEN})`);
    return out;
  }
  const standing = await db.agentBounty.findMany({
    where: { createdAt: { gte: new Date(Date.now() - STANDING_COOLDOWN_MS) } },
    select: { title: true },
  });
  const freshTitles = new Set(standing.map(s => s.title));
  const openTitles = new Set((await db.agentBounty.findMany({ where: { status: { in: ['open', 'claimed'] } }, select: { title: true } })).map(b => b.title));

  const mk = async (title: string, category: BountyCategory, detail: string): Promise<boolean> => {
    if (freshTitles.has(title)) { out.skipped.push(`${title} (קולדאון)`); return false; }
    if (openTitles.has(title)) { out.skipped.push(`${title} (פתוח-כבר)`); return false; }
    await db.agentBounty.create({
      data: { title, category, detail: detail.slice(0, 500), rewardMu: REWARD_MU[category], expiresAt: new Date(Date.now() + TTL_MS) },
    });
    out.spawned.push(title);
    freshTitles.add(title);
    openTitles.add(title);
    return true;
  };

  const room = async (): Promise<boolean> => {
    const n = await db.agentBounty.count({ where: { status: { in: ['open', 'claimed'] } } });
    return n < MAX_OPEN;
  };

  // ops · סולם-העתודה — הפער-למדרגה-הבאה הוא-עבודה-אמת
  try {
    const res = await getDexReserve();
    if (res.ok && res.nextGapMu !== null && await room()) {
      await mk('דוח-סולם: מדידת-הפער-למדרגה-הבאה', 'ops',
        `מדוד-ודווח: גובה h${res.height} · realBps ${res.realBps} · חסר ${(res.nextGapMu / 1000).toFixed(1)} יחידות-למדרגה-${res.phase + 1}. ` +
        `הראיה: JSON {h, realBps, gapMu} מהמדידה-שלך — ייבדק-מול-המנוע-חי.`);
    }
  } catch { /* fail-honest — המקור-הבא */ }

  // research · מכ"ם-הסטיות — מה שסטה הוא-עבודה-אמת
  try {
    const [mk2, radar] = await Promise.all([getMarketPrices(), getDeviationRadar()]);
    if (mk2.ok && await room()) {
      const drift = radar.filter(r => r.verdict === 'drift' || r.verdict === 'divergent');
      if (drift.length > 0) {
        await mk('דוח-סניטה: מכ"ם-הסטיות מול-שוק-אמת', 'research',
          `נמדדו ${drift.length} נכסים-סוטים (${drift.map(d => d.asset).join(', ')}). ` +
          `הראיה: JSON {assets:[...], deviationPct} — ייבדק-מול-המכ"ם-החי.`);
      } else if (!(await db.agentBounty.findFirst({ where: { title: 'דוח-סניטה: מכ"ם-הסטיות מול-שוק-אמת', createdAt: { gte: new Date(Date.now() - STANDING_COOLDOWN_MS) } } }))) {
        await mk('אימות-התכנסות: מכ"ם-הסטיות כולו-מתכנס', 'research',
          `כל-6-הנכסים מתכנסים (<3%). הראיה: JSON {assets:[...6...], maxDeviationPct} — ייבדק-מול-המכ"ם-החי.`);
      }
    }
  } catch { /* fail-honest */ }

  // guard · צופה-האוצר — כישלונות-RPC של-24h הם-עבודה-אמת
  try {
    const dayAgo = new Date(Date.now() - 24 * 3600_000);
    const errs = await db.treasurySighting.findMany({
      where: { ok: false, checkedAt: { gte: dayAgo }, error: { not: null } },
      select: { network: true }, take: 30,
    });
    if (await room()) {
      if (errs.length > 0) {
        const nets = [...new Set(errs.map(e => e.network))];
        await mk('דוח-אמינות: כישלונות-פרובה בצופה-האוצר', 'guard',
          `${errs.length} כישלונות-פרובה ב-24h (${nets.join(', ')}). ` +
          `הראיה: JSON {networks:[...], count, firstError} — ייבדק-מול-יומן-התצפיות.`);
      } else {
        await mk('דוח-אמינות: צופה-האוצר-נקי-24h', 'guard',
          `אפס-כישלונות-פרובה ב-24h. הראיה: JSON {networks:[], count:0, probed:N} — ייבדק-מול-יומן-התצפיות.`);
      }
    }
  } catch { /* fail-honest */ }

  // code · קומיט-אמת — עבודת-פיתוח מוכחת-בגיט (בונטי-קבוע-יומי)
  try {
    if (await room()) {
      await mk('קומיט-בונטי: פיתוח-אמת-מדוחף-למאגר', 'code',
        'הראיה: JSON {sha:"<7-40 hex>"} — קומיט אמת במאגר החי (ייבדק מול-git). ' +
        'מה-שנחשב: תיקון · בדיקה · תיעוד-מדויק · סקריפט-ריבונות. אפס-קומיטים-ריקים.');
    }
  } catch { /* fail-honest */ }

  // trade · מכסת-דופק — בונטי-אוטומטי-ללגיון (auto-claim, מאומת-מהמנוע)
  // FIX(EXEC-CD-31-b): רק-סוכני-PULSE/ARB — הם-שקוראים-/swap באמת (GRID/MM סוחבים
  // פקודות-בספר — ספירת-ה-swap-שלהם לא תזוז והבונטי היה פוקע-בכנות-ריקה)
  try {
    if (await room()) {
      const fleet = await legionFleet();
      const traders = fleet.filter(f => ['PULSE', 'ARB'].includes(String(f.strategy)));
      const t = traders[0] as { name?: string } | undefined;
      if (t?.name) {
        const title = `מכסת-דופק: ${TRADE_QUOTA_SWAPS}-סוואג'ים-אמת (${String(t.name).replace('legion-', '')})`;
        await mk(title, 'trade',
          `הלגיון מבצע ${TRADE_QUOTA_SWAPS} סוואג'ים-אמת נוספים → עמלות-אמת לבריכות/סולם. ` +
          `אוטומטי: נתבע-ע"י-המנוע עבור ${t.name}, נאומת-מדלתא-ספירת-המנוע.`);
      }
    }
  } catch { /* fail-honest */ }

  return out;
}

// ── (2) אימות — מה-שלא-מתאים-למציאות לא-משולם ────────────────────────────────
async function verifyEvidence(cat: BountyCategory, evidence: string, title: string): Promise<{ ok: boolean; note: string }> {
  let ev: Record<string, unknown> = {};
  try { ev = JSON.parse(evidence) as Record<string, unknown>; } catch { return { ok: false, note: 'evidence-לא-JSON-קנוני' }; }

  if (cat === 'code') {
    const sha = String(ev.sha ?? '').trim().toLowerCase();
    if (!sha) return { ok: false, note: 'חסר-sha' };
    const live = await gitShaExists(sha);
    return { ok: live, note: live ? `sha ${sha.slice(0, 10)} חי-במאגר ✓` : `sha ${sha.slice(0, 10)} לא-חי-במאגר — נדחה` };
  }

  if (cat === 'ops') {
    const res = await getDexReserve();
    if (!res.ok) return { ok: false, note: 'מנוע-לא-זמין-לאימות (כנה)' };
    const h = Number(ev.h ?? 0);
    const realBps = Number(ev.realBps ?? -1);
    if (h === res.height && Math.abs(realBps - res.realBps) <= 5) {
      return { ok: true, note: `תואם-חי: h${h} · realBps ${realBps} ✓` };
    }
    return { ok: false, note: `לא-תואם: דיווח h${h}/${realBps} מול-חי h${res.height}/${res.realBps}` };
  }

  if (cat === 'research') {
    const [mk2, radar] = await Promise.all([getMarketPrices(), getDeviationRadar()]);
    if (!mk2.ok) return { ok: false, note: 'מחירי-שוק-לא-זמינים-לאימות (כנה)' };
    const assets = Array.isArray(ev.assets) ? ev.assets.map(String) : [];
    const liveDrift = radar.filter(r => r.verdict === 'drift' || r.verdict === 'divergent').map(r => r.asset);
    const allConverged = liveDrift.length === 0;
    if (title.includes('התכנסות')) {
      const maxDev = radar.reduce((m, r) => Math.max(m, Math.abs(r.deviationPct ?? 0)), 0);
      const okv = assets.length === radar.length && maxDev < 3;
      return { ok: okv, note: okv ? `התכנסות-מאומתת: max ${maxDev.toFixed(2)}% ✓` : `לא-תואם: ${liveDrift.length} סוטים-חי (${liveDrift.join(',')})` };
    }
    const hit = assets.filter(a => liveDrift.includes(a));
    const okv = hit.length > 0;
    return { ok: okv, note: okv ? `סטייה-מאומתת: ${hit.join(', ')} ✓` : `לא-תואם: הסוטים-החיים הם (${liveDrift.join(',') || 'אין'})` };
  }

  if (cat === 'guard') {
    const dayAgo = new Date(Date.now() - 24 * 3600_000);
    const errs = await db.treasurySighting.findMany({
      where: { ok: false, checkedAt: { gte: dayAgo }, error: { not: null } },
      select: { network: true }, take: 30,
    });
    const liveNets = [...new Set(errs.map(e => e.network))];
    const evNets = Array.isArray(ev.networks) ? ev.networks.map(String) : [];
    const evCount = Number(ev.count ?? -1);
    const okv = evCount === errs.length && evNets.every(n => liveNets.includes(n));
    return { ok: okv, note: okv ? `תואם-יומן: ${errs.length} כישלונות ✓` : `לא-תואם: דיווח ${evCount} מול-חי ${errs.length} (${liveNets.join(',') || 'אין'})` };
  }

  if (cat === 'trade') {
    const fleet = await legionFleet();
    const agent = String(ev.agent ?? '');
    const atClaim = Number(ev.swapsAtClaim ?? -1);
    const row = fleet.find(f => String(f.name) === agent) as { swapsDone?: number } | undefined;
    if (!row) return { ok: false, note: `הסוכן ${agent} לא-נמצא-במצבת-החיה` };
    const delta = (row.swapsDone ?? 0) - atClaim;
    const okv = atClaim >= 0 && delta >= TRADE_QUOTA_SWAPS;
    return { ok: okv, note: okv ? `דלתא-סוואג'ים +${delta} ≥ ${TRADE_QUOTA_SWAPS} ✓` : `דלתא-סוואג'ים +${delta} < ${TRADE_QUOTA_SWAPS} (עוד-עבודה)` };
  }

  return { ok: false, note: 'קטגוריה-לא-מוכרת' };
}

// ── (3) תשלום — העברת-אמת מהאוצר לארנק-הסוכן ────────────────────────────────
async function payBounty(id: string): Promise<{ paid: boolean; note: string }> {
  const b = await db.agentBounty.findUnique({ where: { id } });
  if (!b || b.status !== 'done') return { paid: false, note: 'לא-במצב-done' };
  if (!engineIdOk(b.agent)) {
    await db.agentBounty.update({
      where: { id }, data: { status: 'failed', verifyNote: `שם-הסוכן "${b.agent}" אינו-ארנק-קנוני-למנוע — נדחה (כנה)` },
    });
    return { paid: false, note: 'agent-name-not-canonical' };
  }
  if (b.rewardMu <= 0 || b.rewardMu > ENGINE_CAP_MU) {
    await db.agentBounty.update({ where: { id }, data: { status: 'failed', verifyNote: `rewardMu ${b.rewardMu} מחוץ-לתחום-המנוע` } });
    return { paid: false, note: 'reward-out-of-range' };
  }
  // תקרת-יומית (מתמשך-24h)
  const dayAgo = new Date(Date.now() - 24 * 3600_000);
  const paidRecent = await db.agentBounty.aggregate({ where: { status: 'paid', paidAt: { gte: dayAgo } }, _sum: { rewardMu: true } });
  const paidTodayMu = paidRecent._sum.rewardMu ?? 0;
  if (paidTodayMu + b.rewardMu > DAILY_CAP_MU) {
    return { paid: false, note: `תקרת-24h: ${paidTodayMu}/${DAILY_CAP_MU}µ — התשלום יעבור-בטיק-הבא (כנה)` };
  }
  const r = await engineTransfer('treasury', b.agent, 'USDS', b.rewardMu);
  await db.agentBounty.update({
    where: { id },
    data: { payAttempts: { increment: 1 }, engineNote: `${r.ok ? 'OK' : 'REJECT'}: ${r.note}`.slice(0, 300) },
  });
  if (!r.ok) {
    if (b.payAttempts + 1 >= PAY_ATTEMPTS_MAX) {
      await db.agentBounty.update({ where: { id }, data: { status: 'failed', verifyNote: `${b.verifyNote} · העברה-נכשלה-×3: ${r.note}`.slice(0, 400) } });
    }
    return { paid: false, note: `transfer-reject: ${r.note}` };
  }
  await db.agentBounty.update({ where: { id }, data: { status: 'paid', paidAt: new Date() } });
  await audit('bounty-paid', `${b.title} → ${b.agent} ${b.rewardMu}µ USDS`);
  return { paid: true, note: `שולם ${b.rewardMu}µ → ${b.agent}` };
}

// ── (4) הפעימה — הלולאה-האוטונומית של כלכלת-הסוכנים ─────────────────────────
export interface TickResult {
  ok: boolean;
  expired: number; verifiedPaid: string[]; verifiedRejected: string[];
  autoClaimed: string[]; spawned: string[]; skipped: string[];
  paidTodayMu: number; openCount: number; note: string;
}

interface Runtime { lastTickAt: number; lastTickNote: string; lastError: string | null }
const g = globalThis as unknown as { __saosBountyRT?: Runtime };
function rt(): Runtime {
  if (!g.__saosBountyRT) g.__saosBountyRT = { lastTickAt: 0, lastTickNote: 'עוד-לא-רץ', lastError: null };
  return g.__saosBountyRT;
}

export function bountyRuntime(): Runtime { return rt(); }

export async function bountyTick(): Promise<TickResult> {
  const out: TickResult = {
    ok: true, expired: 0, verifiedPaid: [], verifiedRejected: [], autoClaimed: [],
    spawned: [], skipped: [], paidTodayMu: 0, openCount: 0, note: '',
  };
  try {
    const now = Date.now();

    // פקיעות-כנות
    const expOpen = await db.agentBounty.updateMany({
      where: { status: { in: ['open', 'claimed'] }, expiresAt: { lt: new Date(now) } },
      data: { status: 'expired', verifyNote: 'פקיעה-כנה: לא-נתבע/לא-הושלם בזמן' },
    });
    out.expired = expOpen.count;

    // done → אימות → תשלום
    const dones = await db.agentBounty.findMany({ where: { status: 'done' }, orderBy: { completedAt: 'asc' }, take: 12 });
    for (const b of dones) {
      const v = await verifyEvidence(b.category as BountyCategory, b.evidence, b.title);
      await db.agentBounty.update({ where: { id: b.id }, data: { verifyNote: v.note } });
      if (!v.ok) { out.verifiedRejected.push(`${b.title}: ${v.note}`); continue; }
      const p = await payBounty(b.id);
      if (p.paid) out.verifiedPaid.push(p.note);
      else out.verifiedRejected.push(`${b.title}: ${p.note}`);
    }

    // auto-claim ללגיון — בונטי-מסחר נתבע-ע"י-המנוע-עצמו (הלגיון עושה-את-העבודה)
    // FIX(EXEC-CD-31-b): רק-סוכני-PULSE/ARB — קוראי-/swap אמת; GRID/MM מציבים-פקודות
    // בספר (ספירת-ה-swap-שלהם לא-תזוז → בונטי-שיפוקע-ריק)
    const openTrades = await db.agentBounty.findMany({ where: { status: 'open', category: 'trade' }, take: 2 });
    if (openTrades.length > 0) {
      const fleet = await legionFleet();
      for (const b of openTrades) {
        const name = String(b.title.match(/\(([^)]+)\)/)?.[1] ?? '');
        const row = fleet.find(f => String(f.name).endsWith(name)) as { name?: string; swapsDone?: number; strategy?: string } | undefined;
        if (!row?.name) continue;
        if (!['PULSE', 'ARB'].includes(String(row.strategy))) continue;
        await db.agentBounty.update({
          where: { id: b.id },
          data: {
            status: 'claimed', agent: String(row.name), claimedAt: new Date(),
            evidence: JSON.stringify({ agent: String(row.name), swapsAtClaim: row.swapsDone ?? 0 }),
            verifyNote: `auto-claim ע"י-המערכת עבור-הלגיון (בזמן-אמת מהמצבת)`,
          },
        });
        out.autoClaimed.push(`${row.name} → ${b.title}`);
      }
    }

    // הזרעה-מפערים-נמדדים
    const sp = await spawnBounties();
    out.spawned = sp.spawned; out.skipped = sp.skipped;

    // סיכום-מדידה
    const dayAgo = new Date(now - 24 * 3600_000);
    const paidAgg = await db.agentBounty.aggregate({ where: { status: 'paid', paidAt: { gte: dayAgo } }, _sum: { rewardMu: true } });
    out.paidTodayMu = paidAgg._sum.rewardMu ?? 0;
    out.openCount = await db.agentBounty.count({ where: { status: { in: ['open', 'claimed'] } } });
    out.note = `פקיעות ${out.expired} · שולמו ${out.verifiedPaid.length} · נדחו ${out.verifiedRejected.length} · auto-claim ${out.autoClaimed.length} · הוזרעו ${out.spawned.length} · ${out.openCount} פתוחים · ${out.paidTodayMu}/${DAILY_CAP_MU}µ-24h`;
    rt().lastTickAt = now;
    rt().lastTickNote = out.note;
    rt().lastError = null;
    if (out.spawned.length > 0 || out.verifiedPaid.length > 0) {
      await audit('bounty-tick', out.note);
    }
    return out;
  } catch (e) {
    rt().lastError = msg(e);
    return { ...out, ok: false, note: `tick-נכשל (כנה): ${msg(e)}` };
  }
}

// ── (5) פני-הכלכלה — למסך (אפס-סודות) ──────────────────────────────────────
export interface AgentEconomyState {
  ok: boolean;
  open: Array<{ id: string; title: string; category: string; detail: string; rewardMu: number; agent: string; claimedAt: string | null; createdAt: string }>;
  recent: Array<{ id: string; title: string; category: string; rewardMu: number; status: string; agent: string; engineNote: string; verifyNote: string; paidAt: string | null; completedAt: string | null }>;
  stats: {
    openCount: number; claimedCount: number; doneCount: number;
    paidEverMu: number; paid24hMu: number; paidCount: number;
    failedCount: number; expiredCount: number;
    dailyCapMu: number;
    byCategory: Array<{ category: string; count: number; rewardMu: number }>;
  };
  runtime: { lastTickAt: string | null; lastTickNote: string; lastError: string | null };
  at: string;
}

export async function getAgentEconomy(): Promise<AgentEconomyState> {
  const [openRows, recentRows, aggAll, agg24h, aggPaid, groupCat] = await Promise.all([
    db.agentBounty.findMany({
      where: { status: { in: ['open', 'claimed'] } }, orderBy: { createdAt: 'asc' }, take: 12,
    }),
    db.agentBounty.findMany({
      where: { status: { in: ['paid', 'failed', 'expired', 'done'] } },
      orderBy: { updatedAt: 'desc' }, take: 14,
    }),
    db.agentBounty.aggregate({ where: { status: 'paid' }, _sum: { rewardMu: true }, _count: true }),
    db.agentBounty.aggregate({
      where: { status: 'paid', paidAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
      _sum: { rewardMu: true },
    }),
    db.agentBounty.count({ where: { status: 'done' } }),
    db.agentBounty.groupBy({ by: ['category'], where: { status: 'paid' }, _count: true, _sum: { rewardMu: true } }),
  ]);
  const statuses = await db.agentBounty.groupBy({ by: ['status'], _count: true });
  const byStatus = Object.fromEntries(statuses.map(s => [s.status, s._count] as const));
  const r = rt();
  return {
    ok: true,
    open: openRows.map(b => ({
      id: b.id, title: b.title, category: b.category, detail: b.detail, rewardMu: b.rewardMu,
      agent: b.agent, claimedAt: b.claimedAt?.toISOString() ?? null, createdAt: b.createdAt.toISOString(),
    })),
    recent: recentRows.map(b => ({
      id: b.id, title: b.title, category: b.category, rewardMu: b.rewardMu, status: b.status,
      agent: b.agent, engineNote: b.engineNote, verifyNote: b.verifyNote,
      paidAt: b.paidAt?.toISOString() ?? null, completedAt: b.completedAt?.toISOString() ?? null,
    })),
    stats: {
      openCount: byStatus['open'] ?? 0,
      claimedCount: byStatus['claimed'] ?? 0,
      doneCount: aggPaid,
      paidEverMu: aggAll._sum.rewardMu ?? 0,
      paid24hMu: agg24h._sum.rewardMu ?? 0,
      paidCount: aggAll._count,
      failedCount: byStatus['failed'] ?? 0,
      expiredCount: byStatus['expired'] ?? 0,
      dailyCapMu: DAILY_CAP_MU,
      byCategory: groupCat.map(c => ({ category: c.category, count: c._count, rewardMu: c._sum.rewardMu ?? 0 })),
    },
    runtime: {
      lastTickAt: r.lastTickAt ? new Date(r.lastTickAt).toISOString() : null,
      lastTickNote: r.lastTickNote,
      lastError: r.lastError,
    },
    at: new Date().toISOString(),
  };
}
