'use client';

// ─── כלכלת-הסוכנים · THE AGENT ECONOMY (EXEC-CD-31) ──────────────────────────
// פקודת-המפעיל: "לוודא שימוש בפלטפורמה על ידי הסוכנים לפיתוח ומסחר והפקת
// רווחים... שיתמוך אחד בשני... עוד זוויות, טריגרים, עסקאות ורווחים."
// התשובה: הפליוויל המלא — עבודת-סוכן → בונטי → ארנק-דקס → מסחר-אמת →
// עמלות → סולם-העתודה. כל-מספר כאן מדידה-חיה: /api/saos/bounty + /api/legion.
// המקורות: הבונטים ב-DB-האמא; הרווחים במצבת-הלגיון (sweptMu — כנות-מדידה).

import { useState } from 'react';
import { Bot, Activity, Coins, RefreshCw, Flame, Timer, CheckCircle2, XCircle, TrendingUp, HandCoins } from 'lucide-react';
import { usePoll, StaleChip } from './common';

interface OpenBounty {
  id: string; title: string; category: string; detail: string; rewardMu: number;
  agent: string; claimedAt: string | null; createdAt: string;
}
interface RecentBounty {
  id: string; title: string; category: string; rewardMu: number; status: string;
  agent: string; engineNote: string; verifyNote: string; paidAt: string | null; completedAt: string | null;
}
interface EconomyState {
  ok: boolean;
  open: OpenBounty[];
  recent: RecentBounty[];
  stats: {
    openCount: number; claimedCount: number; doneCount: number;
    paidEverMu: number; paid24hMu: number; paidCount: number;
    failedCount: number; expiredCount: number; dailyCapMu: number;
    byCategory: Array<{ category: string; count: number; rewardMu: number }>;
  };
  runtime: { lastTickAt: string | null; lastTickNote: string; lastError: string | null };
  at: string;
}
interface FleetRow {
  name: string; strategy: string; ordersPlaced: number; swapsDone: number;
  valueMu: number | null; sweptMu: number; credits: number | null; stoppedReason: string | null;
}
interface LegionState { ok: boolean; fleet: FleetRow[]; kill: boolean; height: number }

const CAT_META: Record<string, { he: string; tone: string }> = {
  ops: { he: 'תפעול', tone: 'text-[color:var(--text-2)] border-[color:var(--line)]' },
  research: { he: 'מחקר', tone: 'text-[color:var(--amber)] border-[color:var(--amber)]/40' },
  guard: { he: 'שמירה', tone: 'text-[color:var(--text-2)] border-[color:var(--line)]' },
  code: { he: 'קוד', tone: 'text-[color:var(--green)] border-[color:var(--green)]/40' },
  trade: { he: 'מסחר', tone: 'text-[color:var(--pink)] border-[color:var(--pink)]/40' },
};

const FLYWHEEL: Array<{ he: string; icon: typeof Bot }> = [
  { he: 'עבודת-סוכן', icon: Bot },
  { he: 'בונטי', icon: HandCoins },
  { he: 'ארנק-דקס', icon: Coins },
  { he: 'מסחר-אמת', icon: TrendingUp },
  { he: 'עמלות', icon: Activity },
  { he: 'סולם-העתודה', icon: CheckCircle2 },
];

function fmtMu(n: number): string {
  return n >= 1000 ? `${(n / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}kµ` : `${n.toLocaleString('en-US')}µ`;
}
function fmtAge(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'עכשיו';
  if (m < 60) return `${m}ד׳`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}ש׳`;
  return `${Math.floor(h / 24)}ימ׳`;
}

export function AgentEconomyView() {
  const [eco, setEco] = useState<EconomyState | null>(null);
  const [legion, setLegion] = useState<LegionState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const stale = usePoll(async () => {
    try {
      const [a, b] = await Promise.all([
        fetch('/api/saos/bounty', { cache: 'no-store', signal: AbortSignal.timeout(10000) }),
        fetch('/api/legion', { cache: 'no-store', signal: AbortSignal.timeout(10000) }),
      ]);
      const ja = await a.json() as EconomyState;
      const jb = await b.json().catch(() => null) as LegionState | null;
      if (ja?.ok) setEco(ja);
      if (jb?.ok) setLegion(jb);
      return ja?.ok ? true : false;
    } catch { return false; }
  }, 12000);

  const tick = async () => {
    setBusy(true); setNote(null);
    try {
      const r = await fetch('/api/saos/bounty', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'tick' }),
        signal: AbortSignal.timeout(30000),
      });
      const j = await r.json();
      setNote(j?.note ?? (j?.ok ? 'הפעימה רצה' : (j?.error ?? 'נכשל')));
    } catch { setNote('שגיאת-רשת — כנה'); }
    setBusy(false);
  };

  const s = eco?.stats;
  const sweptTotal = (legion?.fleet ?? []).reduce((x, f) => x + (f.sweptMu ?? 0), 0);
  const traders = (legion?.fleet ?? []).filter(f => ['MM', 'GRID', 'ARB', 'PULSE'].includes(f.strategy))
    .sort((a, b) => (b.sweptMu ?? 0) - (a.sweptMu ?? 0) || (b.valueMu ?? 0) - (a.valueMu ?? 0));

  return (
    <div className="space-y-3">
      {/* ראש-הכלכלה */}
      <div className="rounded-xl border border-[color:var(--line)] bg-[color:var(--card)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <HandCoins className="h-4 w-4 text-[color:var(--pink)]" aria-hidden />
            <h2 className="text-sm font-bold">כלכלת-הסוכנים · הפליוויל</h2>
            <StaleChip show={stale} />
          </div>
          <button
            onClick={tick} disabled={busy}
            className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-[color:var(--green)]/40 text-[color:var(--green)] hover:bg-[color:var(--green-soft)] disabled:opacity-40 flex items-center gap-1.5"
            aria-label="הרץ פעימת-בונטים"
          >
            <RefreshCw className={`h-3 w-3 ${busy ? 'animate-spin' : ''}`} aria-hidden /> פעימה-עכשיו
          </button>
        </div>
        <p className="text-[11px] text-[color:var(--text-3)] mt-2 leading-relaxed">
          עבודת-סוכן אמת (דוח-מדידה · קוד-מוכח-בגיט · מכסת-מסחר) → בונטי-דטרמיניסטי → תשלום-אמת
          מהאוצר לארנק-הסוכן על שרשרת-הדקס → הסוכן סוחר → עמלות → סולם-העתודה.
          מה-שלא-מאומת-מול-מציאות — לא-משולם. תקרת-תשלום-24h: {s ? `${fmtMu(s.dailyCapMu)}` : '—'} (אנטי-אינפלציה).
        </p>
        {/* הפליוויל */}
        <div className="flex flex-wrap items-center gap-1 mt-3" aria-label="פליוויל כלכלת-הסוכנים">
          {FLYWHEEL.map((f, i) => (
            <span key={f.he} className="flex items-center gap-1">
              <span className="dx-chip h-7 px-2.5 flex items-center gap-1.5 text-[10.5px]">
                <f.icon className="h-3 w-3 text-[color:var(--pink)]" aria-hidden /> {f.he}
              </span>
              {i < FLYWHEEL.length - 1 && <span className="text-[color:var(--text-3)] text-[10px]">←</span>}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
          {[
            { label: 'בונטים-פתוחים', val: s ? String(s.openCount + s.claimedCount) : '—', icon: Timer },
            { label: 'שולם-24h', val: s ? fmtMu(s.paid24hMu) : '—', icon: HandCoins },
            { label: 'שולם-אי-פעם', val: s ? fmtMu(s.paidEverMu) : '—', icon: Coins },
            { label: 'רווחי-לגיון-שנסחבו', val: legion ? fmtMu(sweptTotal) : '—', icon: TrendingUp },
          ].map(k => (
            <div key={k.label} className="rounded-lg border border-[color:var(--line)] p-2.5">
              <div className="flex items-center gap-1.5 text-[10px] text-[color:var(--text-3)]"><k.icon className="h-3 w-3" aria-hidden /> {k.label}</div>
              <div className="dx-num text-sm font-bold mt-0.5">{k.val}</div>
            </div>
          ))}
        </div>
        {eco?.runtime && (
          <div className="text-[10px] text-[color:var(--text-3)] mt-2 dx-num" dir="auto">
            פעימה-אחרונה: {eco.runtime.lastTickAt ? fmtAge(eco.runtime.lastTickAt) : 'ממתין-ללופ'} · {eco.runtime.lastTickNote}
            {eco.runtime.lastError ? ` · שגיאה: ${eco.runtime.lastError}` : ''}
          </div>
        )}
        {note && <div className="text-[10.5px] text-[color:var(--amber)] mt-1.5">{note}</div>}
      </div>

      {/* תור-הבונטים */}
      <div className="rounded-xl border border-[color:var(--line)] bg-[color:var(--card)] p-4">
        <h3 className="text-xs font-bold mb-3 flex items-center gap-1.5"><Timer className="h-3.5 w-3.5" aria-hidden /> תור-העבודה ({eco?.open.length ?? 0})</h3>
        <div className="space-y-2 max-h-[24rem] overflow-y-auto pl-1">
          {(eco?.open ?? []).map(b => {
            const meta = CAT_META[b.category] ?? { he: b.category, tone: 'text-[color:var(--text-2)] border-[color:var(--line)]' };
            return (
              <div key={b.id} className="rounded-lg border border-[color:var(--line)] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded border ${meta.tone}`}>{meta.he}</span>
                  <span className="text-xs font-bold">{b.title}</span>
                  <span className="flex-1" />
                  <span className="text-[11px] font-bold text-[color:var(--green)] dx-num">{fmtMu(b.rewardMu)}</span>
                  {b.claimedAt
                    ? <span className="text-[9.5px] px-1.5 py-0.5 rounded border border-[color:var(--amber)]/40 text-[color:var(--amber)] font-mono">{b.agent || 'נתבע'} · {fmtAge(b.claimedAt)}</span>
                    : <span className="text-[9.5px] text-[color:var(--text-3)]">פתוח · {fmtAge(b.createdAt)}</span>}
                </div>
                <div className="text-[10px] mt-1 text-[color:var(--text-2)] leading-relaxed">{b.detail}</div>
              </div>
            );
          })}
          {eco && eco.open.length === 0 && <div className="text-[11px] text-[color:var(--text-3)] p-2">אין-בונטים-פתוחים — הפעימה הבאה תזרע-מהפערים-הנמדדים.</div>}
          {!eco && <div className="text-[11px] text-[color:var(--text-3)] p-4 text-center">טוען את כלכלת-הסוכנים...</div>}
        </div>
      </div>

      {/* פנקס-התשלומים */}
      <div className="rounded-xl border border-[color:var(--line)] bg-[color:var(--card)] p-4">
        <h3 className="text-xs font-bold mb-3 flex items-center gap-1.5"><Coins className="h-3.5 w-3.5" aria-hidden /> פנקס-התשלומים ({s?.paidCount ?? 0} שולמו · {s?.failedCount ?? 0} נכשלו · {s?.expiredCount ?? 0} פקעו)</h3>
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {(eco?.recent ?? []).map(b => {
            const meta = CAT_META[b.category] ?? { he: b.category, tone: 'text-[color:var(--text-2)] border-[color:var(--line)]' };
            const paid = b.status === 'paid';
            const dead = b.status === 'failed' || b.status === 'expired';
            return (
              <div key={b.id} className="rounded-lg border border-[color:var(--line)] p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  {paid
                    ? <CheckCircle2 className="h-3 w-3 text-[color:var(--green)] shrink-0" aria-hidden />
                    : dead
                      ? <XCircle className="h-3 w-3 text-[color:var(--amber)] shrink-0" aria-hidden />
                      : <Flame className="h-3 w-3 text-[color:var(--text-3)] shrink-0" aria-hidden />}
                  <span className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded border ${meta.tone}`}>{meta.he}</span>
                  <span className="text-[11px] font-bold truncate max-w-[45%]">{b.title}</span>
                  <span className="text-[10px] font-mono text-[color:var(--text-3)] truncate max-w-[20%]" dir="ltr">{b.agent || '—'}</span>
                  <span className="flex-1" />
                  <span className={`text-[11px] font-bold dx-num ${paid ? 'text-[color:var(--green)]' : 'text-[color:var(--text-3)]'}`}>{fmtMu(b.rewardMu)}</span>
                  <span className="text-[9.5px] text-[color:var(--text-3)] shrink-0">{paid ? `שולם · ${fmtAge(b.paidAt)}` : b.status}</span>
                </div>
                {(b.verifyNote || b.engineNote) && (
                  <div className="text-[9.5px] text-[color:var(--text-3)] mt-1 truncate" title={`${b.verifyNote} ${b.engineNote}`}>
                    {b.verifyNote}{b.engineNote ? ` · ${b.engineNote}` : ''}
                  </div>
                )}
              </div>
            );
          })}
          {eco && eco.recent.length === 0 && <div className="text-[11px] text-[color:var(--text-3)] p-2">אין-תשלומים-עדיין — הפליוויל מתחיל-עכשיו.</div>}
        </div>
      </div>

      {/* מד-הרווחים של הלגיון */}
      <div className="rounded-xl border border-[color:var(--line)] bg-[color:var(--card)] p-4">
        <h3 className="text-xs font-bold mb-3 flex items-center gap-1.5"><TrendingUp className="h-3.5 w-3.5" aria-hidden /> מד-הרווחים · הלגיון ({traders.length} סוחרים)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-80 overflow-y-auto">
          {traders.map(f => (
            <div key={f.name} className="rounded-lg border border-[color:var(--line)] p-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold font-mono">{f.name.replace('legion-', '')}</span>
                {f.stoppedReason && <span className="text-[9px] px-1 py-0.5 rounded border border-[color:var(--amber)]/40 text-[color:var(--amber)]">עצור</span>}
                <span className="flex-1" />
                <span className="text-[10px] text-[color:var(--text-3)] dx-num" dir="ltr">{f.ordersPlaced + f.swapsDone} פעולות</span>
              </div>
              <div className="flex items-center gap-3 mt-1.5 text-[10.5px] dx-num">
                <span className="text-[color:var(--text-2)]">תיק: <b dir="ltr">{f.valueMu !== null ? f.valueMu.toLocaleString('en-US') : '—'}µ</b></span>
                <span className={f.sweptMu > 0 ? 'text-[color:var(--green)]' : 'text-[color:var(--text-3)]'}>
                  נסחב-לאוצר: <b dir="ltr">{(f.sweptMu ?? 0).toLocaleString('en-US')}µ</b>
                </span>
                {f.credits !== null && <span className="text-[color:var(--text-3)]">דלק: {f.credits}</span>}
              </div>
            </div>
          ))}
          {legion && traders.length === 0 && <div className="text-[11px] text-[color:var(--text-3)] p-2">הלגיון לא נגיש עכשיו — כנה; הוא יוקם-מחדש עם-שרת-האם.</div>}
        </div>
      </div>
    </div>
  );
}
