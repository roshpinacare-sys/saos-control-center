// ═══ soldier-activation — the all-soldier activation surface (pure core) ══════
// Mission §2.3: the ALL-SOLDIER parallel activation surface. The legion (:3012)
// holds per-agent activation state; the rc-rebalance mesh (:3141) holds the RC
// rebalancing plan. This core MERGES both into one deterministic per-soldier
// verdict — zero I/O, zero clock (inputs are pre-fetched by the route).
//
// HONESTY: a soldier absent from the legion fleet is 'unlisted' (the identity
// lives on-chain, no agent runs yet); an offline mesh is meshOnline:false with
// null mesh fields — nothing is fabricated.

export interface MeshSurfaceInput {
  online: boolean;
  planId: string | null;
  lastBeatAt: string | null;
  /** delegation moves of the last plan (from=donor, to=receiver) */
  moves: Array<{ from: string; to: string }>;
}

export interface LegionFleetEntry {
  name: string;
  fallen: string;
  enabled?: boolean;
  stoppedReason?: string | null;
}

export interface SoldierActivation {
  account: string;
  /** measured mana % from the mesh's last measurement (null when mesh offline/unmeasured) */
  rcPct: number | null;
  meshPlanId: string | null;
  meshPlanned: boolean; // appears in the last rebalance plan (donor or receiver)
  legionEnabled: boolean | null;
  legionStoppedReason: string | null;
  /** deterministic verdict: rebalancing > active > stopped > idle > unlisted */
  activationState: 'rebalancing' | 'active' | 'stopped' | 'idle' | 'unlisted';
}

export interface ActivationSurface {
  ok: boolean;
  at: string;
  meshOnline: boolean;
  legionOnline: boolean;
  rosterCount: number;
  counts: Record<'rebalancing' | 'active' | 'stopped' | 'idle' | 'unlisted', number>;
  soldiers: SoldierActivation[];
}

/**
 * The canon ROT1 roster — the same identities the public soldiers API audits
 * (src/app/api/saos/soldiers/route.ts) and the rc-rebalance mesh balances
 * (mini-services/rc-rebalance/index.ts DEFAULT_ROSTER). Keep the three in sync.
 */
export const SOLDIER_ROSTER = ['headcorner', 'cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq'] as const;

export interface ActivationInput {
  roster: ReadonlyArray<string>;
  mesh: MeshSurfaceInput;
  legionOnline: boolean;
  legionFleet: LegionFleetEntry[];
  /** optional per-account measured mana from the mesh (account → rcPct) */
  rcByAccount?: Record<string, number | null>;
  at?: string;
}

export function buildSoldierActivationSurface(input: ActivationInput): ActivationSurface {
  const at = input.at ?? new Date().toISOString();
  const legionBy = new Map(input.legionFleet.map((f) => [String(f.name), f]));
  const planned = new Set<string>();
  for (const mv of input.mesh.online ? input.mesh.moves : []) {
    planned.add(mv.from);
    planned.add(mv.to);
  }

  const soldiers: SoldierActivation[] = input.roster.map((account) => {
    const legion = legionBy.get(account);
    const legionEnabled = legion ? legion.enabled !== false : null; // absent field = enabled (legion default)
    const legionStoppedReason = legion?.stoppedReason ?? null;
    const isPlanned = planned.has(account);
    const activationState: SoldierActivation['activationState'] = isPlanned
      ? 'rebalancing'
      : legion
        ? legionEnabled && !legionStoppedReason
          ? 'active'
          : 'stopped'
        : 'unlisted';
    return {
      account,
      rcPct: input.rcByAccount?.[account] ?? null,
      meshPlanId: input.mesh.online ? input.mesh.planId : null,
      meshPlanned: isPlanned,
      legionEnabled,
      legionStoppedReason,
      activationState,
    };
  });

  const counts = { rebalancing: 0, active: 0, stopped: 0, idle: 0, unlisted: 0 };
  for (const s of soldiers) counts[s.activationState] += 1;

  return {
    ok: true,
    at,
    meshOnline: input.mesh.online,
    legionOnline: input.legionOnline,
    rosterCount: soldiers.length,
    counts,
    soldiers,
  };
}
