import { NextRequest, NextResponse } from "next/server";
import { safeErr } from "@/lib/safe-error"; // FIX(R16-b·m5)
import { kernelSelftest } from "@/lib/saos/kernel";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const result = await kernelSelftest();

    // FIX(Roast-63 · H2): GET-קריאה-בלבד — היה-רושם-קבלה-לשרשרת-העדויות-בכל-סקר
    // (GET-עם-side-effect = אפשרות-הצפת-שרשרת-החש-בלופ-פשוט). ה-selftest עצמו
    // דטרמיניסטי — אין-ערך-עדות-בכל-חזרה.
    return NextResponse.json({ ok: result.ok, result });
  } catch (e) {
    return NextResponse.json(
      // FIX(R16-b·m5): פירוט-גולמי רק-לבעלים; אנונימי מקבל פסק כנה גנרי
      await safeErr(req, e, "selftest failed"),
      { status: 200 }
    );
  }
}
