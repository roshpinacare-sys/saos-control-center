'use client';

// ─── GridOpsView (EXEC-CD-10) — מרכז-החיים של רשת-הגריד על שוק-STEEM ═══════
// הבעלים: "אין-לי נתוני-פעילות מסודרים של-הפוזיציות והכל שם כלום" — מענה אחד
// מאורגן: הפוזיציה-האמת · הסולם-החי (offer) · הפקודות-הפתוחות על-השרשרת ·
// מילויים-אמת עם-edge · 36 החיילים · סורק-הארב · אמת-המשמור · דופק-התאום ·
// ומפת-החיבור "איך זה מתחבר פה" — הכל חי מ-/saos-dex/api/dex/grid/ops,
// שקורא רק קובצי-אמת שהתאום (grid-trigger-twin[bot]) מחייב-לגיט. אפס-המצאה.

import { useCallback, useMemo, useState } from 'react';
import {
  Activity, Bot, Timer, ShieldAlert, Landmark, Zap, Coins, Gauge,
  Repeat, Ban, BadgeCheck, GitCommit, Wallet, Waypoints,
} from 'lucide-react';
import { fmtInt, usePoll, StaleChip } from './common';

/* ── חוזה-הנתונים (שיקוף-ה-API; השדות שה-UI באמת מציג) ── */
type Tick = { sha: string; at: string; msg: string };
type Soldier = {
  id: string; strategy: string; active: boolean;
  inventoryMu: number; pnlSimMu: number; lastNote: string;
  levels: number | null; widthBps: number | null; capMu: number | null;
};
type GridOps = {
  ok: boolean;
  asof: string;
  sources: Record<string, { mtime: string | null; error: string | null }>;
  twin: {
    asof: string | null; runCount: number; spawnCount: number;
    market: { refPrice: number | null; source: string | null; stale: boolean; calmBps: number | null };
    feeMeter: {
      simMu: number; simFills: number; realMu: number; realFills: number;
      milestonesHit: number[]; queue: string[]; realSbdDelta: number | null;
      realPnl: {
        buys: number; sells: number; boughtSteem: number; spentSbd: number;
        soldSteem: number; proceedsSbd: number; realizedSbd: number;
        positionSteem: number; positionCostSbd: number; openAvgCost: number | null;
      };
    };
    fleetCap: { globalCapMu?: number; note?: string } | null;
    soldiersSummary: { count: number; active: number; totalInventoryMu: number; totalPnlSimMu: number };
    soldiers: Soldier[];
  };
  offer: {
    publishedAt: string | null; verdict: string | null; blocker: string[];
    account: string | null; chain: string | null;
    marks: { steemUsd: number | null; sbdUsd: number | null; paritySbdPerSteem: number | null; convertArb: { discountPct: number | null; verdict: string | null; lockDays: number | null } };
    book: { bestBid: number | null; bestAsk: number | null; mid: number | null; spreadBps: number | null };
    inventory: { steem: number | null; sbd: number | null };
    openOrdersNow: number | null; parityBps: number | null;
    drag: { k: number | null; spreadBps: number | null; effAskStepBps: number | null; effBidStepBps: number | null };
    plan: {
      asks: Array<{ level: number; priceSbdPerSteem: number | null; sizeSteem: number | null; kind: string }>;
      bids: Array<{ level: number; priceSbdPerSteem: number | null; sizeSteem: number | null; kind: string }>;
      totals: Record<string, unknown> | null;
    };
  } | null;
  real: {
    placedTotal: number; filledTotal: number; cancelledTotal: number; externalFlowUsd: number;
    counts: { orders: number; fills: number };
    openOrders: Array<{ id: number; at: string; side: string; chain: string; sell: string; receive: string; priceSbdPerSteem: number; status: string }>;
    recentOrders: Array<{ id: number; at: string; side: string; sell: string; receive: string; priceSbdPerSteem: number; status: string }>;
    recentFills: Array<{ at: string; side: string; direction: string; chain: string; paid: string; received: string; edgeBps: number | null }>;
  } | null;
  arb: {
    generatedAt: string | null; count: number;
    cumulative: Record<string, unknown> | null;
    recent: Array<{ ts: string; pair: string; edgeBps: number | null; executableSize: number | null; realness: string; paperPnlSbd: number | null; degraded: boolean; notes: string }>;
  } | null;
  custody: {
    at: string | null; account: string | null;
    rows: Array<{ chain: string; venue: string; asset: string; amount: string | null; ownership: string | null; realness: string; note: string | null }>;
  } | null;
  route: Record<string, unknown> | null;
  heartbeat: { ticks: Tick[]; error: string | null; fetchedAt: string };
  connection: Array<{ step: number; title: string; detail: string; live: string }>;
  honesty: string;
};

/* ── עזרים ── */
function fmtN(n: number | null | undefined, digits = 3): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}
function agoOf(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}ש׳`;
  if (s < 3600) return `${Math.floor(s / 60)}ד׳`;
  if (s < 86400) return `${Math.floor(s / 3600)}ש׳`;
  return `${Math.floor(s / 86400)}י׳`;
}
function edgeCls(bps: number | null): string {
  if (bps === null) return 'text-[color:var(--text-3)]';
  return bps >= 0 ? 'text-[color:var(--green)]' : 'text-[color:var(--red)]';
}
function realnessCls(r: string): string {
  if (r === 'ONCHAIN_REAL') return 'text-[color:var(--green)] border-[color:var(--green)]/50';
  if (r === 'L2_REAL' || r === 'MEASURED') return 'text-[color:var(--text-1)] border-[color:var(--line-strong)]';
  if (r === 'PAPER' || r === 'CEX_REF') return 'text-[color:var(--amber)] border-[color:var(--amber)]/50';
  return 'text-[color:var(--red)] border-[color:var(--red)]/50';
}
const SOLDIER_FILTERS = [
  { id: 'all', label: 'הכל' },
  { id: 'supremacy', label: 'supremacy' },
  { id: 'mm-grid', label: 'mm-grid' },
  { id: 'anchor-quote', label: 'anchor' },
  { id: 'other', label: 'אחרים' },
] as const;

export function GridOpsView() {
  const [data, setData] = useState<GridOps | null>(null);
  const [soldierFilter, setSoldierFilter] = useState<string>('all');
  const fetcher = useCallback(async (): Promise<boolean> => {
    try {
      const r = await fetch('/saos-dex/api/dex/grid/ops', { cache: 'no-store', signal: AbortSignal.timeout(20000) });
      const j = (await r.json()) as GridOps;
      if (j.ok) { setData(j); return true; }
      return false;
    } catch { return false; }
  }, []);
  const stale = usePoll(fetcher, 30_000);

  const d = data;
  const soldiersShown = useMemo(() => {
    if (!d) return [];
    const list = d.twin.soldiers;
    if (soldierFilter === 'all') return list;
    if (soldierFilter === 'other') return list.filter(s => !['supremacy', 'mm-grid', 'anchor-quote'].includes(s.strategy));
    return list.filter(s => s.strategy === soldierFilter);
  }, [d, soldierFilter]);

  if (!d) {
    return (
      <div className="flex items-center justify-center py-16 text-sm opacity-60">
        <Activity className="w-4 h-4 ml-2 animate-pulse" />
        טוען את מרכז-החיים של רשת-הגריד מקובצי-האמת…
      </div>
    );
  }

  const rp = d.twin.feeMeter.realPnl;
  const of = d.offer;
  const real = d.real;
  const verdict = of?.verdict ?? '—';
  const offerReady = verdict === 'OFFER-READY';

  return (
    <div className="space-y-4" data-testid="grid-ops-view">
      {/* ── כותרת ── */}
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="w-9 h-9 rounded-xl dx-raised flex items-center justify-center shrink-0">
          <Zap className="w-4.5 h-4.5 text-[color:var(--pink)]" />
        </span>
        <div className="min-w-0">
          <h1 className="text-[16px] font-extrabold leading-tight">גריד-STEEM · מרכז-החיים</h1>
          <p className="text-[11px] text-[color:var(--text-3)]">
            פוזיציות · פעילות · הסולם-החי · החיבור ל-DEX — הכל מקובצי-אמת שהתאום מחייב-לגיט ·
            <span className="dx-num" dir="ltr"> run #{fmtInt(d.twin.runCount)}</span>
          </p>
        </div>
        <div className="flex-1" />
        <StaleChip show={stale} />
        <span className="dx-chip h-8 px-2.5 hidden sm:flex items-center gap-1.5 text-[10.5px]">
          <Timer className="w-3 h-3" />
          תאום <span className="dx-num" dir="ltr">{agoOf(d.twin.asof)}</span>
          · הצעה <span className="dx-num" dir="ltr">{agoOf(of?.publishedAt ?? null)}</span>
          · פנקס <span className="dx-num" dir="ltr">{agoOf(d.sources?.ledger?.mtime ?? null)}</span>
        </span>
      </div>

      {/* ── KPI — הפוזיציות-האמת ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {/* פוזיציה-אמת על שוק-STEEM */}
        <div className="dx-card rounded-2xl p-4" data-testid="grid-position">
          <div className="flex items-center gap-1.5 text-[11px] text-[color:var(--text-3)] mb-2">
            <Wallet className="w-3.5 h-3.5" /> פוזיציה-אמת על שוק-STEEM הפנימי
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[26px] font-black dx-num leading-none" dir="ltr">{fmtN(rp.positionSteem, 3)}</span>
            <span className="text-[12px] font-bold text-[color:var(--text-2)]">STEEM</span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1.5 text-[10.5px]">
            <div><div className="text-[color:var(--text-3)]">עלות-ממוצעת</div><div className="dx-num font-semibold" dir="ltr">{fmtN(rp.openAvgCost, 6)}</div></div>
            <div><div className="text-[color:var(--text-3)]">עלות-סגורה</div><div className="dx-num font-semibold" dir="ltr">{fmtN(rp.positionCostSbd, 3)} SBD</div></div>
            <div><div className="text-[color:var(--text-3)]">realized</div>
              <div className={`dx-num font-semibold ${rp.realizedSbd >= 0 ? 'text-[color:var(--green)]' : 'text-[color:var(--red)]'}`} dir="ltr">{fmtN(rp.realizedSbd, 3)} SBD</div></div>
          </div>
          <div className="mt-2 text-[10px] text-[color:var(--text-3)] dx-num" dir="ltr">
            buys {fmtInt(rp.buys)} · sells {fmtInt(rp.sells)} · sold {fmtN(rp.soldSteem, 1)} STEEM → {fmtN(rp.proceedsSbd, 2)} SBD
          </div>
        </div>

        {/* פעילות-אמת */}
        <div className="dx-card rounded-2xl p-4" data-testid="grid-activity">
          <div className="flex items-center gap-1.5 text-[11px] text-[color:var(--text-3)] mb-2">
            <Repeat className="w-3.5 h-3.5" /> פעילות-אמת (פנקס grid-beat)
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="dx-raised rounded-xl py-2"><div className="text-[18px] font-black dx-num" dir="ltr">{fmtInt(real?.placedTotal ?? 0)}</div><div className="text-[10px] text-[color:var(--text-3)]">הוצבו</div></div>
            <div className="dx-raised rounded-xl py-2"><div className="text-[18px] font-black dx-num text-[color:var(--green)]" dir="ltr">{fmtInt(real?.filledTotal ?? 0)}</div><div className="text-[10px] text-[color:var(--text-3)]">מולאו</div></div>
            <div className="dx-raised rounded-xl py-2"><div className="text-[18px] font-black dx-num" dir="ltr">{fmtInt(real?.cancelledTotal ?? 0)}</div><div className="text-[10px] text-[color:var(--text-3)]">בוטלו</div></div>
          </div>
          <div className="mt-2 flex items-center justify-between text-[10.5px]">
            <span className="text-[color:var(--text-3)]">פקודות-פתוחות על-השרשרת</span>
            <span className="dx-num font-bold" dir="ltr">{fmtInt(of?.openOrdersNow ?? 0)}</span>
          </div>
          <div className="flex items-center justify-between text-[10.5px]">
            <span className="text-[color:var(--text-3)]">נזילות-חוץ נטו (ציון-USD)</span>
            <span className="dx-num font-semibold" dir="ltr">${fmtN(real?.externalFlowUsd ?? 0, 3)}</span>
          </div>
        </div>

        {/* מד-העמלות — מנוע-הלידה */}
        <div className="dx-card rounded-2xl p-4" data-testid="grid-feemeter">
          <div className="flex items-center gap-1.5 text-[11px] text-[color:var(--text-3)] mb-2">
            <Gauge className="w-3.5 h-3.5" /> מד-העמלות · מנוע-לידת-גרידים
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[26px] font-black dx-num leading-none" dir="ltr">{fmtN(d.twin.feeMeter.simMu, 0)}</span>
            <span className="text-[12px] font-bold text-[color:var(--text-2)]">µ sim</span>
            <span className="text-[10.5px] text-[color:var(--text-3)] dx-num" dir="ltr">מ-{fmtInt(d.twin.feeMeter.simFills)} מילויים</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
            {d.twin.feeMeter.milestonesHit.map((m, i) => (
              <span key={i} className="dx-chip px-2 py-0.5 dx-num text-[color:var(--green)]" dir="ltr">{fmtN(m, 0)}µ ✓</span>
            ))}
            <span className="dx-chip px-2 py-0.5 text-[color:var(--text-3)]">realFills <span className="dx-num" dir="ltr">{fmtInt(d.twin.feeMeter.realFills)}</span></span>
          </div>
          <div className="mt-2 text-[10.5px]">
            <span className="text-[color:var(--text-3)]">תור-לידה: </span>
            <span className="dx-num" dir="ltr">{d.twin.feeMeter.queue.join(' → ') || '—'}</span>
            <span className="text-[color:var(--text-3)]"> · spawn {fmtInt(d.twin.spawnCount)}</span>
          </div>
        </div>

        {/* אמת-השוק */}
        <div className="dx-card rounded-2xl p-4" data-testid="grid-market">
          <div className="flex items-center gap-1.5 text-[11px] text-[color:var(--text-3)] mb-2">
            <Coins className="w-3.5 h-3.5" /> אמת-השוק (feed + פאריטי-חוץ)
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[26px] font-black dx-num leading-none" dir="ltr">{fmtN(d.twin.market.refPrice, 6)}</span>
            <span className="text-[11px] text-[color:var(--text-3)]">SBD/STEEM {d.twin.market.source ? `· ${d.twin.market.source}` : ''}</span>
            {d.twin.market.stale && <span className="dx-chip px-1.5 py-0.5 text-[9.5px] text-[color:var(--amber)] border-[color:var(--amber)]/50">stale</span>}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1.5 text-[10.5px]">
            <div><div className="text-[color:var(--text-3)]">parity חוץ</div><div className="dx-num font-semibold" dir="ltr">{fmtN(of?.marks.paritySbdPerSteem, 6)}</div></div>
            <div><div className="text-[color:var(--text-3)]">סטייה</div><div className="dx-num font-semibold" dir="ltr">{fmtN(of?.parityBps, 0)} bps</div></div>
            <div><div className="text-[color:var(--text-3)]">פיזור-ספר</div><div className="dx-num font-semibold" dir="ltr">{fmtN(of?.book.spreadBps, 0)} bps</div></div>
          </div>
          <div className="mt-2 text-[10px] text-[color:var(--text-3)] dx-num" dir="ltr">
            STEEM ${fmtN(of?.marks.steemUsd, 4)} · SBD ${fmtN(of?.marks.sbdUsd, 4)} · mid {fmtN(of?.book.mid, 5)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* ── הסולם-החי (offer.json) ── */}
        <section className="dx-card rounded-2xl p-4" data-testid="grid-ladder">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Landmark className="w-4 h-4 text-[color:var(--text-2)]" />
            <h2 className="text-[13.5px] font-extrabold">הסולם-החי · peg → offer</h2>
            <span className={`dx-chip px-2 py-0.5 text-[10px] font-bold ${offerReady ? 'text-[color:var(--green)] border-[color:var(--green)]/50' : 'text-[color:var(--amber)] border-[color:var(--amber)]/50'}`} data-testid="offer-verdict">
              {verdict}
            </span>
            <span className="flex-1" />
            <span className="text-[10px] text-[color:var(--text-3)] dx-num" dir="ltr">
              drag k={fmtN(of?.drag.k, 3)} · askStep {fmtN(of?.drag.effAskStepBps, 1)}bps · bidStep {fmtN(of?.drag.effBidStepBps, 1)}bps
            </span>
          </div>
          {(of?.blocker.length ?? 0) > 0 && (
            <div className="mb-3 rounded-xl border border-[color:var(--amber)]/40 bg-[color:var(--amber-soft)] p-2.5 space-y-1">
              {of!.blocker.map((b, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[11px] text-[color:var(--amber)]"><Ban className="w-3.5 h-3.5 shrink-0 mt-0.5" />{b}</div>
              ))}
            </div>
          )}
          <div className="text-[10.5px] text-[color:var(--text-3)] mb-1.5">מדף-מכירה מעל קו-הזהות (אף-מכירה מתחת לערך-החוץ):</div>
          <div className="space-y-1">
            {(of?.plan.asks ?? []).map(l => (
              <div key={l.level} className="flex items-center gap-2 dx-raised rounded-lg px-2.5 py-1.5 text-[11px]">
                <span className="w-5 text-[color:var(--text-3)] dx-num" dir="ltr">L{l.level}</span>
                <span className="dx-num font-bold text-[color:var(--red)]" dir="ltr">{fmtN(l.priceSbdPerSteem, 6)}</span>
                <span className="text-[color:var(--text-3)]">SBD/STEEM</span>
                <span className="flex-1" />
                <span className="dx-num font-semibold" dir="ltr">{fmtN(l.sizeSteem, 3)} STEEM</span>
              </div>
            ))}
            {(of?.plan.asks.length ?? 0) === 0 && <div className="text-[11px] opacity-50 py-2">אין-רמות-מכירה בתוכנית</div>}
            {(of?.plan.bids ?? []).map(l => (
              <div key={l.level} className="flex items-center gap-2 dx-raised rounded-lg px-2.5 py-1.5 text-[11px]">
                <span className="w-5 text-[color:var(--text-3)] dx-num" dir="ltr">L{l.level}</span>
                <span className="dx-num font-bold text-[color:var(--green)]" dir="ltr">{fmtN(l.priceSbdPerSteem, 6)}</span>
                <span className="text-[color:var(--text-3)]">SBD/STEEM</span>
                <span className="flex-1" />
                <span className="dx-num font-semibold" dir="ltr">{fmtN(l.sizeSteem, 3)} STEEM</span>
              </div>
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-[color:var(--text-3)]">
            <span>מלאי-שרשרת: <span className="dx-num text-[color:var(--text-1)]" dir="ltr">{fmtN(of?.inventory.steem, 3)} STEEM · {fmtN(of?.inventory.sbd, 3)} SBD</span></span>
            {of?.marks.convertArb.verdict && (
              <span>convert: <span className="dx-num text-[color:var(--text-1)]" dir="ltr">{fmtN(of.marks.convertArb.discountPct, 1)}% {of.marks.convertArb.verdict}</span></span>
            )}
          </div>
        </section>

        {/* ── מפת-החיבור: איך זה מתחבר פה ── */}
        <section className="dx-card rounded-2xl p-4" data-testid="grid-connection">
          <div className="flex items-center gap-2 mb-3">
            <Waypoints className="w-4 h-4 text-[color:var(--text-2)]" />
            <h2 className="text-[13.5px] font-extrabold">איך הגריד מתחבר לכאן · מפת-הזרימה</h2>
          </div>
          <ol className="relative space-y-2.5 pr-4 border-r border-[color:var(--line)]">
            {d.connection.map(s => (
              <li key={s.step} className="relative">
                <span className="absolute -right-[21px] top-1 w-4 h-4 rounded-full bg-[color:var(--pink)] text-white text-[9px] font-black flex items-center justify-center" dir="ltr">{s.step}</span>
                <div className="text-[12px] font-bold leading-tight">{s.title}</div>
                <div className="text-[10.5px] text-[color:var(--text-3)] leading-snug">{s.detail}</div>
                <div className="mt-0.5 text-[10.5px] dx-num text-[color:var(--pink)]" dir="ltr">{s.live}</div>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {/* ── הפקודות-הפתוחות על-השרשרת + מילויים-אמת ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <section className="dx-card rounded-2xl p-4 flex flex-col" data-testid="grid-open-orders">
          <div className="flex items-center gap-2 mb-2">
            <Landmark className="w-4 h-4 text-[color:var(--text-2)]" />
            <h2 className="text-[13.5px] font-extrabold">פקודות-פתוחות על שוק-STEEM</h2>
            <span className="flex-1" />
            <span className="dx-chip px-2 py-0.5 text-[10px] dx-num" dir="ltr">{real?.openOrders.length ?? 0} בפנקס · {fmtInt(of?.openOrdersNow ?? 0)} בחשבון</span>
          </div>
          <div className="max-h-72 overflow-y-auto scroll-slim -mx-1 px-1">
            <table className="w-full text-[11px]">
              <thead className="text-[9.5px] text-[color:var(--text-3)] sticky top-0 bg-[color:var(--raised)]">
                <tr><th className="text-right py-1.5 px-1.5 font-medium">#id</th><th className="text-right py-1.5 px-1.5 font-medium">צד</th><th className="text-right py-1.5 px-1.5 font-medium">מוכר</th><th className="text-right py-1.5 px-1.5 font-medium">מקבל</th><th className="text-right py-1.5 px-1.5 font-medium">מחיר</th><th className="text-right py-1.5 px-1.5 font-medium">גיל</th></tr>
              </thead>
              <tbody>
                {(real?.openOrders ?? []).map(o => (
                  <tr key={o.id} className="border-t border-[color:var(--line)]">
                    <td className="py-1.5 px-1.5 dx-num text-[color:var(--text-3)]" dir="ltr">{o.id}</td>
                    <td className={`py-1.5 px-1.5 font-bold ${o.side === 'ask' ? 'text-[color:var(--red)]' : 'text-[color:var(--green)]'}`}>{o.side === 'ask' ? 'מכירה' : 'קנייה'}</td>
                    <td className="py-1.5 px-1.5 dx-num" dir="ltr">{o.sell}</td>
                    <td className="py-1.5 px-1.5 dx-num" dir="ltr">{o.receive}</td>
                    <td className="py-1.5 px-1.5 dx-num font-semibold" dir="ltr">{fmtN(o.priceSbdPerSteem, 6)}</td>
                    <td className="py-1.5 px-1.5 text-[color:var(--text-3)]" dir="ltr">{agoOf(o.at)}</td>
                  </tr>
                ))}
                {(real?.openOrders.length ?? 0) === 0 && (
                  <tr><td colSpan={6} className="py-3 text-center text-[color:var(--text-3)]">אין-פקודות-פתוחות בפנקס (הפנקס מחזיק 300-אחרונות בלבד)</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="dx-card rounded-2xl p-4 flex flex-col" data-testid="grid-fills">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-[color:var(--text-2)]" />
            <h2 className="text-[13.5px] font-extrabold">מילויים-אמת · קצה-מדוד מול ציון-חוץ</h2>
            <span className="flex-1" />
            <span className="dx-chip px-2 py-0.5 text-[10px] dx-num" dir="ltr">{fmtInt(d.twin.feeMeter.realFills)} סה״כ</span>
          </div>
          <div className="max-h-72 overflow-y-auto scroll-slim -mx-1 px-1">
            <table className="w-full text-[11px]">
              <thead className="text-[9.5px] text-[color:var(--text-3)] sticky top-0 bg-[color:var(--raised)]">
                <tr><th className="text-right py-1.5 px-1.5 font-medium">זמן</th><th className="text-right py-1.5 px-1.5 font-medium">כיוון</th><th className="text-right py-1.5 px-1.5 font-medium">שולם</th><th className="text-right py-1.5 px-1.5 font-medium">התקבל</th><th className="text-left py-1.5 px-1.5 font-medium">edge</th></tr>
              </thead>
              <tbody>
                {(real?.recentFills ?? []).map((f, i) => (
                  <tr key={`${f.at}-${i}`} className="border-t border-[color:var(--line)]">
                    <td className="py-1.5 px-1.5 text-[color:var(--text-3)] dx-num" dir="ltr">{f.at.slice(5, 16).replace('T', ' ')}</td>
                    <td className={`py-1.5 px-1.5 font-bold ${f.direction.startsWith('bought') ? 'text-[color:var(--green)]' : 'text-[color:var(--red)]'}`}>
                      {f.direction.startsWith('bought') ? 'קנה' : 'מכר'} {f.chain}
                    </td>
                    <td className="py-1.5 px-1.5 dx-num" dir="ltr">{f.paid}</td>
                    <td className="py-1.5 px-1.5 dx-num" dir="ltr">{f.received}</td>
                    <td className={`py-1.5 px-1.5 dx-num font-bold text-left ${edgeCls(f.edgeBps)}`} dir="ltr">{f.edgeBps !== null ? `${fmtN(f.edgeBps, 0)}bps` : '—'}</td>
                  </tr>
                ))}
                {(real?.recentFills.length ?? 0) === 0 && (
                  <tr><td colSpan={5} className="py-3 text-center text-[color:var(--text-3)]">אין-מילויים בפנקס</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* ── החיילים ── */}
      <section className="dx-card rounded-2xl p-4" data-testid="grid-soldiers">
        <div className="flex flex-wrap items-center gap-2 mb-2.5">
          <Bot className="w-4 h-4 text-[color:var(--text-2)]" />
          <h2 className="text-[13.5px] font-extrabold">רשת-המיקרו-גרידים · {d.twin.soldiersSummary.count} חיילים</h2>
          <span className="dx-chip px-2 py-0.5 text-[10px] dx-num" dir="ltr">inv {fmtN(d.twin.soldiersSummary.totalInventoryMu, 0)}µ · simPnL {fmtN(d.twin.soldiersSummary.totalPnlSimMu, 0)}µ</span>
          <span className="flex-1" />
          <div className="flex gap-1 flex-wrap">
            {SOLDIER_FILTERS.map(f => (
              <button key={f.id} onClick={() => setSoldierFilter(f.id)}
                className={`dx-chip h-7 px-2.5 text-[10.5px] ${soldierFilter === f.id ? 'border-[color:var(--pink)] text-[color:var(--pink)] font-bold' : ''}`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="max-h-96 overflow-y-auto scroll-slim -mx-1 px-1">
          <table className="w-full text-[11px]">
            <thead className="text-[9.5px] text-[color:var(--text-3)] sticky top-0 bg-[color:var(--raised)]">
              <tr><th className="text-right py-1.5 px-1.5 font-medium">id</th><th className="text-right py-1.5 px-1.5 font-medium">אסטרטגיה</th><th className="text-right py-1.5 px-1.5 font-medium">רמות</th><th className="text-right py-1.5 px-1.5 font-medium">רוחב</th><th className="text-left py-1.5 px-1.5 font-medium">מלאי</th><th className="text-left py-1.5 px-1.5 font-medium">simPnL</th><th className="text-right py-1.5 px-1.5 font-medium">הערה-אחרונה</th></tr>
            </thead>
            <tbody>
              {soldiersShown.map(s => (
                <tr key={s.id} className="border-t border-[color:var(--line)]">
                  <td className="py-1.5 px-1.5">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${s.active ? 'bg-[color:var(--green)] pulse-ring' : 'bg-[color:var(--red)]'}`} />
                      <span className="dx-num font-semibold" dir="ltr">{s.id}</span>
                    </span>
                  </td>
                  <td className="py-1.5 px-1.5 text-[color:var(--text-2)]" dir="ltr">{s.strategy}</td>
                  <td className="py-1.5 px-1.5 dx-num text-[color:var(--text-3)]" dir="ltr">{s.levels ?? '—'}</td>
                  <td className="py-1.5 px-1.5 dx-num text-[color:var(--text-3)]" dir="ltr">{s.widthBps !== null ? fmtN(s.widthBps, 1) : '—'}</td>
                  <td className="py-1.5 px-1.5 dx-num text-left" dir="ltr">{fmtN(s.inventoryMu, 1)}µ</td>
                  <td className={`py-1.5 px-1.5 dx-num font-semibold text-left ${s.pnlSimMu >= 0 ? 'text-[color:var(--green)]' : 'text-[color:var(--red)]'}`} dir="ltr">{fmtN(s.pnlSimMu, 1)}µ</td>
                  <td className="py-1.5 px-1.5 text-[color:var(--text-3)] text-[10px]" dir="ltr">{s.lastNote || '—'}</td>
                </tr>
              ))}
              {soldiersShown.length === 0 && (
                <tr><td colSpan={7} className="py-3 text-center text-[color:var(--text-3)]">אין-חיילים בסינון הזה</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {d.twin.fleetCap?.note && <div className="mt-2 text-[10px] text-[color:var(--text-3)]">{d.twin.fleetCap.note}</div>}
      </section>

      {/* ── ארב · משמורת · דופק ── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <section className="dx-card rounded-2xl p-4" data-testid="grid-arb">
          <div className="flex items-center gap-2 mb-2">
            <Gauge className="w-4 h-4 text-[color:var(--text-2)]" />
            <h2 className="text-[13.5px] font-extrabold">סורק-הארביטרז'</h2>
            <span className="flex-1" />
            <span className="dx-chip px-2 py-0.5 text-[10px] dx-num" dir="ltr">{fmtInt(d.arb?.count ?? 0)} רשומות</span>
          </div>
          <div className="space-y-1.5 max-h-64 overflow-y-auto scroll-slim">
            {(d.arb?.recent ?? []).map((e, i) => (
              <div key={`${e.ts}-${i}`} className="dx-raised rounded-lg px-2.5 py-1.5 text-[10.5px]">
                <div className="flex items-center gap-1.5">
                  <span className="dx-num text-[color:var(--text-3)]" dir="ltr">{e.ts.slice(5, 16).replace('T', ' ')}</span>
                  <span className="dx-num font-semibold" dir="ltr">{e.pair}</span>
                  <span className="flex-1" />
                  <span className={`dx-num font-bold ${edgeCls(e.edgeBps)}`} dir="ltr">{e.edgeBps !== null ? `${fmtN(e.edgeBps, 0)}bps` : '—'}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`dx-chip px-1.5 py-0 text-[9px] ${realnessCls(e.realness)}`} dir="ltr">{e.realness}</span>
                  {e.executableSize !== null && e.executableSize > 0 && <span className="dx-num text-[color:var(--text-3)]" dir="ltr">size {fmtN(e.executableSize, 2)}</span>}
                  {e.paperPnlSbd !== null && <span className="dx-num text-[color:var(--text-3)]" dir="ltr">paper {fmtN(e.paperPnlSbd, 4)} SBD</span>}
                </div>
              </div>
            ))}
            {(d.arb?.recent.length ?? 0) === 0 && <div className="text-[11px] opacity-50 py-2">אין-רשומות-ארב</div>}
          </div>
        </section>

        <section className="dx-card rounded-2xl p-4" data-testid="grid-custody">
          <div className="flex items-center gap-2 mb-2">
            <BadgeCheck className="w-4 h-4 text-[color:var(--text-2)]" />
            <h2 className="text-[13.5px] font-extrabold">אמת-משמור על-השרשרת</h2>
            <span className="flex-1" />
            <span className="text-[10px] text-[color:var(--text-3)] dx-num" dir="ltr">{agoOf(d.custody?.at)}</span>
          </div>
          <div className="space-y-1.5 max-h-64 overflow-y-auto scroll-slim">
            {(d.custody?.rows ?? []).map((r, i) => (
              <div key={i} className="dx-raised rounded-lg px-2.5 py-1.5 text-[10.5px]">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold" dir="ltr">{r.chain}</span>
                  <span className="text-[color:var(--text-3)]" dir="ltr">{r.venue}</span>
                  <span className="flex-1" />
                  <span className="dx-num font-semibold" dir="ltr">{r.asset}{r.amount !== null ? `: ${r.amount}` : ''}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`dx-chip px-1.5 py-0 text-[9px] ${realnessCls(r.realness)}`} dir="ltr">{r.realness}</span>
                  {r.ownership && <span className="text-[color:var(--text-3)] truncate" dir="ltr">{r.ownership}</span>}
                </div>
              </div>
            ))}
            {(d.custody?.rows.length ?? 0) === 0 && <div className="text-[11px] opacity-50 py-2">אין-שורות-משמור</div>}
          </div>
        </section>

        <section className="dx-card rounded-2xl p-4" data-testid="grid-heartbeat">
          <div className="flex items-center gap-2 mb-2">
            <GitCommit className="w-4 h-4 text-[color:var(--text-2)]" />
            <h2 className="text-[13.5px] font-extrabold">דופק-התאום · grid-trigger-twin</h2>
          </div>
          <div className="space-y-1.5 max-h-64 overflow-y-auto scroll-slim">
            {d.heartbeat.ticks.map(t => (
              <div key={t.sha} className="dx-raised rounded-lg px-2.5 py-1.5 text-[10.5px] flex items-center gap-1.5">
                <span className="dx-num text-[color:var(--pink)] font-bold" dir="ltr">{t.sha}</span>
                <span className="dx-num text-[color:var(--text-2)]" dir="ltr">{t.at.slice(11, 19)}Z</span>
                <span className="flex-1" />
                <span className="text-[color:var(--text-3)] dx-num" dir="ltr">{agoOf(t.at)}</span>
              </div>
            ))}
            {d.heartbeat.ticks.length === 0 && (
              <div className="text-[11px] opacity-60 py-2">
                אין-דופק בגיט המקומי{d.heartbeat.error ? ` — ${d.heartbeat.error.slice(0, 80)}` : ''} (התאום דוחף ל-origin כל-~30דק׳; state-push מושך-אותו בקדנס)
              </div>
            )}
          </div>
          <div className="mt-2 text-[10px] text-[color:var(--text-3)] leading-relaxed">
            התאום חי-מחוץ-לסנדבוקס (grid-trigger-twin[bot]): מריץ את grids/run.mjs, מחייב state.json+offer.json לגיט.
            state-push המקומי מושך-אותם בכל-קדנס → הקבצים כאן טריים-עד-~30דק׳. הריצה-החיה של-המילויים-האמת: grid-beat עם-מפתח-headcorner.
          </div>
        </section>
      </div>

      {/* ── כנות ── */}
      <div className="dx-card rounded-2xl p-3.5 flex items-start gap-2 text-[10.5px] text-[color:var(--text-3)] leading-relaxed">
        <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-[color:var(--amber)]" />
        <div>
          {d.honesty} · גילי-מקור: state {agoOf(d.sources?.state?.mtime)} · offer {agoOf(d.sources?.offer?.mtime)} · ledger {agoOf(d.sources?.ledger?.mtime)} · arb {agoOf(d.sources?.arb?.mtime)} · custody {agoOf(d.sources?.custody?.mtime)}
        </div>
      </div>
    </div>
  );
}
