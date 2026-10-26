// ═══ /api/soldiers — the all-soldier activation surface (§2.3, ADDITIVE) ══════
// One authenticated read that merges, for EVERY registered soldier:
//   · the rc-rebalance mesh (127.0.0.1:3141 — measured mana + last delegation plan)
//   · the legion (:3012 — per-agent DEX activation state)
// into one deterministic activation verdict per soldier (src/lib/soldier-activation.ts).
//
// §1 SECURITY LAW (directive 1a173c95d5ec1431): this route is NOT on the public
// allowlist (src/lib/security-gate.ts) — anonymous requests are dropped 401 at
// the edge, and this route independently re-verifies owner-session or agent-token
// (deny-by-default, fail-closed; the edge never grants). Downstream calls are
// loopback-only and server-side; RC_REBALANCE_TOKEN never leaves the process.

import { NextRequest, NextResponse } from 'next/server';
import { requireOwner, agentFrom } from '@/lib/auth';
import { denyAndLog } from '@/lib/deny-audit';
import { buildSoldierActivationSurface, SOLDIER_ROSTER, type MeshSurfaceInput, type LegionFleetEntry } from '@/lib/soldier-activation';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MESH_URL = process.env.RC_REBALANCE_MESH_URL ?? 'http://127.0.0.1:3141';
const LEGION_URL = process.env.SAOS_LEGION_URL ?? 'http://127.0.0.1:3012';

interface MeshStatusBody {
  lastPlanId?: string | null;
  lastBeat?: { at?: string } | null;
  lastMeasures?: Array<{ account: string; rcPct: number | null }>;
}
interface MeshPlanBody {
  moves?: Array<{ from: string; to: string }>;
}

async function jfetch<T>(url: string, headers: Record<string, string>, timeoutMs: number): Promise<T | null> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  // §1 deny-by-default — route-level re-verification (the edge already refused
  // anonymous traffic; this is the second lock, exactly like /api/vault/treasury).
  const owner = await requireOwner(req);
  const agent = owner ? null : await agentFrom(req);
  if (!owner && !agent) {
    return denyAndLog(req, '/api/soldiers', 'soldier activation surface read without owner session or agent token');
  }

  const meshHeaders: Record<string, string> = {};
  const meshToken = process.env.RC_REBALANCE_TOKEN ?? '';
  if (meshToken) meshHeaders.authorization = `Bearer ${meshToken}`;

  const [meshStatus, meshPlan, legionState] = await Promise.all([
    jfetch<MeshStatusBody>(`${MESH_URL}/status`, meshHeaders, 4000),
    jfetch<MeshPlanBody>(`${MESH_URL}/plan`, meshHeaders, 4000),
    jfetch<{ ok?: boolean; fleet?: LegionFleetEntry[] }>(`${LEGION_URL}/api/legion/state`, {}, 4000),
  ]);

  const meshOnline = meshStatus !== null;
  const mesh: MeshSurfaceInput = {
    online: meshOnline,
    planId: meshStatus?.lastPlanId ?? null,
    lastBeatAt: meshStatus?.lastBeat?.at ?? null,
    moves: meshPlan?.moves ?? [],
  };
  const rcByAccount: Record<string, number | null> = {};
  for (const m of meshStatus?.lastMeasures ?? []) rcByAccount[m.account] = m.rcPct;

  const surface = buildSoldierActivationSurface({
    roster: SOLDIER_ROSTER,
    mesh,
    legionOnline: legionState?.ok === true,
    legionFleet: legionState?.fleet ?? [],
    rcByAccount,
  });

  return NextResponse.json({
    ...surface,
    mesh: meshOnline
      ? { url: MESH_URL, authenticated: Boolean(meshToken) }
      : { url: MESH_URL, reachable: false, note: 'mesh offline — soldier verdicts still honest from legion only' },
    custody: { keyMaterial: 'never-touched', broadcast: false },
  });
}
