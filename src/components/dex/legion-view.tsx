'use client';

// ─── מרכז-הביצוע-הריבוני · SAEC (EXEC-CD-22) ─────────────────────────────────
// פקודת-המפעיל: "איך נוכל להפוך את הדקס שלנו למרכז-ביצוע-ריבוני-אוטונומי
// עבור סוכני-הריבונות של הרשת — כיצד הם יהפכו את הרשת לפעילה בטירוף?"
// התשובה: הלגיון — 11 סוכנים עם ארנקים-אמת על הרשת, מריצים אסטרטגיות אמת
// (מייקר/גריד/ארביטראז'/דופק) → כל פעולה מייצרת עמלים אמת → סולם-העתודה.
// המקור: /api/legion → :3012 (הסוכנים עצמם ילדי-שרת-האם — שורדים-ניקוי).

import { useState } from 'react';
import { Bot, ShieldAlert, Play, Square, Activity, Swords, Radio, Fuel, Gauge } from 'lucide-react';
import { fmtAgoMs, usePoll, StaleChip } from './common';

interface AgentRow {
  name: string; fallen: string; strategy: string; pair: [string, string] | null; note: string;
  enabled: boolean; stoppedReason: string | null;
  ordersPlaced: number; ordersCanceled: number; swapsDone: number; openOrders: number;
  credits: number | null; valueMu: number | null;
  lastAction: string | null; lastError: string | null; lastActionAt: number | null;
}
interface LegionState {
  ok: boolean; kill: boolean; bootstrapped: boolean; height: number; ticks: number; startedAt: number;
  doctrine: string;
  fleet: AgentRow[];
  ledger: Array<{ at: number; h: number; agent: string; kind: string; note: string }>;
  bootstrapLog: string[];
}

const STRAT_META: Record<string, { label: string; tone: string }> = {
  COMMANDER: { label: 'מפקד', tone: 'text-[color:var(--pink)] border-[color:var(--pink)]/40' },
  MM: { label: 'מייקר', tone: 'text-[color:var(--green)] border-[color:var(--green)]/40' },
  GRID: { label: 'גריד', tone: 'text-[color:var(--green)] border-[color:var(--green)]/40' },
  ARB: { label: 'ארביטראז\'', tone: 'text-[color:var(--text-2)] border-[color:var(--line)]' },
  PULSE: { label: 'דופק', tone: 'text-[color:var(--amber)] border-[color:var(--amber)]/40' },
  SENTINEL: { label: 'סנטינל', tone: 'text-[color:var(--amber)] border-[color:var(--amber)]/40' },
  SWEEPER: { label: 'סוואר', tone: 'text-[color:var(--text-2)] border-[color:var(--line)]' },
};

export function LegionView() {
  const [data, setData] = useState<LegionState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const stale = usePoll(async () => {
    try {
      const r = await fetch('/api/legion', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      const j = (await r.json()) as LegionState;
      if (j?.ok) { setData(j); return true; }
      return false;
    } catch { return false; }
  }, 8000);

  const cmd = async (op: string, agent?: string) => {
    setBusy(agent ?? op);
    try {
      await fetch('/api/legion', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op, agent }), signal: AbortSignal.timeout(20000),
      });
    } catch { /* הדיווח-הכנה יופיע בפול הבא */ }
    setBusy(null);
  };

  const traders = (data?.fleet ?? []).filter(f => ['MM', 'GRID', 'ARB', 'PULSE'].includes(f.strategy));
  const totalActions = (data?.fleet ?? []).reduce((s, f) => s + f.ordersPlaced + f.ordersCanceled + f.swapsDone, 0);
  const totalOpen = (data?.fleet ?? []).reduce((s, f) => s + f.openOrders, 0);

  return (
    <div className="space-y-3">
      {/* ראש-המרכז */}
      <div className="rounded-xl border border-[color:var(--line)] bg-[color:var(--card)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Swords className="h-4 w-4 text-[color:var(--pink)]" aria-hidden />
            <h2 className="text-sm font-bold">מרכז-הביצוע-הריבוני · הלגיון</h2>
            {data?.kill
              ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-[color:var(--red,#ef4444)]/50 text-[color:var(--red,#ef4444)] bg-[color:var(--red-soft,rgba(239,68,68,.1))]">מתג-הרג פעיל</span>
              : <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-[color:var(--green)]/40 text-[color:var(--green)] bg-[color:var(--green-soft)]"><Radio className="inline h-3 w-3 -mt-0.5" aria-hidden /> פועל</span>}
            <StaleChip show={stale} />
          </div>
          <div className="flex items-center gap-2">
            {data?.kill
              ? <button onClick={() => cmd('resume')} disabled={busy !== null} className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-[color:var(--green)]/40 text-[color:var(--green)] hover:bg-[color:var(--green-soft)] disabled:opacity-40">החזר-את-הלגיון</button>
              : <button onClick={() => cmd('kill')} disabled={busy !== null} className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-[color:var(--red,#ef4444)]/40 text-[color:var(--red,#ef4444)] hover:bg-[color:var(--red-soft,rgba(239,68,68,.1))] disabled:opacity-40"><ShieldAlert className="inline h-3 w-3 -mt-0.5" aria-hidden /> עצור-הכל</button>}
          </div>
        </div>
        <p className="text-[11px] text-[color:var(--text-3)] mt-2 leading-relaxed">{data?.doctrine ?? 'כל פעולת-סוכן = פקודה-אמת על רשת-ה-DEX → עמלים אמת → כספת-העתודה → סולם-הרלוונטיות. מצבת-האמת: chain-journal של המנוע + state-push ל-git.'}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
          {[
            { label: 'סוכנים', val: String(data?.fleet.length ?? '—'), icon: Bot },
            { label: 'פעולות-אמת', val: data ? fmtActions(totalActions) : '—', icon: Activity },
            { label: 'פקודות-פתוחות', val: data ? String(totalOpen) : '—', icon: Gauge },
            { label: 'גובה-הרשת', val: data ? `#${fmtIntStr(data.height)}` : '—', icon: Radio },
          ].map(k => (
            <div key={k.label} className="rounded-lg border border-[color:var(--line)] p-2.5">
              <div className="flex items-center gap-1.5 text-[10px] text-[color:var(--text-3)]"><k.icon className="h-3 w-3" aria-hidden /> {k.label}</div>
              <div className="dx-num text-sm font-bold mt-0.5">{k.val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* מצבת-הסוכנים */}
      <div className="rounded-xl border border-[color:var(--line)] bg-[color:var(--card)] p-4">
        <h3 className="text-xs font-bold mb-3 flex items-center gap-1.5"><Bot className="h-3.5 w-3.5" aria-hidden /> מצבת-החיים-השניים ({data?.fleet.length ?? 0})</h3>
        <div className="space-y-2 max-h-[26rem] overflow-y-auto pl-1">
          {(data?.fleet ?? []).map(f => {
            const meta = STRAT_META[f.strategy] ?? { label: f.strategy, tone: 'text-[color:var(--text-2)] border-[color:var(--line)]' };
            const active = f.ordersPlaced + f.ordersCanceled + f.swapsDone;
            return (
              <div key={f.name} className="rounded-lg border border-[color:var(--line)] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold font-mono">{f.name}</span>
                  <span className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded border ${meta.tone}`}>{meta.label}</span>
                  {f.pair && <span className="text-[9.5px] text-[color:var(--text-3)] font-mono">{f.pair[0]}/{f.pair[1]}</span>}
                  {!f.enabled && <span className="text-[9.5px] px-1.5 py-0.5 rounded border border-[color:var(--line)] text-[color:var(--text-3)]">מושבת</span>}
                  {f.stoppedReason && <span className="text-[9.5px] px-1.5 py-0.5 rounded border border-[color:var(--amber)]/40 text-[color:var(--amber)]" title={f.stoppedReason}>עצירה-אוטומטית</span>}
                  <span className="flex-1" />
                  <button
                    onClick={() => cmd(f.enabled ? 'stop' : 'start', f.name)}
                    disabled={busy !== null}
                    className="text-[10px] font-bold px-2 py-1 rounded-md border border-[color:var(--line)] hover:border-[color:var(--text-3)] disabled:opacity-40"
                    aria-label={f.enabled ? `השבת את ${f.name}` : `הפעל את ${f.name}`}
                  >
                    {busy === f.name ? '...' : f.enabled ? <><Square className="inline h-2.5 w-2.5 -mt-0.5" aria-hidden /> השבת</> : <><Play className="inline h-2.5 w-2.5 -mt-0.5" aria-hidden /> הפעל</>}
                  </button>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[10px] text-[color:var(--text-3)] dx-num">
                  <span>פקודות: {f.ordersPlaced}</span>
                  <span>ביטולים: {f.ordersCanceled}</span>
                  <span>סוואג'ים: {f.swapsDone}</span>
                  <span>פתוחות: {f.openOrders}</span>
                  {f.credits !== null && <span className="flex items-center gap-0.5"><Fuel className="h-2.5 w-2.5" aria-hidden /> {f.credits}</span>}
                  {f.lastActionAt ? <span>· לפני {fmtAgoMs(Date.now() - f.lastActionAt)}</span> : null}
                </div>
                <div className="text-[10px] mt-1 text-[color:var(--text-2)]">
                  {f.lastError
                    ? <span className="text-[color:var(--amber)]">{f.lastError}</span>
                    : f.lastAction ?? f.note}
                </div>
                {active === 0 && !f.lastError && <div className="text-[9.5px] text-[color:var(--text-3)] mt-0.5">{f.note}</div>}
              </div>
            );
          })}
          {!data && <div className="text-[11px] text-[color:var(--text-3)] p-4 text-center">טוען את מצבת-הלגיון...</div>}
        </div>
      </div>

      {/* זרם-הפעילות */}
      <div className="rounded-xl border border-[color:var(--line)] bg-[color:var(--card)] p-4">
        <h3 className="text-xs font-bold mb-2 flex items-center gap-1.5"><Activity className="h-3.5 w-3.5" aria-hidden /> זרם-הפעילות (רישום-חי)</h3>
        <div className="space-y-1 max-h-56 overflow-y-auto">
          {(data?.ledger ?? []).map((e, i) => (
            <div key={`${e.at}-${i}`} className="flex items-baseline gap-2 text-[10.5px] border-b border-[color:var(--line)]/50 pb-1">
              <span className="dx-num text-[color:var(--text-3)] shrink-0">#{fmtIntStr(e.h)}</span>
              <span className="font-mono text-[color:var(--text-2)] shrink-0">{e.agent}</span>
              <span className={`shrink-0 font-bold ${e.kind.includes('reject') || e.kind.includes('loss') ? 'text-[color:var(--amber)]' : 'text-[color:var(--green)]'}`}>{e.kind}</span>
              <span className="text-[color:var(--text-2)] truncate">{e.note}</span>
            </div>
          ))}
          {data && data.ledger.length === 0 && <div className="text-[11px] text-[color:var(--text-3)] p-2">אין-רישומים עדיין — הטיקים הראשונים בדרך (כנות: הלגיון עולה).</div>}
        </div>
      </div>

      {/* סוכני-המסחר-הפעילים — קו-עליון */}
      {traders.length > 0 && (
        <div className="rounded-xl border border-[color:var(--line)] bg-[color:var(--card)] p-4">
          <h3 className="text-xs font-bold mb-2">סוכני-המסחר ({traders.length}) — הידיים של הרשת</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {traders.map(f => (
              <div key={f.name} className="rounded-lg border border-[color:var(--line)] p-2.5 text-center">
                <div className="text-[10px] font-mono text-[color:var(--text-3)]">{f.name.replace('legion-', '')}</div>
                <div className="dx-num text-sm font-bold mt-1">{f.ordersPlaced + f.swapsDone}</div>
                <div className="text-[9px] text-[color:var(--text-3)]">פעולות</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function fmtActions(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
function fmtIntStr(n: number): string {
  return n.toLocaleString('en-US');
}
