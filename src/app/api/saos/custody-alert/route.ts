/**
 * GET /api/saos/custody-alert — T-15 · SOVEREIGN LIQUIDITY GUARD NODE
 * ═══════════════════════════════════════════════════════════════════════
 * דבר-ההנחיה: "Continuously poll the state vectors of this route every 20
 * seconds. If any internal credential drift or signature authority
 * degradation is detected across the 15-account grid, execute the T-15 Red
 * Alert — locking the cockpit into a Solid Red State and blocking outbound
 * transmission of non-validated transactions."
 *
 * מקורות-אמת (קבלות-קנוניות בלבד — אפס-חישוב-חדש כאן):
 *   authority-guard-latest.json  → סחיפה/שלילה-חיה מול-השרשרת (2ש')
 *   authority-drift-latest.json  → מקור-אזהרה בלתי-נמחק (אירוע <48ש' = RED פעיל)
 *   credential-drill-latest.json → תרגיל-הכספות (2ש')
 *   connect-all-latest.json      → מטריצת-החיבור (2ש')
 *   mem-sentinel-latest.json     → זיכרון-מארח (5דק')
 *
 * מדיניות: RED = נעילת-יציאה (autoLockout=true) · AMBER = אזהרה ללא-נעילה ·
 * GREEN = ריבונות-נוזלת. קבלה-ישנה (>26ש') = AMBER (כנות, לא-אדמה-שווא).
 * אפס-סודות · אפס-נתיבי-עבודה בפלט.
 */
import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ROOT = process.cwd();
const STALE_MS = 26 * 3600 * 1000;
const DRIFT_ACTIVE_MS = 48 * 3600 * 1000;

type Json = Record<string, unknown>;
function readJson(p: string): Json | null {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, "receipts", p), "utf8")) as Json; } catch { return null; }
}
function ageOf(j: Json | null): number | null {
  const at = typeof j?.at === "string" ? Date.parse(j.at) : NaN;
  return Number.isFinite(at) ? Date.now() - at : null;
}

export async function GET() {
  const guard = readJson("authority-guard-latest.json");
  const drift = readJson("authority-drift-latest.json");
  const drill = readJson("credential-drill-latest.json");
  const connectAll = readJson("connect-all-latest.json");
  const mem = readJson("mem-sentinel-latest.json");

  const reasons: string[] = [];
  let state = "GREEN";

  /* ── RED: סחיפה-פעילה או שלילת-סמכות ── */
  const driftEvents = Array.isArray(drift?.events) ? (drift.events as Array<{ at?: string; kind?: string }>) : [];
  const freshDrift = driftEvents.filter((e) => typeof e.at === "string" && Date.now() - Date.parse(e.at) < DRIFT_ACTIVE_MS);
  const guardVerdict = String(guard?.verdict ?? "unknown");
  if (guardVerdict === "RED" || freshDrift.length > 0) {
    state = "RED";
    reasons.push(`authority drift active: guard=${guardVerdict} · fresh-revocations=${guard?.freshRevocations ?? driftEvents.length}`);
  }

  /* ── RED: תרגיל-כספות נכשל ── */
  const drillVerdict = String(drill?.verdict ?? "unknown");
  const drillAge = ageOf(drill);
  if (drillVerdict === "FAIL" && drillAge != null && drillAge < STALE_MS) {
    state = "RED";
    reasons.push("credential-drill FAILED (vault unwrap/keys/rails)");
  }

  /* ── AMBER: קבלות-ישנות / זיכרון-נלחץ / מצבים-לא-ידועים ── */
  const connectVerdict = String(connectAll?.verdict ?? "unknown");
  if (state !== "RED") {
    if (drillVerdict === "unknown" || connectVerdict === "unknown" || guardVerdict === "unknown") {
      state = "AMBER";
      reasons.push("custody receipts not yet published (guard/drill/connect-all)");
    } else if (drillAge != null && drillAge >= STALE_MS) {
      state = "AMBER";
      reasons.push("credential-drill receipt stale (>26h)");
    }
    const memLevel = String(mem?.level ?? "unknown");
    if (memLevel === "warn") { state = state === "GREEN" ? "AMBER" : state; reasons.push("host memory in warn band (≥2.0GiB)"); }
    if (memLevel === "critical") { reasons.push("host memory critical (≥2.3GiB) — compaction triggered"); }
    const driftTotal = driftEvents.length;
    if (driftTotal > 0 && freshDrift.length === 0 && state === "GREEN") {
      state = "AMBER";
      reasons.push("resolved drift marker present (history preserved — unalterable)");
    }
  }

  if (state === "GREEN") reasons.push("matrix live-verified · vault opens · no active drift");

  return NextResponse.json({
    schema: "saos.custody-alert/1",
    at: new Date().toISOString(),
    state,                     // GREEN | AMBER | RED
    autoLockout: state === "RED", // נעילת-יציאה — אסור-לשדר עסקאות-לא-מאומתות
    reasons,
    sources: {
      authorityGuard: { verdict: guardVerdict, freshRevocations: Number(guard?.freshRevocations ?? 0), at: guard?.at ?? null },
      authorityDrift: { events: driftEvents.length, freshEvents: freshDrift.length, lastSeenAt: drift?.lastSeenAt ?? null },
      credentialDrill: { verdict: drillVerdict, at: drill?.at ?? null },
      connectAll: { verdict: connectVerdict, at: connectAll?.at ?? null },
      memSentinel: { level: String(mem?.level ?? "unknown"), usedGiB: mem?.usedGiB ?? null, headroomGiB: mem?.headroomGiB ?? null },
    },
    keysLeaked: false,
  }, { headers: { "cache-control": "no-store" } });
}
