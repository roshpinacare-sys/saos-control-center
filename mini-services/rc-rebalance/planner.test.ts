// ═══ rc-rebalance · planner — the deterministic delegation-move law (TDD) ═══
// Laws under test (mission §3):
//  (a) FLOOR — a move never pushes any soldier below the floor: only soldiers at
//      or above the donation ceiling may donate; the donor's post-move vesting
//      ledger never dips below its reservation floor.
//  (b) CAPACITY — a move never exceeds the source's own capacity: the sum of a
//      donor's outflows ≤ its spare vests (own vests − already delegated − reservation).
//  (c) IDEMPOTENCE — same inputs ⇒ byte-identical plan (stable planId, injected
//      clock); and the applied fixed-point re-plans to zero moves.
//  (d) FAIL-CLOSED — absent/stale/unmeasurable data ⇒ honest EMPTY plan (ok:false,
//      moves:[]) with a per-soldier reason. Nothing is fabricated.
// All units are integer µVESTS (1 VESTS = 1e6 µVESTS — the chain's mana units).

import { describe, expect, test } from 'bun:test';
import { planRebalance, applyMoves, canonJson, planIdOf, type SoldierMeasure, type RebalancePolicy } from './planner';

const POLICY: RebalancePolicy = {
  floorPct: 20,
  targetPct: 60,
  ceilingPct: 85,
  doseVests: 1_000_000, // 1 VESTS in µVESTS — small for arithmetic clarity
  maxDosesPerReceiver: 2,
  reservationVests: 500_000,
  maxStaleMs: 15 * 60_000,
};

const NOW = 1_700_000_000_000;

function m(partial: Partial<SoldierMeasure> & { account: string }): SoldierMeasure {
  return {
    chain: 'steem',
    rcPct: 95,
    vestingShares: 10_000_000,
    delegatedOut: 0,
    receivedIn: 0,
    measuredAtMs: NOW - 1000,
    source: 'chain',
    ...partial,
  };
}

function healthyRoster(): SoldierMeasure[] {
  return [
    m({ account: 'whale', rcPct: 99, vestingShares: 50_000_000 }), // donor: spare 49.5M
    m({ account: 'thirsty', rcPct: 10, vestingShares: 1_000_000 }), // receiver (< 60)
    m({ account: 'cruiser', rcPct: 70, vestingShares: 5_000_000 }), // mid — untouched
  ];
}

describe('planner: fail-closed law (d)', () => {
  test('absent measurement for any roster soldier → honest empty plan, ok:false', () => {
    const roster = ['whale', 'thirsty', 'ghost'];
    const measures = healthyRoster(); // 'ghost' has no row
    const plan = planRebalance({ roster, measures, policy: POLICY, nowMs: NOW });
    expect(plan.ok).toBe(false);
    expect(plan.reason).toBe('stale-or-absent-measurement');
    expect(plan.moves).toEqual([]);
    const blocked = plan.blocked.find((b) => b.account === 'ghost');
    expect(blocked?.reason).toContain('absent');
  });

  test('stale measurement (older than maxStaleMs) → empty plan, ok:false', () => {
    const measures = healthyRoster().map((x) =>
      x.account === 'thirsty' ? { ...x, measuredAtMs: NOW - POLICY.maxStaleMs - 1 } : x,
    );
    const plan = planRebalance({ roster: ['whale', 'thirsty', 'cruiser'], measures, policy: POLICY, nowMs: NOW });
    expect(plan.ok).toBe(false);
    expect(plan.moves).toEqual([]);
    expect(plan.blocked.find((b) => b.account === 'thirsty')?.reason).toContain('stale');
  });

  test('unmeasurable mana (rcPct null) → empty plan, ok:false', () => {
    const measures = healthyRoster().map((x) => (x.account === 'whale' ? { ...x, rcPct: null } : x));
    const plan = planRebalance({ roster: ['whale', 'thirsty', 'cruiser'], measures, policy: POLICY, nowMs: NOW });
    expect(plan.ok).toBe(false);
    expect(plan.moves).toEqual([]);
    expect(plan.blocked.find((b) => b.account === 'whale')?.reason).toContain('rcPct');
  });

  test('invalid policy (floor ≥ target) throws — config is fail-closed', () => {
    expect(() =>
      planRebalance({ roster: ['a'], measures: [m({ account: 'a' })], policy: { ...POLICY, floorPct: 60, targetPct: 60 }, nowMs: NOW }),
    ).toThrow();
    expect(() =>
      planRebalance({ roster: ['a'], measures: [m({ account: 'a' })], policy: { ...POLICY, targetPct: 90, ceilingPct: 90 }, nowMs: NOW }),
    ).toThrow();
  });
});

describe('planner: floor + capacity laws (a, b)', () => {
  test('deficit receiver + capable donor → doses up to the per-plan cap, ledger math exact', () => {
    const plan = planRebalance({ roster: ['whale', 'thirsty', 'cruiser'], measures: healthyRoster(), policy: POLICY, nowMs: NOW });
    expect(plan.ok).toBe(true);
    expect(plan.reason).toBe('moved');
    expect(plan.moves.length).toBe(POLICY.maxDosesPerReceiver);
    expect(plan.moves[0]).toEqual({ from: 'whale', to: 'thirsty', vests: POLICY.doseVests, seq: 1 });
    expect(plan.moves[1]).toEqual({ from: 'whale', to: 'thirsty', vests: POLICY.doseVests, seq: 2 });
  });

  test('donor between target and ceiling NEVER donates (floor law)', () => {
    const measures = [
      m({ account: 'midrich', rcPct: 70, vestingShares: 50_000_000 }), // plenty of vests but mana < ceiling
      m({ account: 'thirsty', rcPct: 10, vestingShares: 1_000_000 }),
    ];
    const plan = planRebalance({ roster: ['midrich', 'thirsty'], measures, policy: POLICY, nowMs: NOW });
    expect(plan.ok).toBe(true);
    expect(plan.moves).toEqual([]);
    expect(plan.reason).toBe('no-viable-donors');
  });

  test('outflow never exceeds donor spare; reservation floor respected (capacity law)', () => {
    const measures = [
      m({ account: 'small', rcPct: 99, vestingShares: 2_000_000, delegatedOut: 1_700_000 }), // spare = 2M−1.7M−0.5M < 0 → ineligible
      m({ account: 'tight', rcPct: 99, vestingShares: 2_600_000 }), // spare = 1.1M → exactly 1 dose
      m({ account: 'thirsty', rcPct: 10, vestingShares: 1_000_000 }),
    ];
    const plan = planRebalance({ roster: ['small', 'tight', 'thirsty'], measures, policy: POLICY, nowMs: NOW });
    const fromTight = plan.moves.filter((x) => x.from === 'tight');
    expect(fromTight.length).toBeLessThanOrEqual(2); // spare 1.1M / dose 1M
    const out = fromTight.reduce((s, x) => s + x.vests, 0);
    expect(out).toBeLessThanOrEqual(2_600_000 - 0 - POLICY.reservationVests);
    // 'small' is over-delegated already (spare < 0) — must never appear as a donor
    expect(plan.moves.some((x) => x.from === 'small')).toBe(false);
  });

  test('receiver is capped at maxDosesPerReceiver doses per plan', () => {
    const measures = [
      m({ account: 'ocean', rcPct: 99, vestingShares: 100_000_000 }),
      m({ account: 'desert', rcPct: 5, vestingShares: 1_000_000 }),
    ];
    const plan = planRebalance({ roster: ['ocean', 'desert'], measures, policy: POLICY, nowMs: NOW });
    const toDesert = plan.moves.filter((x) => x.to === 'desert');
    expect(toDesert.length).toBe(POLICY.maxDosesPerReceiver);
  });

  test('donors drain largest-spare-first; receivers served driest-first (deterministic greedy)', () => {
    const measures = [
      m({ account: 'd-small', rcPct: 99, vestingShares: 3_500_000 }), // spare 3.0M → 3 doses
      m({ account: 'd-big', rcPct: 99, vestingShares: 9_000_000 }), // spare 8.5M → 8 doses
      m({ account: 'r-a', rcPct: 20, vestingShares: 1_000_000 }),
      m({ account: 'r-b', rcPct: 10, vestingShares: 1_000_000 }),
      m({ account: 'r-c', rcPct: 30, vestingShares: 1_000_000 }),
    ];
    const plan = planRebalance({ roster: ['d-small', 'd-big', 'r-a', 'r-b', 'r-c'], measures, policy: POLICY, nowMs: NOW });
    // driest receiver served first: r-b (10) → r-a (20) → r-c (30); each ≤ 2 doses
    const toOf = (t: string) => plan.moves.filter((x) => x.to === t).length;
    expect(toOf('r-b')).toBe(2);
    expect(toOf('r-a')).toBe(2);
    expect(toOf('r-c')).toBeLessThanOrEqual(2);
    // first move goes to the driest
    expect(plan.moves[0].to).toBe('r-b');
    // big donor supplies the first dose (largest spare first)
    expect(plan.moves[0].from).toBe('d-big');
    // donor ledgers never go below reservation
    const out = (f: string) => plan.moves.filter((x) => x.from === f).reduce((s, x) => s + x.vests, 0);
    expect(9_000_000 - out('d-big')).toBeGreaterThanOrEqual(POLICY.reservationVests);
    expect(3_500_000 - out('d-small')).toBeGreaterThanOrEqual(POLICY.reservationVests);
    // exhausted receivers are blocked honestly, never fabricated
    if (toOf('r-c') < 2) {
      expect(plan.blocked.some((b) => b.account === 'r-c' && b.reason.includes('insufficient-donor-capacity'))).toBe(true);
    }
  });
});

describe('planner: idempotence + determinism (c)', () => {
  test('same inputs → identical moves + planId; injected clock skew touches only the nowMs field', () => {
    const later = NOW + 600_000; // inside maxStaleMs (900_000) for both runs
    const a = planRebalance({ roster: ['whale', 'thirsty', 'cruiser'], measures: healthyRoster(), policy: POLICY, nowMs: NOW });
    const b = planRebalance({
      roster: ['whale', 'thirsty', 'cruiser'],
      measures: healthyRoster().map((x) => ({ ...x, measuredAtMs: later - 1000 })),
      policy: POLICY,
      nowMs: later,
    });
    const { nowMs: _a, ...coreA } = a;
    const { nowMs: _b, ...coreB } = b;
    expect(coreA).toEqual(coreB);
    expect(a.planId).toBe(b.planId);
    expect(a.moves).toEqual(b.moves);
  });

  test('planId is 64-hex over canonical JSON; differs when the ledger differs', () => {
    const a = planRebalance({ roster: ['whale', 'thirsty', 'cruiser'], measures: healthyRoster(), policy: POLICY, nowMs: NOW });
    expect(a.planId).toMatch(/^[0-9a-f]{64}$/);
    const changed = healthyRoster().map((x) => (x.account === 'whale' ? { ...x, vestingShares: 50_000_001 } : x));
    const b = planRebalance({ roster: ['whale', 'thirsty', 'cruiser'], measures: changed, policy: POLICY, nowMs: NOW });
    expect(b.planId).not.toBe(a.planId);
  });

  test('fixed point: applying the plan then re-planning on converged state yields zero moves', () => {
    const measures = [
      m({ account: 'ocean', rcPct: 99, vestingShares: 100_000_000 }),
      m({ account: 'desert', rcPct: 5, vestingShares: 1_000_000 }),
    ];
    const plan = planRebalance({ roster: ['ocean', 'desert'], measures, policy: POLICY, nowMs: NOW });
    expect(plan.moves.length).toBeGreaterThan(0);
    // next beat: chain re-measures — the dose landed (ledger moved) and mana recovered above target
    const next = applyMoves(measures, plan).map((x) => (x.account === 'desert' ? { ...x, rcPct: 75 } : x));
    const plan2 = planRebalance({ roster: ['ocean', 'desert'], measures: next, policy: POLICY, nowMs: NOW + 60_000 });
    expect(plan2.ok).toBe(true);
    expect(plan2.moves).toEqual([]);
    expect(plan2.reason).toBe('balanced');
  });

  test('applyMoves is exact ledger math (delegatedOut/receivedIn) and never mutates its input', () => {
    const measures = healthyRoster();
    const snapshot = JSON.stringify(measures);
    const plan = planRebalance({ roster: ['whale', 'thirsty', 'cruiser'], measures, policy: POLICY, nowMs: NOW });
    const next = applyMoves(measures, plan);
    expect(JSON.stringify(measures)).toBe(snapshot); // no mutation
    expect(next.find((x) => x.account === 'whale')?.delegatedOut).toBe(POLICY.doseVests * POLICY.maxDosesPerReceiver);
    expect(next.find((x) => x.account === 'thirsty')?.receivedIn).toBe(POLICY.doseVests * POLICY.maxDosesPerReceiver);
  });
});

describe('planner: canonical json + helpers', () => {
  test('canonJson sorts keys recursively and keeps array order', () => {
    expect(canonJson({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } })).toBe('{"a":{"c":[3,{"y":2,"z":1}],"d":2},"b":1}');
  });
  test('planIdOf is sha256-hex of canonJson', () => {
    const id = planIdOf({ x: 1 });
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });
  test('balanced roster → zero moves without donors or receivers', () => {
    const measures = [m({ account: 'ok1', rcPct: 70 }), m({ account: 'ok2', rcPct: 70 })];
    const plan = planRebalance({ roster: ['ok1', 'ok2'], measures, policy: POLICY, nowMs: NOW });
    expect(plan.ok).toBe(true);
    expect(plan.moves).toEqual([]);
    expect(plan.reason).toBe('balanced');
  });
});
