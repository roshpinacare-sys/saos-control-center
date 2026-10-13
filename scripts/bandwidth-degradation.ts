/**
 * bandwidth-degradation.ts — T-36 · מקדמי-הידרדרות-רוחב-הפס · "הרוח-לפני-הקריסה" ═══
 * מקור: החלטת-המפעיל (שאלה-1 שלאחר-T-35): האם מעקב-העדים ירכיב אוטומטית מקדמי-
 *     הידרדרות-רוחב-פס-חוצי-רשת אל-יומן-הקבלות — לחיזוי-קריסות-צמתים-מערכתיות.
 *     **ההחלטה: כן** — מימוש-נטיבי-TS, קריאה-בלבד, אפס-שידור.
 *
 * מה: טורי-latency החיים מreceipts/witness-latency-history.jsonl (tail-512, מוזן
 *     כל-2ש' ע"י witness-tracker) → פר-(chain,node): שיפוע-ריבועים-פחותים של ms
 *     מול-זמן (ms/שעה) · שיפוע-יחסי (חלק-מהחציון לשעה) · התרחבות-שונות (חצי-
 *     שני מול חצי-ראשון — קריסות-צמתים נפתחות-ברעש-לפני-שהממוצע זז) · ETA לתקרת-
 *     הפסק-9ש' (גבול-הקריסה הנצפה בפועל ב-mesh). העשרה: successRate מ-
 *     saos-dex/tx/broadcast-latency.jsonl כאשר-הוא-קיים (עדיין-אין-תביעות-אמת — כנות).
 * איך: סיווג-פר-צומת insufficient-data-honest / improving / stable / degrading /
 *     critical · סיכון-מערכתי = ≥2 רשתות-עם-צומת-degrading/critical במקביל →
 *     קבלה saos.bandwidth-degradation/1 + יומן-היסטוריה מקומט (~150B/שורה).
 * גבולות: **קריאה-בלבד** · אפס-שידור · אפס-סודות · חיזוי-כנה (ETA=null כשאין-שיפוע) —
 *     אין-פעולות-אוטומטיות על-סמך-החיזוי; הוא-אות-למפעיל-ולסדר-הקפצת-הצמתים.
 */
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const HIST_IN = path.join(ROOT, "receipts", "witness-latency-history.jsonl");
const TXL = path.join(ROOT, "saos-dex", "tx", "broadcast-latency.jsonl");
const OUT = path.join(ROOT, "receipts", "bandwidth-degradation-latest.json");
const HIST_OUT = path.join(ROOT, "receipts", "bandwidth-degradation-history.jsonl");
const TAIL = 512;
const LINE_CEILING = 150;
const TIMEOUT_CEILING_MS = 9000; // = TIMEOUT_MS של witness-tracker — גבול-הקריסה הנצפה

interface Sample { t: number; ms: number }
interface NodeDeg {
  chain: string; node: string; samples: number; spanHours: number | null;
  medianMs: number | null; slopeMsPerHour: number | null; relSlopePerHour: number | null;
  varianceExpansion: number | null; etaToCeilingHours: number | null;
  successRate: number | null; verdict: string;
}
type Verdict = "insufficient-data-honest" | "improving" | "stable" | "degrading" | "critical";

const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const std = (a: number[]): number => {
  if (a.length < 2) return 0;
  const mu = a.reduce((n, x) => n + x, 0) / a.length;
  return Math.sqrt(a.reduce((n, x) => n + (x - mu) ** 2, 0) / a.length);
};
const r4 = (v: number | null): number | null => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1e4) / 1e4);

/* ── שיפוע-ריבועים-פחותים: ms לשעה מול-זמן-אמת (עצמאי-מקצב-הקדנס) ── */
function slopeMsPerHour(s: Sample[]): number | null {
  if (s.length < 3) return null;
  const t0 = s[0].t;
  const xs = s.map((p) => (p.t - t0) / 3600000);
  const ys = s.map((p) => p.ms);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den > 1e-12 ? num / den : 0; // כל-הדגימות-באותו-רגע → שיפוע-אפס-כנה
}

function classify(samples: number, spanHours: number | null, slope: number | null, rel: number | null): Verdict {
  if (samples < 4 || spanHours == null || spanHours < 0.5 || slope == null || rel == null) return "insufficient-data-honest"; // חלון-דק (<30דק') = רעש — כנות
  if (rel > 0.10) return "critical";      // >10%/שעה — אזור-חיזוי-קריסה
  if (rel > 0.02) return "degrading";     // 2–10%/שעה — מגמה-עולה
  if (rel < -0.02) return "improving";
  return "stable";
}

function successRates(): Record<string, number> {
  const agg: Record<string, { a: number; c: number }> = {};
  try {
    for (const l of fs.readFileSync(TXL, "utf8").trim().split("\n").filter(Boolean)) {
      const j = JSON.parse(l) as { node?: string; status?: string };
      if (!j.node) continue;
      const k = String(j.node).replace(/^https?:\/\//, "");
      const e = agg[k] ?? (agg[k] = { a: 0, c: 0 });
      e.a++; if (j.status === "confirmed") e.c++;
    }
  } catch { /* אין-קובץ-תביעות — כנות: עדיין-אפס-שידורים */ }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(agg)) if (v.a >= 3) out[k] = Math.round((v.c / v.a) * 1000) / 1000;
  return out;
}

async function main(): Promise<void> {
  const at = new Date().toISOString();
  const lines = fs.readFileSync(HIST_IN, "utf8").trim().split("\n").filter(Boolean);
  const byKey: Record<string, Sample[]> = {};
  for (const l of lines) {
    try {
      const j = JSON.parse(l) as { at?: string; chain?: string; node?: string; ms?: number; status?: string };
      if (!j.at || !j.chain || !j.node || typeof j.ms !== "number" || j.status !== "ok") continue;
      const k = `${j.chain}|${String(j.node).replace(/^https?:\/\//, "")}`;
      (byKey[k] ??= []).push({ t: Date.parse(j.at), ms: j.ms });
    } catch { /* שורה-פגומה — דילוג-כנה */ }
  }
  const succ = successRates();
  const nodes: NodeDeg[] = [];
  for (const k of Object.keys(byKey).sort()) {
    const [chain, node] = k.split("|");
    const s = byKey[k].sort((a, b) => a.t - b.t);
    const slope = slopeMsPerHour(s);
    const med = median(s.map((p) => p.ms));
    const rel = slope != null && med > 0 ? slope / med : null;
    const half = Math.floor(s.length / 2);
    const s1 = std(s.slice(0, half).map((p) => p.ms));
    const s2 = std(s.slice(half).map((p) => p.ms));
    const varExp = s1 > 0 && half >= 2 ? s2 / s1 : null;
    const eta = slope != null && slope > 0 && med < TIMEOUT_CEILING_MS ? (TIMEOUT_CEILING_MS - med) / slope : null;
    const span = (s[s.length - 1].t - s[0].t) / 3600000;
    const verdict = classify(s.length, span, slope, rel);
    nodes.push({
      chain, node, samples: s.length,
      spanHours: r4((s[s.length - 1].t - s[0].t) / 3600000),
      medianMs: Math.round(med), slopeMsPerHour: r4(slope), relSlopePerHour: r4(rel),
      varianceExpansion: r4(varExp), etaToCeilingHours: r4(eta),
      successRate: succ[node] ?? null, verdict,
    });
  }
  const chains: Record<string, { degraded: boolean; worst: string | null }> = {};
  for (const c of ["steem", "hive", "blurt"]) {
    const ns = nodes.filter((n) => n.chain === c && (n.verdict === "degrading" || n.verdict === "critical"));
    const worst = ns.slice().sort((a, b) => (b.relSlopePerHour ?? 0) - (a.relSlopePerHour ?? 0))[0];
    chains[c] = { degraded: ns.length > 0, worst: worst ? `${worst.node}(${worst.verdict})` : null };
  }
  const degradedChains = Object.keys(chains).filter((c) => chains[c].degraded);
  const receipt = {
    schema: "saos.bandwidth-degradation/1",
    at,
    source: "receipts/witness-latency-history.jsonl (tail 512 · fed 2h by witness-tracker)",
    method: "per-(chain,node) least-squares ms/hour · relSlope=share-of-median-per-hour · variance-expansion half2/half1 · ETA to 9s timeout ceiling",
    thresholds: { degrading: "relSlope>2%/h (window>=30min)", critical: "relSlope>10%/h", systemicRisk: ">=2 networks degraded simultaneously" },
    nodes,
    chains,
    systemicRisk: { flagged: degradedChains.length >= 2, degradedChains },
    broadcastSuccessEnriched: Object.keys(succ).length > 0,
    doctrine: "read-only prediction · zero broadcast · zero secrets · prediction is an operator signal, never an auto-action",
    keysLeaked: false,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(receipt, null, 1) + "\n");
  // יומן-היסטוריה מקומט (~150B/שורה — קנון-מטא כמו saos.tx-latency/1)
  const newLines: string[] = [];
  for (const n of nodes) {
    const line = JSON.stringify({
      at, chain: n.chain, node: n.node, n: n.samples,
      msH: n.slopeMsPerHour, v: n.verdict === "insufficient-data-honest" ? "thin" : n.verdict,
      sr: n.successRate, risk: n.verdict === "critical",
    });
    newLines.push(line.slice(0, LINE_CEILING));
  }
  fs.appendFileSync(HIST_OUT, newLines.join("\n") + "\n");
  try {
    const all = fs.readFileSync(HIST_OUT, "utf8").trim().split("\n").filter(Boolean);
    if (all.length > TAIL) fs.writeFileSync(HIST_OUT, all.slice(-TAIL).join("\n") + "\n");
  } catch { /* כנות */ }
  const critical = nodes.filter((n) => n.verdict === "critical").length;
  const degrading = nodes.filter((n) => n.verdict === "degrading").length;
  console.log(`bandwidth-degradation: nodes=${nodes.length} degrading=${degrading} critical=${critical} · systemicRisk=${receipt.systemicRisk.flagged ? "FLAGGED" : "none"} · chains=${JSON.stringify(Object.fromEntries(Object.entries(chains).map(([c, v]) => [c, v.degraded ? v.worst : "ok"])))}`);
}

main().catch((e) => { console.error(`[bandwidth-degradation] FAILED: ${String((e as Error).message ?? e).slice(0, 200)}`); process.exit(1); });
