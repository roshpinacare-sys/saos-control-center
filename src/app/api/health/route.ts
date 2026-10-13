import { NextResponse } from "next/server";
import fs from "fs";

/* PEACE TREATY (2026-10-07) — the platform's dev-revive keeper probes
 * :3000/api/health and kills the port-holder when it can't get a 200.
 * The preview-bridge (saos-dex, task-10/war-end) answered this locally to
 * protect the DEX process. Now the REAL mother console is back on :3000 —
 * this honest 200 keeps the peace: no kill, no competition. The bridge
 * yields by its own design ("the real mother wins") and stays as the
 * automatic fallback if this server ever dies. */
export const dynamic = "force-dynamic";

export async function GET() {
  // EXEC-CD-19 (TRUTH-AUDIT): honest engine-deployment status — no more
  // "spawning a missing directory" silently. The DEX engine lives in a
  // separate repo (saos-dex/) that is NOT part of this tree; when absent,
  // every engine-fed surface is unknown (never zero).
  const dexDir = process.env.DEX_DIR || "/home/z/my-project/saos-dex";
  const engineDeployed = fs.existsSync(dexDir);
  return NextResponse.json({
    ok: true,
    service: "saos-mother-console",
    port: 3000,
    doctrine: "real-mother-alive · keeper-peace · no-competition · git-is-the-only-truth",
    treaty: "2026-10-07: / = mother console · sandbox is ephemeral (wiped ~5x/day) — nothing here is trusted state",
    engine: {
      deployed: engineDeployed,
      dir: dexDir,
      note: engineDeployed
        ? "engine repo present — trading/anchoring surfaces may be live"
        : "engine repo NOT in this tree — trading/anchoring surfaces are unknown (fail-honest), live-bridge surfaces are independent and real",
    },
    at: new Date().toISOString(),
  });
}
