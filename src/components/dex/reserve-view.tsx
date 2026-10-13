'use client';

// ─── סולם-הגיבוי (EXEC-CD-21) — מטבעות-הבית → כסף-אמת, צעד-צעד ──────────────
// הוראת-המפעיל: "סוואפ במסך-הראשי רק על המטבעות הלא-רלוונטיים שלנו כרגע, עד
// שתהפוך אותם לרלוונטיים עם גב נזיל אמת... דרך-חכמה שזה לאט לאט יהפוך".
// המקור: /saos-dex/api/dex/reserve (GET ציבורי — מדידה-חי מהמצב-הקנוני של המנוע).
// אפס-קישוט: כל-מספר כאן הוא מדידה, וכל-מדרגה נמדדת-חי (גם הירידה-מדרגה כנה).

import { useState } from 'react';
import { ShieldCheck, Landmark, Flame, Lock, Unlock, TrendingUp, Activity, ArrowUpCircle, ArrowDownCircle, Info } from 'lucide-react';
import { fmtInt, usePoll, StaleChip } from './common';

interface ReserveEvent { h: number; kind: string; mu?: number; note: string }
interface ReservePhase { id: number; name: string; unitBps: number; realBps: number; note: string }
interface ReserveData {
  ok: boolean;
  height: number;
  vault: string;
  phase: number; phaseName: string; phaseNote: string; sinceH: number;
  measure: {
    unitMu: number; realMu: number; supplyMu: number; unitBps: number; realBps: number;
    holdings: Record<string, number>; prices: Record<string, number>;
  };
  unitPct: number; realPct: number;
  next: { id: number; name: string; unitBps: number; realBps: number; unitGapMu: number; realGapMu: number; note: string } | null;
  streak: number; streakTarget: number; every: number; blocksLeft: number;
  totals: { sweptMu: number; routerSlicedMu: number; realSwappedMu: number; redeemMu: number };
  redeem: { open: boolean; windowCapMu: number; windowUsedMu: number; windowBlocks: number };
  events: ReserveEvent[];
  phases: ReservePhase[];
}

const KIND_META: Record<string, { label: string; icon: 'up' | 'down' | 'fire' | 'act' }> = {
  sweep: { label: 'סחיבת-עודף', icon: 'act' },
  real_swap: { label: 'המרה-לנכסי-אמת', icon: 'fire' },
  router_slice: { label: 'חלק-ראוטר', icon: 'act' },
  migrate: { label: 'הגירת-אוצר', icon: 'act' },
  phase_up: { label: 'עליית-מדרגה', icon: 'up' },
  phase_down: { label: 'ירידת-מדרגה (כנות)', icon: 'down' },
  redeem: { label: 'פדיון-אמת', icon: 'fire' },
};

function phaseTone(phase: number): string {
  if (phase >= 3) return 'border-[color:var(--pink)]/40 bg-[color:var(--pink-soft,rgba(236,72,153,.12))] text-[color:var(--pink)]';
  if (phase >= 1) return 'border-[color:var(--green)]/40 bg-[color:var(--green-soft)] text-[color:var(--green)]';
  return 'border-[color:var(--amber)]/40 bg-[color:var(--amber-soft)] text-[color:var(--amber)]';
}

function useReserve(periodMs = 15000): { data: ReserveData | null; stale: boolean } {
  const [data, setData] = useState<ReserveData | null>(null);
  const stale = usePoll(async () => {
    try {
      const r = await fetch('/saos-dex/api/dex/reserve', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      const j = (await r.json()) as ReserveData;
      if (j?.ok) { setData(j); return true; }
      return false;
    } catch { return false; }
  }, periodMs);
  return { data, stale };
}

function Bar({ label, pct, targetLabel, tone }: { label: string; pct: number; targetLabel: string; tone: string }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div>
      <div className="flex items-center justify-between text-[10.5px] mb-1">
        <span className="text-[color:var(--text-2)] font-semibold">{label}</span>
        <span className="dx-num text-[color:var(--text-3)]">{pct.toFixed(2)}% · {targetLabel}</span>
      </div>
      <div className="h-1.5 rounded-full bg-[color:var(--line)] overflow-hidden" role="progressbar" aria-label={label} aria-valuenow={Math.round(w)} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${w}%` }} />
      </div>
    </div>
  );
}

/** פס-קומפקטי מתחת-לסוואף-הראשי: איפה-המטבעות-שלנו עומדים בדרך-לכסף-אמת. */
export function ReserveStrip() {
  const { data, stale } = useReserve(15000);
  const next = data?.next ?? null;
  const unitTarget = next ? next.unitBps / 100 : Math.max(100, data?.unitPct ?? 100);
  const realTarget = next ? next.realBps / 100 : Math.max(50, data?.realPct ?? 50);
  return (
    <div className="w-full max-w-[480px] mt-3 dx-card p-3.5" data-testid="reserve-strip">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2.5">
        <div className="flex items-center gap-1.5 text-[11px] text-[color:var(--text-3)] font-semibold">
          <ShieldCheck className="w-3.5 h-3.5 text-[color:var(--green)]" />
          סולם-הגיבוי · כל-עמלת-סוואף מזינה-את-העתודה
        </div>
        {data ? (
          <span className="text-[10px] dx-num text-[color:var(--text-3)]">
            h{fmtInt(data.height)} · טיק-סולם בעוד {data.blocksLeft} בלוקים
          </span>
        ) : (
          <span className="text-[10px] text-[color:var(--amber)]">טרם נמדד</span>
        )}
      </div>
      {data ? (
        <>
          <div className="flex items-center gap-2 flex-wrap mb-2.5">
            <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${phaseTone(data.phase)}`}>
              מדרגה {data.phase} · {data.phaseName}
            </span>
            {data.redeem.open ? (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-[color:var(--pink)]/40 text-[color:var(--pink)] inline-flex items-center gap-1">
                <Unlock className="w-3 h-3" /> חלון-פדיון פתוח
              </span>
            ) : (
              <span className="text-[10px] text-[color:var(--text-3)] inline-flex items-center gap-1">
                <Lock className="w-3 h-3" /> פדיון נעול (מדרגה 3)
              </span>
            )}
          </div>
          <div className="space-y-2">
            <Bar label="רצפת-יחידה (כספת-העתודה / אספקת-SAOS)" pct={data.unitPct} targetLabel={`יעד-מדרגה הבאה ${unitTarget}%`} tone="bg-[color:var(--green)]" />
            <Bar label="גיבוי-אמת (נכסי-דלת 1:1)" pct={data.realPct} targetLabel={`יעד ${realTarget}%`} tone="bg-[color:var(--pink)]" />
          </div>
          {next && (
            <p className="text-[10.5px] text-[color:var(--text-3)] mt-2 leading-relaxed">
              למדרגה {next.id} ({next.name}) חסרים בכספת <span className="dx-num font-semibold text-[color:var(--text-2)]">{fmtInt(next.unitGapMu)}µ</span>
              {next.realGapMu > 0 ? <> + גיבוי-דלת <span className="dx-num">{fmtInt(next.realGapMu)}µ</span></> : null} — הסולם ניזון אוטונומית מעמלות, מחזורי-הראוטר והפקדות-אמת.
            </p>
          )}
        </>
      ) : (
        <p className="text-[11px] text-[color:var(--text-3)] leading-relaxed">
          המדידה-החיה מתחברת למנוע-הבורסה… אין-עדיין נתונים מדודים (לא-אפס-מזויף).
        </p>
      )}
      <StaleChip show={stale} />
    </div>
  );
}

/** מקטע-מלא בלשונית-הכלכלה: המדרגות · כספת-העתודה · טריגרי-התחזוקה-שמרוויחה · מצב-פדיון. */
export function ReserveLadderSection() {
  const { data, stale } = useReserve(10000);
  return (
    <section className="dx-card p-5" data-testid="reserve-ladder">
      <header className="flex items-start gap-2.5 mb-4 flex-wrap">
        <span className="w-8 h-8 rounded-xl bg-[color:var(--green-soft)] border border-[color:var(--green)]/30 flex items-center justify-center">
          <Landmark className="w-4 h-4 text-[color:var(--green)]" />
        </span>
        <div className="flex-1 min-w-[220px]">
          <h2 className="text-[15px] font-bold">סולם-הגיבוי — מטבעות-הבית הופכים לכסף-אמת</h2>
          <p className="text-[11px] text-[color:var(--text-3)] leading-relaxed">
            כספת-עתודה גלויה ({data?.vault ?? 'reserve-vault'}) שניזונה אוטונומית: 15% מכל מחזור-ראוטר ·
            50% מעודף-האוצר-מעל-כל-הרצפות · הפקדות-אמת. המדרגות נמדדות-חי מהמצב-הקנוני —
            והירידה-מדרגה כנה בדיוק כמו-העלייה.
          </p>
        </div>
        {data && (
          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${phaseTone(data.phase)}`}>
            מדרגה {data.phase} · {data.phaseName}
          </span>
        )}
      </header>

      {data ? (
        <>
          {/* המדרגות */}
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 mb-4">
            {data.phases.map(p => {
              const active = p.id === data.phase;
              const reached = p.id <= data.phase;
              return (
                <div key={p.id}
                  className={`rounded-xl border p-2.5 text-[11px] leading-relaxed ${active ? 'border-[color:var(--green)]/60 bg-[color:var(--green-soft)]' : reached ? 'border-[color:var(--line-strong)]' : 'border-[color:var(--line)] opacity-70'}`}
                  aria-current={active ? 'step' : undefined}>
                  <div className="font-bold mb-0.5 flex items-center gap-1">
                    {reached ? <TrendingUp className="w-3 h-3 text-[color:var(--green)]" /> : <Lock className="w-3 h-3 text-[color:var(--text-3)]" />}
                    {p.id}. {p.name}
                  </div>
                  <div className="text-[color:var(--text-3)] dx-num">
                    רצפה {p.unitBps / 100}%{p.realBps > 0 ? ` · אמת ${p.realBps / 100}%` : ''}
                  </div>
                </div>
              );
            })}
          </div>

          {/* מדידות-חי */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-4">
            <div className="dx-raised p-3">
              <div className="text-[10px] label-caps mb-1">ערך-כספת (רצפה)</div>
              <div className="dx-num text-sm font-bold">{fmtInt(data.measure.unitMu)}µ</div>
              <div className="text-[10px] text-[color:var(--text-3)] dx-num">{data.unitPct.toFixed(2)}% מהאספקה</div>
            </div>
            <div className="dx-raised p-3">
              <div className="text-[10px] label-caps mb-1">גיבוי-אמת (נכסי-דלת)</div>
              <div className="dx-num text-sm font-bold">{fmtInt(data.measure.realMu)}µ</div>
              <div className="text-[10px] text-[color:var(--text-3)] dx-num">{data.realPct.toFixed(2)}% מהאספקה</div>
            </div>
            <div className="dx-raised p-3">
              <div className="text-[10px] label-caps mb-1">אספקת-SAOS אמת</div>
              <div className="dx-num text-sm font-bold">{fmtInt(data.measure.supplyMu)}µ</div>
              <div className="text-[10px] text-[color:var(--text-3)]">Σ כל-היתרות (ללא-הכפלת-ve)</div>
            </div>
            <div className="dx-raised p-3">
              <div className="text-[10px] label-caps mb-1">טיק-הבא</div>
              <div className="dx-num text-sm font-bold">{data.blocksLeft} בלוקים</div>
              <div className="text-[10px] text-[color:var(--text-3)]">כל {data.every} בלוקים · אוטונומי</div>
            </div>
          </div>

          {/* תכולת-הכספת */}
          <div className="mb-4">
            <div className="text-[11px] label-caps mb-2">תכולת-כספת-העתודה (מאומת-מהיתרות)</div>
            {Object.keys(data.measure.holdings).length ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {Object.entries(data.measure.holdings).map(([a, amt]) => (
                  <div key={a} className="dx-raised p-2.5 flex items-center justify-between">
                    <span className="text-xs font-semibold">{a}</span>
                    <span className="dx-num text-xs text-[color:var(--text-2)]">
                      {fmtInt(amt)}µ{data.measure.prices[a] > 0 ? <span className="text-[color:var(--text-3)]"> @ {data.measure.prices[a]}</span> : <span className="text-[color:var(--amber)]"> · ללא-מחיר-קנוני (לא-נספר-לרצפה)</span>}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-[color:var(--text-3)]">
                הכספת ריקה עדיין — כנות מלאה: הסולם ניזון מרווח-אמת בלבד (העמלות מצטברות, הטיק הבא יסחוב עודף-מעל-הרצפות).
              </p>
            )}
          </div>

          {/* מצב-פדיון */}
          <div className={`rounded-xl border p-3 mb-4 ${data.redeem.open ? 'border-[color:var(--pink)]/40 bg-[color:var(--pink-soft,rgba(236,72,153,.08))]' : 'border-[color:var(--line)]'}`}>
            <div className="flex items-center gap-2 text-xs font-bold mb-1">
              {data.redeem.open ? <Unlock className="w-3.5 h-3.5 text-[color:var(--pink)]" /> : <Lock className="w-3.5 h-3.5 text-[color:var(--text-3)]" />}
              חלון-פדיון SAOS→עתודה {data.redeem.open ? 'פתוח' : 'נעול (מדרגה 3+)'}
            </div>
            <p className="text-[10.5px] text-[color:var(--text-3)] leading-relaxed">
              פדיון = שריפת-SAOS מול כספת-העתודה במחיר-הקנוני — ההוכחה-הקשה שהגיבוי אמת.
              תקרה: 5% מהכספת לאפוק ({fmtInt(data.redeem.windowBlocks)} בלוקים) · נוצל עד-כה
              {' '}<span className="dx-num">{fmtInt(data.redeem.windowUsedMu)}µ</span> מתוך <span className="dx-num">{fmtInt(data.redeem.windowCapMu)}µ</span>
              {' '}· Σ פדיון-היסטורי <span className="dx-num">{fmtInt(data.totals.redeemMu)}µ</span>.
            </p>
          </div>

          {/* מאזן-הזנה */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="dx-raised p-2.5">
              <div className="text-[10px] label-caps mb-0.5">מחזורי-ראוטר</div>
              <div className="dx-num text-xs font-bold">{fmtInt(data.totals.routerSlicedMu)}µ</div>
            </div>
            <div className="dx-raised p-2.5">
              <div className="text-[10px] label-caps mb-0.5">סחיבות-עודף</div>
              <div className="dx-num text-xs font-bold">{fmtInt(data.totals.sweptMu)}µ</div>
            </div>
            <div className="dx-raised p-2.5">
              <div className="text-[10px] label-caps mb-0.5">הומר-לנכסי-אמת</div>
              <div className="dx-num text-xs font-bold">{fmtInt(data.totals.realSwappedMu)}µ</div>
            </div>
          </div>

          {/* טריגרי-תחזוקה — "התחזוקה-עצמה מניבה-את-הגיבוי" */}
          <div>
            <div className="text-[11px] label-caps mb-2 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-[color:var(--pink)]" />
              טריגרי-תחזוקה-ורווח (חי)
            </div>
            {data.events.length ? (
              <ul className="space-y-1.5 max-h-72 overflow-y-auto pr-1" aria-label="פנקס-טריגרי-הסולם">
                {data.events.map((e, i) => {
                  const km = KIND_META[e.kind] ?? { label: e.kind, icon: 'act' as const };
                  const Icon = km.icon === 'up' ? ArrowUpCircle : km.icon === 'down' ? ArrowDownCircle : km.icon === 'fire' ? Flame : Activity;
                  return (
                    <li key={`${e.h}-${i}`} className="dx-raised px-3 py-2 text-[11px] flex items-start gap-2">
                      <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${e.kind === 'phase_down' ? 'text-[color:var(--amber)]' : e.kind === 'phase_up' || e.kind === 'redeem' ? 'text-[color:var(--pink)]' : 'text-[color:var(--green)]'}`} />
                      <div className="flex-1 min-w-0">
                        <span className="font-semibold">{km.label}</span>
                        {e.mu !== undefined && e.mu > 0 && <span className="dx-num text-[color:var(--text-2)]"> · {fmtInt(e.mu)}µ</span>}
                        <span className="text-[color:var(--text-3)]"> · h{fmtInt(e.h)}</span>
                        <div className="text-[color:var(--text-3)] leading-relaxed">{e.note}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[11px] text-[color:var(--text-3)]">אין-עדיין טריגרים — הטיק-האוטונומי הראשון יירשם כאן.</p>
            )}
          </div>

          <p className="text-[10.5px] text-[color:var(--text-3)] mt-3 leading-relaxed flex items-start gap-1.5">
            <Info className="w-3 h-3 mt-0.5 shrink-0" />
            כנות: הערכים נמדדים-חי מהמצב-הקנוני של השרשרת (אפס-float · אפס-הבטחות-ריקות).
            מטבעות-הבית נסחרים-כרגע בסוואף-הראשי בלבד — הם ייפתחו-לחוץ-הרשתות כשהמדידה-החיה
            תעמוד-במדרגות. מה-שנראה-כאן הוא בדיוק מה-שיש.
          </p>
        </>
      ) : (
        <p className="text-[12px] text-[color:var(--amber)]" role="status">
          סולם-הגיבוי טרם נמדד — מתחבר למנוע… (אין-ערכים-מזויפים לפני-המדידה-הראשונה)
        </p>
      )}
      <StaleChip show={stale} />
    </section>
  );
}
