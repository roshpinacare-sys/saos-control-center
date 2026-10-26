// ═══ liquid-fuel tests — the STEEM/SBD fuel-streaming draft law (TDD, red→green) ═══
// Companion to the rc-rebalance delegation planner: while planner.ts moves RC
// (vesting delegation), liquid fuel (STEEM/SBD) moves by `transfer`. The laws are
// the same fleet laws: measured-only amounts (zero invention), fail-closed on any
// missing/stale measurement, deterministic planId (sha256 of canon core, clock
// excluded), broadcast:false ALWAYS (this lane never signs, never broadcasts),
// and an HONEST law gate — exec-armed.json governs what the custody-gated
// executor may ever broadcast; drafts outside the armed law are marked
// lawGate:'pending-exec-armed-allowlist' and stay untouched.
import { describe, expect, test } from 'bun:test';

import { planLiquidFuel, canonJsonOf, type LiquidBalance, type LiquidFuelPolicy } from './liquid-fuel';

const NOW = 1_800_000_000_000;
const STALE = NOW - 20 * 60 * 1000; // 20 minutes ago (maxStaleMs is 15)

const policy: LiquidFuelPolicy = {
  receiverMinSteemM: 500_000, // a soldier below 0.5 STEEM liquid is fuel-hungry
  receiverMinSbdM: 100_000, // below 0.1 SBD
  donorKeepSteemM: 1_000_000, // a donor always keeps 1 STEEM liquid
  donorKeepSbdM: 200_000,
  doseSteemM: 300_000, // 0.3 STEEM per dose
  doseSbdM: 50_000,
  maxDosesPerReceiver: 2,
  maxStaleMs: 900_000,
  armedLaw: {
    allowTransfersOut: false,
    transferAllowlist: [] as string[],
    delegationAllowlist: ['headcorner', 'cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq', 'hcsoldier4', 'hcsoldier5', 'hcsoldier6'],
    note: 'exec-armed.json measured 2026-10-26: transfers-out REFUSED; saos-0004 absent from the 13-body delegation allowlist',
  },
};

function bal(account: string, steemM: number, sbdM: number, opts?: { stale?: boolean; missing?: string }): LiquidBalance {
  if (opts?.missing) return { account, chain: 'steem', steemM: 0, sbdM: 0, measuredAtMs: opts.stale ? STALE : NOW, source: 'missing', reason: opts.missing };
  return { account, chain: 'steem', steemM, sbdM, measuredAtMs: opts?.stale ? STALE : NOW, source: 'chain' };
}

describe('liquid-fuel: determinism + planId law', () => {
  test('same inputs → deep-equal plan and identical planId (clock excluded)', () => {
    const roster = ['headcorner', 'saos-0004'];
    const measures = [bal('headcorner', 50_000_000, 5_000_000), bal('saos-0004', 100_000, 20_000)];
    const a = planLiquidFuel({ roster, measures, policy, nowMs: NOW });
    const b = planLiquidFuel({ roster, measures, policy, nowMs: NOW + 1234 });
    // clock is excluded from the planId and from the deterministic core (planner.ts law)
    const coreA = { ...a, nowMs: 0 }; const coreB = { ...b, nowMs: 0 };
    expect(coreA).toEqual(coreB);
    expect(a.planId).toMatch(/^[0-9a-f]{64}$/);
    expect(a.planId).toBe(b.planId);
  });

  test('canonJsonOf is key-sorted recursive (fleet canon)', () => {
    expect(canonJsonOf({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
});

describe('liquid-fuel: fail-closed law (no invented amounts, ever)', () => {
  test('missing measurement → ok:false with per-account reason, zero drafts', () => {
    const plan = planLiquidFuel({
      roster: ['headcorner', 'ghost'],
      measures: [bal('headcorner', 50_000_000, 5_000_000), bal('ghost', 0, 0, { missing: 'absent from chain response' })],
      policy, nowMs: NOW,
    });
    expect(plan.ok).toBe(false);
    expect(plan.drafts).toHaveLength(0);
    expect(plan.blocked.map((b) => b.account)).toContain('ghost');
  });

  test('stale measurement → fail-closed', () => {
    const plan = planLiquidFuel({
      roster: ['headcorner', 'old-timer'],
      measures: [bal('headcorner', 50_000_000, 5_000_000), bal('old-timer', 1, 1, { stale: true })],
      policy, nowMs: NOW,
    });
    expect(plan.ok).toBe(false);
    expect(plan.blocked.some((b) => b.reason.includes('stale'))).toBe(true);
  });

  test('duplicate roster entries → fail-closed', () => {
    const plan = planLiquidFuel({
      roster: ['headcorner', 'headcorner'],
      measures: [bal('headcorner', 50_000_000, 5_000_000)],
      policy, nowMs: NOW,
    });
    expect(plan.ok).toBe(false);
  });
});

describe('liquid-fuel: move law (donor keep-floor, doses, honest exhaustion)', () => {
  test('thirsty soldier gets whole doses; donor never dips below its keep floor', () => {
    const plan = planLiquidFuel({
      roster: ['headcorner', 'saos-0004'],
      measures: [bal('headcorner', 2_000_000, 1_000_000), bal('saos-0004', 100_000, 20_000)],
      policy, nowMs: NOW,
    });
    expect(plan.ok).toBe(true);
    const steemOut = plan.drafts.filter((d) => d.asset === 'STEEM').reduce((s, d) => s + d.amountM, 0);
    const donorSteem = 2_000_000 - steemOut;
    expect(donorSteem).toBeGreaterThanOrEqual(policy.donorKeepSteemM);
    expect(steemOut).toBeGreaterThan(0);
    expect(steemOut % policy.doseSteemM).toBe(0); // whole doses only
    for (const d of plan.drafts) {
      expect(d.broadcast).toBe(false);
      expect(d.planId).toBe(plan.planId);
      expect(d.op).toBe('transfer');
    }
  });

  test('dry donor → honest no-viable-donors, zero drafts (nothing fabricated)', () => {
    const plan = planLiquidFuel({
      roster: ['headcorner', 'saos-0004'],
      measures: [bal('headcorner', 1_000_000, 200_000), bal('saos-0004', 100_000, 20_000)],
      policy, nowMs: NOW,
    });
    expect(plan.ok).toBe(true);
    expect(plan.reason).toBe('no-viable-donors');
    expect(plan.drafts).toHaveLength(0);
  });

  test('satisfied roster → balanced (fixed point, zero drafts)', () => {
    const plan = planLiquidFuel({
      roster: ['headcorner', 'saos-0004'],
      measures: [bal('headcorner', 50_000_000, 5_000_000), bal('saos-0004', 600_000, 150_000)],
      policy, nowMs: NOW,
    });
    expect(plan.ok).toBe(true);
    expect(plan.reason).toBe('balanced');
    expect(plan.drafts).toHaveLength(0);
  });

  test('max doses per receiver respected', () => {
    const plan = planLiquidFuel({
      roster: ['headcorner', 'very-dry'],
      measures: [bal('headcorner', 100_000_000, 100_000), bal('very-dry', 0, 0)],
      policy, nowMs: NOW,
    });
    const steemDoses = plan.drafts.filter((d) => d.asset === 'STEEM').length;
    expect(steemDoses).toBe(policy.maxDosesPerReceiver);
  });
});

describe('liquid-fuel: the ARMED-LAW gate (exec-armed honesty)', () => {
  test('every draft carries broadcast:false and the measured law verdict', () => {
    const plan = planLiquidFuel({
      roster: ['headcorner', 'saos-0004'],
      measures: [bal('headcorner', 50_000_000, 5_000_000), bal('saos-0004', 100_000, 20_000)],
      policy, nowMs: NOW,
    });
    expect(plan.drafts.length).toBeGreaterThan(0);
    for (const d of plan.drafts) {
      expect(d.broadcast).toBe(false);
      // measured exec-armed: allowTransfersOut=false and the delegatee allowlist
      // excludes saos-0004 — so funding saos-0004 is lawGate 'pending-exec-armed-allowlist'
      expect(d.lawGate).toBe('pending-exec-armed-allowlist');
    }
    expect(plan.lawSummary.armedTransfersOut).toBe(false);
    expect(plan.lawSummary.allowlistCoversSaos0004).toBe(false);
  });

  test('an armed, allowlisted world marks drafts armed (gate reflects the law, not the lane)', () => {
    const armedPolicy: LiquidFuelPolicy = {
      ...policy,
      armedLaw: { ...policy.armedLaw, allowTransfersOut: true, transferAllowlist: ['saos-0004'] },
    };
    const plan = planLiquidFuel({
      roster: ['headcorner', 'saos-0004'],
      measures: [bal('headcorner', 50_000_000, 5_000_000), bal('saos-0004', 100_000, 20_000)],
      policy: armedPolicy, nowMs: NOW,
    });
    for (const d of plan.drafts) expect(d.lawGate).toBe('armed');
    // broadcast stays false REGARDLESS — this lane never broadcasts (custody-gated executor only)
    for (const d of plan.drafts) expect(d.broadcast).toBe(false);
  });
});
