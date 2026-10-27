// ═══ rc-rebalance · armed-policy — the measured exec-armed delegation law ═════
// Mission §2.3 (G78-a all-soldier mesh): real delegation ops are governed by the
// MEASURED exec-armed verdict (owner standing order 2026-09-29 + W118 volume-up
// 2026-10-21 + W119-REINFORCE-ARMED, trace web-39a3a21d). This module is the PURE
// projection of that verdict onto the rebalance mesh:
//
//  · armed + policy.allowDelegation must BOTH be true — otherwise every move is
//    refused (fail-closed; the mesh keeps planning, zero drafts go out armed);
//  · recipients ⊆ policy.delegationAllowlist (the 14-body roster);
//  · delegators ⊆ delegationAllowlist minus the RECIPIENT-ONLY custody-wounded
//    bodies (haran/lsa/siq — chain posting-authority mismatch, CUSTODY-WOUNDS.jsonl
//    trace 1a173ed9bed1a4b5): they may RECEIVE delegation but cannot broadcast;
//  · maxOpsPerCycle cap (measured 60);
//  · master keep-gate: @headcorner never delegates below its ≥40% keep floor
//    (exec-armed delegationLaw: "amounts bounded by the ≥40% master keep-gate");
//  · zero operator funding — moves only redistribute MEASURED vesting between
//    fleet bodies; nothing is ever minted or funded from outside the roster.
//
// SECRETS LAW: this module reads POLICY METADATA only. It never reads, derives,
// prints or stores key material. The custody-gated executor does its own
// verify-then-write against the live chain authorities.

import { readFile } from 'node:fs/promises';

import type { DelegationMove } from './planner';

/** The custody-wounded bodies (vault-behind-chain): recipient-only by law. */
export const RECIPIENT_ONLY_SOLDIERS = ['haran', 'lsa', 'siq'] as const;

/** The fleet master — its keep-gate is measured in percent of own vesting. */
export const MASTER_ACCOUNT = 'headcorner';

/** Loose shape of exec-armed.json (only the fields the law needs — never keys). */
export interface ExecArmedJson {
  armed?: unknown;
  maxOpsPerCycle?: unknown;
  minRcPct?: unknown;
  policy?: {
    allowDelegation?: unknown;
    delegationAllowlist?: unknown;
    delegationLaw?: unknown;
  } | null;
}

export interface ArmedDelegationLaw {
  armed: boolean;
  allowDelegation: boolean;
  /** bodies that may BROADCAST a delegation (allowlist minus recipient-only) */
  delegators: string[];
  /** bodies that may RECEIVE delegation (the full measured allowlist) */
  recipients: string[];
  maxOpsPerCycle: number;
  /** measured RC floor (exec-armed minRcPct — 20..25 band per directive §2.3) */
  minRcPct: number;
  /** @headcorner keeps at least this % of its own vesting undelegated */
  masterKeepPct: number;
  /** honest provenance: where the law was measured from (path or 'unarmed') */
  source: string;
  note: string;
}

export const DEFAULT_MASTER_KEEP_PCT = 40;
export const DEFAULT_MAX_OPS_PER_CYCLE = 60;
export const DEFAULT_MIN_RC_PCT = 20;

const num = (v: unknown, d: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : d;
};
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];

/** Thin I/O loader: read the exec-armed policy file (METADATA only), project to law.
 *  Any failure (missing/unreadable/foreign JSON) → honest unarmed law (fail-closed). */
export async function loadExecArmedLaw(path: string): Promise<{ law: ArmedDelegationLaw; read: boolean }> {
  try {
    const raw = await readFile(path, 'utf8');
    const j = JSON.parse(raw) as ExecArmedJson;
    return { law: lawFromExecArmed(j, path), read: true };
  } catch (e) {
    return {
      law: lawFromExecArmed(null, `unreadable:${path}:${e instanceof Error ? e.message.slice(0, 60) : 'unknown'}`),
      read: false,
    };
  }
}

/** Thin I/O loader: the measured census custody verdicts (account → vaultValid).
 *  Any failure → empty map (verdicts unknown; the executor's verify-then-write stays the last line). */
export async function loadCensusVaultVerdicts(path: string): Promise<Map<string, boolean>> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as { soldiers?: Array<{ account?: unknown; custody?: unknown }> };
    const out = new Map<string, boolean>();
    for (const s of raw.soldiers ?? []) {
      const account = String(s.account ?? '');
      if (account) out.set(account, s.custody === 'VAULT-VALID');
    }
    return out;
  } catch {
    return new Map();
  }
}

/** PURE projection of the measured exec-armed JSON onto the delegation law.
 *  Accepts null (file unreadable) → honest UNARMED law (refuses everything). */
export function lawFromExecArmed(j: ExecArmedJson | null, source = 'unarmed'): ArmedDelegationLaw {
  if (!j || typeof j !== 'object') {
    return {
      armed: false,
      allowDelegation: false,
      delegators: [],
      recipients: [],
      maxOpsPerCycle: DEFAULT_MAX_OPS_PER_CYCLE,
      minRcPct: DEFAULT_MIN_RC_PCT,
      masterKeepPct: DEFAULT_MASTER_KEEP_PCT,
      source,
      note: 'exec-armed policy unreadable — fail-closed, zero delegation moves allowed',
    };
  }
  const allowlist = strList(j.policy?.delegationAllowlist);
  const delegationLaw = typeof j.policy?.delegationLaw === 'string' ? j.policy.delegationLaw : '';
  // master keep-gate is measured from the delegationLaw note (≥40%), default 40
  const keepMatch = /(\d{1,3})\s*%\s*master\s*keep/.exec(delegationLaw);
  const masterKeepPct = keepMatch ? Math.min(100, Math.max(0, Number(keepMatch[1]))) : DEFAULT_MASTER_KEEP_PCT;
  return {
    armed: j.armed === true,
    allowDelegation: j.policy?.allowDelegation === true,
    delegators: allowlist.filter((a) => !(RECIPIENT_ONLY_SOLDIERS as readonly string[]).includes(a)),
    recipients: allowlist,
    maxOpsPerCycle: num(j.maxOpsPerCycle, DEFAULT_MAX_OPS_PER_CYCLE),
    minRcPct: num(j.minRcPct, DEFAULT_MIN_RC_PCT),
    masterKeepPct,
    source,
    note: delegationLaw || 'no delegationLaw note in exec-armed',
  };
}

export interface RefusedMove { from: string; to: string; vests: number; reason: string }

export interface ArmedLedgerRow { account: string; vestingShares: number; delegatedOut: number; /** measured census custody (G78-a): false = BLOCKED-honest → never a delegator */ vaultValid?: boolean }

export interface ArmedLawVerdict {
  allowed: DelegationMove[];
  refused: RefusedMove[];
  /** the law verdict itself, verbatim for receipts/state */
  armedOk: boolean;
}

/**
 * PURE armed-law filter over a planner output. Laws (each tested):
 *  (1) armed && allowDelegation — else ALL moves refused (fail-closed);
 *  (2) delegator ∈ law.delegators (allowlist, never recipient-only wounded);
 *  (3) recipient ∈ law.recipients;
 *  (4) self-delegation refused;
 *  (5) maxOpsPerCycle — the FIRST lawfully-allowed moves win (deterministic:
 *      planner order), the remainder refused with the cap reason;
 *  (6) master keep-gate — for the master account, the cycle's cumulative outflow
 *      never pushes its delegated-out past (100 − masterKeepPct)% of its own
 *      vesting ledger (exact µVESTS math over the MEASURED ledger rows).
 */
export function applyArmedLaw(
  moves: DelegationMove[],
  law: ArmedDelegationLaw,
  ledger: ArmedLedgerRow[],
): ArmedLawVerdict {
  const refused: RefusedMove[] = [];
  if (!law.armed || !law.allowDelegation) {
    const reason = !law.armed
      ? `exec-armed not armed (measured from ${law.source})`
      : 'exec-armed policy.allowDelegation=false — delegation lane closed';
    return { allowed: [], refused: moves.map((m) => ({ ...m, reason })), armedOk: false };
  }

  const delegators = new Set(law.delegators);
  const recipients = new Set(law.recipients);
  const ledgerBy = new Map(ledger.map((r) => [r.account, r]));

  // master keep-gate state: cumulative outflow of the master within this cycle
  const masterOutflowCap = (() => {
    const row = ledgerBy.get(MASTER_ACCOUNT);
    if (!row || row.vestingShares <= 0) return 0; // unknown ledger → nothing may flow from master
    const keep = Math.floor((row.vestingShares * law.masterKeepPct) / 100);
    return Math.max(0, row.vestingShares - keep - row.delegatedOut);
  })();
  let masterOutflow = 0;

  const allowed: DelegationMove[] = [];
  for (const mv of moves) {
    const refuse = (reason: string) => refused.push({ from: mv.from, to: mv.to, vests: mv.vests, reason });
    if (mv.from === mv.to) { refuse('self-delegation is a no-op (refused)'); continue; }
    if (ledgerBy.get(mv.from)?.vaultValid === false) {
      refuse(`delegator ${mv.from} is measured BLOCKED-honest in the soldier census (vault behind chain — cannot broadcast)`);
      continue;
    }
    if (!delegators.has(mv.from)) {
      refuse(
        (RECIPIENT_ONLY_SOLDIERS as readonly string[]).includes(mv.from)
          ? `delegator ${mv.from} is custody-wounded (recipient-only by law — cannot broadcast)`
          : `delegator ${mv.from} not in exec-armed delegationAllowlist`,
      );
      continue;
    }
    if (!recipients.has(mv.to)) { refuse(`recipient ${mv.to} not in exec-armed delegationAllowlist`); continue; }
    if (allowed.length >= law.maxOpsPerCycle) {
      refuse(`maxOpsPerCycle=${law.maxOpsPerCycle} cap reached (honest — remaining moves wait for the next beat)`);
      continue;
    }
    if (mv.from === MASTER_ACCOUNT) {
      if (masterOutflow + mv.vests > masterOutflowCap) {
        refuse(`master keep-gate: outflow would push @${MASTER_ACCOUNT} below its ${law.masterKeepPct}% keep floor`);
        continue;
      }
      masterOutflow += mv.vests;
    }
    allowed.push(mv);
  }
  return { allowed, refused, armedOk: true };
}
