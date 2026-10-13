/**
 * connect-all.ts — THE ONE COMMAND · "הראשי מחבר את כולם"
 * ═══════════════════════════════════════════════════════════════════════
 * דבר-הבעלים (2026-10-08): "שלא נבזבז שעות שוב בטענות שאין מפתח" — פקודה-אחת
 * שפותחת-הכל, מאמתת-הכל מול-השרשראות החיות, וכותבת-קבלה-ציבורית. רצה-גם
 * בתוך credential-drill (check #6) כל-שעתיים — החיבור-תמיד-מוכח, לא-נשכח.
 *
 *   bun run scripts/connect-all.ts            → טבלה-מלאה + קבלה
 *   bun run scripts/connect-all.ts --quiet    → שורה-אחת (ל-drill)
 *
 * מקורות: repo-vault (מעטפת-המאם, בגיט) · כספת-הצי (fleet_keys.enc) ·
 * rails (saos-dex/.env) · קבלות (fuel-state, broadcast-pending).
 * חוזה-סודות: אפס-חומר-מפתח בפלט/קבלה — רק-ספירות, שמות, תוויות-פאב-קיומיות.
 */
import fs from "fs";
import path from "path";
import { openRepoVault } from "../src/lib/repo-vault";
import { openFleetFiles, buildMatrix, ROLES } from "../src/lib/blurt-army";

const QUIET = process.argv.includes("--quiet");
const ROOT = process.cwd();
const OUT = path.join(ROOT, "receipts", "connect-all-latest.json");

interface Check { name: string; ok: boolean; detail: string }

async function main(): Promise<void> {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => { checks.push({ name, ok, detail }); if (!QUIET) console.log(`[${ok ? "✓" : "✗"}] ${name}: ${detail}`); };

  // ── 1) מעטפת-המאם (repo-vault — האמת-המוצפנת-שבגיט) ──
  let repoOk = false, absorbedCount = 0;
  try {
    const { bundle } = openRepoVault();
    absorbedCount = Object.keys(bundle.absorbed ?? {}).length;
    repoOk = absorbedCount > 0;
  } catch (e) { /* fail-closed */ }
  add("repo-vault", repoOk, `opens with 2-of-2 shards · absorbed members=${absorbedCount}`);

  // ── 2) כספת-הצי ──
  let fleetOk = false, fleetFiles = 0, blurtMember = 0;
  let matrix: Awaited<ReturnType<typeof buildMatrix>>["matrix"] = [];
  let chainPresent = { steem: 0, hive: 0, blurt: 0 };
  try {
    const { files } = openFleetFiles();
    fleetFiles = Object.keys(files).length;
    fleetOk = files["keys/vault.json"] !== undefined;
    try { blurtMember = (JSON.parse(files["keys/blurt.json"] ?? "{}") as { accounts?: unknown[] }).accounts?.length ?? 0; } catch { /* absent */ }
    const m = await buildMatrix(files);
    matrix = m.matrix; chainPresent = m.chainPresent;
  } catch { /* fail-closed */ }
  add("fleet-vault", fleetOk, `opens · files=${fleetFiles} · sealed-blurt-accounts=${blurtMember}`);

  // ── 3) מטריצה-חיה מול-השרשראות ──
  const full = (chain: "steem" | "hive" | "blurt", min: number) =>
    matrix.filter((r) => { const c = r.chains[chain]; return c && typeof c === "object" && c.verifiedCount >= min; }).length;
  const steemFull = full("steem", 4), hiveFull = full("hive", 4), blurtOwner = full("blurt", 1), blurtFull = full("blurt", 4);
  const matrixOk = steemFull >= 10 && blurtOwner >= 10;
  add("chain-matrix", matrixOk, `steem-full4=${steemFull} · hive-full4=${hiveFull} · blurt-owner+ =${blurtOwner} · blurt-full4=${blurtFull} · on-chain: steem=${chainPresent.steem} hive=${chainPresent.hive} blurt=${chainPresent.blurt} (of ${matrix.length})`);

  // ── 4) מסילות (rails — קיום-מפתחות-סביבה לפי KEY_ENV_NAMES הקנוני, בלי-הדפסה) ──
  let rails = 0;
  const railsWanted = ["SAOS_RELAY_AGENT_ACCOUNT", "STEEM_POSTING_WIF", "HIVE_POSTING_WIF", "BLURT_ACTIVE_WIF", "ETH_PRIVATE_KEY", "SOL_PRIVATE_KEY"];
  try {
    const env = fs.readFileSync(path.join(ROOT, "saos-dex", ".env"), "utf8");
    for (const k of railsWanted) if (new RegExp(`^${k}=.+`, "m").test(env)) rails += 1;
  } catch { /* absent */ }
  add("rails-keys", rails >= 3, `${rails}/${railsWanted.length} canonical rail keys present in saos-dex/.env (names-only)`);

  // ── 5) קבלות-עדכניות ──
  const rec = (p: string) => { try { return fs.statSync(path.join(ROOT, "receipts", p)).mtimeMs; } catch { return 0; } };
  const now = Date.now();
  const fresh = (ms: number) => ms > 0 && (now - ms) < 26 * 3600 * 1000;
  const fuelFresh = fresh(rec("fuel-state-latest.json"));
  const pendFresh = fresh(rec("broadcast-pending-latest.json"));
  add("receipts", fuelFresh && pendFresh, `fuel-state-fresh=${fuelFresh} · broadcast-pending-fresh=${pendFresh}`);

  // ── קבלה-ציבורית ──
  const verdict = checks.every((c) => c.ok) ? "PASS" : "PARTIAL";
  const receipt = {
    schema: "saos.connect-all/1",
    at: new Date().toISOString(),
    verdict,
    checks,
    blurtArmy: { sealedAccounts: blurtMember, chainVerifiedOwnerPlus: blurtOwner, full4: blurtFull },
    matrix: matrix.map((r) => ({
      username: r.username,
      chains: Object.fromEntries(Object.entries(r.chains).map(([c, v]) => [c, v === "no-keys" || v === "not-on-chain" ? v : { verified: (v as any).verifiedCount, roles: Object.fromEntries(Object.entries((v as any).roles).map(([role, rr]: [string, any]) => [role, rr.onChain])) }])),
    })),
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(receipt, null, 1) + "\n");

  if (QUIET) {
    console.log(`connect-all: ${verdict} · steem4=${steemFull} hive4=${hiveFull} blurtOwner=${blurtOwner} blurt4=${blurtFull} rails=${rails} repoVault=${repoOk ? 1 : 0} fleet=${fleetOk ? 1 : 0}`);
  } else {
    console.log(`\nVERDICT: ${verdict} → ${path.relative(ROOT, OUT)}`);
  }
  // exit 0 רק אם PASS מלא — ה-drill ידרוש כנות
  process.exit(verdict === "PASS" ? 0 : 1);
}

main().catch((e) => { console.error(`[connect-all] FAILED: ${String((e as Error).message ?? e).slice(0, 200)}`); process.exit(1); });
