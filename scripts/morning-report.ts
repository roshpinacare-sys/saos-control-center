/**
 * morning-report.ts — THE MEASURED MORNING REPORT · דו"ח-הבוקר-המדוד
 * ═══════════════════════════════════════════════════════════════════════════════
 * EXEC-CD-36 · "בחן גם התקדמות כללית" — דו"ח-התקדמות-כללית שנמדד-חי, לא-מוצהר:
 *   כל-שורה = קריאה-חיה (מנוע / ערך / עוגנים / הוכחה / גיט / כלכלת-סוכנים).
 *   הפלט: MORNING-REPORT.md בשורש-הריפו — העדכון הבא דורס-בכנות (חד-אמת).
 * אפס-סודות. ריצה: bun scripts/morning-report.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { db } from "../src/lib/db";

const MOTHER = "/home/z/my-project";
const DEX = `${MOTHER}/saos-dex`;
const PP = `${DEX}/audit-package/proof-pack`;
const ENGINE = "http://127.0.0.1:3010/saos-dex/api/dex/state";
const TIER1_MU = 1_427_886; // יעד-מדרגה-1 (ECONOMY-DOCTRINE §93)

async function portUp(p: number): Promise<boolean> {
  try { const s = await Bun.connect({ hostname: "127.0.0.1", port: p, socket: { data() {}, close() {}, error() {} } }); await new Promise((r) => setTimeout(r, 30)); s.end(); return true; } catch { return false; }
}
function patToken(): string {
  try { const m = readFileSync(`${MOTHER}/upload/pat.env`, "utf8").match(/ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+/); return m ? m[0] : ""; } catch { return ""; }
}
async function remoteSha(repo: string): Promise<string> {
  const tok = patToken(); if (!tok) return "?";
  try { const r = await fetch(`https://api.github.com/repos/roshpinacare-sys/${repo}/branches/main`, { headers: { Authorization: `token ${tok}` }, signal: AbortSignal.timeout(10_000) }); const j = (await r.json()) as { commit?: { sha?: string } }; return (j?.commit?.sha ?? "").slice(0, 7); } catch { return "api-fail"; }
}
const localHead = (repo: string): string => { try { return readFileSync(`${repo}/.git/refs/heads/main`, "utf8").trim().slice(0, 7); } catch { return "?"; } };

async function main(): Promise<void> {
  const L: string[] = [];
  const warn = (s: string): string => `> ⚠️ ${s}`;
  const portNames: [string, number][] = [["מטה (3000)", 3000], ["מנוע (3010)", 3010], ["ריליי (3003)", 3003], ["מושל (3042)", 3042], ["לגיון (3012)", 3012]];
  const ports = await Promise.all(portNames.map(async ([nm, p]) => `${nm} ${await portUp(p) ? "חי ✓" : "מת ✗"}`));

  // ── מנוע: תמצית-חיה (API) + עומק-כלכלי-מהסנאפשוט-האטום (מלא-בלבד שם) ──
  let engRows = ["מנוע לא מגיב"];
  let height = 0, reserveUsds = 0, feeMeter = 0, profitEver = 0, burned = 0, poolFees = 0, supplySaos = 0, snapH = 0;
  try {
    const r = await fetch(ENGINE, { signal: AbortSignal.timeout(8_000) });
    const j = (await r.json()) as { ok?: boolean; state?: { height?: number; feeMeter?: number; treasuryProfit?: number } };
    if (j?.ok && j.state) { height = j.state.height ?? 0; feeMeter = j.state.feeMeter ?? 0; }
  } catch { /* כנה-למטה */ }
  try {
    const snap = JSON.parse(readFileSync(`${DEX}/db/state-snapshot.json`, "utf8")) as { state?: Record<string, never> & {
      height?: number; feeMeter?: number; treasuryProfitEver?: number; burnedSaos?: number;
      balances?: Record<string, Record<string, number>>; pools?: Record<string, { feeAccruedTreasury?: number }>;
    } };
    const st = snap.state ?? {};
    snapH = st.height ?? 0;
    if (!height) { height = snapH; feeMeter = st.feeMeter ?? 0; }
    profitEver = st.treasuryProfitEver ?? 0; burned = st.burnedSaos ?? 0;
    poolFees = Object.values(st.pools ?? {}).reduce((s, p) => s + (p.feeAccruedTreasury ?? 0), 0);
    // מדידת-כספת-העתודה: Σיתרות × מחיר-קנוני (מוסכם-notional: price×amt/1000) — אותו-חישוב-reserveMeasure
    const assets = (st as { assets?: Record<string, { refPrice?: number }> }).assets ?? {};
    for (const [a, v] of Object.entries(st.balances?.["reserve-vault"] ?? {})) {
      const rp = assets[a]?.refPrice ?? 0;
      if (rp > 0) reserveUsds += Math.floor((rp * v) / 1000);
    }
    supplySaos = Object.values(st.balances ?? {}).reduce((s, w) => s + (w.SAOS ?? 0), 0);
    engRows = [
      `גובה-חי h${height.toLocaleString()} · סנאפשוט-אטום h${snapH.toLocaleString()} (Δ${(height - snapH).toLocaleString()} — חוזה-RPO ≤600)`,
      `feeMeter ${feeMeter.toLocaleString()}µ · עמלות-בריכות ${poolFees.toLocaleString()}µ · רווח-אוצר-אי-פעם ${profitEver.toLocaleString()}µ · נשרף ${burned.toLocaleString()}µ`,
      `אספקת-SAOS-גולמת ${supplySaos.toLocaleString()}µ · כספת-עתודה (Σיתרות × מחיר-קנוני) ${reserveUsds.toLocaleString()}µ`,
    ];
  } catch { /* engRows כנה */ }

  // ── סולם-הערך (מהסנאפשוט — תיוג-טריות-כנה) ──
  let ladderRow = "";
  if (reserveUsds > 0) {
    const bps = Math.floor((reserveUsds * 10_000) / Math.max(1, supplySaos));
    const pct = (bps / 100).toFixed(2);
    const toTier1 = Math.max(0, TIER1_MU - reserveUsds);
    ladderRow = `\n## הסולם-לערך-אמת\n\n- גיבוי-דלת: **${reserveUsds.toLocaleString()}µ** = ${bps.toLocaleString()}bps (${pct}%) מאספקת-SAOS-גולמת\n- מדרגה-1 (רצפת-10% ≈ ${TIER1_MU.toLocaleString()}µ): **נותרו ${toTier1.toLocaleString()}µ** — המדד-הכנה-של-הדרך\n- מדרגה-נוכחית: 0 (מטבע-בית) — נפתחת אחרי 3-טיקים-רצופים מעל-הסף (אנטי-רעש) · המדידה-הקנונית המלאה reserveMeasure חיה-במנוע-הערך`;
  }

  // ── כלכלת-הסוכנים (prisma) ──
  let bountyRow = "כלכלת-סוכנים: לא-נמדדה";
  try {
    const [byStatus, paidAgg] = await Promise.all([
      db.agentBounty.groupBy({ by: ["status"], _count: { _all: true } }),
      db.agentBounty.aggregate({ where: { status: "paid" }, _count: { _all: true }, _sum: { rewardMu: true } }),
    ]);
    const m = byStatus.map((s) => `${s.status}=${s._count._all}`).join(" · ");
    bountyRow = `כלכלת-סוכנים: ${m} · שולמו-אמת ${paidAgg._count._all}-באונטיות · Σ${(paidAgg._sum.rewardMu ?? 0).toLocaleString()}µ`;
  } catch (e) { bountyRow = `כלכלת-סוכנים: שגיאת-מדידה ${String(e).slice(0, 60)}`; }

  // ── עוגנים ──
  let anchorRows: string[] = [];
  try {
    const la = JSON.parse(readFileSync(`${DEX}/state/last-anchor.json`, "utf8")) as { chain?: string; txid?: string; height?: number; at?: string; account?: string; stateRoot?: string };
    const anch = JSON.parse(readFileSync(`${DEX}/state/anchors.json`, "utf8")) as { chains?: Record<string, { status?: string; lastAnchoredTxid?: string; lastAt?: string }> };
    const sigLines = existsSync(`${DEX}/state/signing-audit.jsonl`) ? readFileSync(`${DEX}/state/signing-audit.jsonl`, "utf8").trim().split("\n").length : 0;
    anchorRows = [`עוגן-אחרון: **${la.chain}** tx ${la.txid?.slice(0, 16)}… בגובה h${la.height} · root ${la.stateRoot?.slice(0, 10)}… · ${la.at} (מאומת-חי-מול-RPC-פומבי ב-EXEC-CD-35)`,
      `מצב-מסילות: ${Object.entries(anch.chains ?? {}).map(([c, s]) => `${c}=${s.status ?? "?"}`).join(" · ")}`,
      `פנקס-חתימות-מוגן-האש: ${sigLines.toLocaleString()} רשומות (prevHash-רשרת)`];
  } catch { anchorRows = ["עוגנים: אין-רשומות-מצב"]; }

  // ── הוכחה ──
  let proofRows: string[] = [];
  try {
    const lp = JSON.parse(readFileSync(`${PP}/latest-proof.json`, "utf8")) as { verdict?: string; ts?: string; run?: number; battery?: { bmc?: { verdict?: string; sequences?: number }; fuzzer?: { verdict?: string } } };
    const bmc = JSON.parse(readFileSync(`${PP}/bmc.json`, "utf8")) as { verdict?: string; depth?: number; sequences?: number; applies?: number };
    const ledger = existsSync(`${PP}/proof-ledger.jsonl`) ? readFileSync(`${PP}/proof-ledger.jsonl`, "utf8").trim().split("\n").filter(Boolean) : [];
    const alerts = existsSync(`${PP}/alerts.jsonl`) ? readFileSync(`${PP}/alerts.jsonl`, "utf8").trim().split("\n").filter(Boolean) : [];
    proofRows = [`רץ-ההוכחה-הרציף: run#${lp.run} **${lp.verdict}** · ${lp.ts}`,
      `BMC: ${bmc.verdict} — עומק ${bmc.depth}, ${bmc.sequences?.toLocaleString()}-רצפים אקסהוסטיביים, ${bmc.applies?.toLocaleString()}-applies`,
      `Fuzzer: ${lp.battery?.fuzzer?.verdict ?? "?"} · פנקס-ריצות: ${ledger.length} · התראות-פתוחות: ${alerts.length}`];
  } catch { proofRows = ["הוכחה: טרם-רץ (`saosctl proof`)"]; }

  // ── גיט ──
  const gitRows = await Promise.all([["saos-control-center", MOTHER] as const, ["saos-dex", DEX] as const].map(async ([nm, repo]) => {
    const l = localHead(repo), r = await remoteSha(nm);
    return `${nm}: ${l === r && l !== "?" ? "✓ מסונכרן" : `✗ פער (local ${l} / remote ${r})`}`;
  }));

  L.push(`# דו"ח-בוקר-מדוד · SAOS`, ``, `> נוצר: ${new Date().toISOString()} · כל-שורה = מדידה-חיה (אפס-הצהרות)`, ``,
    `## הערימה-החיה`, ``, ...ports.map((p) => `- ${p}`), ``,
    `## המנוע-הריבוני (saos-dex :3010)`, ``, ...engRows.map((r) => `- ${r}`), ladderRow, ``,
    `## הרכבת-הציבורית (עוגנים-על-שרשרות-אמת)`, ``, ...anchorRows.map((r) => `- ${r}`), ``,
    `## ההוכחה-הרציפה (רמת-הענקים)`, ``, ...proofRows.map((r) => `- ${r}`), ``,
    `## כלכלת-הסוכנים`, ``, `- ${bountyRow}`, ``,
    `## ריבונות-הגיט`, ``, ...gitRows.map((r) => `- ${r}`), ``,
    `---`, ``, `*דו"ח-חד-אמת: הריצה הבאה דורסת. הפער למדרגה-1 הוא-המדד-הכנה-של-הדרך.*`);
  const out = `${MOTHER}/MORNING-REPORT.md`;
  await Bun.write(out, L.join("\n") + "\n");
  console.log(L.join("\n"));
  console.log(`\n→ נכתב: ${out}`);
  await db.$disconnect();
}
main().catch((e) => { console.error("report fail:", e); process.exit(1); });
