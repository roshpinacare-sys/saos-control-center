'use client';

// ─── T-15 · Sovereign Liquidity Guard Node — פס-המשמר של הקוקפיט ──────────
// דבר-ההנחיה: דגימת /api/saos/custody-alert כל-20ש' · סחיפת-סמכות/כספת-שנפלה
// = Solid-Red-State + נעילת-יציאה · כנות מלאה: אין-מצב-שקט-כשאין-נתונים (AMBER).
// אפס-המצאה: המצב נקרא-מהשרת בלבד — הלקוח לעולם לא מחליט על-אדום בעצמו.

import { useCallback, useState } from 'react';
import { ShieldAlert, ShieldCheck, ShieldQuestion, Loader2 } from 'lucide-react';
import { usePoll } from './common';

type CustodySources = {
  authorityGuard?: { verdict?: string; freshRevocations?: number; at?: string | null };
  authorityDrift?: { events?: number; freshEvents?: number; lastSeenAt?: string | null };
  credentialDrill?: { verdict?: string; at?: string | null };
  connectAll?: { verdict?: string; at?: string | null };
  memSentinel?: { level?: string; usedGiB?: number | null; headroomGiB?: number | null };
};
type CustodyData = {
  schema?: string; at?: string; state?: 'GREEN' | 'AMBER' | 'RED' | string;
  autoLockout?: boolean; reasons?: string[]; sources?: CustodySources;
} | null;

export function CustodyAlertBar() {
  const [data, setData] = useState<CustodyData>(null);

  const fetcher = useCallback(async () => {
    try {
      const res = await fetch('/api/saos/custody-alert', { cache: 'no-store' });
      if (!res.ok) { setData(null); return false; }
      setData(await res.json() as CustodyData);
      return true;
    } catch { setData(null); return false; }
  }, []);

  const stale = usePoll(fetcher, 20000); // T-15: דגימה כל-20ש'

  const state = data?.state ?? 'AMBER';
  const red = state === 'RED';
  const green = state === 'GREEN' && !stale;

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-label={`T-15 custody state: ${state}`}
      data-testid="custody-bar"
      className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold border-b ${
        red
          ? 'bg-[color:var(--red)] text-white border-[color:var(--red)]'
          : green
            ? 'bg-emerald-950/40 text-emerald-300 border-emerald-900/60'
            : 'bg-[color:var(--amber-soft)] text-[color:var(--amber)] border-[color:var(--amber)]/40'
      }`}
    >
      {red ? <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
        : green ? <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
        : stale ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
        : <ShieldQuestion className="h-4 w-4 shrink-0" aria-hidden />}
      <span className="tracking-wide">
        {red ? 'T-15 RED ALERT' : green ? 'T-15 SOVEREIGN LIQUID' : 'T-15 CUSTODY WATCH'}
      </span>
      <span className="opacity-90 truncate flex-1 min-w-0" title={(data?.reasons ?? []).join(' · ')}>
        {(data?.reasons ?? []).join(' · ') || '…'}
      </span>
      {red && (
        <span className="shrink-0 rounded bg-white/15 px-2 py-0.5 font-bold">
          יציאה-נעולה · outbound locked
        </span>
      )}
      {!red && data?.sources?.memSentinel?.headroomGiB != null && (
        <span className="shrink-0 opacity-75 tabular-nums">
          RAM {data.sources.memSentinel.usedGiB ?? '—'}GiB / 2.5GiB
        </span>
      )}
    </div>
  );
}
