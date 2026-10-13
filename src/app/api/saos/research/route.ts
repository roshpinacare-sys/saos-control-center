import { NextRequest, NextResponse } from "next/server";
import { safeErr } from "@/lib/safe-error"; // FIX(R16-b·m5)
import { FINDINGS, SYNTHESIS } from "@/lib/saos/findings";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// FIX(R17-a·F4): ה-mirror היה רץ **בתוך ה-GET** — כל-אנונימי-שסרק יכול-היה-להזיז-כתיבות-
// upsert-ל-DB (GET-עם-תופעות-לוואי — בניגוד-למשמעת-"GET-לא-כותב" שהונהגה-ב-kernel/
// economy/energy). עתה: ה-mirror רץ-פעם-אחת-באתחול-המודול (boot one-shot, אידמפוטנטי) —
// ה-GET עצמו קריאה-בלבד בכל-נסיבות. כישלון-mirror לא מפיל-את-התשובה-הציבורית.
void (async () => {
  try {
    const existing = await db.researchFinding.count();
    if (existing !== FINDINGS.length) {
      for (const f of FINDINGS) {
        await db.researchFinding.upsert({
          where: { archive: f.archive },
          update: { rank: f.rank, score: f.score, verdict: f.verdict },
          create: {
            archive: f.archive,
            rank: f.rank,
            score: f.score,
            verdict: f.verdict,
            salvage: JSON.stringify(f.salvage),
            evidence: JSON.stringify(f.evidence)
          }
        });
      }
    }
  } catch { /* mirror אופציונלי — הנתונים-החיים-תמיד-מ-FINDINGS-בזיכרון */ }
})();

export async function GET(req: NextRequest) {
  try {
    // קריאה-בלבד — ה-mirror קרה-באתחול (R17-a·F4); הנתונים-מוגשים-מהמקור-החי-בזיכרון
    return NextResponse.json({ ok: true, findings: FINDINGS, synthesis: SYNTHESIS });
  } catch (e) {
    return NextResponse.json(
      // FIX(R16-b·m5): פירוט-גולמי רק-לבעלים; אנונימי מקבל פסק כנה גנרי
      await safeErr(req, e, "research failed"),
      { status: 200 }
    );
  }
}
