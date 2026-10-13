'use client';

// ─── כספת-הריפו הריבונית (EXEC-CD-24) ──────────────────────────────────────
// הארנק שחי-בגיט עצמו: seal.a ⊕ seal.b → AES-256-GCM → wallet.enc.json.
// תרגיל-שחזור מclone-טרי = עצמאות-מסנדבוקס. + רישום-ההעברה-למפעיל (מה-שהאוטונומיה
// באמת-באמת לא יכולה לעשות — כמו כניסה עם גוגל — רשום ומוצג כאן).
// אף-חומר-סוד לא מגיע לכאן — כתובות-ציבוריות, טביעות-אצבע ופסקי-דין בלבד.

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck, ShieldAlert, Copy, Check, Vault, HandMetal, Terminal, Eye, TrendingUp, TrendingDown, Activity, Droplets, Radar, GitBranch, Crosshair } from 'lucide-react';

type Probe = {
  network: string; ok: boolean; activated?: boolean;
  balance: string | null; unit: string; nonce?: number | null;
  latencyMs: number | null; checkedAt: string; error?: string;
};
type NetRow = { network: string; label: string; path: string; address?: string; addressMasked?: string; probe?: Probe | null };
type EscalationItem = {
  id: string; title: string; titleEn: string; why: string; what: string;
  priority: 'high' | 'medium' | 'low'; status: string; surfacedAt: string;
};
type SovereignData = {
  ok: boolean;
  exists: boolean;
  me: 'owner' | null;
  label?: string;
  createdAt?: string;
  algo?: { cipher: string; seal: string; mnemonicWords: number } | null;
  fingerprints?: Record<string, string> | null;
  networks?: NetRow[];
  manifestOnDisk?: boolean;
  manifestConsistent?: boolean;
  escalations?: { updatedAt: string; note: string; items: EscalationItem[] };
  escalationsCount?: number;
  recovery?: string;
  error?: string;
};
type VerifyResult = {
  ok: boolean;
  verdict?: { opened: boolean; addressesMatch: boolean; mismatches: string[]; label: string; latencyMs: number };
  networks?: NetRow[];
  error?: string;
};
type TreasuryProbe = {
  network: string; address: string; ok: boolean; activated?: boolean;
  balanceRaw: string; balanceHuman: string | null; unit: string;
  latencyMs: number | null; checkedAt: string; error?: string;
};
type TreasuryEvent = {
  network: string; address: string; kind: string; deltaHuman: string;
  balanceHuman: string | null; unit: string; note: string; seenAt: string;
};
type TreasuryState = {
  ok: boolean; exists: boolean; label: string | null;
  addresses?: Array<{ network: string; address: string; probe: TreasuryProbe | null }>;
  events?: TreasuryEvent[];
  stats?: { sightings: number; events: number; fundingEvents: number; lastWatchAt: string | null };
  checkedAt?: string; error?: string;
};
type WatchSummary = { ok: boolean; probed?: number; eventsCreated?: number; error?: string; errors?: string[] };

const NET_ICON: Record<string, string> = { evm: '⟠', tron: '▲', bitcoin: '₿', solana: '◎' };

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); }).catch(() => { }); }}
      className="shrink-0 p-1 rounded hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700 transition-colors"
      aria-label="העתק כתובת"
    >
      {done ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function ProbeChip({ p }: { p?: Probe | null }) {
  if (!p) return <span className="text-[10px] text-zinc-400">לא-נבדק</span>;
  if (p.ok) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 whitespace-nowrap" dir="ltr">
        <ShieldCheck className="w-2.5 h-2.5" />live · {p.balance ?? '?'} {p.unit} · {p.latencyMs}ms
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 whitespace-nowrap" dir="ltr" title={p.error}>
      <ShieldAlert className="w-2.5 h-2.5" />RPC לא-זמין
    </span>
  );
}

const PRIO_META: Record<string, { label: string; cls: string }> = {
  high: { label: 'דחוף', cls: 'text-rose-700 bg-rose-50 border-rose-200' },
  medium: { label: 'בינוני', cls: 'text-amber-700 bg-amber-50 border-amber-200' },
  low: { label: 'רגיל', cls: 'text-zinc-600 bg-zinc-50 border-zinc-200' },
};

const EV_META: Record<string, { label: string; icon: typeof TrendingUp; cls: string }> = {
  funding: { label: 'כניסת-ערך', icon: TrendingUp, cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  decrease: { label: 'יציאה', icon: TrendingDown, cls: 'text-amber-700 bg-amber-50 border-amber-200' },
  'probe-error': { label: 'RPC', icon: ShieldAlert, cls: 'text-zinc-600 bg-zinc-50 border-zinc-200' },
};

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `לפני ${s}ש׳`;
  if (s < 3600) return `לפני ${Math.floor(s / 60)} דק׳`;
  if (s < 86400) return `לפני ${Math.floor(s / 3600)} שע׳`;
  return `לפני ${Math.floor(s / 86400)} ימים`;
}

/* ─── חציית-הגבול (EXEC-CD-29) ─────────────────────────────────────────── */
interface CrossingData {
  ok: boolean;
  exec?: string;
  at?: string;
  verdict?: string;
  facts?: {
    secretsRescued?: number;
    solSweeps?: Array<{ from: string; amount: string; txid: string }>;
    tronSweeps?: Array<{ from: string; amount: string; txid: string }>;
    realSwap?: { route: string; in: string; out: string; txid: string; slot: number };
    hiveAuthority?: { status: string; transfer: string };
    residues?: Array<{ addr?: string; account?: string; amount: string; why: string }>;
  };
  live?: { solLamports?: number | null; usdc?: number | null; trxSun?: number | null };
}

function BorderCrossingCard() {
  const [d, setD] = useState<CrossingData | null>(null);
  const [err, setErr] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/vault/crossing', { cache: 'no-store' });
      const j = await r.json() as CrossingData;
      setD(j); setErr(!j.ok);
    } catch { setErr(true); }
  }, []);

  useEffect(() => {
    const iv = setInterval(() => { void load(); }, 120_000);
    const to = setTimeout(() => { void load(); }, 0);
    return () => { clearTimeout(to); clearInterval(iv); };
  }, [load]);

  if (err) return null;
  if (!d?.facts?.realSwap) return null;
  const sw = d.facts.realSwap;
  const live = d.live ?? {};
  const short = (s: string, n = 10) => s.length > 2 * n + 3 ? `${s.slice(0, n)}…${s.slice(-n)}` : s;
  return (
    <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <div className="text-[11px] font-semibold text-emerald-800">חציית-הגבול — הוכחות-אמת על-השרשרות <span className="font-normal text-emerald-600">({d.exec})</span></div>
        <span className="text-[10px] text-emerald-800 bg-white border border-emerald-300 rounded-full px-2 py-0.5">מוכח-על-השרשרת</span>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-3 mb-2">
        <div className="rounded-lg bg-white border border-emerald-100 px-2.5 py-1.5">
          <div className="text-[10px] text-zinc-500">כספת hYWKEi — SOL</div>
          <div className="font-data text-[12px] text-zinc-900" dir="ltr">{live.solLamports != null ? `${(live.solLamports / 1e9).toFixed(9)}` : '…'} ◎</div>
        </div>
        <div className="rounded-lg bg-white border border-emerald-100 px-2.5 py-1.5">
          <div className="text-[10px] text-zinc-500">כספת hYWKEi — USDC</div>
          <div className="font-data text-[12px] text-zinc-900" dir="ltr">{live.usdc != null ? live.usdc.toFixed(6) : '…'} $</div>
        </div>
        <div className="rounded-lg bg-white border border-emerald-100 px-2.5 py-1.5">
          <div className="text-[10px] text-zinc-500">כספת TPFmkf — TRX</div>
          <div className="font-data text-[12px] text-zinc-900" dir="ltr">{live.trxSun != null ? (live.trxSun / 1e6).toFixed(6) : '…'}</div>
        </div>
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-[10.5px] text-zinc-700 flex-wrap">
          <span className="text-emerald-700 font-semibold">המרה-אמת:</span>
          <span dir="ltr" className="font-data">{sw.in} → {sw.out}</span>
          <span className="text-zinc-400">({sw.route})</span>
          <a href={`https://solscan.io/tx/${sw.txid}`} target="_blank" rel="noreferrer" className="font-data text-[10px] text-emerald-700 underline decoration-dotted" dir="ltr">{short(sw.txid)}</a>
          <span className="text-zinc-400">slot {sw.slot}</span>
        </div>
        {(d.facts.solSweeps ?? []).map((s, i) => (
          <div key={`sol${i}`} className="flex items-center gap-2 text-[10px] text-zinc-500 flex-wrap">
            <span dir="ltr" className="font-data">sweep {s.amount} → vault</span>
            <a href={`https://solscan.io/tx/${s.txid}`} target="_blank" rel="noreferrer" className="font-data text-zinc-400 underline decoration-dotted" dir="ltr">{short(s.txid, 8)}</a>
          </div>
        ))}
        {(d.facts.tronSweeps ?? []).map((s, i) => (
          <div key={`tron${i}`} className="flex items-center gap-2 text-[10px] text-zinc-500 flex-wrap">
            <span dir="ltr" className="font-data">sweep {s.amount} → vault</span>
            <span className="font-data text-zinc-400" dir="ltr">{short(s.txid, 8)}</span>
          </div>
        ))}
        {d.facts.hiveAuthority && (
          <div className="text-[10px] text-zinc-500">{d.facts.hiveAuthority.status} · {d.facts.hiveAuthority.transfer}</div>
        )}
      </div>
      <div className="mt-2 text-[10px] leading-relaxed text-zinc-500">
        {d.facts.secretsRescued} סודות-גנוזים חולצו מהמחסן-שנחשב-אבוד ונאטמו-במעטפת-המוצפנת (בגיט עצמו). שאריות-כנות:{' '}
        {(d.facts.residues ?? []).map((r, i) => (
          <span key={i} className="text-zinc-600" dir="ltr">{r.amount}{i < (d.facts?.residues?.length ?? 0) - 1 ? ' · ' : ''}</span>
        ))}
      </div>
    </div>
  );
}

/* ═══ מנוע-הערך-האמתי (EXEC-CD-30) — השטיפה-צעד-צעד כמדידה-חיה ═══════════════
 * האוצר-האמיתי (כתובות-הכספת × מחירי-שוק) מול הדקס-הפנימי (סולם-העתודה),
 * מכ"ם-הסטיות (פנימי מול שוק-אמת), השערים ותשואתם — הכל נמדד-חי, אפס-תיאטרון. */
type VeTreasuryRow = { network: string; asset: string; address: string; amount: number | null; unit: string; usd: number | null; ok: boolean; error?: string };
type VeReserve = { ok: boolean; height: number; phase: number; phaseName: string; phaseNote: string; supplyMu: number; unitMu: number; realMu: number; unitBps: number; realBps: number; holdings: Record<string, number>; nextGapMu: number | null; redeemOpen: boolean; income: { poolFeesMu: number; feeMeterMu: number; treasuryProfitEverMu: number; ladderSpentMu: number } | null };
type VeRadarRow = { asset: string; realSymbol: string; internalUsd: number | null; realUsd: number | null; deviationPct: number | null; verdict: 'converged' | 'drift' | 'divergent' | 'unmeasured' };
type VeGate = { id: string; he: string; status: 'open' | 'live' | 'armed' | 'gated' | 'locked'; detail: string; yieldNow: string };
type VeArbEdge = { kind: string; asset: string; devPct: number | null; netPct: number | null; direction: string; executable: boolean; note: string };
type VeArbScan = {
  ok: boolean; at: string; thresholdPct: number; bestNetPct: number | null;
  edges: VeArbEdge[];
  chainRail: { inUsdc: number; solOutLamports: number; solBackUsdc: number; roundTripPct: number; quoteSource: string } | null;
  note: string;
};
type VeState = {
  ok: boolean; at: string;
  treasury: { ok: boolean; rows: VeTreasuryRow[]; totalUsd: number; measuredUsd: number; priceSource: string; at: string };
  reserve: VeReserve;
  radar: VeRadarRow[];
  gates: VeGate[];
  arbScan?: VeArbScan | null;
  wash: { supplyUsd: number; realUsd: number; realPlusTreasuryUsd: number; ratioPct: number; note: string };
  history: Array<{ at: string; height: number; phase: number; unitBps: number; realBps: number; realUsdMicro: string }>;
  error?: string;
};

const GATE_STYLE: Record<VeGate['status'], { cls: string; label: string }> = {
  open: { cls: 'bg-emerald-50 border-emerald-200 text-emerald-800', label: 'פתוח' },
  live: { cls: 'bg-emerald-50 border-emerald-200 text-emerald-800', label: 'חי' },
  armed: { cls: 'bg-amber-50 border-amber-200 text-amber-800', label: 'חמוש' },
  gated: { cls: 'bg-orange-50 border-orange-200 text-orange-800', label: 'סגור-בשער' },
  locked: { cls: 'bg-zinc-100 border-zinc-200 text-zinc-600', label: 'נעול-בכנות' },
};

function ValueEngineCard() {
  const [ve, setVe] = useState<VeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [ticking, setTicking] = useState(false);
  const [tickMsg, setTickMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/saos/value-engine', { cache: 'no-store' });
      setVe(await r.json());
    } catch {
      setVe(prev => prev); // fail-soft לתצוגה
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void load();
    const iv = setInterval(() => { void load(); }, 120_000);
    return () => clearInterval(iv);
  }, [load]);

  const runTick = async () => {
    setTicking(true); setTickMsg(null);
    try {
      const r = await fetch('/api/saos/value-engine', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      });
      const j = await r.json() as { ok: boolean; height?: number; realUsdMicro?: string; error?: string };
      if (j.ok) {
        const usd = Number(BigInt(j.realUsdMicro ?? '0')) / 1e6;
        setTickMsg(`פעימה נרשמה h${j.height} — שווי-האוצר-האמיתי $${usd.toFixed(2)}`);
      } else {
        setTickMsg(j.error ?? 'הפעימה נכשלה');
      }
      await load();
    } catch {
      setTickMsg('ה-API לא נגיש');
    } finally { setTicking(false); }
  };

  const w = ve?.wash;
  const hist = ve?.history ?? [];
  const fmtUsd = (n: number): string => n >= 1 ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : `$${n.toFixed(4)}`;
  const fmtMu = (n: number): string => `${Math.round(n).toLocaleString('en-US')}µ$`;

  return (
    <div className="sv-card p-4 md:p-6">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 grid place-items-center">
            <Droplets className="w-4.5 h-4.5 text-amber-700" />
          </div>
          <div>
            <div className="text-[14px] font-bold text-zinc-900">מנוע-הערך-האמתי <span className="text-[11px] font-normal text-zinc-500">(EXEC-CD-30)</span></div>
            <div className="text-[11px] text-zinc-500">
              שטיפת-ערך פנימי → אמיתי · מדידה-חי כל-30-דק׳
              {hist[0]?.at ? ` · תמונה-אחרונה ${timeAgo(hist[0].at)}` : ''}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="h-8 px-2.5 rounded-lg border border-[#e0e0da] bg-white hover:bg-zinc-50 text-[11px] text-zinc-600 transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
            aria-label="רענן מדידת-ערך"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> רענון
          </button>
          <button
            onClick={runTick}
            disabled={ticking}
            className="h-8 px-3 rounded-lg border border-amber-600/30 bg-amber-50 hover:bg-amber-100 text-[11px] text-amber-800 transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <Activity className={`w-3 h-3 ${ticking ? 'animate-pulse' : ''}`} /> פעימת-מדידה עכשיו
          </button>
        </div>
      </div>

      {tickMsg && (
        <div className="mb-3 text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{tickMsg}</div>
      )}

      {loading && !ve ? (
        <div className="p-6 text-center text-[12px] text-zinc-400">מודד את האוצר-האמיתי מול השרשראות ואת סולם-הדקס…</div>
      ) : !ve ? (
        <div className="p-6 text-center text-[12px] text-zinc-400">אין-מדידה-כרגע</div>
      ) : (
        <>
          {/* שטיפת-הערך — המדידה הראשית */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-4">
            <div className="rounded-xl border border-[#e0e0da] bg-white p-3">
              <div className="text-[10px] text-zinc-500 mb-1">היצע-פנימי (הדקס)</div>
              <div className="text-[15px] font-bold text-zinc-900" dir="ltr">{fmtUsd(w?.supplyUsd ?? 0)}</div>
              <div className="text-[10px] text-zinc-400 mt-0.5" dir="ltr">supply {fmtMu(ve.reserve.supplyMu)}</div>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
              <div className="text-[10px] text-emerald-700 mb-1">גיבוי-אמת (בכספת-העתודה)</div>
              <div className="text-[15px] font-bold text-emerald-800" dir="ltr">{fmtUsd(w?.realUsd ?? 0)}</div>
              <div className="text-[10px] text-emerald-600/80 mt-0.5" dir="ltr">realMu {fmtMu(ve.reserve.realMu)}</div>
            </div>
            <div className="rounded-xl border border-[#e0e0da] bg-white p-3">
              <div className="text-[10px] text-zinc-500 mb-1">האוצר-האמיתי (על-השרשראות)</div>
              <div className="text-[15px] font-bold text-zinc-900" dir="ltr">{fmtUsd(ve.treasury.totalUsd)}</div>
              <div className="text-[10px] text-zinc-400 mt-0.5" dir="ltr">src: {ve.treasury.priceSource}</div>
            </div>
            <div className="rounded-xl border border-[#e0e0da] bg-white p-3">
              <div className="text-[10px] text-zinc-500 mb-1">יחס-הגיבוי (real/supply)</div>
              <div className="text-[15px] font-bold text-zinc-900" dir="ltr">{(w?.ratioPct ?? 0).toFixed(2)}%</div>
              <div className="text-[10px] text-zinc-400 mt-0.5">הפער = מה-שהפעילות-סוגרת</div>
            </div>
          </div>

          {/* מדרגת-הסולם + המדרך */}
          <div className="rounded-xl border border-[#e0e0da] bg-zinc-50 dark:bg-zinc-900/60 p-3.5 mb-4">
            <div className="flex items-center gap-2 mb-2">
              <GitBranch className="w-3.5 h-3.5 text-zinc-500" />
              <span className="text-[12px] font-bold text-zinc-800 dark:text-zinc-100">
                מדרגה-{ve.reserve.phase} · {ve.reserve.phaseName}
              </span>
              <span className="text-[10.5px] text-zinc-500">{ve.reserve.phaseNote}</span>
            </div>
            <div className="flex gap-1.5 flex-wrap" dir="ltr">
              {['0 מטבע-בית', '1 רצפת-יחידה 10%', '2 גיבוי-אמת 30%+10%', '3 פדיון 60%+20%', '4 רלוונטיות 100%+50%'].map((p, i) => (
                <span
                  key={p}
                  className={`text-[10px] px-2 py-1 rounded-md border ${i === ve.reserve.phase
                    ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-white dark:text-zinc-900 dark:border-white'
                    : 'bg-white text-zinc-500 border-[#e0e0da] dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700'}`}
                >
                  {p}
                </span>
              ))}
            </div>
            {ve.reserve.nextGapMu != null && ve.reserve.phase < 4 && (
              <div className="text-[11px] text-zinc-600 dark:text-zinc-300 mt-2">
                למדרגה-הבאה חסרים <span className="font-bold" dir="ltr">{fmtUsd((ve.reserve.nextGapMu ?? 0) / 1000)}</span> של רצפת-יחידה — הדרך: עמלות-הסוכנים (סחיבה-כל-200-בלוקים), הפקדות-אמת-דרך-הדלת, ורווחי-ארביטראז.
              </div>
            )}
          </div>

          {/* השערים ותשואתם */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Vault className="w-3.5 h-3.5 text-zinc-500" />
              <span className="text-[12px] font-bold text-zinc-800">השערים — מה יש ומה זה מניב</span>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {ve.gates.map(g => {
                const gs = GATE_STYLE[g.status];
                return (
                  <div key={g.id} className={`rounded-xl border p-3 ${gs.cls}`}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-[11.5px] font-bold">{g.he}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md border bg-white/70 whitespace-nowrap">{gs.label}</span>
                    </div>
                    <div className="text-[10.5px] opacity-80 mb-1">{g.detail}</div>
                    <div className="text-[10.5px] font-semibold" dir="auto">{g.yieldNow}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* EXEC-CD-32 · סריקת-הארביטראז-החיה — השער-החמוש הופך-מדידה-מתמדת */}
          {ve.arbScan && (
            <div className="rounded-xl border border-[#e0e0da] bg-white p-3.5 mb-4">
              <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                <div className="flex items-center gap-2">
                  <Crosshair className="w-3.5 h-3.5 text-amber-700" />
                  <span className="text-[12px] font-bold text-zinc-800">סריקת-ארביטראז-חיה</span>
                  <span className="text-[10px] text-zinc-400" dir="ltr">threshold ≥{ve.arbScan.thresholdPct}%</span>
                </div>
                <span className="text-[10px] text-zinc-400">נסרק {timeAgo(ve.arbScan.at)}</span>
              </div>
              <div className="text-[11px] text-zinc-600 dark:text-zinc-300 mb-1.5" dir="auto">{ve.arbScan.note}</div>
              {ve.arbScan.edges.filter(e => e.kind === 'internal-deviation').length > 0 && (
                <div className="space-y-1" dir="ltr">
                  {ve.arbScan.edges.filter(e => e.kind === 'internal-deviation').slice(0, 3).map(e => (
                    <div key={e.asset} className="flex items-center justify-between gap-2 text-[10.5px] rounded-lg border border-[#e0e0da] bg-zinc-50 dark:bg-zinc-900/60 px-2.5 py-1.5">
                      <span className="font-semibold text-zinc-700 dark:text-zinc-200">{e.asset}</span>
                      <span className="text-zinc-500">dev {e.devPct !== null ? `${e.devPct > 0 ? '+' : ''}${e.devPct.toFixed(2)}%` : '—'}</span>
                      <span className={e.executable ? 'text-emerald-700 font-semibold' : 'text-zinc-500'}>net {e.netPct !== null ? `${e.netPct > 0 ? '+' : ''}${e.netPct.toFixed(2)}%` : '—'}</span>
                      <span className="text-zinc-400 hidden sm:inline">{e.direction}</span>
                    </div>
                  ))}
                </div>
              )}
              {ve.arbScan.chainRail && (
                <div className="text-[10px] text-zinc-500 mt-1.5" dir="auto">
                  עלות-רכבת-השרשרת מדודה: {ve.arbScan.chainRail.inUsdc} USDC → SOL → {ve.arbScan.chainRail.solBackUsdc} USDC = סבב {ve.arbScan.chainRail.roundTripPct}% ({ve.arbScan.chainRail.quoteSource}) — זו-הקרקע-שכל-חישוב-ביצוע-עומד-עליה.
                </div>
              )}
            </div>
          )}

          {/* האוצר-האמיתי + מכ"ם-הסטיות */}
          <div className="grid md:grid-cols-2 gap-3">
            <div className="rounded-xl border border-[#e0e0da] bg-white p-3.5">
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
                <span className="text-[12px] font-bold text-zinc-800">האוצר-האמיתי — יתרות-חי × מחירי-שוק</span>
              </div>
              {ve.treasury.rows.length === 0 ? (
                <div className="text-[11px] text-zinc-400">לא-נמדד (manifest-חסר או-RPC-נופל)</div>
              ) : (
                <div className="space-y-1.5">
                  {ve.treasury.rows.map(r => (
                    <div key={`${r.network}-${r.asset}`} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-semibold text-zinc-700">{r.asset} <span className="text-zinc-400 font-normal">{r.address}</span></span>
                      <span dir="ltr" className={r.ok ? 'text-zinc-800' : 'text-red-700'}>
                        {r.ok
                          ? <>{r.amount?.toLocaleString('en-US', { maximumFractionDigits: 6 }) ?? '?'} {r.unit} {r.usd != null ? <span className="text-emerald-700 font-semibold">= {fmtUsd(r.usd)}</span> : ''}</>
                          : (r.error ?? 'שגיאה')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="rounded-xl border border-[#e0e0da] bg-white p-3.5">
              <div className="flex items-center gap-2 mb-2">
                <Radar className="w-3.5 h-3.5 text-amber-700" />
                <span className="text-[12px] font-bold text-zinc-800">מכ"ם-הסטיות — פנימי מול שוק-אמת</span>
              </div>
              <div className="space-y-1.5">
                {ve.radar.map(r => (
                  <div key={r.asset} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-semibold text-zinc-700" dir="ltr">{r.asset}</span>
                    <span dir="ltr" className={
                      r.verdict === 'converged' ? 'text-emerald-700'
                        : r.verdict === 'drift' ? 'text-amber-700'
                          : r.verdict === 'divergent' ? 'text-red-700' : 'text-zinc-400'
                    }>
                      {r.internalUsd != null ? `$${r.internalUsd.toPrecision(4)}` : '—'}
                      {' vs '}
                      {r.realUsd != null ? `$${r.realUsd.toPrecision(4)}` : '—'}
                      {r.deviationPct != null ? ` (${r.deviationPct > 0 ? '+' : ''}${r.deviationPct.toFixed(2)}%)` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {hist.length > 1 && (
            <div className="mt-3 text-[10.5px] text-zinc-500">
              היסטוריית-שטיפה: {hist.length} תמונות · realBps {hist[hist.length - 1].realBps} → {hist[0].realBps} · unitBps {hist[hist.length - 1].unitBps} → {hist[0].unitBps}
            </div>
          )}
          <div className="mt-2 text-[10px] text-zinc-400">
            כנות: כל-מספר נמדד-חי (RPC-ציבורי · CoinGecko/Binance · state-הדקס) — אין-הדמיה-מחופשת-להכנסה. הפער-המוצג הוא הפער-האמיתי.
          </div>
        </>
      )}
    </div>
  );
}

/* ─── כרטיס-ההוכחה-הרציפה (EXEC-CD-36) — חלון-המפעיל-אל-רץ-ההוכחה-ה-self-hosted ─── */
type ProofStatus = {
  ok: boolean; exists: boolean; note?: string; error?: string;
  latest?: {
    verdict?: string; ts?: string; run?: number;
    engine?: { up: boolean; height: number };
    ports?: Record<string, boolean>;
    git?: Array<{ repo: string; local: string; remote: string; synced: boolean | null }>;
    battery?: { bmc?: { verdict: string; depth: number; sequences: number; applies: number } | null; fuzzer?: { verdict: string } | null };
    alerts?: Array<{ rule: string }>;
  };
  alerts?: Array<{ ts: string; rule: string; state: string; detail: string }>;
  ledgerLines?: number;
  bmc?: { verdict?: string; depth?: number; sequences?: number; applies?: number; ts?: string } | null;
};

function ProofStatusCard() {
  const [ps, setPs] = useState<ProofStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [spawning, setSpawning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/saos/proof-status', { cache: 'no-store' });
      setPs(await r.json());
    } catch { setPs(prev => prev); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void load();
    const iv = setInterval(() => { void load(); }, 90_000);
    return () => clearInterval(iv);
  }, [load]);

  const spawnProof = async () => {
    setSpawning(true); setMsg(null);
    try {
      const r = await fetch('/api/saos/proof-status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const j = await r.json() as { ok: boolean; note?: string; error?: string };
      setMsg(j.ok ? (j.note ?? 'הריצה הוזנקה') : [j.error, j.note].filter(Boolean).join(' — ') || 'ההזנקה נכשלה');
      setTimeout(() => { void load(); }, 45_000);
    } catch { setMsg('ה-API לא נגיש'); } finally { setSpawning(false); }
  };

  const v = ps?.latest?.verdict;
  const VERDICT_META: Record<string, { cls: string; label: string }> = {
    PASS: { cls: 'bg-emerald-50 border-emerald-200 text-emerald-800', label: 'הוכח' },
    ALERT: { cls: 'bg-orange-50 border-orange-200 text-orange-800', label: 'התראה' },
    DEGRADED: { cls: 'bg-amber-50 border-amber-200 text-amber-800', label: 'מופחת' },
  };
  const vm = v ? (VERDICT_META[v] ?? { cls: 'bg-zinc-100 border-zinc-200 text-zinc-600', label: v }) : null;
  const ports = ps?.latest?.ports ?? {};
  const bmc = ps?.latest?.battery?.bmc;
  const fz = ps?.latest?.battery?.fuzzer;
  const git = ps?.latest?.git ?? [];

  return (
    <div className="sv-card p-4 md:p-6">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 grid place-items-center">
            <ShieldCheck className="w-4.5 h-4.5 text-emerald-700" />
          </div>
          <div>
            <div className="text-[14px] font-bold text-zinc-900">ההוכחה-הרציפה <span className="text-[11px] font-normal text-zinc-500">(EXEC-CD-36 · self-hosted runner)</span></div>
            <div className="text-[11px] text-zinc-500">
              BMC-אקסהוסטיבי + fuzzer + חיווט + התראות · כל-4-שעות
              {ps?.latest?.ts ? ` · ריצה-אחרונה ${timeAgo(ps.latest.ts)}` : ''} · פנקס {ps?.ledgerLines ?? 0} ריצות
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {vm && <span className={`text-[11px] rounded-full px-2.5 py-1 border font-semibold ${vm.cls}`}>{vm.label}</span>}
          <button onClick={load} disabled={loading}
            className="h-8 px-2.5 rounded-lg border border-[#e0e0da] bg-white hover:bg-zinc-50 text-[11px] text-zinc-600 transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
            aria-label="רענן מצב-הוכחה">
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> רענון
          </button>
          <button onClick={spawnProof} disabled={spawning}
            className="h-8 px-3 rounded-lg border border-emerald-600/30 bg-emerald-50 hover:bg-emerald-100 text-[11px] text-emerald-800 transition-colors inline-flex items-center gap-1.5 disabled:opacity-50">
            <Crosshair className={`w-3 h-3 ${spawning ? 'animate-pulse' : ''}`} /> הזנק-הוכחה-עכשיו
          </button>
        </div>
      </div>

      {msg && <div className="mb-3 rounded-lg border border-[#e8e8e3] bg-zinc-50 px-3 py-2 text-[11.5px] text-zinc-700">{msg}</div>}
      {!ps?.exists && ps?.ok && <div className="text-[12px] text-zinc-500">{ps.note}</div>}
      {ps?.ok === false && <div className="text-[12px] text-orange-700">{ps.error}</div>}

      {ps?.exists && ps.latest && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-3">
            <div className="rounded-xl border border-[#e8e8e3] bg-white p-3">
              <div className="text-[10px] text-zinc-500 mb-0.5">BMC (אקסהוסטיבי)</div>
              <div className="text-[13px] font-bold text-zinc-900">
                {bmc ? `${bmc.verdict === 'PASS' ? '✓' : '✗'} עומק-${bmc.depth}` : (fz ? '—' : '—')}
              </div>
              <div className="text-[10px] text-zinc-400">{bmc?.sequences ? `${bmc.sequences.toLocaleString('en-US')} רצפים · ${bmc.applies?.toLocaleString('en-US')} applies` : 'טרם-רץ'}</div>
            </div>
            <div className="rounded-xl border border-[#e8e8e3] bg-white p-3">
              <div className="text-[10px] text-zinc-500 mb-0.5">Fuzzer אדיברסרי</div>
              <div className="text-[13px] font-bold text-zinc-900">{fz ? (fz.verdict.startsWith('PASS') ? '✓ PASS' : `✗ ${fz.verdict}`) : '—'}</div>
              <div className="text-[10px] text-zinc-400">13 אינוואריאנטות · ביקורת-מוטנטים</div>
            </div>
            <div className="rounded-xl border border-[#e8e8e3] bg-white p-3">
              <div className="text-[10px] text-zinc-500 mb-0.5">המנוע-החי</div>
              <div className="text-[13px] font-bold text-zinc-900">{ps.latest.engine?.up ? `✓ h${ps.latest.engine.height?.toLocaleString('en-US')}` : '✗ לא-מגיב'}</div>
              <div className="text-[10px] text-zinc-400">{Object.values(ports).filter(Boolean).length}/{Object.keys(ports).length} נמלי-ערימה</div>
            </div>
            <div className="rounded-xl border border-[#e8e8e3] bg-white p-3">
              <div className="text-[10px] text-zinc-500 mb-0.5">ריבונות-גיט</div>
              <div className="text-[13px] font-bold text-zinc-900">{git.length ? (git.every(g => g.synced === true) ? '✓ מסונכרן' : '✗ פער') : '—'}</div>
              <div className="text-[10px] text-zinc-400">{git.map(g => g.repo.replace('saos-', '')).join(' · ') || '—'}</div>
            </div>
          </div>

          {(ps.latest.alerts?.length ?? 0) > 0 && (
            <div className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 mb-3 text-[11.5px] text-orange-800">
              התראות-פתוחות: {ps.latest.alerts?.map(a => a.rule).join(' · ')}
            </div>
          )}

          {(ps.alerts?.length ?? 0) > 0 && (
            <div className="max-h-40 overflow-y-auto pr-1 space-y-1.5" role="log" aria-label="פנקס-התראות">
              {ps.alerts?.map((a, i) => (
                <div key={`${a.ts}-${i}`} className="flex items-start justify-between gap-2 text-[11px] rounded-lg border border-[#e8e8e3] bg-white px-2.5 py-1.5">
                  <span className="text-zinc-700">
                    <span className={a.state === 'open' ? 'text-orange-700 font-semibold' : 'text-emerald-700 font-semibold'}>{a.state === 'open' ? 'נפתחה' : 'נסגרה'}</span>
                    {' · '}{a.rule} — {a.detail}
                  </span>
                  <span className="text-[10px] text-zinc-400 shrink-0">{timeAgo(a.ts)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TreasuryWatcherCard() {
  const [t, setT] = useState<TreasuryState | null>(null);
  const [loading, setLoading] = useState(true);
  const [watching, setWatching] = useState(false);
  const [watchMsg, setWatchMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/vault/treasury', { cache: 'no-store' });
      setT(await r.json());
    } catch {
      setT(prev => prev); // שמירה-על-מצב-קודם — fail-soft לתצוגה
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void load();
    const iv = setInterval(() => { void load(); }, 90_000);
    return () => clearInterval(iv);
  }, [load]);

  const runWatch = async () => {
    setWatching(true); setWatchMsg(null);
    try {
      const r = await fetch('/api/vault/treasury', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      });
      const j: WatchSummary = await r.json();
      if (j.ok) {
        setWatchMsg(j.eventsCreated
          ? `סיבוב הושלם — ${j.probed} רשתות · ${j.eventsCreated} אירועים חדשים`
          : `סיבוב הושלם — ${j.probed} רשתות, אין-שינויי-יתרה`);
      } else {
        setWatchMsg(j.error ?? 'סיבוב נכשל');
      }
      await load();
    } catch {
      setWatchMsg('ה-API לא נגיש');
    } finally { setWatching(false); }
  };

  const rows = t?.addresses ?? [];
  const evs = t?.events ?? [];
  return (
    <div className="sv-card p-4 md:p-6">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-sky-600/10 border border-sky-600/20 grid place-items-center">
            <Eye className="w-4.5 h-4.5 text-sky-700" />
          </div>
          <div>
            <div className="text-[14px] font-bold text-zinc-900">צופה-האוצר <span className="text-[11px] font-normal text-zinc-500">(EXEC-CD-26)</span></div>
            <div className="text-[11px] text-zinc-500">
              הריבונות עוקבת בעצמה אחרי יתרות כתובות-הכספת · לופ אוטונומי כל-15-דק׳
              {t?.stats?.lastWatchAt ? ` · תצפית-אחרונה ${timeAgo(t.stats.lastWatchAt)}` : ''}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="h-8 px-2.5 rounded-lg border border-[#e0e0da] bg-white hover:bg-zinc-50 text-[11px] text-zinc-600 transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
            aria-label="רענן יתרות"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> רענון
          </button>
          <button
            onClick={runWatch}
            disabled={watching}
            className="h-8 px-3 rounded-lg border border-sky-600/30 bg-sky-50 hover:bg-sky-100 text-[11px] text-sky-800 transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <Activity className={`w-3 h-3 ${watching ? 'animate-pulse' : ''}`} /> סיבוב-צפייה עכשיו
          </button>
        </div>
      </div>

      {watchMsg && (
        <div className="mb-3 text-[11.5px] text-sky-800 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">{watchMsg}</div>
      )}

      {loading && !t ? (
        <div className="p-6 text-center text-[12px] text-zinc-400">בודק יתרות-חיות מול הרשתות…</div>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            {rows.map(a => {
              const p = a.probe;
              return (
                <div key={a.network} className="rounded-xl border border-[#e8e8e3] bg-white p-3">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-data text-[14px] text-zinc-900 w-5 text-center" dir="ltr">{NET_ICON[a.network] ?? '●'}</span>
                      <span className="text-[12px] font-semibold text-zinc-800 capitalize">{a.network}</span>
                    </div>
                    {p?.ok
                      ? <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">חי · {p.latencyMs}ms</span>
                      : <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5" title={p?.error}>RPC לא-זמין</span>}
                  </div>
                  <div className="font-data text-[16px] font-semibold text-zinc-900" dir="ltr">
                    {p?.ok ? (
                      <>{p.balanceHuman ?? '0'} <span className="text-[11px] text-zinc-400">{p.unit}</span></>
                    ) : '—'}
                  </div>
                </div>
              );
            })}
            {!rows.length && (
              <div className="p-4 text-[12px] text-zinc-400 sm:col-span-2">אין כתובות-כספת (manifest חסר)</div>
            )}
          </div>

          {/* מנוע-ההמרה-מהכספת (EXEC-CD-27) — נכונות-חיה מהצפיות-שכבר-חיות למעלה */}
          {(() => {
            const byNet = new Map(rows.map(r => [r.network, r.probe]));
            const sol = byNet.get('solana');
            const evm = byNet.get('evm');
            const solReady = !!sol?.ok && Number(sol.balanceRaw || '0') > 1_500_000;
            const evmReady = !!evm?.ok && Number(evm.balanceRaw || '0') > 300_000_000_000_000;
            const anyReady = solReady || evmReady;
            return (
              <div className="mt-3 rounded-xl border border-[#e8e8e3] bg-zinc-50/60 p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                  <div className="text-[11px] font-semibold text-zinc-600">מנוע-ההמרה-מהכספת <span className="font-normal text-zinc-400">(vault-swap · EXEC-CD-27)</span></div>
                  {anyReady && <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">מוכן-לביצוע</span>}
                </div>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-zinc-600" dir="ltr">◎ SOL → USDC/USDT (Jupiter)</span>
                    {solReady
                      ? <span className="text-emerald-700 font-semibold">READY</span>
                      : <span className="text-zinc-400">מחכה-מימון</span>}
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-zinc-600" dir="ltr">⟠ ETH → USDC/USDT (ParaSwap)</span>
                    {evmReady
                      ? <span className="text-emerald-700 font-semibold">READY</span>
                      : <span className="text-zinc-400">מחכה-מימון</span>}
                  </div>
                </div>
                <div className="mt-2 text-[10.5px] leading-relaxed text-zinc-500">
                  נתיב-ההמרה: כסף-נוחת-על-כתובת-הכספת ← צופה-האוצר מזהה-תוך-15-דק׳ ←
                  <span className="font-data text-[10px] text-zinc-700" dir="ltr"> scripts/vault-swap.ts --chain solana|evm</span>
                  ← quote-חי ← חתימה ← סימולציה ← שידור. תקרות-קשיחות: 0.1-SOL / 0.05-ETH. ציטוטים-חיים אומתו (EXEC-CD-27).
                </div>
              </div>
            );
          })()}

          {/* חציית-הגבול (EXEC-CD-29) — הוכחות-אמת על-השרשרות + בדיקות-חי */}
          <BorderCrossingCard />

          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] font-semibold text-zinc-600">יומן-אירועי-אוצר</div>
              {t?.stats && (
                <div className="text-[10px] text-zinc-400">
                  {t.stats.fundingEvents} כניסות-ערך · {t.stats.events} אירועים · {t.stats.sightings} תצפיות
                </div>
              )}
            </div>
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {evs.map((e, i) => {
                const meta = EV_META[e.kind] ?? EV_META['probe-error'];
                const Icon = meta.icon;
                return (
                  <div key={`${e.seenAt}-${i}`} className="flex items-center gap-2 rounded-lg border border-[#f0f0eb] bg-white px-2.5 py-1.5">
                    <span className={`inline-flex items-center gap-1 text-[10px] rounded-full px-2 py-0.5 border ${meta.cls} shrink-0`}>
                      <Icon className="w-2.5 h-2.5" />{meta.label}
                    </span>
                    <span className="font-data text-[11px] text-zinc-800" dir="ltr">{e.deltaHuman} {e.unit}</span>
                    <span className="text-[10px] text-zinc-400 truncate flex-1">{e.note}</span>
                    <span className="text-[10px] text-zinc-400 shrink-0">{timeAgo(e.seenAt)}</span>
                  </div>
                );
              })}
              {!evs.length && (
                <div className="p-4 text-center text-[11.5px] text-zinc-400 rounded-lg border border-dashed border-[#e8e8e3]">
                  עדיין אין אירועים — הצופה רושם כניסת-ערך ברגע שכסף יגיע לכתובות-הכספת
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 sv-well p-2.5 text-[10.5px] text-zinc-500">
            אפס-סודות: קריאה-ציבורית בלבד (RPC ציבוריים מול כתובות-ה-manifest) — המעטפת המוצפנת לא נפתחת כאן לעולם.
            כניסת-ערך לכתובת-כספת = אירוע שהאוטונומיה רואה ומטפלת לפי חוק-המשפך (דוקטרינה §6-§7).
          </div>
        </>
      )}
    </div>
  );
}

export function SovereignView() {
  const [data, setData] = useState<SovereignData | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [verify, setVerify] = useState<VerifyResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/vault/sovereign', { cache: 'no-store' });
      setData(await r.json());
    } catch {
      setData({ ok: false, exists: false, me: null, error: 'ה-API לא נגיש' });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const runVerify = async () => {
    setVerifying(true); setVerify(null);
    try {
      const { authHeaders } = await import('./shared');
      const r = await fetch('/api/vault/sovereign', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ action: 'verify' }),
      });
      setVerify(await r.json());
    } catch {
      setVerify({ ok: false, error: 'הבדיקה נכשלה — ה-API לא נגיש' });
    } finally { setVerifying(false); }
  };

  const esc = data?.escalations?.items ?? [];
  const sortedEsc = [...esc].sort((a, b) => {
    const w = { high: 0, medium: 1, low: 2 } as Record<string, number>;
    return (w[a.priority] ?? 3) - (w[b.priority] ?? 3);
  });

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight leading-tight text-zinc-900">כספת-הריפו הריבונית</h1>
          <p className="text-[12px] text-zinc-500 mt-0.5">
            הארנק שחי בגיט עצמו — לא תלוי בסנדבוקס · 2-of-2 שברי-חותם → AES-256-GCM · clone חדש = שחזור-מלא
          </p>
        </div>
        <button
          onClick={runVerify}
          disabled={verifying || !data?.exists}
          className="h-9 px-3.5 rounded-lg border border-[#e0e0da] bg-white hover:bg-zinc-50 text-[12px] text-zinc-700 transition-colors inline-flex items-center gap-2 disabled:opacity-50 shadow-[0_1px_2px_rgba(24,24,27,0.04)]"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${verifying ? 'animate-spin' : ''}`} />
          תרגיל-פתיחה + בדיקת-חי
        </button>
      </div>

      {loading && <div className="sv-card p-8 text-center text-[12px] text-zinc-400">טוען את מצב הכספת…</div>}

      {!loading && data && !data.exists && (
        <div className="sv-card p-6 text-center space-y-2">
          <Vault className="w-8 h-8 mx-auto text-zinc-300" />
          <p className="text-[13px] text-zinc-600">אין כספת בריפו. הרץ:</p>
          <code className="block font-data text-[12px] bg-zinc-50 border border-[#e8e8e3] rounded-lg px-3 py-2 text-zinc-700" dir="ltr">bun scripts/repo-vault-mint.ts</code>
          {data.error && <p className="text-[11px] text-rose-600">{data.error}</p>}
        </div>
      )}

      {!loading && data?.exists && (
        <>
          {/* פסק-דין תרגיל-הפתיחה */}
          {verify && (
            <div className={`sv-card p-4 border ${verify.ok && verify.verdict?.addressesMatch ? 'border-emerald-300 bg-emerald-50/40' : 'border-rose-300 bg-rose-50/40'}`}>
              <div className="flex items-center gap-2 mb-1.5">
                {verify.ok && verify.verdict?.addressesMatch
                  ? <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  : <ShieldAlert className="w-4 h-4 text-rose-600" />}
                <span className="text-[13px] font-semibold text-zinc-900">
                  {verify.ok && verify.verdict?.addressesMatch
                    ? `תרגיל-השחזור עבר — פתיחה-GCM ✓ · נגזרה-מחדש ביט-מול-ביט ✓ · (${verify.verdict.latencyMs}ms)`
                    : 'תרגיל-השחזור נכשל — יש לבדוק מיד'}
                </span>
              </div>
              {verify.error && <p className="text-[12px] text-rose-700 font-data" dir="ltr">{verify.error}</p>}
              {verify.networks && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {verify.networks.map(n => <ProbeChip key={n.network} p={n.probe} />)}
                </div>
              )}
            </div>
          )}

          {/* כרטיס-הכספת */}
          <div className="sv-card p-4 md:p-6">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-600/10 border border-emerald-600/20 grid place-items-center">
                  <Vault className="w-4.5 h-4.5 text-emerald-700" />
                </div>
                <div>
                  <div className="text-[14px] font-bold text-zinc-900">הארנק-הריבוני <span className="font-data text-[11px] text-zinc-500" dir="ltr">{data.label}</span></div>
                  <div className="text-[11px] text-zinc-500">נחתם {data.createdAt ? new Date(data.createdAt).toLocaleString('he-IL') : ''} · {data.algo?.cipher ?? 'AES-256-GCM'} · {data.algo?.mnemonicWords ?? 24} מילים</div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                  <ShieldCheck className="w-2.5 h-2.5" />חתומה-בגיט
                </span>
                {data.manifestOnDisk && (
                  <span className={`text-[10px] rounded-full px-2 py-0.5 border ${data.manifestConsistent ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-amber-700 bg-amber-50 border-amber-200'}`}>
                    מניפסט {data.manifestConsistent ? 'מתואם' : 'חסר-התאמה'}
                  </span>
                )}
                {data.me !== 'owner' && <span className="text-[10px] text-zinc-500">· כתובות-מלאות למחוברים</span>}
              </div>
            </div>

            {/* רשתות */}
            <div className="grid gap-2.5 md:grid-cols-2">
              {(data.networks ?? []).map(n => {
                const addr = data.me === 'owner' ? n.address : n.addressMasked;
                return (
                  <div key={n.network} className="rounded-xl border border-[#e8e8e3] bg-white p-3.5">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-data text-[15px] text-zinc-900 w-5 text-center" dir="ltr">{NET_ICON[n.network] ?? '●'}</span>
                        <div>
                          <div className="text-[12px] font-semibold text-zinc-900">{n.label.split('(')[0].trim()}</div>
                          <div className="font-data text-[10px] text-zinc-400" dir="ltr">{n.path}</div>
                        </div>
                      </div>
                      <ProbeChip p={n.probe} />
                    </div>
                    {addr && (
                      <div className="flex items-center gap-1.5 bg-zinc-50 rounded-lg px-2.5 py-1.5 border border-[#f0f0eb]">
                        <code className="font-data text-[11px] text-zinc-700 truncate flex-1" dir="ltr">{addr}</code>
                        {data.me === 'owner' && n.address && <CopyBtn text={n.address} />}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* טביעות-אצבע + חוזה-הכספת */}
            <div className="mt-4 sv-well p-3">
              <div className="text-[11px] font-semibold text-zinc-600 mb-1.5">חוזה-הכספת</div>
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                מפתח-AES = sha256(&quot;sovereign-repo-vault-v1&quot; ‖ seal.a ⊕ seal.b) — שני-השברים-חיים-בריפו-עצמו,
                אין-תלות ב-.env או בסנדבוקס. טביעות-אצבע (16 תווים ראשונים של SHA-256 — לעולם לא החומר):
                {data.fingerprints && (
                  <span className="font-data text-zinc-600" dir="ltr">
                    {' '}mnemonic:{data.fingerprints['mnemonic']} · seal.a:{data.fingerprints['seal.a']} · seal.b:{data.fingerprints['seal.b']}
                  </span>
                )}
              </p>
              <div className="mt-2.5 flex items-start gap-2 text-[11px] text-zinc-500 bg-white rounded-lg border border-[#e8e8e3] px-3 py-2">
                <Terminal className="w-3.5 h-3.5 mt-0.5 shrink-0 text-zinc-400" />
                <div>
                  <span className="font-semibold text-zinc-600">תרגיל-השחזור (סנדבוקס-מתה → מכונה-חדשה):</span>
                  <div className="font-data mt-1 space-y-0.5" dir="ltr">
                    <div className="text-zinc-600">git clone &lt;repo&gt; saos &amp;&amp; cd saos &amp;&amp; bun install</div>
                    <div className="text-emerald-700">bun scripts/repo-vault-open.ts --probe</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* צופה-האוצר (EXEC-CD-26) */}
      <TreasuryWatcherCard />

      {/* מנוע-הערך-האמתי (EXEC-CD-30) — השטיפה-צעד-צעד */}
      <ValueEngineCard />

      {/* ההוכחה-הרציפה (EXEC-CD-36) — self-hosted runner ברמת-הענקים */}
      <ProofStatusCard />

      {/* העברה-למפעיל */}
      <div className="sv-card p-4 md:p-6">
        <div className="flex items-center gap-2.5 mb-1.5">
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 grid place-items-center">
            <HandMetal className="w-4.5 h-4.5 text-amber-700" />
          </div>
          <div>
            <div className="text-[14px] font-bold text-zinc-900">העברה-למפעיל — מה שהאוטונומיה לא יכולה לעשות</div>
            <div className="text-[11px] text-zinc-500">
              רישום-חי בריפו (<code className="font-data" dir="ltr">repo-vault/escalations.json</code>)
              {data?.escalations?.items.length ? ` · ${data.escalations.items.length} פריטים` : ''} · עודכן {data?.escalations?.updatedAt ? new Date(data.escalations.updatedAt).toLocaleDateString('he-IL') : '—'}
            </div>
          </div>
        </div>
        <p className="text-[11.5px] text-zinc-500 mb-3">{data?.escalations?.note}</p>
        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {sortedEsc.map(it => (
            <div key={it.id} className="rounded-xl border border-[#e8e8e3] bg-white p-3.5">
              <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                <span className="text-[12.5px] font-semibold text-zinc-900">{it.title}</span>
                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] rounded-full px-2 py-0.5 border ${PRIO_META[it.priority]?.cls ?? PRIO_META.low.cls}`}>
                    {PRIO_META[it.priority]?.label ?? 'רגיל'}
                  </span>
                  <span className="text-[10px] text-zinc-400 rounded-full border border-[#e8e8e3] px-2 py-0.5">ממתין-למפעיל</span>
                </div>
              </div>
              <p className="text-[11.5px] text-zinc-500 leading-relaxed"><span className="font-semibold text-zinc-600">למה אי-אפשר:</span> {it.why}</p>
              <p className="text-[11.5px] text-zinc-500 leading-relaxed"><span className="font-semibold text-emerald-700">מה נדרש:</span> {it.what}</p>
            </div>
          ))}
          {!sortedEsc.length && !loading && (
            <div className="p-6 text-center text-[12px] text-zinc-400">אין פריטים — כל-הדרוש-אנושי מבוצע</div>
          )}
        </div>
      </div>

      {/* כנות-איום */}
      <div className="sv-well p-3.5 text-[11px] text-zinc-500 leading-relaxed">
        <span className="font-semibold text-zinc-600">כנות-איום (חוק-הכנות):</span> ההצפנה מגינה מפני-חומר-עירום-במנוחה,
        סריקות-אוטומטיות ודליפות-לוג — לא מבעל-גישה-לריפו-הפרטי שמתכוון-לפתוח (שני-השברים-בריפו).
        זה-המחיר של עצמאות-מסנדבוקס — הוראת-המפעיל המפורשת. מפתחות-פרטיים לעולם לא נכנסים למסך הזה.
      </div>
    </div>
  );
}
