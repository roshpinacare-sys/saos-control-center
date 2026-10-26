// ═══ rc-rebalance · execute — delegation op DRAFTS for the custody-gated pipeline (TDD) ═══
// LAWS: (1) this service NEVER broadcasts and NEVER touches key material —
//       army-keys custody is gated elsewhere (rot1-restore / fleet vault);
//       (2) drafts are chain-shaped `delegate_vesting_shares` op DRAFTS, marked
//       broadcast:false, tied to the deterministic planId; (3) writes are atomic
//       (tmp+rename) and idempotent — the same planId never rewrites the file;
//       (4) an empty plan writes nothing (honest noop).

import { describe, expect, test } from 'bun:test';
import { buildDelegationDrafts, writeDelegationDrafts, type DelegationDraftFile } from './execute';
import { planRebalance, type RebalancePolicy, type SoldierMeasure } from './planner';
import { mkdtempSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NOW = 1_700_000_200_000;
const WORK = mkdtempSync(join(tmpdir(), 'rc-execute-')); // /tmp is wiped between runs; bun tmpdir is per-process — fine for a test

const POLICY: RebalancePolicy = {
  floorPct: 20, targetPct: 60, ceilingPct: 85,
  doseVests: 1_000_000, maxDosesPerReceiver: 1, reservationVests: 0, maxStaleMs: 15 * 60_000,
};

function measures(): SoldierMeasure[] {
  return [
    { account: 'whale', chain: 'steem', rcPct: 99, vestingShares: 10_000_000, delegatedOut: 0, receivedIn: 0, measuredAtMs: NOW - 1000, source: 'chain' },
    { account: 'thirsty', chain: 'steem', rcPct: 10, vestingShares: 1_000_000, delegatedOut: 0, receivedIn: 0, measuredAtMs: NOW - 1000, source: 'chain' },
  ];
}

describe('execute: drafts (no broadcast law)', () => {
  test('buildDelegationDrafts: 1:1 with plan moves, chain-format shares, broadcast:false, planId bound', () => {
    const plan = planRebalance({ roster: ['whale', 'thirsty'], measures: measures(), policy: POLICY, nowMs: NOW });
    expect(plan.moves.length).toBe(1);
    const drafts = buildDelegationDrafts(plan);
    expect(drafts.length).toBe(1);
    expect(drafts[0]).toEqual({
      seq: 1,
      op: 'delegate_vesting_shares',
      delegator: 'whale',
      delegatee: 'thirsty',
      vesting_shares: '1.000000 VESTS',
      planId: plan.planId,
      broadcast: false,
    });
  });

  test('writeDelegationDrafts: atomic file with honest envelope; no secret fields', async () => {
    const plan = planRebalance({ roster: ['whale', 'thirsty'], measures: measures(), policy: POLICY, nowMs: NOW });
    const out = join(WORK, 'drafts-a.json');
    const res = await writeDelegationDrafts(plan, out);
    expect(res.wrote).toBe(true);
    expect(res.count).toBe(1);
    const parsed = JSON.parse(readFileSync(out, 'utf8')) as DelegationDraftFile;
    expect(parsed.schema).toBe('saos.rc-drafts/1');
    expect(parsed.broadcast).toBe(false);
    expect(parsed.planId).toBe(plan.planId);
    expect(parsed.note).toContain('DRAFTS ONLY');
    expect(parsed.drafts.length).toBe(1);
    // structural secrecy: no key/secret material fields anywhere in the envelope
    const flat = JSON.stringify(parsed);
    expect(flat).not.toMatch(/wif|private|secret|scaf/i);
  });

  test('idempotence: the same planId skips the rewrite (byte-stable file)', async () => {
    const plan = planRebalance({ roster: ['whale', 'thirsty'], measures: measures(), policy: POLICY, nowMs: NOW });
    const out = join(WORK, 'drafts-b.json');
    const first = await writeDelegationDrafts(plan, out);
    expect(first.wrote).toBe(true);
    const before = statSync(out).mtimeMs;
    await new Promise((r) => setTimeout(r, 5));
    const second = await writeDelegationDrafts(plan, out);
    expect(second.wrote).toBe(false); // same planId → skip (idempotent beat loop)
    expect(statSync(out).mtimeMs).toBe(before);
  });

  test('empty plan → nothing written (honest noop)', async () => {
    const okMeasures = [
      { account: 'ok1', chain: 'steem' as const, rcPct: 70, vestingShares: 1_000_000, delegatedOut: 0, receivedIn: 0, measuredAtMs: NOW - 1000, source: 'chain' as const },
      { account: 'ok2', chain: 'steem' as const, rcPct: 70, vestingShares: 1_000_000, delegatedOut: 0, receivedIn: 0, measuredAtMs: NOW - 1000, source: 'chain' as const },
    ];
    const plan = planRebalance({ roster: ['ok1', 'ok2'], measures: okMeasures, policy: POLICY, nowMs: NOW });
    const out = join(WORK, 'drafts-c.json');
    const res = await writeDelegationDrafts(plan, out);
    expect(res.wrote).toBe(false);
    expect(res.count).toBe(0);
    expect(existsSync(out)).toBe(false);
  });
});
