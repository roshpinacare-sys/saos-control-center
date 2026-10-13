import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/fuel — Fuel Deck (Task 3-c): מדדי-דלק חיים של הצי.
 * מאגד: מפיק-ה-telemetry (receipts/fuel-state-latest.json — נכתב ע"י
 * scripts/fuel-state.ts כל-15דק') + מצב-relay/fleet-חי-מהמנוע (3010) +
 * חבילות-ה-broadcast-pending. אפס-סודות — נתונים-ציבוריים בלבד.
 */
async function safeJson<T>(url: string, timeoutMs = 4000): Promise<T | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctl.signal, cache: "no-store" });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } finally {
      clearTimeout(t);
    }
  } catch {
    return null;
  }
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(process.cwd(), file), "utf8")) as T;
  } catch {
    return null;
  }
}

function relayView(relay: any | null) {
  if (!relay?.relay) return null;
  const r = relay.relay;
  const chains: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r.chains ?? r.chainState ?? {})) {
    const s = v as Record<string, unknown>;
    chains[k] = {
      enabled: s.enabled, status: s.status, anchored: s.anchored, verified: s.verified,
      mismatches: s.mismatches, lastError: s.lastError ?? null,
    };
  }
  return { metrics: r.metrics ?? null, chains };
}

function fleetView(fleet: any | null) {
  if (!fleet?.fleet) return null;
  const f = fleet.fleet;
  return {
    configured: !!f.configured,
    usableByChain: f.usableByChain ?? null,
    accounts: (f.accounts ?? []).map((a: Record<string, unknown>) => ({
      account: a.account, hasVerifiedKey: a.hasVerifiedKey, authorityOk: a.authorityOk,
      rcEffective: a.rcEffective, steemOk: a.steemOk, steemRc: a.steemRc,
      blurtOk: a.blurtOk, blurtBalance: a.blurtBalance, anchoredCount: a.anchoredCount, usable: a.usable,
    })),
  };
}

export async function GET() {
  const [relayRaw, fleetRaw, fuelState, pending, connectAll] = await Promise.all([
    safeJson<{ relay?: any }>("http://127.0.0.1:3010/saos-dex/api/dex/relay"),
    safeJson<{ fleet?: any }>("http://127.0.0.1:3010/saos-dex/api/dex/fleet"),
    readJson<{ at: string; primary?: Record<string, unknown>; blockers?: string[] }>("receipts/fuel-state-latest.json"),
    readJson<{ eth?: Record<string, unknown>; sol?: Record<string, unknown> }>("receipts/broadcast-pending-latest.json"),
    // BLURT ARMY (2026-10-08): מטריצת-החיבור המלאה — connect-all (מאומת-מול-שרשראות-חיות)
    readJson<{ at: string; verdict: string; blurtArmy?: Record<string, unknown>; matrix?: unknown[]; checks?: unknown[] }>("receipts/connect-all-latest.json"),
  ]);

  const relay = relayView(relayRaw);
  const fleet = fleetView(fleetRaw);
  const pendingView = pending
    ? {
        eth: pending.eth ? { status: pending.eth.status, identity: pending.eth.identity, missingWei: pending.eth.missingWei } : null,
        sol: pending.sol ? { status: pending.sol.status, identity: pending.sol.identity, missingLamports: pending.sol.missingLamports } : null,
      }
    : null;

  return NextResponse.json({
    ok: true,
    at: new Date().toISOString(),
    sources: { fuelState: !!fuelState, relay: !!relay, fleet: !!fleet, connectAll: !!connectAll },
    relay,
    fleet,
    primary: fuelState?.primary ?? null,
    blockers: fuelState?.blockers ?? null,
    pending: pendingView,
    army: connectAll
      ? { at: connectAll.at, verdict: connectAll.verdict, blurtArmy: connectAll.blurtArmy ?? null, matrix: connectAll.matrix ?? null }
      : null,
  });
}
