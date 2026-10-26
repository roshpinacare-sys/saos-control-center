// ═══ rc-rebalance · planner — pure deterministic delegation-move law (§2.3+§3) ═══
// Mission: RC (Resource Credit) dynamic rebalancing across soldier accounts.
// The chain truth this planner is built on (measured in-repo, scripts/fuel-state.ts
// + worklog TOPIC-3): a graphene soldier's RC/mana capacity derives from its
// vesting stake; delegation (`delegate_vesting_shares`) is the fuel-logistics
// operation that moves stake (hence RC) between accounts — measured live
// 0.43% → 93.24% mana after a delegation cure.
//
// CONTRACT (pure — zero I/O, zero clock, zero network):
//  · Input: roster + per-soldier measurements (fed from measure.ts chain reads,
//    or any honest upstream estimate — rcPct may come from vote/debt heuristics),
//    a policy, and an injected clock.
//  · Output: a plan of delegation MOVES in integer µVESTS (1 VESTS = 1e6 µVESTS).
//    This planner NEVER broadcasts — execute.ts turns moves into DRAFT ops for
//    the custody-gated executor (army-keys custody is gated; we never touch keys).
//
// LAWS (each enforced here and tested in planner.test.ts):
//  (a) FLOOR     — donors are only soldiers whose measured mana is at/above the
//                  donation ceiling; a donor's post-move vesting ledger never dips
//                  below its reservation floor. No soldier is pushed below the floor.
//  (b) CAPACITY  — the sum of a donor's planned outflows never exceeds its spare:
//                  vestingShares − delegatedOut − reservationVests (exact ledger math).
//  (c) IDEMPOTENCE — pure function of (roster, measures, policy): same inputs ⇒
//                  deep-equal plan and identical planId (clock injected, excluded
//                  from the id). The convergence loop re-measures; a satisfied
//                  roster re-plans to zero moves (fixed point).
//  (d) FAIL-CLOSED — any roster soldier absent, stale (older than maxStaleMs) or
//                  unmeasurable (rcPct null) ⇒ honest EMPTY plan (ok:false,
//                  moves:[]) with per-soldier reasons. Nothing is fabricated.

import { createHash } from 'node:crypto';

/** Integer µVESTS (1 VESTS = 1e6 µVESTS — the chain's mana units). */
export type MicroVests = number;

export interface SoldierMeasure {
  account: string;
  chain: 'steem' | 'hive' | 'blurt';
  /** Effective mana % (0..100) after regen projection — null when unmeasurable. */
  rcPct: number | null;
  /** Own vesting stake (µVESTS). */
  vestingShares: MicroVests;
  /** Vests this account already delegated away (µVESTS). */
  delegatedOut: MicroVests;
  /** Vests this account receives from others (µVESTS — not re-delegable). */
  receivedIn: MicroVests;
  /** Wall-clock ms when this measurement was taken (injected by the caller). */
  measuredAtMs: number;
  source: 'chain' | 'missing';
  /** Honest failure reason when source === 'missing'. */
  reason?: string;
}

export interface RebalancePolicy {
  /** Hard mana floor — informational lower bound; donors come from ABOVE the ceiling. */
  floorPct: number;
  /** Receivers are soldiers measured BELOW this. */
  targetPct: number;
  /** Donors are soldiers measured AT/ABOVE this (they are wasting regen). */
  ceilingPct: number;
  /** One delegation dose (µVESTS). */
  doseVests: MicroVests;
  /** Per-plan cap on doses any single receiver may accept. */
  maxDosesPerReceiver: number;
  /** Vests a donor always keeps (the ledger floor — law (a)). */
  reservationVests: MicroVests;
  /** Measurement older than this is stale → fail-closed (law (d)). */
  maxStaleMs: number;
}

export interface PlannerInput {
  roster: string[];
  measures: SoldierMeasure[];
  policy: RebalancePolicy;
  nowMs: number;
}

export interface DelegationMove {
  from: string;
  to: string;
  vests: MicroVests;
  seq: number;
}

export interface BlockedSoldier {
  account: string;
  reason: string;
}

export interface RebalancePlan {
  ok: boolean;
  /** 'balanced' | 'moved' | 'no-viable-donors' | 'stale-or-absent-measurement' */
  reason: string;
  moves: DelegationMove[];
  blocked: BlockedSoldier[];
  /** sha256 over the canonical JSON of the plan CORE (roster+policy+ledger+moves) — clock-excluded. */
  planId: string;
  nowMs: number;
}

/** Stable recursive key-sorted JSON (the fleet's canon — mirrors sovereign-gateway/protocol). */
export function canonJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonJson).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const body = keys.map((k) => `${JSON.stringify(k)}:${canonJson((value as Record<string, unknown>)[k])}`).join(',');
  return `{${body}}`;
}

export function planIdOf(core: unknown): string {
  return createHash('sha256').update(canonJson(core)).digest('hex');
}

function validatePolicy(p: RebalancePolicy): void {
  const fail = (why: string): never => {
    throw new Error(`rc-rebalance policy invalid (fail-closed): ${why}`);
  };
  if (!(p.floorPct < p.targetPct && p.targetPct < p.ceilingPct && p.ceilingPct <= 100)) fail('floorPct < targetPct < ceilingPct <= 100 required');
  if (!Number.isInteger(p.doseVests) || p.doseVests <= 0) fail('doseVests must be a positive integer (µVESTS)');
  if (!Number.isInteger(p.reservationVests) || p.reservationVests < 0) fail('reservationVests must be a non-negative integer');
  if (!Number.isInteger(p.maxDosesPerReceiver) || p.maxDosesPerReceiver < 1) fail('maxDosesPerReceiver must be >= 1');
  if (!Number.isInteger(p.maxStaleMs) || p.maxStaleMs <= 0) fail('maxStaleMs must be a positive integer');
}

/**
 * THE planner. Deterministic greedy: driest receiver first (rcPct asc, account asc
 * tie-break), largest-spare donor first (spare desc, account asc tie-break).
 */
export function planRebalance(input: PlannerInput): RebalancePlan {
  const { roster, measures, policy, nowMs } = input;
  validatePolicy(policy);

  if (new Set(roster).size !== roster.length) {
    return { ok: false, reason: 'stale-or-absent-measurement', moves: [], blocked: [{ account: '*', reason: 'roster has duplicate entries (fail-closed)' }], planId: planIdOf({ roster, policy }), nowMs };
  }

  const byName = new Map(measures.map((x) => [x.account, x]));

  // ── law (d): fail-closed on ANY absent / stale / unmeasurable roster soldier ──
  const blocked: BlockedSoldier[] = [];
  for (const name of roster) {
    const m = byName.get(name);
    if (!m) {
      blocked.push({ account: name, reason: 'absent measurement — fail-closed (no plan is fabricated)' });
      continue;
    }
    if (m.measuredAtMs + policy.maxStaleMs <= nowMs) {
      blocked.push({ account: name, reason: `stale measurement (measuredAt=${m.measuredAtMs} > maxStaleMs=${policy.maxStaleMs} before now=${nowMs})` });
      continue;
    }
    if (m.rcPct === null || !Number.isFinite(m.rcPct)) {
      blocked.push({ account: name, reason: `rcPct unmeasurable${m.reason ? `: ${m.reason}` : ''}` });
      continue;
    }
  }
  if (blocked.length > 0) {
    return {
      ok: false,
      reason: 'stale-or-absent-measurement',
      moves: [],
      blocked,
      planId: planIdOf({ roster, policy, blocked }),
      nowMs,
    };
  }

  const live = roster.map((n) => byName.get(n)!);

  // ── receivers: measured below target (driest first, account tie-break) ──
  const receivers = live
    .filter((x) => (x.rcPct as number) < policy.targetPct)
    .sort((a, b) => (a.rcPct as number) - (b.rcPct as number) || a.account.localeCompare(b.account));

  // ── donors: at/above ceiling with real spare capacity (law (a) + (b)) ──
  const spareOf = (x: SoldierMeasure): MicroVests => x.vestingShares - x.delegatedOut - policy.reservationVests;
  const donors = live
    .filter((x) => (x.rcPct as number) >= policy.ceilingPct)
    .map((x) => ({ account: x.account, spare: spareOf(x) }))
    .filter((d) => d.spare >= policy.doseVests)
    .sort((a, b) => b.spare - a.spare || a.account.localeCompare(b.account));

  const moves: DelegationMove[] = [];
  const dosesByReceiver = new Map<string, number>();
  let seq = 0;

  for (const r of receivers) {
    let doses = dosesByReceiver.get(r.account) ?? 0;
    while (doses < policy.maxDosesPerReceiver) {
      const donor = donors.find((d) => d.spare >= policy.doseVests);
      if (!donor) break; // no viable donor remains — honest, not fabricated
      seq += 1;
      moves.push({ from: donor.account, to: r.account, vests: policy.doseVests, seq });
      donor.spare -= policy.doseVests; // law (b): exact ledger accounting
      doses += 1;
    }
    if (doses < policy.maxDosesPerReceiver && doses === 0) {
      blocked.push({ account: r.account, reason: 'insufficient-donor-capacity (honest — no donor has a full dose)' });
    }
    dosesByReceiver.set(r.account, doses);
  }

  const reason = moves.length > 0 ? 'moved' : receivers.length > 0 ? 'no-viable-donors' : 'balanced';
  const planId = planIdOf({ roster, policy, ledger: live.map((x) => ({ a: x.account, v: x.vestingShares, d: x.delegatedOut, r: x.receivedIn })), moves });

  return { ok: true, reason, moves, blocked, planId, nowMs };
}

/** Exact ledger application of a plan to measurements (used by tests/CI to prove the fixed point). */
export function applyMoves(measures: SoldierMeasure[], plan: RebalancePlan): SoldierMeasure[] {
  const next = measures.map((x) => ({ ...x }));
  const byName = new Map(next.map((x) => [x.account, x]));
  for (const mv of plan.moves) {
    const from = byName.get(mv.from);
    const to = byName.get(mv.to);
    if (!from || !to) continue;
    from.delegatedOut += mv.vests;
    to.receivedIn += mv.vests;
  }
  return next;
}
