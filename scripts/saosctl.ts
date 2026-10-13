/**
 * saosctl.ts — THE ONE-COMMAND OPS TOOL · כלי-ההרצה-האחד (מכשיר #17)
 * ═══════════════════════════════════════════════════════════════════════════════
 * EXEC-CD-36 · "אולי יש כלים שיעזרו לנו בהרצה של המערכת" — עניינם של הענקים:
 *   kubectl/fleetctl — ממשק-פעולה-אחד לכל-המערכת. ארבע-פקודות:
 *
 *   bun scripts/saosctl.ts status   → לוח-מצב-חי: נמלים · מנוע · כלכלה · עוגנים ·
 *                                      הוכחה-אחרונה · התראות · סנכרון-גיט
 *   bun scripts/saosctl.ts proof    → הרצת-סוללת-ההוכחה עכשיו (רץ-ההוכחה --once)
 *   bun scripts/saosctl.ts report   → דו"ח-בוקר מדוד → MORNING-REPORT.md
 *   bun scripts/saosctl.ts sync     → דחיפת-שני-הריפו + אימות-remote==local מול-API
 *
 * אפס-סודות בפלט — תוויות ומספרים בלבד. ה-PAT נקרא-מ-upload/pat.env ולעולם לא נדפס.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const MOTHER = "/home/z/my-project";
const DEX = `${MOTHER}/saos-dex`;
const ENGINE = "http://127.0.0.1:3010/saos-dex/api/dex/state";
const PP = `${DEX}/audit-package/proof-pack`;
const PORTS: [string, number][] = [["mother:3000", 3000], ["engine:3010", 3010], ["relay:3003", 3003], ["governor:3042", 3042], ["legion:3012", 3012]];

async function portUp(p: number): Promise<boolean> {
  try { const s = await Bun.connect({ hostname: "127.0.0.1", port: p, socket: { data() {}, close() {}, error() {} } }); await new Promise((r) => setTimeout(r, 30)); s.end(); return true; }
  catch { return false; }
}
async function engineState(): Promise<{ ok: boolean; st?: Record<string, unknown> & { height?: number }; err?: string }> {
  try {
    const r = await fetch(ENGINE, { signal: AbortSignal.timeout(8_000) });
    const j = (await r.json()) as { ok?: boolean; state?: Record<string, unknown> & { height?: number } };
    return j?.ok && j.state ? { ok: true, st: j.state } : { ok: false, err: "bad-shape" };
  } catch (e) { return { ok: false, err: String(e).slice(0, 60) }; }
}
function patToken(): string {
  try { const m = readFileSync(`${MOTHER}/upload/pat.env`, "utf8").match(/ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+/); return m ? m[0] : ""; } catch { return ""; }
}
async function remoteSha(repo: string): Promise<string> {
  const tok = patToken(); if (!tok) return "unverified";
  try {
    const r = await fetch(`https://api.github.com/repos/roshpinacare-sys/${repo}/branches/main`, { headers: { Authorization: `token ${tok}` }, signal: AbortSignal.timeout(10_000) });
    const j = (await r.json()) as { commit?: { sha?: string } };
    return (j?.commit?.sha ?? "").slice(0, 7) || "api-fail";
  } catch { return "api-fail"; }
}
function head(repo: string): string { try { return spawnSync("git", ["-C", repo, "rev-parse", "HEAD"]).stdout.toString().trim().slice(0, 7); } catch { return "?"; } }

/* ── status ─────────────────────────────────────────────────────────────────── */
async function status(): Promise<void> {
  console.log("\n════ saosctl status · לוח-המצב-החי ════");
  const ports: Record<string, boolean> = {};
  for (const [nm, p] of PORTS) ports[nm] = await portUp(p);
  console.log(`נמלים: ${PORTS.map(([nm]) => `${nm}=${ports[nm] ? "✓" : "✗"}`).join(" · ")}`);
  const e = await engineState();
  if (e.ok && e.st) {
    const st = e.st as { height?: number; feeMeter?: number; treasuryProfit?: number };
    // העומק-הכלכלי חי-רק-בסנאפשוט-האטום (ה-API מקרין-תמצית בלי-balances/pools)
    let deep = "";
    try {
      const snap = JSON.parse(readFileSync(`${DEX}/db/state-snapshot.json`, "utf8")) as { state?: { height?: number; treasuryProfitEver?: number; burnedSaos?: number; balances?: Record<string, Record<string, number>>; pools?: Record<string, { feeAccruedTreasury?: number }>; assets?: Record<string, { refPrice?: number }> } };
      const s = snap.state ?? {};
      const fees = Object.values(s.pools ?? {}).reduce((acc, p) => acc + (p.feeAccruedTreasury ?? 0), 0);
      let reserve = 0;
      for (const [a, v] of Object.entries(s.balances?.["reserve-vault"] ?? {})) {
        const rp = s.assets?.[a]?.refPrice ?? 0;
        if (rp > 0) reserve += Math.floor((rp * v) / 1000);
      }
      const supply = Object.values(s.balances ?? {}).reduce((acc, w) => acc + (w.SAOS ?? 0), 0);
      deep = ` · סנאפשוט h${(s.height ?? 0).toLocaleString()} (Δ${(st.height ?? 0) - (s.height ?? 0)}) · עמלות-בריכות ${fees.toLocaleString()}µ · רווח-ever ${(s.treasuryProfitEver ?? 0).toLocaleString()}µ · גיבוי-דלת ${reserve.toLocaleString()}µ (${Math.floor((reserve * 10_000) / Math.max(1, supply))}bps) · אספקת-SAOS ${supply.toLocaleString()}µ`;
    } catch { deep = " · סנאפשוט-לא-זמין"; }
    console.log(`מנוע: h${st.height} · feeMeter ${st.feeMeter ?? 0}µ · רווח-אוצר ${st.treasuryProfit ?? 0}µ${deep}`);
  } else console.log(`מנוע: ✗ לא-מגיב (${e.err})`);
  // עוגנים
  try {
    const la = JSON.parse(readFileSync(`${DEX}/state/last-anchor.json`, "utf8")) as { chain?: string; txid?: string; height?: number; at?: string; account?: string };
    console.log(`עוגן-אחרון: ${la.chain} ${la.txid?.slice(0, 12)}… h${la.height} · ${la.account} · ${la.at}`);
  } catch { console.log("עוגן-אחרון: אין-רשומה"); }
  // הוכחה
  try {
    const lp = JSON.parse(readFileSync(`${PP}/latest-proof.json`, "utf8")) as { verdict?: string; ts?: string; run?: number; battery?: { bmc?: { verdict?: string }; fuzzer?: { verdict?: string } } };
    const ledgerLines = existsSync(`${PP}/proof-ledger.jsonl`) ? readFileSync(`${PP}/proof-ledger.jsonl`, "utf8").trim().split("\n").length : 0;
    const alerts = existsSync(`${PP}/alerts.jsonl`) ? readFileSync(`${PP}/alerts.jsonl`, "utf8").trim().split("\n").filter(Boolean).slice(-4) : [];
    console.log(`הוכחה: run#${lp.run} ${lp.verdict} · ${lp.ts} · bmc=${lp.battery?.bmc?.verdict ?? "?"} fuzzer=${lp.battery?.fuzzer?.verdict ?? "?"} · פנקס=${ledgerLines}-ריצות`);
    for (const a of alerts) console.log(`  התראה: ${a.slice(0, 140)}`);
  } catch { console.log("הוכחה: אין-ריצה — הרץ `saosctl proof`"); }
  // גיט
  const gitRows = await Promise.all([["saos-control-center", MOTHER] as const, ["saos-dex", DEX] as const].map(async ([nm, repo]) => {
    const l = head(repo), r = await remoteSha(nm);
    return `${nm}: local=${l} remote=${r} ${l === r ? "✓מסונכרן" : r === "unverified" ? "?לא-נבדק" : "✗פער"}`;
  }));
  for (const g of gitRows) console.log(`גיט: ${g}`);
  console.log("");
}

/* ── proof / report / sync ──────────────────────────────────────────────────── */
function proof(): void {
  console.log("רץ-הוכחה-רציף --once (BMC-עומק-3 + fuzzer + חיווט + התראות)…\n");
  const r = spawnSync("bun", ["harness/proof-runner.ts", "--once"], { cwd: DEX, stdio: "inherit", timeout: 900_000, env: { ...process.env, DATABASE_URL: `file:${DEX}/db/dex.db` } });
  process.exit(r.status ?? 1);
}
function report(): void {
  console.log("מייצר דו\"ח-בוקר מדוד…\n");
  const r = spawnSync("bun", ["scripts/morning-report.ts"], { cwd: MOTHER, stdio: "inherit", timeout: 300_000, env: process.env });
  process.exit(r.status ?? 1);
}
async function sync(): Promise<void> {
  console.log("דחיפת-שני-הריפו + אימות-מול-API…");
  const push = (repo: string): number => spawnSync("bash", [`${repo}/scripts/sovereign-push.sh`], { cwd: repo, stdio: "pipe", timeout: 120_000 }).status ?? -1;
  const pushDex = (): number => {
    const tok = patToken();
    if (!tok) return -1;
    spawnSync("git", ["-C", DEX, "add", "-A"], { timeout: 60_000 });
    spawnSync("git", ["-C", DEX, "commit", "-m", `saosctl sync ${new Date().toISOString().slice(0, 16)}`], { cwd: DEX, timeout: 60_000 });
    const r = spawnSync("git", ["-C", DEX, "push", `https://${tok}@github.com/roshpinacare-sys/saos-dex.git`, "main"], { timeout: 120_000 });
    return r.status ?? -1;
  };
  const mPush = push(MOTHER);
  const dPush = pushDex();
  const rows = await Promise.all([["saos-control-center", MOTHER] as const, ["saos-dex", DEX] as const].map(async ([nm, repo]) => {
    const l = head(repo), r = await remoteSha(nm);
    return `${nm}: local=${l} remote=${r} ${l === r ? "✓" : "✗"}`;
  }));
  console.log(`pushes: mother=${mPush === 0 ? "✓" : "✗"} dex=${dPush === 0 ? "✓" : "✗"}`);
  for (const g of rows) console.log(`  ${g}`);
  process.exit(rows.every((g) => g.includes("✓")) && mPush === 0 && dPush === 0 ? 0 : 1);
}

const cmd = process.argv[2] ?? "status";
if (cmd === "status") await status();
else if (cmd === "proof") proof();
else if (cmd === "report") report();
else if (cmd === "sync") await sync();
else { console.log("שימוש: bun scripts/saosctl.ts status|proof|report|sync"); process.exit(2); }
