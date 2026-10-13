"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Activity,
  GitBranch,
  Vault,
  Radio,
  Anchor,
  ShieldCheck,
  RefreshCw,
  Server,
} from "lucide-react";

interface FleetState {
  at: string;
  server: { up: boolean; port: number; noteHe: string };
  repos: {
    name: string;
    branch: string;
    hash: string | null;
    subject: string;
    date: string | null;
    dirty: number;
  }[];
  vault: { present: boolean; accounts: number | null; sha256?: string; noteHe: string };
  unseal: { sealedVault: boolean; privateRepo: string; liveVars: number; noteHe: string } | null;
  cadence: {
    mode: string;
    checkpoint: number | null;
    root: string | null;
    attestations: number | null;
    at: string | null;
    txSteem: string | null;
    txHive: string | null;
  } | null;
  custody: { match: number | null; checked: number | null; headcornerSteem: string | null; noteHe?: string; at: string } | null;
  custodyAlive: { at: string; verdict: string | null; verified: number | null; total: number | null; noteHe: string } | null;
  treasury: {
    evmMeasuredAt: string;
    evmIdentities: number;
    evmTotalEth: number;
    gasEverywhere: boolean;
    steemSum: number;
    sbdSum: number;
    noteHe: string;
  } | null;
  chains: {
    mainnet: {
      verdict: string;
      block?: number;
      balanceEth?: number;
      nonce?: number;
      gasGwei?: number;
      blocksSinceBaseline?: number;
      noteHe: string;
    };
    zeroRail: { verdict: string; chainId?: number; gasPrice?: string; block?: number; rpc?: string; noteHe: string };
  };
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("he-IL", { hour12: false });
  } catch {
    return "—";
  }
}

function verdictBadge(v: string) {
  if (v === "ZERO-LIVE" || v === "MEASURED" || v === "ALIVE" || v === "FLEET-CUSTODY-ALIVE")
    return <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">{v}</Badge>;
  if (v === "STARVED" || v === "DRIFTED" || v === "STALE")
    return <Badge className="bg-red-600 hover:bg-red-600 text-white">{v}</Badge>;
  if (v === "ANCHORED") return <Badge className="bg-emerald-800 hover:bg-emerald-800 text-white">{v}</Badge>;
  return <Badge variant="outline">{v || "UNMEASURED"}</Badge>;
}

export default function Home() {
  const [state, setState] = useState<FleetState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/fleet-state", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setState(await r.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div dir="rtl" className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-900/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-emerald-900/50 border border-emerald-700 flex items-center justify-center">
              <ShieldCheck className="h-5 w-5 text-emerald-400" aria-hidden />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight">קונסולת-הצי — ריבונות-חיה</h1>
              <p className="text-xs text-zinc-400">Sovereign Fleet Console · הכל-נמדד-חי, אפס-סיפורים</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {state?.server?.up && (
              <Badge className="bg-emerald-700 text-white gap-1">
                <Server className="h-3 w-3" aria-hidden /> השרת-חי ·:3000
              </Badge>
            )}
            <button
              onClick={load}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-sm transition-colors"
              aria-label="רענן-מדידה"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
              רענן
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6 space-y-6">
        {error && (
          <Card className="border-red-800 bg-red-950/40">
            <CardContent className="p-4 text-sm text-red-200">
              שגיאה-בקריאת-המדידה: {error} — המדידה-הבאה-תנסה-שוב-בעוד-30-שניות (fail-honest).
            </CardContent>
          </Card>
        )}

        {/* Chain rails */}
        <section aria-label="מסילות-השרשרת" className="grid gap-4 md:grid-cols-2">
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2">
                  <Radio className="h-4 w-4 text-emerald-400" aria-hidden /> רכבת-האפס (Z-Chain-9369)
                </span>
                {state ? verdictBadge(state.chains.zeroRail.verdict) : <Badge variant="outline">מודד…</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              {state?.chains.zeroRail ? (
                <>
                  <div className="flex justify-between"><span className="text-zinc-400">gasPrice-נמדד</span><code className="text-emerald-400">{state.chains.zeroRail.gasPrice ?? "—"}</code></div>
                  <div className="flex justify-between"><span className="text-zinc-400">בלוק</span><span>{state.chains.zeroRail.block?.toLocaleString("he-IL") ?? "—"}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-400">RPC</span><span className="text-xs text-zinc-500">{state.chains.zeroRail.rpc ?? "—"}</span></div>
                  <p className="text-xs text-zinc-400 pt-1">{state.chains.zeroRail.noteHe}</p>
                </>
              ) : (
                <p className="text-zinc-500 text-sm">מודד-מול-ה-RPC-הציבורי-עכשיו…</p>
              )}
            </CardContent>
          </Card>

          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-red-400" aria-hidden /> לב-הרשת-הראשית (Ethereum)
                </span>
                {state ? verdictBadge(state.chains.mainnet.verdict) : <Badge variant="outline">מודד…</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              {state?.chains.mainnet ? (
                <>
                  <div className="flex justify-between"><span className="text-zinc-400">יתרת-הזהות</span><span className="font-mono text-xs">{state.chains.mainnet.balanceEth !== undefined ? state.chains.mainnet.balanceEth.toExponential(3) + " ETH" : "—"}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-400">nonce</span><span>{state.chains.mainnet.nonce ?? "—"}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-400">דלק</span><span>{state.chains.mainnet.gasGwei !== undefined ? state.chains.mainnet.gasGwei.toFixed(2) + " gwei" : "—"}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-400">בלוקים-מהבסיס</span><span>{state.chains.mainnet.blocksSinceBaseline?.toLocaleString("he-IL") ?? "—"}</span></div>
                  <p className="text-xs text-red-300/90 pt-1">{state.chains.mainnet.noteHe}</p>
                </>
              ) : (
                <p className="text-zinc-500 text-sm">מודד-מול-ה-RPC-הציבורי-עכשיו…</p>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Cadence + vault + custody */}
        <section aria-label="מצב-הכספות-והקצב" className="grid gap-4 md:grid-cols-3">
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Anchor className="h-4 w-4 text-amber-400" aria-hidden /> קצב-העיגון
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              {state?.cadence ? (
                <>
                  <div className="flex justify-between"><span className="text-zinc-400">מצב</span>{verdictBadge(state.cadence.mode)}</div>
                  <div className="flex justify-between"><span className="text-zinc-400">נקודת-ביקורת</span><span>#{state.cadence.checkpoint ?? "—"}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-400">אישורים</span><span>{state.cadence.attestations?.toLocaleString("he-IL") ?? "—"}</span></div>
                  <div className="flex justify-between text-xs"><span className="text-zinc-400">steem-tx</span><code className="text-zinc-500">{state.cadence.txSteem ?? "—"}</code></div>
                  <div className="flex justify-between text-xs"><span className="text-zinc-400">hive-tx</span><code className="text-zinc-500">{state.cadence.txHive ?? "—"}</code></div>
                  <p className="text-xs text-zinc-500">נמדד-אחרון: {fmtTime(state.cadence.at)}</p>
                </>
              ) : (
                <p className="text-zinc-500">אין-קבלת-עיגון-זמינה-מקומית</p>
              )}
            </CardContent>
          </Card>

          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Vault className="h-4 w-4 text-amber-400" aria-hidden /> כספת-המפתחות-בגיט
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              {state?.vault ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">נוכחות</span>
                    {state.vault.present ? (
                      <Badge className="bg-emerald-700 text-white">פתוחה</Badge>
                    ) : (
                      <Badge variant="destructive">חסרה</Badge>
                    )}
                  </div>
                  <div className="flex justify-between"><span className="text-zinc-400">חשבונות</span><span>{state.vault.accounts ?? "—"}</span></div>
                  <p className="text-xs text-zinc-400 pt-1 leading-relaxed">{state.vault.noteHe}</p>
                </>
              ) : (
                <p className="text-zinc-500">טוען…</p>
              )}
            </CardContent>
          </Card>

          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-4 w-4 text-emerald-400" aria-hidden /> משפט-המשמורת
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              {state?.custodyAlive?.verdict ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">ורדיקט-חי</span>
                    {verdictBadge(state.custodyAlive.verdict)}
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">חשבונות-מאומתים</span>
                    <span className="font-mono">{state.custodyAlive.verified}/{state.custodyAlive.total}</span>
                  </div>
                  <p className="text-xs text-zinc-400 pt-1">{state.custodyAlive.noteHe}</p>
                  <p className="text-xs text-zinc-500">נמדד: {fmtTime(state.custodyAlive.at)}</p>
                  {state.custody && (
                    <p className="text-xs text-zinc-500 border-t border-zinc-800 pt-1.5">
                      מטריצה-מלאה (14:47): {state.custody.match}/{state.custody.checked}-MATCH · ראש-steem {state.custody.headcornerSteem}
                    </p>
                  )}
                </>
              ) : state?.custody ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">מפתחות-תואמים</span>
                    <span className="font-mono">{state.custody.match}/{state.custody.checked}</span>
                  </div>
                  <p className="text-xs text-zinc-400 pt-1">{state.custody.noteHe}</p>
                </>
              ) : (
                <p className="text-zinc-500">אין-קבלת-שיפוט-מקומית</p>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Treasury + unseal */}
        <section aria-label="אוצר-ופענוח" className="grid gap-4 md:grid-cols-2">
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="h-4 w-4 text-amber-400" aria-hidden /> אוצר-הריבונות (נמדד)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              {state?.treasury ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">זהויות-EVM</span>
                    <span>{state.treasury.evmIdentities} · סה״כ {state.treasury.evmTotalEth.toExponential(2)} ETH</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">דלק-בכל-הרשתות</span>
                    {state.treasury.gasEverywhere ? (
                      <Badge className="bg-red-600 text-white">אפס-בכולן</Badge>
                    ) : (
                      <Badge className="bg-emerald-700 text-white">נמצא-דלק</Badge>
                    )}
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">אוצר-חברתי</span>
                    <span>{state.treasury.steemSum} STEEM · {state.treasury.sbdSum} SBD</span>
                  </div>
                  <p className="text-xs text-amber-300/80 pt-1 leading-relaxed">{state.treasury.noteHe}</p>
                  <p className="text-xs text-zinc-500">נמדד: {fmtTime(state.treasury.evmMeasuredAt)}</p>
                </>
              ) : (
                <p className="text-zinc-500">אין-סריקת-אוצר-שמורה</p>
              )}
            </CardContent>
          </Card>

          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Vault className="h-4 w-4 text-emerald-400" aria-hidden /> פענוח-אוטונומי (FleetHQ)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              {state?.unseal ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">כספת-חתומה-בגיט</span>
                    {state.unseal.sealedVault ? <Badge className="bg-emerald-700 text-white">קיימת</Badge> : <Badge variant="destructive">חסרה</Badge>}
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">משתנים-חיים-נפרסו</span>
                    <span className="font-mono">{state.unseal.liveVars}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">ריפו-פרטי</span>
                    <code className="text-zinc-500">{state.unseal.privateRepo}</code>
                  </div>
                  <p className="text-xs text-zinc-400 pt-1">{state.unseal.noteHe}</p>
                </>
              ) : (
                <p className="text-zinc-500">טוען…</p>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Repos */}
        <section aria-label="הכספות-בגיט" className="space-y-3">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-zinc-400" aria-hidden />
            <h2 className="text-base font-semibold">שש-הכספות-בגיט — טיפים-חיים</h2>
          </div>
          <ScrollArea className="max-h-96 rounded-lg border border-zinc-800">
            <div className="divide-y divide-zinc-800/60">
              {(state?.repos ?? []).map((r) => (
                <div key={r.name} className="p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 hover:bg-zinc-900/60 transition-colors">
                  <div className="sm:w-44 shrink-0">
                    <div className="font-medium text-sm">{r.name}</div>
                    <div className="text-xs text-zinc-500">{r.branch}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-zinc-300 truncate" title={r.subject}>{r.subject || "—"}</div>
                    <div className="text-xs text-zinc-500">
                      {r.hash ? <code>{r.hash}</code> : "UNMEASURED"} · {fmtTime(r.date)}
                      {r.dirty > 0 && <span className="text-amber-400"> · {r.dirty} קבצים-לא-נדחפו</span>}
                      {r.dirty === 0 && <span className="text-emerald-500"> · נדחף-ונקי</span>}
                    </div>
                  </div>
                </div>
              ))}
              {!state && Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="p-4 animate-pulse bg-zinc-900/40" />
              ))}
            </div>
          </ScrollArea>
        </section>

        <Separator className="bg-zinc-800" />

        <p className="text-xs text-zinc-500 leading-relaxed pb-2">
          דוקטרינת-התצוגה: אפס-סודות-על-המסך (רק-פינים-ציבוריים) · כל-ערך-נמדד-חי-מה-RPC-הציבורי-ומהגיט-ברגע-הצפייה ·
          התרעות-אדומות-נשארות-אדומות-עד-תיקון-אמיתי · התרוקנות-RPC = UNMEASURED (לא-שקר).
          עדכון-אוטומטי-כל-30-שניות. נמדד-לאחרונה: {fmtTime(state?.at ?? null)}.
        </p>
      </main>

      <footer className="mt-auto border-t border-zinc-800 bg-zinc-900/60">
        <div className="max-w-6xl mx-auto px-4 py-3 text-xs text-zinc-500 flex flex-wrap items-center justify-between gap-2">
          <span>הריבונות-היא-הבוס · הכספות-בגיט-הן-המקור · השרשרת-היא-השופט</span>
          <span>roshpinacare-sys · קונסולה-חיה-ללא-סיפורים</span>
        </div>
      </footer>
    </div>
  );
}
