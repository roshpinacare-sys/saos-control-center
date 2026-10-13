'use client';

// ─── סיפון-הדלק · Fuel Deck — טלמטריית דלק/RC חיה של הצי הריבוני ──────────
// מקור-אמת: GET /api/fuel (מצב-דלק + relay + צי + זהות-ראשית) · קריאה-בלבד · אפס הדמיה.
// כנות: שדות-חסרים מוצגים '—' / 'לא-נמדד' — לעולם לא ממציאים נתונים (Task 3-c).

import { useCallback, useState } from 'react';
import {
  Fuel, Flame, Zap, Coins, Sun, Gem, Sparkles, Activity,
  Check, X, Minus, KeyRound, RefreshCcw, Loader2, ShieldAlert,
} from 'lucide-react';
import { fmtInt, usePoll, StaleChip } from './common';

// ── contract types (GET /api/fuel) — optional-safe: השרת עשוי לדווח חלקית ──
type FuelSources = { fuelState?: boolean; relay?: boolean; fleet?: boolean; connectAll?: boolean };
type FuelMetrics = {
  broadcasts?: number; verified?: number; mismatches?: number;
  breakerTrips?: number; economicWaits?: number; rotations?: number;
};
type FuelChain = {
  enabled?: boolean; status?: string | null; anchored?: number;
  verified?: number; mismatches?: number; lastError?: string | null;
};
type FuelRelay = { metrics?: FuelMetrics | null; chains?: Record<string, FuelChain> | null };
type FuelAccount = {
  account: string; hasVerifiedKey?: boolean; authorityOk?: boolean | null;
  rcEffective?: number | null; steemOk?: boolean | null; steemRc?: number | null;
  blurtOk?: boolean | null; blurtBalance?: number | null;
  anchoredCount?: number; usable?: boolean;
};
type FuelFleet = {
  configured?: boolean;
  usableByChain?: { hive?: number; steem?: number; blurt?: number };
  accounts?: FuelAccount[];
};
type FuelPrimary = {
  account?: string;
  hive?: { rc?: number; rcPct?: number } | null;
  steem?: { rc?: number } | null;
  blurt?: { balance?: number } | null;
  tron?: { sun?: number } | null;
  eth?: { wei?: number } | null;
  sol?: { lamports?: number } | null;
};
type FuelPendingLeg = { status?: string; identity?: string; missingWei?: string; missingLamports?: string };
type FuelPending = { eth?: FuelPendingLeg | null; sol?: FuelPendingLeg | null };
// BLURT ARMY · connect-all — מטריצת-החיבור (כל-השרשראות, כל-התפקידים, מאומת-חי)
type ArmyRoles = { owner?: boolean; active?: boolean; posting?: boolean; memo?: boolean };
type ArmyChain = { verified?: number; roles?: ArmyRoles } | 'no-keys' | 'not-on-chain';
type ArmyAccount = { username?: string; chains?: Record<string, ArmyChain | undefined> };
type ArmyBlurt = { sealedAccounts?: number; chainVerifiedOwnerPlus?: number; full4?: number };
type ArmyData = {
  at?: string; verdict?: string;
  blurtArmy?: ArmyBlurt | null;
  matrix?: ArmyAccount[] | null;
} | null;
type FuelData = {
  ok: boolean; at?: string; sources?: FuelSources;
  relay?: FuelRelay | null; fleet?: FuelFleet | null;
  primary?: FuelPrimary | null; pending?: FuelPending | null;
  army?: ArmyData;
};

// ── defensive helpers — כל-מספר-מהרשת עובר-ניקוי (strict, אין any) ──
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// RC/יתרות-גדולות → M/B/T (כמו-שנמדד: 66,600,000 → 66.6M · 1.23e15 wei → 1.2T)
function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(1) + 'T';
  if (abs >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return fmtInt(n);
}

type Tone = 'ok' | 'unknown' | 'dead';
const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-[color:var(--green)]',
  unknown: 'text-[color:var(--amber)]',
  dead: 'text-[color:var(--red)]',
};
const TONE_DOT: Record<Tone, string> = {
  ok: 'bg-[color:var(--green)]',
  unknown: 'bg-[color:var(--amber)]',
  dead: 'bg-[color:var(--red)]',
};

// אמרלד = סמכות-תקינה ודלק-נמדד · אמבר = לא-נמדד/null · רוז = ידוע-מת/לא-כשיר
function railTone(ok: boolean | null | undefined, value: number | null): Tone {
  if (ok === false) return 'dead';
  if (ok === true && value !== null) return 'ok';
  return 'unknown';
}

function rcTone(pct: number): 'ok' | 'warn' | 'bad' {
  return pct >= 40 ? 'ok' : pct >= 10 ? 'warn' : 'bad';
}

// ── Hive RC% — פס-התקדמות: ירוק ≥40% · אמבר ≥10% · רוז מתחת ──
function RcBar({ pct }: { pct: number | null }) {
  if (pct === null) {
    return <div className="h-1.5 w-full rounded-full bg-white/10" title="לא-נמדד" />;
  }
  const clamped = Math.max(0, Math.min(100, pct));
  const color = rcTone(pct);
  const bg = color === 'ok' ? 'var(--green)' : color === 'warn' ? 'var(--amber)' : 'var(--red)';
  return (
    <div
      className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden"
      role="progressbar"
      aria-label="אחוז RC של Hive"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-full rounded-full transition-all" style={{ width: `${clamped}%`, background: bg }} />
    </div>
  );
}

function Meter({ icon: Icon, label, value, bar, sub }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: string; bar?: React.ReactNode; sub?: React.ReactNode;
}) {
  return (
    <div className="dx-raised p-3">
      <div className="flex items-center gap-1.5 text-[10px] label-caps text-[color:var(--text-3)]">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <div className="dx-num text-sm mt-1" dir="ltr">{value}</div>
      {bar && <div className="mt-1.5">{bar}</div>}
      {sub && <div className="text-[10px] text-[color:var(--text-3)] mt-1">{sub}</div>}
    </div>
  );
}

// תא-מסילה במטריצת-הצי: סמן-מצב + מספר (LTR mono)
function RailCell({ ok, value, fmt, unknownLabel = 'לא-נמדד' }: {
  ok: boolean | null | undefined; value: number | null;
  fmt: (n: number) => string; unknownLabel?: string;
}) {
  const tone = railTone(ok, value);
  const Icon = tone === 'ok' ? Check : tone === 'dead' ? X : Minus;
  const title = tone === 'ok' ? 'סמכות-תקינה · דלק נמדד' : tone === 'dead' ? 'ידוע-מת / לא-כשיר' : unknownLabel;
  return (
    <span className={`inline-flex items-center gap-1.5 ${TONE_TEXT[tone]}`} title={title}>
      <Icon className="w-3 h-3 shrink-0" aria-hidden />
      <span className="dx-num text-[11px]" dir="ltr">{value !== null ? fmt(value) : '—'}</span>
    </span>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className="dx-raised p-3">
      <div className="text-[9px] label-caps">{label}</div>
      <div className={`dx-num text-sm mt-0.5 ${tone === 'ok' ? 'text-[color:var(--green)]' : tone === 'warn' ? 'text-[color:var(--amber)]' : tone === 'bad' ? 'text-[color:var(--red)]' : ''}`}>
        {value}
      </div>
    </div>
  );
}

function SourceDot({ label, ok }: { label: string; ok: boolean | undefined }) {
  const cls = ok === true ? TONE_DOT.ok : ok === false ? TONE_DOT.dead : TONE_DOT.unknown;
  return (
    <span className="inline-flex items-center gap-1" title={ok === undefined ? 'לא-דווח' : undefined}>
      <span className={`w-1.5 h-1.5 rounded-full ${cls}`} aria-hidden />
      {label}
    </span>
  );
}

// רגל-שידור-ממתין (dry-run) — סטטוס + זהות + כמות-דלק-חסרה (mono, כנה)
function ArmyCell({ chain }: { chain: ArmyChain | undefined }) {
  if (!chain) return <span className="text-[color:var(--text-3)] text-[11px]">·</span>;
  if (chain === 'no-keys') return <span className="text-[10px] text-[color:var(--amber)]" title="אין חותמות בכספת">אין-מפתחות</span>;
  if (chain === 'not-on-chain') return <span className="text-[10px] text-[color:var(--text-3)]" title="החשבון לא קיים על השרשרת">לא-על-השרשרת</span>;
  const roles: ArmyRoles = chain.roles ?? {};
  const marks = (['owner', 'active', 'posting', 'memo'] as const).map((role) => {
    const v = roles[role];
    const cls = v === true ? 'text-[color:var(--green)]' : v === false ? 'text-[color:var(--amber)]' : 'text-[color:var(--text-3)]';
    const glyph = v === true ? '✓' : v === false ? '✕' : '·';
    return (
      <span key={role} className={`${cls} dx-num text-[11px]`} title={`${role}: ${v === true ? 'מאומת-מול-השרשרת' : v === false ? 'מפתח-תקין-אך-שונה-על-השרשרת' : 'לא-נמדד'}`}>
        {glyph}
      </span>
    );
  });
  return <span className="inline-flex items-center gap-1.5" dir="ltr">{marks}</span>;
}

function PendingLeg({ name, leg, divisor, unit }: {
  name: string;
  leg: FuelPendingLeg | null | undefined;
  divisor: number; unit: string;
}) {
  const missingRaw = leg?.missingWei ?? leg?.missingLamports ?? null;
  const missing = typeof missingRaw === 'string' && missingRaw.length > 0 && Number.isFinite(Number(missingRaw))
    ? Number(missingRaw)
    : null;
  const status = typeof leg?.status === 'string' && leg.status.length > 0 ? leg.status : null;
  const ready = status === 'ready';
  return (
    <div className="dx-raised p-3 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold dx-num" dir="ltr">{name}</span>
        <span className={`text-[9px] px-2 py-0.5 rounded-full ${ready ? 'bg-[color:var(--green-soft)] text-[color:var(--green)]' : 'bg-[color:var(--amber-soft)] text-[color:var(--amber)]'}`}>
          {status ? (ready ? 'מוכן' : status) : 'לא-דווח'}
        </span>
      </div>
      <div className="text-[10px] text-[color:var(--text-3)] flex items-center gap-1 min-w-0">
        זהות:{' '}
        {leg?.identity
          ? <span className="dx-num truncate" dir="ltr">{leg.identity}</span>
          : <span className="text-[color:var(--amber)]">לא-דווח</span>}
      </div>
      <div className="text-[10px] text-[color:var(--text-3)]">
        חסר-דלק:{' '}
        {missing !== null
          ? <span className="dx-num text-[color:var(--amber)]" dir="ltr">{(missing / divisor).toFixed(6)} {unit}</span>
          : <span>לא-דווח</span>}
      </div>
    </div>
  );
}

function DeckHeader({ stale, onRefresh }: { stale: boolean; onRefresh: () => void }) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-2">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Fuel className="w-5 h-5 text-[color:var(--pink)]" />
          סיפון-הדלק
          <StaleChip show={stale} className="mr-1" />
        </h2>
        <p className="text-xs text-[color:var(--text-2)] mt-0.5">
          מדדי-RC ויתרות חיים · 15 חשבונות × 7 מסילות
        </p>
      </div>
      <button
        onClick={onRefresh}
        className="dx-ghost h-11 px-4 text-xs flex items-center gap-1.5 min-w-[44px] hover:bg-white/[0.06] transition-colors"
        aria-label="רענון סיפון-הדלק"
      >
        <RefreshCcw className="w-3.5 h-3.5" /> רענון
      </button>
    </div>
  );
}

export function FuelDeckView() {
  const [data, setData] = useState<FuelData | null>(null);
  const [err, setErr] = useState(false);

  const fetcher = useCallback(async (): Promise<boolean> => {
    try {
      const r = await fetch('/api/fuel', { cache: 'no-store' });
      const j = (await r.json()) as FuelData;
      if (r.ok && j?.ok) {
        setData(j);
        setErr(false);
        return true;
      }
      setErr(true);
      return false;
    } catch {
      setErr(true);
      return false;
    }
  }, []);

  // 15ש׳ · השהיה-בטאב-נסתר + backoff-עם-jitter + stale-chip — הקונבנציה של common.tsx
  const stale = usePoll(fetcher, 15_000);
  const onRefresh = useCallback(() => { void fetcher(); }, [fetcher]);

  const d = data;
  const relay = d?.relay ?? null;
  const metrics = relay?.metrics ?? null;
  const chains = Object.entries(relay?.chains ?? {});
  const enabledChains = chains.filter(([, c]) => c.enabled === true).length;
  const fleet = d?.fleet ?? null;
  const accounts = fleet?.accounts ?? [];
  const primary = d?.primary ?? null;
  const pending = d?.pending ?? null;
  const army = d?.army ?? null;
  const src = d?.sources;

  const rotations = num(metrics?.rotations);
  const economicWaits = num(metrics?.economicWaits);
  const verified = num(metrics?.verified);
  const broadcasts = num(metrics?.broadcasts);
  const hiveRc = num(primary?.hive?.rc);
  const hivePct = num(primary?.hive?.rcPct);
  const steemRc = num(primary?.steem?.rc);
  const blurtBal = num(primary?.blurt?.balance);
  const tronSun = num(primary?.tron?.sun);
  const ethWei = num(primary?.eth?.wei);
  const solLamports = num(primary?.sol?.lamports);

  return (
    <div className="max-w-5xl mx-auto space-y-4 pb-6" data-testid="fuel-deck-view">
      <DeckHeader stale={stale} onRefresh={onRefresh} />

      {/* שגיאה כנה — אין נתוני-דלק, אין המצאה */}
      {!d && err && (
        <div className="dx-card p-6 border-[color:var(--red)]/40" data-testid="fuel-error">
          <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--red)]">
            <ShieldAlert className="w-4 h-4" />
            סיפון-הדלק לא נגיש
          </div>
          <p className="text-xs text-[color:var(--text-2)] leading-relaxed mt-2">
            הקריאה אל <span className="dx-num" dir="ltr">GET /api/fuel</span> נכשלה — אין נתוני-דלק אמת להציג
            ולא יוצגו מדידות-שקר. הלולאה ממשיכה לנסות ברקע; אפשר גם לרענן ידנית.
          </p>
          <button
            onClick={onRefresh}
            className="dx-ghost h-11 px-4 mt-3 text-xs flex items-center gap-1.5 min-w-[44px] hover:bg-white/[0.06] transition-colors"
          >
            <RefreshCcw className="w-3.5 h-3.5" /> רענון
          </button>
        </div>
      )}

      {/* טעינה ראשונה */}
      {!d && !err && (
        <div className="flex items-center justify-center py-16 text-sm opacity-60" data-testid="fuel-loading">
          <Loader2 className="w-4 h-4 ml-2 animate-spin-slow" />
          טוען את סיפון-הדלק מהטלמטריה החיה…
        </div>
      )}

      {d && (
        <>
          {/* ── (b) שורת-סיכום: 4 כרטיסי-סטטיסטיקה + מקורות-אמת ── */}
          <div className="dx-card p-4" data-testid="fuel-summary">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Stat label="רוטציות-דלק" value={rotations !== null ? fmtInt(rotations) : '—'} />
              <Stat
                label="המתנות-כלכליות"
                value={economicWaits !== null ? fmtInt(economicWaits) : '—'}
                tone={economicWaits !== null && economicWaits > 0 ? 'warn' : undefined}
              />
              <Stat
                label="עיגונים מאומתים"
                value={verified !== null || broadcasts !== null ? `${fmtInt(verified ?? 0)}/${fmtInt(broadcasts ?? 0)}` : '—'}
                tone={verified !== null && verified > 0 ? 'ok' : undefined}
              />
              <Stat
                label="מסילות-פעילות"
                value={chains.length > 0 ? `${enabledChains}/${chains.length}` : '—'}
                tone={chains.length === 0 ? undefined : enabledChains > 0 ? 'ok' : 'warn'}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 mt-3 pt-2.5 border-t border-[color:var(--line)] text-[10px] text-[color:var(--text-3)]">
              <span className="flex flex-wrap items-center gap-3" data-testid="fuel-sources">
                <span>מקורות:</span>
                <SourceDot label="מצב-דלק" ok={src?.fuelState} />
                <SourceDot label="relay" ok={src?.relay} />
                <SourceDot label="צי" ok={src?.fleet} />
                <SourceDot label="חיבור-צבא" ok={src?.connectAll} />
              </span>
              {d.at && <span className="dx-num" dir="ltr">{d.at}</span>}
            </div>
          </div>

          {/* ── (c) כרטיס-הזהות-הראשית (headcorner) — 6 מדידות-מיני ── */}
          <div className="dx-card p-4 md:p-5" data-testid="fuel-primary">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <h3 className="text-base font-semibold flex items-center gap-2">
                <Fuel className="w-4 h-4 text-[color:var(--pink)]" />
                זהות-ראשית · דלק חי
              </h3>
              {primary?.account && (
                <span className="dx-num text-xs text-[color:var(--text-2)]" dir="ltr">@{primary.account}</span>
              )}
            </div>
            {primary ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <Meter
                  icon={Flame}
                  label="Hive · RC%"
                  value={hivePct !== null ? `${hivePct.toFixed(1)}%` : '—'}
                  bar={<RcBar pct={hivePct} />}
                  sub={hiveRc !== null ? <span dir="ltr">{fmtCompact(hiveRc)} RC</span> : 'לא-נמדד'}
                />
                <Meter
                  icon={Zap}
                  label="Steem · RC"
                  value={steemRc !== null ? fmtCompact(steemRc) : '—'}
                  sub={steemRc !== null ? <span dir="ltr">{fmtInt(steemRc)} RC</span> : 'לא-נמדד'}
                />
                <Meter
                  icon={Coins}
                  label="Blurt · יתרה"
                  value={blurtBal !== null ? blurtBal.toFixed(3) : '—'}
                  sub={blurtBal !== null ? <span dir="ltr">BLURT</span> : 'לא-נמדד'}
                />
                <Meter
                  icon={Sun}
                  label="TRON · sun"
                  value={tronSun !== null ? fmtInt(tronSun) : '—'}
                  sub={tronSun !== null ? <span dir="ltr">= {(tronSun / 1e6).toFixed(6)} TRX</span> : 'לא-נמדד'}
                />
                <Meter
                  icon={Gem}
                  label="ETH · wei"
                  value={ethWei !== null ? `${(ethWei / 1e18).toFixed(6)} ETH` : '—'}
                  sub={ethWei !== null ? <span dir="ltr">{fmtCompact(ethWei)} wei</span> : 'לא-נמדד'}
                />
                <Meter
                  icon={Sparkles}
                  label="SOL · lamports"
                  value={solLamports !== null ? `${(solLamports / 1e9).toFixed(6)} SOL` : '—'}
                  sub={solLamports !== null ? <span dir="ltr">{fmtCompact(solLamports)} lamports</span> : 'לא-נמדד'}
                />
              </div>
            ) : (
              <p className="text-sm text-[color:var(--amber)]">
                הזהות-הראשית לא דווחה (primary=null) — אין מדידות-דלק להצגה.
              </p>
            )}
          </div>

          {/* ── (d) מטריצת-הצי — הליבה: 15 שורות · Hive/Steem/Blurt/עיגונים ── */}
          <div className="dx-card p-4 md:p-5" data-testid="fuel-fleet">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-base font-semibold flex items-center gap-2">
                <Activity className="w-4 h-4 text-[color:var(--green)]" />
                מטריצת-הצי · דלק פר-חשבון
                <span className="dx-num text-[11px] text-[color:var(--text-3)]" dir="ltr">
                  {accounts.length}
                </span>
              </h3>
              {fleet?.usableByChain && (
                <div className="flex flex-wrap gap-1.5 text-[10px]">
                  {(['hive', 'steem', 'blurt'] as const).map(k => {
                    const v = num(fleet.usableByChain?.[k]);
                    return v !== null ? (
                      <span key={k} className="dx-chip h-6 px-2 inline-flex items-center gap-1 text-[10px] text-[color:var(--text-2)]">
                        {k} <span className="dx-num" dir="ltr">{fmtInt(v)}</span>
                      </span>
                    ) : null;
                  })}
                </div>
              )}
            </div>

            {fleet?.configured === false ? (
              <p className="text-sm text-[color:var(--amber)] mt-3">הצי לא הוגדר (configured=false) — כנות: אין חשבונות למדידה.</p>
            ) : accounts.length > 0 ? (
              <div className="mt-3 max-h-96 overflow-auto rounded-xl border border-[color:var(--line)]">
                <table className="w-full min-w-[620px] text-xs border-collapse">
                  <thead>
                    <tr>
                      <th className="sticky top-0 z-10 bg-[color:var(--well)] text-start font-medium text-[10px] label-caps text-[color:var(--text-3)] px-3 py-2.5">חשבון</th>
                      <th className="sticky top-0 z-10 bg-[color:var(--well)] text-start font-medium text-[10px] label-caps text-[color:var(--text-3)] px-3 py-2.5">Hive</th>
                      <th className="sticky top-0 z-10 bg-[color:var(--well)] text-start font-medium text-[10px] label-caps text-[color:var(--text-3)] px-3 py-2.5">Steem</th>
                      <th className="sticky top-0 z-10 bg-[color:var(--well)] text-start font-medium text-[10px] label-caps text-[color:var(--text-3)] px-3 py-2.5">Blurt</th>
                      <th className="sticky top-0 z-10 bg-[color:var(--well)] text-start font-medium text-[10px] label-caps text-[color:var(--text-3)] px-3 py-2.5">עיגונים</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map(a => {
                      const rowTone: Tone = a.usable === true ? 'ok' : a.usable === false ? 'dead' : 'unknown';
                      return (
                        <tr key={a.account} className="border-t border-[color:var(--line)] hover:bg-white/[0.03] transition-colors">
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TONE_DOT[rowTone]}`}
                                title={rowTone === 'ok' ? 'כשיר' : rowTone === 'dead' ? 'לא-כשיר' : 'לא-נמדד'} />
                              <span className="dx-num text-[11px] font-semibold" dir="ltr">@{a.account}</span>
                              {a.hasVerifiedKey === false && (
                                <span className="inline-flex items-center gap-1 text-[9px] text-[color:var(--red)]" title="אין מפתח-מאומת">
                                  <KeyRound className="w-3 h-3" aria-hidden /> אין-מפתח
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <RailCell ok={a.authorityOk} value={num(a.rcEffective)} fmt={fmtCompact} />
                          </td>
                          <td className="px-3 py-2.5">
                            <RailCell ok={a.steemOk} value={num(a.steemRc)} fmt={fmtCompact} />
                          </td>
                          <td className="px-3 py-2.5">
                            <RailCell ok={a.blurtOk} value={num(a.blurtBalance)} fmt={(n: number) => n.toFixed(3)} />
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="dx-num text-[11px]" dir="ltr">{fmtInt(num(a.anchoredCount) ?? 0)}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-[color:var(--amber)] mt-3">לא דווחו חשבונות-צי (accounts=null/[]) — לא-נמדד.</p>
            )}
          </div>

          {/* ── (d2) חיבור-הצבא · סטימיט-2018 ↔ Blurt — מטריצת-סמכויות-חיה ── */}
          <div className="dx-card p-4 md:p-5" data-testid="fuel-army">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-base font-semibold flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-[color:var(--green)]" />
                חיבור-הצבא · סמכויות-חיות פר-חשבון
              </h3>
              {army?.blurtArmy && (
                <div className="flex flex-wrap gap-1.5 text-[10px]">
                  <span className="dx-chip h-6 px-2 inline-flex items-center text-[10px] text-[color:var(--text-2)]">
                    חתום-בכספת <span className="dx-num" dir="ltr">{fmtInt(num(army.blurtArmy.sealedAccounts) ?? 0)}</span>
                  </span>
                  <span className="dx-chip h-6 px-2 inline-flex items-center text-[10px] text-[color:var(--text-2)]">
                    owner+ על-Blurt <span className="dx-num" dir="ltr">{fmtInt(num(army.blurtArmy.chainVerifiedOwnerPlus) ?? 0)}</span>
                  </span>
                  <span className="dx-chip h-6 px-2 inline-flex items-center text-[10px] text-[color:var(--text-2)]">
                    full4 <span className="dx-num" dir="ltr">{fmtInt(num(army.blurtArmy.full4) ?? 0)}</span>
                  </span>
                </div>
              )}
            </div>
            {army?.matrix && army.matrix.length > 0 ? (
              <>
                <div className="mt-3 max-h-96 overflow-auto rounded-xl border border-[color:var(--line)]">
                  <table className="w-full min-w-[560px] text-xs border-collapse">
                    <thead>
                      <tr>
                        <th className="sticky top-0 z-10 bg-[color:var(--well)] text-start font-medium text-[10px] label-caps text-[color:var(--text-3)] px-3 py-2.5">חשבון</th>
                        {(['steem', 'hive', 'blurt'] as const).map((c) => (
                          <th key={c} className="sticky top-0 z-10 bg-[color:var(--well)] text-start font-medium text-[10px] label-caps text-[color:var(--text-3)] px-3 py-2.5">
                            {c} <span className="dx-num" dir="ltr">o/a/p/m</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {army.matrix.map((row) => (
                        <tr key={row.username ?? ''} className="border-t border-[color:var(--line)] hover:bg-white/[0.03] transition-colors">
                          <td className="px-3 py-2">
                            <span className="dx-num text-[11px] font-semibold" dir="ltr">@{row.username}</span>
                          </td>
                          {(['steem', 'hive', 'blurt'] as const).map((c) => (
                            <td key={c} className="px-3 py-2">
                              <ArmyCell chain={row.chains?.[c]} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-[color:var(--text-3)] mt-2 leading-relaxed">
                  ✓ = מאומת-מול-השרשרת-החיה · ✕ = מפתח-תקין-בכספת אך-הסמכות-על-השרשרת שונה · · = לא-נמדד ·
                  אין-מפתחות = הכספת לא מחזיקה חותמות לחשבון זה.
                  דוקטרינה: Blurt = fork-גרפני של Steem — אותו-חומר-מפתח-מ-2018, נאטם-רק-מה שעבר-אימות-שרשרת.
                </p>
              </>
            ) : (
              <p className="text-sm text-[color:var(--amber)] mt-3">אין-דיווח מטריצת-חיבור (army=null) — ריצת connect-all נדרשת.</p>
            )}
          </div>

          {/* ── (e) שורת-שידורים-ממתינים (dry-run) — ETH/SOL בכנות ── */}
          <div className="dx-card p-4 md:p-5" data-testid="fuel-pending">
            <h3 className="text-base font-semibold flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-[color:var(--amber)]" />
              שידורים-ממתינים · בדיקת-יובש (dry-run)
            </h3>
            {pending ? (
              <div className="grid sm:grid-cols-2 gap-2">
                <PendingLeg name="ETH" leg={pending.eth} divisor={1e18} unit="ETH" />
                <PendingLeg name="SOL" leg={pending.sol} divisor={1e9} unit="SOL" />
              </div>
            ) : (
              <p className="text-sm text-[color:var(--text-2)]">
                אין-דיווח שידורים-ממתינים (pending=null) — השרת לא דיווח; לא מנחשים.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
