import { NextRequest, NextResponse } from "next/server";
import { safeErr } from "@/lib/safe-error"; // FIX(R16-b·m5)
import { simulateEconomy, DEFAULT_ECONOMY, type EconomyInput } from "@/lib/saos/economy";

export const dynamic = "force-dynamic";

// FIX(Roast-64-a · F6): GET ציבורי-זה כתב EvidenceReceipt בכל-קריאה — עבירה על
// עיקרון-הפלטפורמה "אין GET עם side-effects", זיהום שרשרת-העדויות מבקשות-קריאה,
// ו-fork-race על prevDigest עם catch שבולע כישלון-כתיבה ומחזיר digest שמעולם
// לא נשמר. עכשיו: חישוב-קריאה-בלבד; receipt=null + הסבר-כנה. קבלה ניתנת-ליצירה
// רק במסלול מאומת (POST /api/saos/seal).

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const q = url.searchParams;
    const input: EconomyInput = {
      poolVolumePerDay: num(q.get("pool"), DEFAULT_ECONOMY.poolVolumePerDay),
      poolFeePct: num(q.get("fee"), DEFAULT_ECONOMY.poolFeePct),
      gridRoundsPerDay: num(q.get("rounds"), DEFAULT_ECONOMY.gridRoundsPerDay),
      gridProfitPerRound: num(q.get("profit"), DEFAULT_ECONOMY.gridProfitPerRound),
      inboundRailVolume: num(q.get("rail"), DEFAULT_ECONOMY.inboundRailVolume),
      inboundRate: num(q.get("rate"), DEFAULT_ECONOMY.inboundRate),
      doorCallsPerDay: num(q.get("door"), DEFAULT_ECONOMY.doorCallsPerDay),
      doorFee: num(q.get("doorFee"), DEFAULT_ECONOMY.doorFee),
      flywheelPct: num(q.get("fly"), DEFAULT_ECONOMY.flywheelPct),
      // honesty fix (Task 10-d-6, platform parity): measured=true is a deliberate
      // caller claim — only accepted when explicitly passed (never defaulted on);
      // the UI never sends it, so the towers sim always reads mode="sim" → הדמיה
      measured: q.get("measured") === "true"
    };

    const result = simulateEconomy(input);

    return NextResponse.json({
      ok: true,
      input,
      result,
      receipt: null,
      note: "read-only: GET לא כותב קבלות-עדות (אין GET עם side-effects) — קבלה נרשמת רק בפעימת-עגינה מאומתת"
    });
  } catch (e) {
    return NextResponse.json(
      // FIX(R16-b·m5): פירוט-גולמי רק-לבעלים; אנונימי מקבל פסק כנה גנרי
      await safeErr(req, e, "economy failed"),
      { status: 200 }
    );
  }
}

function num(v: string | null, d: number): number {
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
}
