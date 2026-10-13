/**
 * bounty-tick.ts — EXEC-CD-31 · פעימת-כלכלת-הסוכנים מה-CLI (כלי-ריבונות-ידני)
 * מריץ את אותו-המנוע בדיוק (spawn → auto-claim → verify → pay) ומדפיס-הוכחה.
 * שימוש: bun scripts/bounty-tick.ts        → פעימה מלאה
 *        bun scripts/bounty-tick.ts spawn  → הזרעה-בלבד
 * אפס-סודות בפלט — תוויות ומספרים בלבד.
 */
import { bountyTick, spawnBounties, getAgentEconomy } from "../src/lib/bounty-engine";

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "tick";
  if (mode === "spawn") {
    const r = await spawnBounties();
    console.log(`SPAWNED=${r.spawned.length}`);
    for (const s of r.spawned) console.log(`  + ${s}`);
    for (const s of r.skipped) console.log(`  · skip: ${s}`);
    return;
  }
  const r = await bountyTick();
  console.log(`OK=${r.ok}`);
  console.log(r.note);
  for (const p of r.verifiedPaid) console.log(`  PAID ${p}`);
  for (const p of r.verifiedRejected) console.log(`  REJECT ${p}`);
  for (const p of r.autoClaimed) console.log(`  AUTO-CLAIM ${p}`);
  for (const p of r.spawned) console.log(`  SPAWN ${p}`);
  const eco = await getAgentEconomy();
  console.log(`OPEN=${eco.stats.openCount + eco.stats.claimedCount} PAID24H=${eco.stats.paid24hMu}µ PAID_EVER=${eco.stats.paidEverMu}µ`);
}

void main().then(() => process.exit(0)).catch((e) => { console.error(`FAIL: ${e instanceof Error ? e.message : e}`); process.exit(1); });
