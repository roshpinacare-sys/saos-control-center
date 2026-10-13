/**
 * GET /api/saos/rpc-mesh — T-35 · רשת-הצמתים-החיה בקוקפיט
 * ═════════════════════════════════════════════════════════════
 * מקור-אמת: receipts/rpc-mesh-latest.json (saos.rpc-mesh/2 — מדורג-חי כל-2ש')
 *   · ranked: צמתים פר-שרשרת (ok · latencyMs · successRate)
 *   · successMetrics: מדדי-הצלחת-שידור פר-צומת (T-34-QB)
 *   · witness-tracker-latest.json → סיכום-מעקב-החשבונות (32-חשבונות)
 * כנות: קבלה-ישנה (>26ש') = honest-stale דגל — אפס-המצאה. אפס-סודות.
 */
import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ROOT = process.cwd();
const STALE_MS = 26 * 3600 * 1000;

export async function GET() {
  try {
    const mesh = JSON.parse(fs.readFileSync(path.join(ROOT, "receipts", "rpc-mesh-latest.json"), "utf8")) as Record<string, unknown>;
    const stale = typeof mesh.at === "string" ? Date.now() - Date.parse(mesh.at) > STALE_MS : true;
    let witness: { tracked?: number; total?: number } | null = null;
    try {
      const w = JSON.parse(fs.readFileSync(path.join(ROOT, "receipts", "witness-tracker-latest.json"), "utf8")) as {
        chains?: Record<string, { tracked?: number; accounts?: unknown[] }>;
      };
      const c = w.chains ?? {};
      witness = {
        tracked: Object.values(c).reduce((n, x) => n + (x.tracked ?? 0), 0),
        total: Object.values(c).reduce((n, x) => n + (x.accounts?.length ?? 0), 0),
      };
    } catch { witness = null; }
    return NextResponse.json({ schema: mesh.schema ?? "saos.rpc-mesh/2", at: mesh.at ?? null, stale, ranked: mesh.ranked ?? {}, successMetrics: mesh.successMetrics ?? {}, witness });
  } catch {
    return NextResponse.json({ schema: "saos.rpc-mesh/2", at: null, stale: true, ranked: {}, successMetrics: {}, witness: null, note: "receipt-missing-honest" }, { status: 200 });
  }
}
