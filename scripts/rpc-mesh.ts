/**
 * rpc-mesh.ts — T-34 · RPC CIRCUIT RANKER v2 · "הצומת-המהיר-ביותר קודם, תמיד"
 * ═══════════════════════════════════════════════════════════════════════
 * דבר-ההנחיה (2026-10-08): "Should the witness watchdog automatically rank
 * alternative RPC endpoints by transactional throughput?" — ההכרעה: **כן**.
 * כל-2ש' (רגל-ה-guard): דגימת-latency חיה מול-כל-צומת-מוגדר (dgp — קריאה-זולה
 * וקנונית), דירוג: ok יורד · latency עולה, ופרסום receipts/rpc-mesh-latest.json.
 *
 * T-34-QB (2026-10-09, הכרעה: **כן**): מדדי-הצלחת-שידור פר-צומת לצד-RTT —
 * צומת-שקט-שמשיב-ל-ping אך מפיל-בלוקים מזוהה: הקראה של
 * saos-dex/tx/broadcast-latency.jsonl (saos.tx-latency/1 — מטא-בלבד),
 * צבירה פר-צומת (attempts/confirmed/failed/successRate — סף-3 ניסיונות),
 * ודירוג: ok יורד → successRate יורד (לא-מדוד אחרי-מדוד) → latency עולה.
 * ניקוז-היומן ל-512-שורות-אחרונות (אפס-נפיחות-DB).
 *
 * צרכנים: revenue-router (סדר-קופץ-צמתים-חי) · כל-agent אחר (קבלה-ציבורית —
 * כולל watchdog-העדים). failover-פר-קריאה נשאר-בתוך-הרכיבים; הדירוג קובע-סדר.
 *
 * רשימות-הצמתים = config-מקומי (הנקודות-שכבר-בשימוש-מוכח בסקריפטים — אפס-
 * endpoints-לא-מורשים). blurt: צומת-חי-יחיד (rpc.blurt.blog — blurt.world אבד).
 * אפס-סודות · אפס-נתיבי-עבודה.
 */
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "receipts", "rpc-mesh-latest.json");
const HISTORY = path.join(ROOT, "receipts", "rpc-mesh-history.jsonl");
const TXL = path.join(ROOT, "saos-dex", "tx", "broadcast-latency.jsonl"); // saos.tx-latency/1
const TIMEOUT_MS = 9000;
const TXL_TAIL = 512;

export const MESH_NODES: Record<"steem" | "hive" | "blurt", string[]> = {
  steem: [
    "https://api.steemit.com",
    "https://api.justyy.com",
    "https://steem.crypto-fans.com",
    "https://steemapi.boylikegirl.club",
  ],
  hive: ["https://api.hive.blog", "https://api.deathwing.me"],
  blurt: ["https://rpc.blurt.blog"], // Roast-74: blurt.world NXDOMAIN — הצומת-החי-היחיד
};

async function probe(node: string): Promise<{ ok: boolean; latencyMs: number; code?: number }> {
  const t0 = Date.now();
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(node, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_dynamic_global_properties", params: [], id: 1 }),
        signal: ctl.signal,
      });
      if (!res.ok) return { ok: false, latencyMs: Date.now() - t0, code: res.status };
      const j = (await res.json()) as { result?: { head_block_number?: number } };
      return { ok: !!j.result?.head_block_number, latencyMs: Date.now() - t0, code: res.status };
    } finally { clearTimeout(t); }
  } catch { return { ok: false, latencyMs: Date.now() - t0 }; }
}

/* ── T-34-QB: מדדי-הצלחה פר-צומת מיומן-השידורים (מטא-בלבד · ניקוז ל-512) ── */
interface NodeSuccess { attempts: number; confirmed: number; failed: number; successRate: number | null; lastAt: string | null }
function successMetrics(): Record<string, NodeSuccess> {
  let lines: string[] = [];
  try { lines = fs.readFileSync(TXL, "utf8").trim().split("\n").filter(Boolean); } catch { return {}; }
  const tail = lines.slice(-TXL_TAIL);
  try { if (lines.length > TXL_TAIL) fs.writeFileSync(TXL, tail.join("\n") + "\n"); } catch { /* כנות */ }
  const agg: Record<string, NodeSuccess> = {};
  for (const l of tail) {
    try {
      const j = JSON.parse(l) as { node?: string; status?: string; at?: string };
      if (!j.node) continue;
      const k = String(j.node).replace(/^https?:\/\//, "");
      const a = agg[k] ?? (agg[k] = { attempts: 0, confirmed: 0, failed: 0, successRate: null, lastAt: null });
      a.attempts++;
      if (j.status === "confirmed") a.confirmed++; else if (j.status === "failed-honest") a.failed++;
      if (j.at && (!a.lastAt || j.at > a.lastAt)) a.lastAt = j.at;
    } catch { /* שורה-פגומה — כנות, מדלגים */ }
  }
  for (const a of Object.values(agg)) a.successRate = a.attempts >= 3 ? Math.round((a.confirmed / a.attempts) * 1000) / 1000 : null;
  return agg;
}

async function main(): Promise<void> {
  const at = new Date().toISOString();
  const succ = successMetrics();
  const rateOf = (node: string): number | null => succ[node.replace(/^https?:\/\//, "")]?.successRate ?? null;
  const ranked: Record<string, Array<{ node: string; ok: boolean; latencyMs: number; successRate: number | null }>> = {};
  const samples: Record<string, unknown[]> = {};
  for (const [chain, nodes] of Object.entries(MESH_NODES)) {
    const probed = await Promise.all(nodes.map(async (node) => ({ node, ...(await probe(node)) })));
    // T-34-QB דירוג: ok יורד → successRate יורד (לא-מדוד אחרי-מדוד) → latency עולה
    ranked[chain] = probed.sort((a, b) =>
      (Number(b.ok) - Number(a.ok))
      || ((rateOf(b.node) ?? -1) - (rateOf(a.node) ?? -1))
      || (a.latencyMs - b.latencyMs))
      .map(({ node, ok, latencyMs }) => ({ node, ok, latencyMs, successRate: rateOf(node) }));
    samples[chain] = probed;
  }
  const receipt = {
    schema: "saos.rpc-mesh/2",
    at,
    method: "dgp probe · sort: ok desc, broadcast-successRate desc (unmeasured after measured), latency asc · min-3-attempts",
    ranked,
    successMetrics: succ,
    latencyLog: { path: "saos-dex/tx/broadcast-latency.jsonl", schema: "saos.tx-latency/1", drainedToTail: TXL_TAIL },
    consumers: ["revenue-router (live failover order)", "witness-watchdog (informational)", "any-agent (public receipt)"],
    keysLeaked: false,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(receipt, null, 1) + "\n");
  try { fs.appendFileSync(HISTORY, JSON.stringify({ at, steem: (samples.steem as unknown[]).length, top: ranked.steem?.[0] }) + "\n"); } catch { /* כנות */ }
  const fmt = (c: string) => (ranked[c] ?? []).map((n) => `${n.node.replace("https://", "")}${n.ok ? "" : "!(dead)"}:${n.latencyMs}ms${n.successRate != null ? `@${Math.round(n.successRate * 100)}%` : ""}`).join(" > ");
  console.log(`rpc-mesh: steem[${fmt("steem")}] hive[${fmt("hive")}] blurt[${fmt("blurt")}]`);
}

main().catch((e) => { console.error(`[rpc-mesh] FAILED: ${String((e as Error).message ?? e).slice(0, 200)}`); process.exit(1); });
