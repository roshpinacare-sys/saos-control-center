// ═══ rc-rebalance · execute — delegation op DRAFTS for the custody-gated pipeline ═══
// THIS SERVICE NEVER BROADCASTS AND NEVER TOUCHES KEY MATERIAL.
// army-keys.json custody is GATED (rot1-restore pathway, fleet vault scrypt/GCM) —
// we stay strictly on the consumption side: a plan's moves become chain-shaped
// `delegate_vesting_shares` op DRAFTS, marked broadcast:false and bound to the
// deterministic planId, written atomically for the existing custody-gated
// executor to review/consume. Idempotent: the same planId never rewrites the
// file. An empty plan writes nothing (honest noop).

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DelegationMove, RebalancePlan } from './planner';

export interface DelegationDraft {
  seq: number;
  op: 'delegate_vesting_shares';
  delegator: string;
  delegatee: string;
  /** Chain format "N.NNNNNN VESTS" (the condenser wire shape). */
  vesting_shares: string;
  planId: string;
  broadcast: false;
}

export interface DelegationDraftFile {
  schema: 'saos.rc-drafts/1';
  at: string;
  planId: string;
  broadcast: false;
  note: string;
  drafts: DelegationDraft[];
}

export function formatVests(microVests: number): string {
  return `${(microVests / 1e6).toFixed(6)} VESTS`;
}

export function buildDelegationDrafts(plan: RebalancePlan): DelegationDraft[] {
  return plan.moves.map((mv: DelegationMove) => ({
    seq: mv.seq,
    op: 'delegate_vesting_shares' as const,
    delegator: mv.from,
    delegatee: mv.to,
    vesting_shares: formatVests(mv.vests),
    planId: plan.planId,
    broadcast: false as const,
  }));
}

export interface DraftWriteResult { wrote: boolean; count: number; planId: string; path: string }

/** Atomic (tmp+rename) draft write; skips the rewrite when the planId is unchanged. */
export async function writeDelegationDrafts(plan: RebalancePlan, draftsPath: string): Promise<DraftWriteResult> {
  if (plan.moves.length === 0) return { wrote: false, count: 0, planId: plan.planId, path: draftsPath };

  try {
    const existing = await readFile(draftsPath, 'utf8');
    const parsed = JSON.parse(existing) as DelegationDraftFile;
    if (parsed.planId === plan.planId) {
      return { wrote: false, count: parsed.drafts.length, planId: plan.planId, path: draftsPath };
    }
  } catch {
    // no file / unreadable → proceed to write (the honest path)
  }

  const envelope: DelegationDraftFile = {
    schema: 'saos.rc-drafts/1',
    at: new Date().toISOString(),
    planId: plan.planId,
    broadcast: false,
    note: 'DRAFTS ONLY — produced by mini-services/rc-rebalance for the custody-gated executor. This service never signs, never broadcasts, never touches key material. Review, then route through the existing candidateSets/custody pipeline.',
    drafts: buildDelegationDrafts(plan),
  };

  await mkdir(dirname(draftsPath), { recursive: true });
  const tmp = `${draftsPath}.tmp`;
  await writeFile(tmp, JSON.stringify(envelope, null, 2), { mode: 0o600 });
  await rename(tmp, draftsPath); // atomic — the fleet's rename discipline
  return { wrote: true, count: envelope.drafts.length, planId: plan.planId, path: draftsPath };
}
