// ═══ armed-policy · the measured exec-armed delegation law (G78-a §2.3, TDD) ═══
// Laws under test:
//   1. unarmed / allowDelegation=false → EVERY move refused (fail-closed);
//   2. delegator must be allowlisted AND never a custody-wounded (recipient-only) body;
//   3. recipient must be allowlisted (wounded bodies DO receive — they just cannot broadcast);
//   4. self-delegation refused;
//   5. maxOpsPerCycle cap — deterministic first-wins;
//   6. master keep-gate — @headcorner's cycle outflow never crosses its ≥40% keep floor;
//   7. lawFromExecArmed — measured projection (allowlist, wounds, caps, keep %, honest defaults);
//   8. loadExecArmedLaw — unreadable file → fail-closed unarmed law (never a crash).
// SECRETS LAW: zero key material anywhere in this suite — policy metadata only.

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  applyArmedLaw,
  lawFromExecArmed,
  loadExecArmedLaw,
  MASTER_ACCOUNT,
  RECIPIENT_ONLY_SOLDIERS,
  type ArmedLedgerRow,
  type ExecArmedJson,
} from './armed-policy';
import type { DelegationMove } from './planner';

const WORK = mkdtempSync(join(tmpdir(), 'rc-armed-'));
const mv = (from: string, to: string, vests: number, seq = 1): DelegationMove => ({ from, to, vests, seq });

const ARMED: ExecArmedJson = {
  armed: true,
  maxOpsPerCycle: 60,
  minRcPct: 20,
  policy: {
    allowDelegation: true,
    delegationAllowlist: ['headcorner', 'cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq', 'hcsoldier4', 'hcsoldier5', 'hcsoldier6'],
    delegationLaw: 'internal-reinforcement-only: delegator=headcorner, delegatee∈roster, amounts bounded by the ≥40% master keep-gate',
  },
};

const ledger = (rows: Array<[string, number, number]>): ArmedLedgerRow[] =>
  rows.map(([account, vestingShares, delegatedOut]) => ({ account, vestingShares, delegatedOut }));

describe('lawFromExecArmed — the measured projection', () => {
  test('measured exec-armed verdict → armed law with allowlist minus recipient-only delegators', () => {
    const law = lawFromExecArmed(ARMED, 'test-source');
    expect(law.armed).toBe(true);
    expect(law.allowDelegation).toBe(true);
    expect(law.recipients).toHaveLength(14); // the full 14-body roster
    expect(law.delegators).toHaveLength(11); // minus haran/lsa/siq (recipient-only)
    for (const w of RECIPIENT_ONLY_SOLDIERS) expect(law.delegators).not.toContain(w);
    expect(law.maxOpsPerCycle).toBe(60);
    expect(law.minRcPct).toBe(20);
    expect(law.masterKeepPct).toBe(40); // measured from the ≥40% keep-gate note
    expect(law.source).toBe('test-source');
  });

  test('null/unreadable input → honest unarmed law (refuses everything)', () => {
    const law = lawFromExecArmed(null, 'unreadable:x');
    expect(law.armed).toBe(false);
    expect(law.allowDelegation).toBe(false);
    expect(law.delegators).toEqual([]);
    expect(law.recipients).toEqual([]);
    expect(law.note).toContain('fail-closed');
  });

  test('armed=true but allowDelegation=false → law refuses (two-switch law)', () => {
    const law = lawFromExecArmed({ ...ARMED, policy: { ...ARMED.policy, allowDelegation: false } });
    expect(law.armed).toBe(true);
    expect(law.allowDelegation).toBe(false);
  });

  test('missing numeric fields fall back to honest defaults (never NaN/0-doses)', () => {
    const law = lawFromExecArmed({ armed: true, policy: { allowDelegation: true, delegationAllowlist: ['headcorner'] } });
    expect(law.maxOpsPerCycle).toBe(60);
    expect(law.minRcPct).toBe(20);
    expect(law.masterKeepPct).toBe(40);
  });
});

describe('applyArmedLaw — the pure move filter', () => {
  test('(1) unarmed law refuses ALL moves with the honest reason', () => {
    const law = lawFromExecArmed(null);
    const v = applyArmedLaw([mv('headcorner', 'tov', 5_000_000)], law, ledger([[MASTER_ACCOUNT, 100_000_000, 0]]));
    expect(v.armedOk).toBe(false);
    expect(v.allowed).toEqual([]);
    expect(v.refused).toHaveLength(1);
    expect(v.refused[0].reason).toContain('exec-armed not armed');
  });

  test('(2a) wounded delegator (haran) refused — recipient-only custody law', () => {
    const law = lawFromExecArmed(ARMED);
    const v = applyArmedLaw([mv('haran', 'tov', 1_000_000)], law, ledger([['haran', 10_000_000, 0]]));
    expect(v.allowed).toEqual([]);
    expect(v.refused[0].reason).toContain('custody-wounded');
    expect(v.refused[0].reason).toContain('cannot broadcast');
  });

  test('(2b) non-allowlisted delegator refused', () => {
    const law = lawFromExecArmed(ARMED);
    const v = applyArmedLaw([mv('stranger', 'tov', 1_000_000)], law, ledger([]));
    expect(v.allowed).toEqual([]);
    expect(v.refused[0].reason).toContain('not in exec-armed delegationAllowlist');
  });

  test('(2c) census-measured BLOCKED-honest delegator refused (vault behind chain — cannot broadcast)', () => {
    const law = lawFromExecArmed(ARMED); // headcorner IS allowlisted…
    const rows = ledger([[MASTER_ACCOUNT, 10_000_000, 0]]).map((r) => ({ ...r, vaultValid: false })); // …but measured BLOCKED
    const v = applyArmedLaw([mv('headcorner', 'tov', 1_000_000)], law, rows);
    expect(v.allowed).toEqual([]);
    expect(v.refused[0].reason).toContain('BLOCKED-honest');
    expect(v.refused[0].reason).toContain('cannot broadcast');
  });

  test('(2d) census-verified vault-valid delegator passes the custody gate', () => {
    const law = lawFromExecArmed(ARMED);
    const rows = ledger([['cashmachine', 10_000_000, 0]]).map((r) => ({ ...r, vaultValid: true }));
    const v = applyArmedLaw([mv('cashmachine', 'tov', 1_000_000)], law, rows);
    expect(v.allowed).toHaveLength(1);
  });

  test('(3) non-allowlisted recipient refused; allowlisted wounded recipient ACCEPTED', () => {
    const law = lawFromExecArmed(ARMED);
    const rows = ledger([[MASTER_ACCOUNT, 1_000_000_000, 0]]);
    const bad = applyArmedLaw([mv('headcorner', 'outsider', 1_000_000)], law, rows);
    expect(bad.allowed).toEqual([]);
    expect(bad.refused[0].reason).toContain('recipient outsider not in exec-armed delegationAllowlist');

    const ok = applyArmedLaw([mv('headcorner', 'haran', 1_000_000)], law, rows); // wounded body as RECIPIENT
    expect(ok.allowed).toHaveLength(1);
    expect(ok.refused).toEqual([]);
  });

  test('(4) self-delegation refused', () => {
    const law = lawFromExecArmed(ARMED);
    const v = applyArmedLaw([mv('headcorner', 'headcorner', 1_000_000)], law, ledger([[MASTER_ACCOUNT, 1_000_000_000, 0]]));
    expect(v.allowed).toEqual([]);
    expect(v.refused[0].reason).toContain('self-delegation');
  });

  test('(5) maxOpsPerCycle cap — first-wins deterministic, remainder refused honestly', () => {
    const law = { ...lawFromExecArmed(ARMED), maxOpsPerCycle: 3 };
    const moves = [mv('headcorner', 'tov', 100, 1), mv('headcorner', 'wic', 100, 2), mv('headcorner', 'wog', 100, 3), mv('headcorner', 'woq', 100, 4)];
    const v = applyArmedLaw(moves, law, ledger([[MASTER_ACCOUNT, 1_000_000_000, 0]]));
    expect(v.allowed).toHaveLength(3);
    expect(v.refused).toHaveLength(1);
    expect(v.refused[0].reason).toContain('maxOpsPerCycle=3 cap');
  });

  test('(6) master keep-gate: outflow never crosses the 40% keep floor', () => {
    const law = lawFromExecArmed(ARMED); // keep 40% of 10M = 4M → max outflow 6M
    const rows = ledger([[MASTER_ACCOUNT, 10_000_000, 0]]);
    const within = applyArmedLaw([mv('headcorner', 'tov', 6_000_000, 1)], law, rows);
    expect(within.allowed).toHaveLength(1);
    const over = applyArmedLaw([mv('headcorner', 'tov', 6_000_000, 1), mv('headcorner', 'wic', 1_000_000, 2)], law, rows);
    expect(over.allowed).toHaveLength(1);
    expect(over.refused[0].reason).toContain('master keep-gate');
  });

  test('(6b) existing delegatedOut counts against the master keep floor', () => {
    const law = lawFromExecArmed(ARMED);
    // 10M vesting, 5.5M already delegated → cap leaves 0.5M; a 1M dose must refuse
    const v = applyArmedLaw([mv('headcorner', 'tov', 1_000_000)], law, ledger([[MASTER_ACCOUNT, 10_000_000, 5_500_000]]));
    expect(v.allowed).toEqual([]);
    expect(v.refused[0].reason).toContain('master keep-gate');
  });

  test('(6c) unknown master ledger → master may not delegate (fail-closed)', () => {
    const law = lawFromExecArmed(ARMED);
    const v = applyArmedLaw([mv('headcorner', 'tov', 1_000_000)], law, ledger([]));
    expect(v.allowed).toEqual([]);
    expect(v.refused[0].reason).toContain('master keep-gate');
  });

  test('non-master delegators are NOT subject to the master keep-gate (mesh freedom)', () => {
    const law = lawFromExecArmed(ARMED);
    const v = applyArmedLaw([mv('cashmachine', 'tov', 100)], law, ledger([['cashmachine', 1_000, 0], [MASTER_ACCOUNT, 0, 0]]));
    expect(v.allowed).toHaveLength(1);
  });
});

describe('loadExecArmedLaw — thin I/O, fail-closed', () => {
  test('a real exec-armed-shaped file loads armed with the measured roster', async () => {
    const p = join(WORK, 'armed.json');
    writeFileSync(p, JSON.stringify(ARMED));
    const { law, read } = await loadExecArmedLaw(p);
    expect(read).toBe(true);
    expect(law.armed).toBe(true);
    expect(law.recipients).toHaveLength(14);
    expect(law.source).toBe(p);
  });

  test('unreadable path → fail-closed unarmed law, never a throw', async () => {
    const { law, read } = await loadExecArmedLaw(join(WORK, 'does-not-exist.json'));
    expect(read).toBe(false);
    expect(law.armed).toBe(false);
    expect(law.allowDelegation).toBe(false);
    expect(law.delegators).toEqual([]);
  });

  test('foreign JSON shape → fail-closed unarmed law', async () => {
    const p = join(WORK, 'foreign.json');
    writeFileSync(p, '"just a string"');
    const { law, read } = await loadExecArmedLaw(p);
    expect(read).toBe(true);
    expect(law.armed).toBe(false); // parsed but no armed=true → honest refusal
  });
});
