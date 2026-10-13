'use client';

// ─── T-35 · רשת-הצמתים-החיה — גרף-ביצועים בקוקפיט ──────────────────────────
// דבר-ההנחיה (Q2 · הכרעה: כן): גרף-עד חי של-ביצועי-צמתי-ה-RPC — latency +
// מדדי-הצלחת-שידור (T-34-QB) פר-צומת · דגימה כל-20ש' מ-/api/saos/rpc-mesh.
// אפס-המצאה: הכל-נקרא-מקבלות-השרת · צומת-מת = אדום-כנה · צומת-בלי-מדידה =
// אפור-כנה (לא-ירוק-מדומה).

import { useCallback, useState } from 'react';
import { Activity, Loader2 } from 'lucide-react';
import { usePoll } from './common';

type MeshNode = { node: string; ok: boolean; latencyMs: number; successRate?: number | null };
type MeshData = {
  schema?: string; at?: string | null; stale?: boolean;
  ranked?: Record<string, MeshNode[]>;
  successMetrics?: Record<string, { attempts?: number; confirmed?: number; failed?: number; successRate?: number | null }>;
  witness?: { tracked?: number; total?: number } | null;
} | null;

const CHAIN_LABEL: Record<string, string> = { steem: 'STEEM', hive: 'HIVE', blurt: 'BLURT' };
const host = (n: string) => n.replace(/^https?:\/\//, '');

function barTone(n: MeshNode): string {
  if (!n.ok) return 'bg-red-500/70';
  if (n.successRate == null) return 'bg-zinc-500/50';
  if (n.successRate >= 0.9) return 'bg-emerald-500/70';
  if (n.successRate >= 0.5) return 'bg-amber-500/70';
  return 'bg-red-500/70';
}

export function RpcMeshChart() {
  const [data, setData] = useState<MeshData>(null);

  const fetcher = useCallback(async () => {
    try {
      const res = await fetch('/api/saos/rpc-mesh', { cache: 'no-store' });
      if (!res.ok) { setData(null); return false; }
      setData(await res.json() as MeshData);
      return true;
    } catch { setData(null); return false; }
  }, []);

  const stale = usePoll(fetcher, 20000);
  const ranked = data?.ranked ?? {};
  const chains = Object.keys(ranked).filter((c) => (ranked[c] ?? []).length > 0);

  return (
    <section
      aria-label="T-35 RPC mesh live ranking"
      data-testid="rpc-mesh-chart"
      className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4 text-xs"
    >
      <header className="mb-3 flex items-center gap-2 text-zinc-300">
        {stale ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Activity className="h-4 w-4" aria-hidden />}
        <span className="font-semibold tracking-wide">T-35 · RPC MESH — דירוג-חי</span>
        <span className="ml-auto flex items-center gap-2 tabular-nums text-[10px] text-zinc-500">
          {data?.witness?.total ? <span>עדים {data.witness.tracked}/{data.witness.total}</span> : null}
          {data?.at ? <time dateTime={data.at}>{new Date(data.at).toLocaleTimeString()}</time> : null}
          {data?.stale ? <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-bold text-amber-400">stale</span> : null}
        </span>
      </header>

      {chains.length === 0 ? (
        <p className="py-3 text-center text-zinc-500">אין-קבלת-מש-טרייה — הקדנס-ידרג-בתורו (כנות)</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          {chains.map((chain) => {
            const nodes = ranked[chain] ?? [];
            const maxMs = Math.max(...nodes.map((n) => n.latencyMs), 1);
            return (
              <div key={chain} className="min-w-0">
                <h3 className="mb-2 text-[10px] font-bold tracking-widest text-zinc-400">{CHAIN_LABEL[chain] ?? chain}</h3>
                <ul className="space-y-1.5">
                  {nodes.map((n) => {
                    const w = Math.max(8, Math.round((n.latencyMs / maxMs) * 100));
                    const rate = n.successRate != null ? `${Math.round(n.successRate * 100)}%` : null;
                    const m = data?.successMetrics?.[host(n.node)];
                    return (
                      <li key={n.node} className="min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className={`truncate font-medium ${n.ok ? 'text-zinc-300' : 'text-red-400 line-through'}`} title={n.node}>
                            {host(n.node)}
                          </span>
                          <span className="shrink-0 tabular-nums text-zinc-500">
                            {n.latencyMs}ms{rate ? ` · ${rate}` : ''}{m ? ` (${m.attempts})` : ''}
                          </span>
                        </div>
                        <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-900" role="presentation">
                          <div className={`h-full rounded-full ${barTone(n)}`} style={{ width: `${w}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-3 border-t border-zinc-900 pt-2 text-[10px] leading-relaxed text-zinc-600">
        מקור: receipts/rpc-mesh-latest.json (saos.rpc-mesh/2 · קדנס 2ש') · סדר = ok → successRate → latency · צומת-אפור = טרם-נמדד-שידור (כנות)
      </p>
    </section>
  );
}
