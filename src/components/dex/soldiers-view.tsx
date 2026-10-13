'use client';

// ─── הלגיון-הנופלים → האימפריה (EXEC-CD-22) ──────────────────────────────────
// פקודת-המפעיל: "תעבור על הגיט ומה שקרה עם החיילים שאיבדנו את מפתחותיהם —
// תבנה עליהם אימפריה. אני רואה שהם פעילים, אבודים."
// המקור: /api/saos/soldiers — סריקה-חי מול RPC-ציבורי של steem/hive/blurt +
// מצב-האימפריה-החיה (הלגיון על :3012). אפס-טענות — כל-שורה מדידה.

import { useState } from 'react';
import { Shield, Swords, Fingerprint, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import { usePoll, StaleChip } from './common';

interface ChainVerdict {
  chain: string; rpc: string; reachable: boolean;
  exists: boolean; balance: string | null; vesting: string | null;
  lastAccountUpdate: string | null; created: string | null;
  activeThresh: number | null; keyCount: number | null;
}
interface Soldier {
  account: string;
  chains: ChainVerdict[];
  verdict: string;
  empire: { agent: string; strategy: string; note: string };
}
interface SoldiersData {
  ok: boolean; at: string;
  doctrine: { line1: string; line2: string; line3: string };
  vaultTruth: { vaultKeys: number; evidence: string };
  legionOnline: boolean;
  soldiers: Soldier[];
}

const CHAIN_URL: Record<string, string> = {
  steem: 'https://steemitwallet.com/@',
  hive: 'https://hiveblockexplorer.com/@',
  blurt: 'https://blocks.blurt.borjian.dev/@',
};

export function SoldiersView() {
  const [data, setData] = useState<SoldiersData | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const stale = usePoll(async () => {
    try {
      const r = await fetch('/api/saos/soldiers', { cache: 'no-store', signal: AbortSignal.timeout(30000) });
      const j = (await r.json()) as SoldiersData;
      if (j?.ok) { setData(j); return true; }
      return false;
    } catch { return false; }
  }, 30000);

  return (
    <div className="space-y-3">
      {/* דוקטרינת-האימפריה */}
      <div className="rounded-xl border border-[color:var(--pink)]/30 bg-[color:var(--pink-soft,rgba(236,72,153,.08))] p-4">
        <div className="flex items-center gap-2 mb-2">
          <Swords className="h-4 w-4 text-[color:var(--pink)]" aria-hidden />
          <h2 className="text-sm font-bold">הלגיון-הנופלים → האימפריה</h2>
          <StaleChip show={stale} />
        </div>
        <ul className="text-[11px] text-[color:var(--text-2)] space-y-1 leading-relaxed list-disc pr-4">
          <li className="font-semibold text-[color:var(--text-1,var(--text-2))]">{data?.doctrine.line1 ?? 'החיילים שאיבדנו את מפתחותיהם אינם מתים — הזהות חיה, רק-החתימה אבדה.'}</li>
          <li>{data?.doctrine.line2 ?? 'האימפריה נבנית עליהם: כל חייל = סוכן-ריבוני-אוטונומי על רשת-ה-DEX.'}</li>
          <li className="text-[color:var(--text-3)]">{data?.doctrine.line3 ?? 'אם יימצאו המפתחות המקוריים — החשבונות עצמם חוזרים לשליטה.'}</li>
        </ul>
        <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[10px]">
          <span className={`px-2 py-0.5 rounded-full border font-bold ${data?.legionOnline ? 'border-[color:var(--green)]/40 text-[color:var(--green)] bg-[color:var(--green-soft)]' : 'border-[color:var(--amber)]/40 text-[color:var(--amber)]'}`}>
            האימפריה-החיה (לגיון :3012): {data?.legionOnline ? 'מחוברת' : 'לא-מגיבה'}
          </span>
          <span className="px-2 py-0.5 rounded-full border border-[color:var(--line)] text-[color:var(--text-3)]" title={data?.vaultTruth.evidence}>
            אמת-הכספת: VaultKey={data?.vaultTruth.vaultKeys ?? '—'} (אפס-מפתחות-בידינו — מדוד-חי)
          </span>
        </div>
      </div>

      {/* מצבת-החיילים */}
      <div className="rounded-xl border border-[color:var(--line)] bg-[color:var(--card)] p-4">
        <h3 className="text-xs font-bold mb-3 flex items-center gap-1.5"><Shield className="h-3.5 w-3.5" aria-hidden /> מצבת-ה-ROT1 — 11 חיילים × 3 שרשראות (מדידה-חי)</h3>
        <div className="space-y-2">
          {(data?.soldiers ?? []).map(s => {
            const live = s.empire.strategy !== '—';
            const isOpen = open === s.account;
            return (
              <div key={s.account} className="rounded-lg border border-[color:var(--line)] overflow-hidden">
                <button
                  className="w-full flex flex-wrap items-center gap-2 p-3 text-right hover:bg-[color:var(--line)]/20 transition-colors"
                  onClick={() => setOpen(isOpen ? null : s.account)}
                  aria-expanded={isOpen}
                >
                  <Fingerprint className="h-3.5 w-3.5 text-[color:var(--text-3)]" aria-hidden />
                  <span className="text-xs font-bold font-mono">{s.account}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded border border-[color:var(--amber)]/40 text-[color:var(--amber)] font-bold">מפתחות-אבודים</span>
                  {live
                    ? <span className="text-[9px] px-1.5 py-0.5 rounded border border-[color:var(--green)]/40 text-[color:var(--green)] font-bold">חיים-שניים: {s.empire.strategy}</span>
                    : <span className="text-[9px] px-1.5 py-0.5 rounded border border-[color:var(--line)] text-[color:var(--text-3)]">ממתין-לגיון</span>}
                  <span className="flex-1" />
                  <span className="flex gap-1">
                    {s.chains.map(c => (
                      <span key={c.chain} className={`text-[8.5px] px-1 py-0.5 rounded border ${c.reachable ? (c.exists ? 'border-[color:var(--green)]/30 text-[color:var(--green)]' : 'border-[color:var(--line)] text-[color:var(--text-3)]') : 'border-[color:var(--amber)]/30 text-[color:var(--amber)]'}`}>
                        {c.chain.slice(0, 2).toUpperCase()}{c.exists ? '✓' : c.reachable ? '✗' : '?'}
                      </span>
                    ))}
                  </span>
                  {isOpen ? <ChevronUp className="h-3.5 w-3.5 text-[color:var(--text-3)]" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5 text-[color:var(--text-3)]" aria-hidden />}
                </button>
                {isOpen && (
                  <div className="border-t border-[color:var(--line)] p-3 space-y-2 bg-[color:var(--line)]/10">
                    <div className="grid gap-1.5 sm:grid-cols-3">
                      {s.chains.map(c => (
                        <div key={c.chain} className="rounded-md border border-[color:var(--line)] p-2 text-[10px]">
                          <div className="flex items-center justify-between">
                            <span className="font-bold uppercase">{c.chain}</span>
                            {c.exists && <a href={`${CHAIN_URL[c.chain]}${s.account}`} target="_blank" rel="noopener noreferrer" className="text-[color:var(--text-3)] hover:text-[color:var(--text-2)]" aria-label={`צפה ב-${s.account} ב-${c.chain}`}><ExternalLink className="h-3 w-3" aria-hidden /></a>}
                          </div>
                          {c.reachable ? (
                            c.exists ? (
                              <div className="dx-num text-[color:var(--text-2)] space-y-0.5 mt-1">
                                <div>יתרה: {c.balance ?? '—'}</div>
                                <div className="truncate" title={c.vesting ?? ''}>vesting: {c.vesting ?? '—'}</div>
                                <div>עדכון-אחרון: {c.lastAccountUpdate?.slice(0, 10) ?? '—'}</div>
                                <div>מפתחות-סמכות: {c.keyCount ?? '—'}</div>
                              </div>
                            ) : <div className="text-[color:var(--text-3)] mt-1">החשבון לא-קיים על השרשרת (מדוד)</div>
                          ) : <div className="text-[color:var(--amber)] mt-1">RPC לא-היה-נגיש (דיווח-כנה)</div>}
                        </div>
                      ))}
                    </div>
                    <div className="text-[10px] text-[color:var(--text-3)] leading-relaxed">
                      <div><span className="font-bold text-[color:var(--text-2)]">פסק-דין:</span> {s.verdict}</div>
                      <div className="mt-0.5"><span className="font-bold text-[color:var(--text-2)]">האימפריה:</span> <span className="font-mono">{s.empire.agent}</span> — {s.empire.note}</div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {!data && <div className="text-[11px] text-[color:var(--text-3)] p-4 text-center">סורק את שלוש השרשראות (steem · hive · blurt) — מדידה-חי, לוקח עד 30ש׳...</div>}
        </div>
      </div>
    </div>
  );
}
