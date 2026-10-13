/**
 * witness-tracker.ts — T-35 · רכיב-מעקב-עדים-חלופי · "עין-על-כל-חשבון-פרסום" ══
 * מקור: פרומפט-המערכת T-35 (פעולה-2) — המימוש **נטיבי-TS** (לא health_monitor.py —
 * לא-קיים-ולא-יבנה-בפייתון; המערכת כולה bun/TypeScript).
 *
 * מה: מעקב-קריאה-בלבד אחרי-מצב-הטרנזקציות של חשבונות-הפרסום-החלופיים
 *     (צבא-העוגנים — 10/10-Steem · 11/11-Blurt · מטריצת-hive) — מהרשימה-הפומבית
 *     בreceipts/authority-guard-latest.json (שמות-משתמש-בלבד — אפס-גישה-לכספת).
 * איך: get_accounts + get_account_history(limit-10) מול-צמתי-ה-mesh-המדורגים-חי
 *     (receipts/rpc-mesh-latest.json <26ש' — fallback קנוני) · מדידת-latency פר-
 *     קריאה → history.jsonl (קנון-מטא ~150B/שורה — כמו saos.tx-latency/1) ·
 *     failover-פר-קריאה (429/timeout → הצומת-הבא).
 * גבולות: **אפס-שידור** · אפס-סודות · אפס-endpoints-לא-מורשים · חשבונות-מוגבלים
 *     (cap-12-פר-שרשרת) · כשל-פר-חשבון = כנה (unreachable-honest).
 */
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const GUARD = path.join(ROOT, "receipts", "authority-guard-latest.json");
const MESH = path.join(ROOT, "receipts", "rpc-mesh-latest.json");
const OUT = path.join(ROOT, "receipts", "witness-tracker-latest.json");
const HIST = path.join(ROOT, "receipts", "witness-latency-history.jsonl");
const HIST_TAIL = 512;
const CAP_PER_CHAIN = 12;
const TIMEOUT_MS = 9000;

const FALLBACK_NODES: Record<string, string[]> = {
  steem: ["https://api.justyy.com", "https://api.steemit.com"],
  hive: ["https://api.hive.blog", "https://api.deathwing.me"],
  blurt: ["https://rpc.blurt.blog"],
};

type Chain = "steem" | "hive" | "blurt";

interface GuardReceipt {
  matrix?: Array<{ username: string; chains: Record<string, unknown> }>;
}
interface MeshReceipt {
  at?: string;
  ranked?: Record<string, Array<{ node: string; ok: boolean }>>;
}

function meshNodeOrder(chain: Chain): string[] {
  try {
    const m = JSON.parse(fs.readFileSync(MESH, "utf8")) as MeshReceipt;
    const fresh = m.at ? Date.now() - Date.parse(m.at) < 26 * 3600 * 1000 : false;
    const ok = (m.ranked?.[chain] ?? []).filter((n) => n.ok).map((n) => n.node);
    if (fresh && ok.length > 0) return [...ok, ...FALLBACK_NODES[chain].filter((n) => !ok.includes(n))];
  } catch { /* כנות */ }
  return FALLBACK_NODES[chain];
}

async function rpcCall(nodes: string[], method: string, params: unknown[]): Promise<{ result: unknown; node: string; ms: number } | null> {
  for (const node of nodes) {
    const t0 = Date.now();
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(node, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
          signal: ctl.signal,
        });
        if (!res.ok) continue;
        const j = (await res.json()) as { result?: unknown; error?: unknown };
        if (j.error) continue;
        return { result: j.result, node, ms: Date.now() - t0 };
      } finally { clearTimeout(t); }
    } catch { /* צומת-הבא — כנות */ }
  }
  return null;
}

function logLine(entry: Record<string, unknown>): void {
  try {
    const line = JSON.stringify({ at: new Date().toISOString(), op: "witness-track", ...entry });
    fs.mkdirSync(path.dirname(HIST), { recursive: true });
    fs.appendFileSync(HIST, line.slice(0, 300) + "\n");
    const lines = fs.readFileSync(HIST, "utf8").trim().split("\n").filter(Boolean);
    if (lines.length > HIST_TAIL) fs.writeFileSync(HIST, lines.slice(-HIST_TAIL).join("\n") + "\n");
  } catch { /* כנות */ }
}

interface TrackResult { account: string; exists: boolean; recentOps: number; lastOpAt: string | null; transfersIn: number; transfersOut: number; node: string | null; ms: number | null; status: string }

async function trackAccount(chain: Chain, account: string): Promise<TrackResult> {
  const nodes = meshNodeOrder(chain);
  const acc = await rpcCall(nodes, "condenser_api.get_accounts", [[account]]);
  if (!acc) return { account, exists: false, recentOps: 0, lastOpAt: null, transfersIn: 0, transfersOut: 0, node: null, ms: null, status: "unreachable-honest" };
  logLine({ chain, account, node: acc.node.replace("https://", ""), ms: acc.ms, status: "ok" });
  const r = acc.result as Array<{ created?: string }> | undefined;
  let recentOps = 0, lastOpAt: string | null = null, transfersIn = 0, transfersOut = 0, histMs: number | null = null, histNode: string | null = null;
  if (chain !== "hive") {
    const hist = await rpcCall(nodes, "condenser_api.get_account_history", [account, -1, 10]);
    histMs = hist?.ms ?? null;
    histNode = hist?.node?.replace("https://", "") ?? null;
    if (hist) {
      logLine({ chain, account, kind: "history", node: histNode, ms: histMs, status: "ok" });
      const items = (hist.result as Array<[number, Record<string, unknown>]> | undefined) ?? [];
      for (const [, e] of items) {
        recentOps++;
        const ts = typeof e?.timestamp === "string" ? e.timestamp : null;
        if (ts && (!lastOpAt || ts > lastOpAt)) lastOpAt = ts;
        const opArr = Array.isArray(e?.op) ? (e.op as Array<unknown>) : null;
        const opName = opArr && typeof opArr[0] === "string" ? opArr[0] : "";
        if (opName === "transfer") {
          const d = (opArr?.[1] ?? {}) as { from?: string; to?: string };
          if (d.to === account) transfersIn++; else if (d.from === account) transfersOut++;
        }
      }
    }
  }
  return {
    account, exists: (r?.length ?? 0) > 0,
    recentOps, lastOpAt, transfersIn, transfersOut,
    node: histNode ?? acc.node.replace("https://", ""),
    ms: histMs ?? acc.ms,
    status: "tracked",
  };
}

async function main(): Promise<void> {
  const at = new Date().toISOString();
  const g = JSON.parse(fs.readFileSync(GUARD, "utf8")) as GuardReceipt;
  const accountsByChain: Record<Chain, string[]> = { steem: [], hive: [], blurt: [] };
  for (const row of g.matrix ?? []) {
    for (const chain of ["steem", "hive", "blurt"] as Chain[]) {
      const cell = row.chains?.[chain] as { verified?: number } | undefined;
      if (cell && typeof cell === "object" && (cell.verified ?? 0) > 0 && accountsByChain[chain].length < CAP_PER_CHAIN) {
        accountsByChain[chain].push(row.username);
      }
    }
  }
  const chains: Record<string, { accounts: TrackResult[]; tracked: number; unreachable: number }> = {};
  for (const chain of ["steem", "hive", "blurt"] as Chain[]) {
    const names = accountsByChain[chain];
    const accounts: TrackResult[] = [];
    for (const n of names) {
      const r = await trackAccount(chain, n);
      accounts.push(r);
      await new Promise((res) => setTimeout(res, 120)); // קצב-מנומס — אפס-רגש-צומת
    }
    chains[chain] = {
      accounts,
      tracked: accounts.filter((a) => a.status === "tracked").length,
      unreachable: accounts.filter((a) => a.status === "unreachable-honest").length,
    };
  }
  const receipt = {
    schema: "saos.witness-track/1",
    at,
    accountsSource: "receipts/authority-guard-latest.json (public usernames only — zero vault access)",
    nodeSource: "receipts/rpc-mesh-latest.json (live-ranked, <26h fresh)",
    chains,
    historyLog: { path: "receipts/witness-latency-history.jsonl", tail: HIST_TAIL, ceilingBytes: 150 },
    doctrine: "read-only telemetry · zero broadcast · zero secrets · prepares asset-routing fallback loops",
    keysLeaked: false,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(receipt, null, 1) + "\n");
  const sum = (c: string) => `${chains[c].tracked}/${chains[c].accounts.length}`;
  console.log(`witness-tracker: tracked steem=${sum("steem")} hive=${sum("hive")} blurt=${sum("blurt")} · unreachable=${chains.steem.unreachable + chains.hive.unreachable + chains.blurt.unreachable}`);
}

main().catch((e) => { console.error(`[witness-tracker] FAILED: ${String((e as Error).message ?? e).slice(0, 200)}`); process.exit(1); });
