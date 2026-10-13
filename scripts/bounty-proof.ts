/**
 * bounty-proof.ts — EXEC-CD-31 · הוכחת-קצה-לקצה של כלכלת-הסוכנים:
 * סוכן-ראיה ('bounty-proof') מודד-בעצמו את מכ"ם-הסטיות-החי, בונה ראיה אמת,
 * תובע + משלים בונטי-מחקר, והפעימה מאמתת-מול-מציאות ומשלמת מהאוצר לארנקו
 * על שרשרת-הדקס. הפלט: מספרים בלבד — אפס-סודות.
 */
import { db } from "../src/lib/db";
import { getDeviationRadar, getMarketPrices, getDexReserve } from "../src/lib/value-engine";
import { bountyTick } from "../src/lib/bounty-engine";

async function main(): Promise<void> {
  const AGENT = "bounty-proof";
  // 1) הסוכן מודד-בעצמו (אמת — לא מעתיק-מהשאלה). מחירי-שוק לא-זמינים? → מדידת-סולם
  //    מהמנוע בלבד (בונטי-ops — אימותו לא-תלוי-בשוק-החוץ).
  const mk = await getMarketPrices();
  let titlePart: string; let evidence: Record<string, unknown>; let reward: number;
  if (mk.ok) {
    const radar = await getDeviationRadar();
    const assets = radar.map(r => r.asset);
    const maxDev = Math.max(...radar.map(r => Math.abs(r.deviationPct ?? 0)));
    console.log(`MEASURED assets=${assets.length} maxDeviation=${maxDev.toFixed(3)}%`);
    titlePart = "התכנסות";
    evidence = { assets, maxDeviationPct: Math.round(maxDev * 1e4) / 1e4 };
    reward = 700;
  } else {
    const res = await getDexReserve();
    if (!res.ok) { console.log("ENGINE-UNREACHABLE — כנה, מסיים"); return; }
    console.log(`PRICES-UNAVAILABLE → עובר-לבונטי-ops (מדידת-מנוע): h${res.height} realBps=${res.realBps}`);
    titlePart = "דוח-סולם";
    evidence = { h: res.height, realBps: res.realBps };
    reward = 600;
  }

  // 2) תביעת-הבונטי-המתאים
  const b = await db.agentBounty.findFirst({
    where: { title: { contains: titlePart }, status: "open" },
  });
  if (!b) { console.log(`NO-OPEN-BOUNTY (${titlePart}) — מסיים`); return; }
  await db.agentBounty.update({
    where: { id: b.id },
    data: { status: "claimed", agent: AGENT, claimedAt: new Date() },
  });
  await db.agentBounty.update({
    where: { id: b.id },
    data: {
      status: "done", completedAt: new Date(),
      evidence: JSON.stringify(evidence),
      verifyNote: "הוגש-ע" + '"' + "י-סוכן-הוכחה (מדידה-עצמאית)",
    },
  });
  console.log(`CLAIMED+DONE bounty=${b.id} reward=${b.rewardMu}µ (expect ${reward})`);

  // 3) פעימה: אימות-מול-מציאות → תשלום-אמת
  const t = await bountyTick();
  console.log(`TICK: ${t.note}`);
  for (const p of t.verifiedPaid) console.log(`  PAID ${p}`);
  for (const p of t.verifiedRejected) console.log(`  REJECT ${p}`);

  // 4) הוכחה-על-השרשרת: יתרת-הארנק במנוע
  const r = await fetch("http://127.0.0.1:3010/saos-dex/api/dex/state", { signal: AbortSignal.timeout(10000) });
  const j = await r.json() as { wallets?: Array<{ name: string; balances?: Record<string, number> }> };
  const w = (j.wallets ?? []).find(x => x.name === AGENT);
  console.log(`WALLET ${AGENT}: USDS=${w?.balances?.USDS ?? "ABSENT"} (צריך להיות ${b.rewardMu}µ)`);
  process.exit(0);
}

void main().catch((e) => { console.error(`FAIL: ${e instanceof Error ? e.message : e}`); process.exit(1); });
