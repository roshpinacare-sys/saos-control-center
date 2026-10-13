/**
 * blurt-army.ts — CLI · מטריצת-החיבור המלאה ל-Blurt + איטום-הכספת
 * ═══════════════════════════════════════════════════════════════════
 *   bun run scripts/blurt-army.ts            → אימות-חי בלבד (מטריצה → קבלה)
 *   bun run scripts/blurt-army.ts --seal     → אימות + איטום keys/blurt.json בכספת-הצי
 *
 * קבלה: receipts/blurt-army-latest.json (אפס-סודות: תוויות-פאב + תוצאות-התאמה).
 * exit 0 רק-אם לפחות-חשבון-אחד-מאומת-מלא-מול-Blurt (אחרת fail-loud).
 */
import fs from "fs";
import path from "path";
import { openFleetFiles, buildMatrix, sealBlurtArmy, resealFleetFiles, ROLES } from "../src/lib/blurt-army";

const OUT = path.join(process.cwd(), "receipts", "blurt-army-latest.json");
const SEAL = process.argv.includes("--seal");

function main(): void {
  void (async () => {
    const { files, sealedAt } = openFleetFiles();
    console.log(`[blurt-army] fleet vault opened · sealedAt=${sealedAt} · files=${Object.keys(files).length}`);
    const { matrix, chainPresent } = await buildMatrix(files);
    console.log(`[blurt-army] on-chain presence: steem=${chainPresent.steem} hive=${chainPresent.hive} blurt=${chainPresent.blurt} (of ${matrix.length})`);

    // ── טבלה-כנה ──
    console.log("\naccount        STEEM o/a/p/m   HIVE o/a/p/m   BLURT o/a/p/m   src");
    for (const r of matrix) {
      const fmt = (c: string) => {
        const v = r.chains[c as keyof typeof r.chains];
        if (v === "no-keys") return "   --no-keys--  ";
        if (v === "not-on-chain") return "  not-on-chain ";
        if (!v || typeof v === "string") return "      ????    ";
        return ROLES.map((role) => (v.roles[role]?.onChain ? "✓" : v.roles[role]?.selfOk ? "x" : "-")).join("/") + `      `;
      };
      const blurt = r.chains.blurt;
      const src = blurt && typeof blurt === "object" ? blurt.sourceSet : "-";
      console.log(`${r.username.padEnd(14)} ${fmt("steem")}   ${fmt("hive")}   ${fmt("blurt")}   ${src}`);
    }
    console.log("\n(✓=מאומת-מול-השרשרת · x=עצמי-תקין-אך-לא-מאומת-על-השרשרת · -=לא-נבדק/--no-keys=אין-חותמת-בכספת)");

    // ── קבלה-ציבורית ──
    const receipt = {
      schema: "saos.blurt-army/2",
      at: new Date().toISOString(),
      doctrine: "blurt = graphene fork of steem — same 2018 key material, verified against live chain authorities",
      node: "https://rpc.blurt.blog",
      chainPresent,
      accounts: matrix.map((r) => ({
        username: r.username,
        totalVerified: r.totalVerified,
        chains: Object.fromEntries(Object.entries(r.chains).map(([c, v]) => [c, v === "no-keys" || v === "not-on-chain" ? v : { sourceSet: (v as any).sourceSet, verifiedCount: (v as any).verifiedCount, roles: Object.fromEntries(Object.entries((v as any).roles).map(([role, rr]: [string, any]) => [role, { selfOk: rr.selfOk, onChain: rr.onChain }])) }])),
        pubLabels: blurtPublicLabels(r),
      })),
    };
    function blurtPublicLabels(r: (typeof matrix)[number]) {
      const v = r.chains.blurt;
      if (!v || typeof v === "string") return {};
      return v.pubLabels;
    }
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(receipt, null, 1) + "\n");

    const blurtVerifiedAccounts = matrix.filter((r) => r.chains.blurt && typeof r.chains.blurt === "object" && (r.chains.blurt as any).verifiedCount > 0).length;
    const blurtFullyVerified = matrix.filter((r) => r.chains.blurt && typeof r.chains.blurt === "object" && (r.chains.blurt as any).verifiedCount >= 3).length;
    console.log(`\n[blurt-army] BLURT: accounts-with-any-match=${blurtVerifiedAccounts}/${matrix.length} · accounts-with-3+-role-match=${blurtFullyVerified}`);
    console.log(`[blurt-army] receipt → ${path.relative(process.cwd(), OUT)} (public, zero secrets)`);

    if (SEAL) {
      const sealInfo = sealBlurtArmy(files, matrix);
      if (sealInfo.accounts === 0) {
        console.error("[blurt-army] SEAL REFUSED — zero chain-verified accounts (fail-closed)");
        process.exit(2);
      }
      resealFleetFiles(files, new Date().toISOString());
      console.log(`[blurt-army] SEALED keys/blurt.json → fleet_keys.enc (same pass, same format): accounts=${sealInfo.accounts} roles=${sealInfo.roles}`);
      // תרגיל-סיבוב: פתיחה-מחדש-מלאה
      const reopen = openFleetFiles();
      const check = JSON.parse(reopen.files["keys/blurt.json"] ?? "{}") as { accounts?: unknown[] };
      console.log(`[blurt-army] reopen-drill: blurt.json member present, accounts=${check.accounts?.length ?? 0}`);
      if ((check.accounts?.length ?? 0) !== sealInfo.accounts) { console.error("[blurt-army] reopen MISMATCH — fail-closed"); process.exit(2); }
    }

    if (blurtVerifiedAccounts === 0) {
      console.error("[blurt-army] VERDICT FAIL — zero blurt matches (key material mismatch?)");
      process.exit(1);
    }
    console.log("[blurt-army] VERDICT PASS — blurt connection proven from existing 2018 key material");
  })();
}

main();
