// ═══ liquid-fuel — the STEEM/SBD fuel-streaming DRAFT law (G77-a) ═══════════════
// Companion to planner.ts (RC/vesting delegation): liquid fuel moves by `transfer`.
// This module NEVER broadcasts, NEVER touches key material — it turns MEASURED
// balances into chain-shaped transfer DRAFTS (broadcast:false) bound to a
// deterministic planId, for the custody-gated executor.
//
// LAWS (tested in liquid-fuel.test.ts):
//  (a) MEASURED-ONLY — every amount derives from measured balances (µSTEEM/µSBD
//      integers). Nothing is invented; a missing/stale measurement fail-closes
//      the whole plan (law mirrors planner.ts (d)).
//  (b) KEEP-FLOOR  — a donor never drafts below its keep floor (donorKeepSteemM /
//      donorKeepSbdM); whole doses only.
//  (c) IDEMPOTENCE — pure function of (roster, measures, policy): same inputs ⇒
//      deep-equal plan and identical planId (clock excluded from the id).
//  (d) ARMED-LAW GATE — every draft carries the MEASURED exec-armed verdict:
//      lawGate 'armed' only when the policy says transfers are armed AND the
//      receiver is allowlisted; otherwise 'pending-exec-armed-allowlist'.
//      broadcast:false ALWAYS — even 'armed' drafts wait for the custody-gated
//      executor (this lane never signs).

import { createHash } from 'node:crypto';

/** Integer µSTEEM / µSBD (1 STEEM = 1e6 µSTEEM). */
export type MicroAmount = number;

export interface LiquidBalance {
  account: string;
  chain: 'steem' | 'hive' | 'blurt';
  /** liquid STEEM in µSTEEM */
  steemM: MicroAmount;
  /** liquid SBD in µSBD */
  sbdM: MicroAmount;
  measuredAtMs: number;
  source: 'chain' | 'missing';
  reason?: string;
}

export interface ArmedLaw {
  /** measured exec-armed.json policy.allowTransfersOut */
  allowTransfersOut: boolean;
  /** measured exec-armed.json policy.transferAllowlist */
  transferAllowlist: string[];
  /** measured exec-armed.json policy.delegationAllowlist (the body roster) */
  delegationAllowlist: string[];
  /** honest provenance note (when/how the law was measured) */
  note: string;
}

export interface LiquidFuelPolicy {
  /** a soldier measured below this (µSTEEM) is fuel-hungry */
  receiverMinSteemM: MicroAmount;
  /** a soldier measured below this (µSBD) is fuel-hungry */
  receiverMinSbdM: MicroAmount;
  /** a donor always keeps this much liquid STEEM (µSTEEM) */
  donorKeepSteemM: MicroAmount;
  /** a donor always keeps this much liquid SBD (µSBD) */
  donorKeepSbdM: MicroAmount;
  /** one transfer dose (µSTEEM) */
  doseSteemM: MicroAmount;
  /** one transfer dose (µSBD) */
  doseSbdM: MicroAmount;
  maxDosesPerReceiver: number;
  /** measurement older than this is stale → fail-closed */
  maxStaleMs: number;
  armedLaw: ArmedLaw;
}

export interface TransferDraft {
  seq: number;
  op: 'transfer';
  from: string;
  to: string;
  /** chain format "N.NNN STEEM" / "N.NNN SBD" (the condenser wire shape) */
  amount: string;
  asset: 'STEEM' | 'SBD';
  /** exact integer µ-amount (audit mirror of `amount`) */
  amountM: MicroAmount;
  planId: string;
  broadcast: false;
  lawGate: 'armed' | 'pending-exec-armed-allowlist';
}

export interface BlockedSoldier { account: string; reason: string }

export interface LiquidFuelPlan {
  ok: boolean;
  /** 'balanced' | 'moved' | 'no-viable-donors' | 'stale-or-absent-measurement' */
  reason: string;
  drafts: TransferDraft[];
  blocked: BlockedSoldier[];
  /** sha256 over the canon JSON of the plan CORE (roster+policy law+ledger+drafts) — clock-excluded */
  planId: string;
  nowMs: number;
  lawSummary: {
    armedTransfersOut: boolean;
    allowlistCoversSaos0004: boolean;
    note: string;
  };
}

/** Stable recursive key-sorted JSON (fleet canon — mirrors planner.ts canonJson). */
export function canonJsonOf(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonJsonOf).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const body = keys.map((k) => `${JSON.stringify(k)}:${canonJsonOf((value as Record<string, unknown>)[k])}`).join(',');
  return `{${body}}`;
}

export function planIdOf(core: unknown): string {
  return createHash('sha256').update(canonJsonOf(core)).digest('hex');
}

/** µ → chain format "N.NNN STEEM" (3 decimals — the condenser wire shape). */
export function formatAmount(micro: number, asset: 'STEEM' | 'SBD'): string {
  return `${(micro / 1e6).toFixed(3)} ${asset}`;
}

function validatePolicy(p: LiquidFuelPolicy): void {
  const fail = (why: string): never => {
    throw new Error(`liquid-fuel policy invalid (fail-closed): ${why}`);
  };
  if (!Number.isInteger(p.receiverMinSteemM) || p.receiverMinSteemM < 0) fail('receiverMinSteemM must be a non-negative integer');
  if (!Number.isInteger(p.receiverMinSbdM) || p.receiverMinSbdM < 0) fail('receiverMinSbdM must be a non-negative integer');
  if (!Number.isInteger(p.donorKeepSteemM) || p.donorKeepSteemM < 0) fail('donorKeepSteemM must be a non-negative integer');
  if (!Number.isInteger(p.donorKeepSbdM) || p.donorKeepSbdM < 0) fail('donorKeepSbdM must be a non-negative integer');
  if (!Number.isInteger(p.doseSteemM) || p.doseSteemM <= 0) fail('doseSteemM must be a positive integer');
  if (!Number.isInteger(p.doseSbdM) || p.doseSbdM <= 0) fail('doseSbdM must be a positive integer');
  if (!Number.isInteger(p.maxDosesPerReceiver) || p.maxDosesPerReceiver < 1) fail('maxDosesPerReceiver must be >= 1');
  if (!Number.isInteger(p.maxStaleMs) || p.maxStaleMs <= 0) fail('maxStaleMs must be a positive integer');
}

export interface LiquidFuelInput {
  roster: string[];
  measures: LiquidBalance[];
  policy: LiquidFuelPolicy;
  nowMs: number;
}

/**
 * THE liquid-fuel planner. Deterministic: driest receiver first (steem asc, sbd asc,
 * account asc tie-break), largest-holdings donor first (spare desc, account asc).
 */
export function planLiquidFuel(input: LiquidFuelInput): LiquidFuelPlan {
  const { roster, measures, policy, nowMs } = input;
  validatePolicy(policy);

  const lawSummary = {
    armedTransfersOut: policy.armedLaw.allowTransfersOut === true,
    allowlistCoversSaos0004: policy.armedLaw.delegationAllowlist.includes('saos-0004'),
    note: policy.armedLaw.note,
  };
  const planIdFor = (draftsCore: unknown, blockedCore: unknown) =>
    planIdOf({ roster, policy: { law: policy.armedLaw, doseSteemM: policy.doseSteemM, doseSbdM: policy.doseSbdM, keep: [policy.donorKeepSteemM, policy.donorKeepSbdM], mins: [policy.receiverMinSteemM, policy.receiverMinSbdM], maxDoses: policy.maxDosesPerReceiver }, ledger: measures.map((m) => ({ a: m.account, s: m.steemM, b: m.sbdM })), drafts: draftsCore, blocked: blockedCore });

  if (new Set(roster).size !== roster.length) {
    const blocked = [{ account: '*', reason: 'roster has duplicate entries (fail-closed)' }];
    return { ok: false, reason: 'stale-or-absent-measurement', drafts: [], blocked, planId: planIdFor([], blocked), nowMs, lawSummary };
  }

  const byName = new Map(measures.map((x) => [x.account, x]));

  // ── fail-closed on ANY absent / stale roster soldier ──
  const blocked: BlockedSoldier[] = [];
  for (const name of roster) {
    const m = byName.get(name);
    if (!m) {
      blocked.push({ account: name, reason: 'absent measurement — fail-closed (no plan is fabricated)' });
      continue;
    }
    if (m.measuredAtMs + policy.maxStaleMs <= nowMs) {
      blocked.push({ account: name, reason: `stale measurement (measuredAt=${m.measuredAtMs} + maxStaleMs=${policy.maxStaleMs} <= now=${nowMs})` });
      continue;
    }
    if (m.source !== 'chain') {
      blocked.push({ account: name, reason: `unmeasurable${m.reason ? `: ${m.reason}` : ''}` });
    }
  }
  if (blocked.length > 0) {
    return { ok: false, reason: 'stale-or-absent-measurement', drafts: [], blocked, planId: planIdFor([], blocked), nowMs, lawSummary };
  }

  const live = roster.map((n) => byName.get(n)!);

  // ── receivers: measured below the fuel floor (driest first, account tie-break) ──
  const receivers = live
    .filter((x) => x.steemM < policy.receiverMinSteemM || x.sbdM < policy.receiverMinSbdM)
    .sort((a, b) => (a.steemM - b.steemM) || (a.sbdM - b.sbdM) || a.account.localeCompare(b.account));

  // ── donors: spare above keep floors (largest first, account tie-break) ──
  const spareSteemOf = (x: LiquidBalance): MicroAmount => x.steemM - policy.donorKeepSteemM;
  const spareSbdOf = (x: LiquidBalance): MicroAmount => x.sbdM - policy.donorKeepSbdM;
  const donors = live
    .map((x) => ({ account: x.account, spareSteem: spareSteemOf(x), spareSbd: spareSbdOf(x) }))
    .filter((d) => d.spareSteem >= policy.doseSteemM || d.spareSbd >= policy.doseSbdM)
    .sort((a, b) => (b.spareSteem - a.spareSteem) || (b.spareSbd - a.spareSbd) || a.account.localeCompare(b.account));

  const drafts: TransferDraft[] = [];
  // doses are counted per (receiver, asset) — a soldier thirsty in both gets both
  const dosesByReceiver = new Map<string, number>();
  let seq = 0;

  for (const r of receivers) {
    for (const assetOfReceiver of ['STEEM', 'SBD'] as const) {
    let doses = dosesByReceiver.get(`${r.account}:${assetOfReceiver}`) ?? 0;
    while (doses < policy.maxDosesPerReceiver) {
      // prefer the asset the receiver is driest in; donor must have spare of that asset
      const asset: 'STEEM' | 'SBD' = assetOfReceiver;
      const donor = donors.find((d) => (asset === 'STEEM' ? d.spareSteem >= policy.doseSteemM : d.spareSbd >= policy.doseSbdM) && d.account !== r.account);
      if (!donor) break; // no viable donor remains — honest, not fabricated
      seq += 1;
      const amountM = asset === 'STEEM' ? policy.doseSteemM : policy.doseSbdM;
      const lawGate: TransferDraft['lawGate'] =
        lawSummary.armedTransfersOut && policy.armedLaw.transferAllowlist.includes(r.account) ? 'armed' : 'pending-exec-armed-allowlist';
      drafts.push({
        seq,
        op: 'transfer',
        from: donor.account,
        to: r.account,
        amount: formatAmount(amountM, asset),
        asset,
        amountM,
        planId: '', // bound below once planId is final
        broadcast: false,
        lawGate,
      });
      if (asset === 'STEEM') donor.spareSteem -= policy.doseSteemM;
      else donor.spareSbd -= policy.doseSbdM;
      doses += 1;
    }
    if (doses < policy.maxDosesPerReceiver && doses === 0) {
      blocked.push({ account: r.account, reason: `insufficient-donor-capacity for ${assetOfReceiver} (honest — no donor has a full dose above its keep floor)` });
    }
    dosesByReceiver.set(`${r.account}:${assetOfReceiver}`, doses);
    }
  }

  const reason = drafts.length > 0 ? 'moved' : receivers.length > 0 ? 'no-viable-donors' : 'balanced';
  const planId = planIdFor(drafts.map(({ planId: _omit, ...rest }) => rest), blocked);
  for (const d of drafts) d.planId = planId;

  return { ok: true, reason, drafts, blocked, planId, nowMs, lawSummary };
}
