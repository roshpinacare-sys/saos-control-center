// ═══ rc-rebalance · measure — the honest chain-reader (§2.3) ══════════════════
// Fetches REAL account mana/RC + vesting ledger from a configurable graphene RPC
// (env RC_REBALANCE_RPC_URL — default the public steem endpoint; no secrets —
// this is public read-only chain data). Two canon calls per beat:
//   · rc_api.find_rc_accounts        → rc_manabar.current_mana / max_rc / last_update_time
//   · condenser_api.get_accounts     → vesting_shares / delegated_vesting_shares / received_vesting_shares
//
// FAIL-HONEST: any failure (transport, malformed, absent account, rc_api down)
// surfaces as source:'missing' with a reason — numbers are NEVER fabricated.
// The planner fail-closes on any missing/stale roster member (law (d)).
//
// The mana regen projection is the fleet canon measured in scripts/fuel-state.ts:
//   effective = min(max, current + max/432000 × elapsedSeconds)   (5-day bar)

import type { SoldierMeasure } from './planner';

export interface MeasureConfig {
  rpcUrl: string;
  nowMs: number;
  timeoutMs?: number;
}

const REGEN_SECONDS = 432_000; // 5 days — the graphene RC regen bar (fleet canon)

/** "123.456789 VESTS" → integer µVESTS. Garbage → 0 (honest zero, never NaN). */
export function parseVests(raw: string): number {
  const n = Number.parseFloat(String(raw ?? '').replace(/\s*VESTS\s*$/i, ''));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1e6);
}

/** Fleet-canon manabar projection, integer µVESTS, clamped at max. */
export function projectMana(current: number, max: number, lastUpdateTimeSec: number, nowMs: number): number {
  if (max <= 0) return 0;
  const elapsedSec = Math.max(0, Math.floor(nowMs / 1000) - (Number.isFinite(lastUpdateTimeSec) ? lastUpdateTimeSec : 0));
  return Math.min(max, current + Math.floor((max / REGEN_SECONDS) * elapsedSec));
}

interface RcRow { account?: unknown; rc_manabar?: { current_mana?: unknown; last_update_time?: unknown }; max_rc?: unknown }
interface CondenserRow { name?: unknown; vesting_shares?: unknown; delegated_vesting_shares?: unknown; received_vesting_shares?: unknown }

async function jrpc<T>(rpcUrl: string, method: string, params: unknown, timeoutMs: number): Promise<T | null> {
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'SAOS-RC-Rebalance/1.0 (+soldier-fuel-mesh)' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { result?: T };
    if (j.result === undefined || j.result === null) return null;
    return j.result;
  } catch {
    return null;
  }
}

function missing(account: string, reason: string, nowMs: number): SoldierMeasure {
  return { account, chain: 'steem', rcPct: null, vestingShares: 0, delegatedOut: 0, receivedIn: 0, measuredAtMs: nowMs, source: 'missing', reason };
}

/** Measure the roster in ONE beat (2 RPC calls total — polite to public nodes). */
export async function measureSoldiers(accounts: string[], cfg: MeasureConfig): Promise<{ ok: boolean; rpcUrl: string; atMs: number; measures: SoldierMeasure[] }> {
  const timeoutMs = cfg.timeoutMs ?? 12_000;
  const nowMs = cfg.nowMs;

  const rcRes = await jrpc<{ rc_accounts?: RcRow[] }>(cfg.rpcUrl, 'rc_api.find_rc_accounts', { accounts }, timeoutMs);
  const condRes = await jrpc<CondenserRow[]>(cfg.rpcUrl, 'condenser_api.get_accounts', [accounts], timeoutMs);

  const rcBy = new Map<string, RcRow>((rcRes?.rc_accounts ?? []).map((r) => [String(r.account), r]));
  const condBy = new Map<string, CondenserRow>((condRes ?? []).map((r) => [String(r.name), r]));

  const measures: SoldierMeasure[] = accounts.map((account) => {
    if (!rcRes && !condRes) return missing(account, `rpc unreachable/malformed at ${cfg.rpcUrl}`, nowMs);
    const cond = condBy.get(account);
    if (!cond) return missing(account, `absent from chain response (condenser_api)`, nowMs);

    const vestingShares = parseVests(String(cond.vesting_shares ?? ''));
    const delegatedOut = parseVests(String(cond.delegated_vesting_shares ?? ''));
    const receivedIn = parseVests(String(cond.received_vesting_shares ?? ''));

    const rc = rcBy.get(account);
    if (!rc) {
      // vests are real (condenser said so); mana is honestly unmeasurable this beat
      return { account, chain: 'steem', rcPct: null, vestingShares, delegatedOut, receivedIn, measuredAtMs: nowMs, source: 'missing', reason: 'rc_api row absent — mana unmeasurable' };
    }
    const current = Math.max(0, Math.floor(Number(rc.rc_manabar?.current_mana ?? 0)) || 0);
    const max = Math.max(0, Math.floor(Number(rc.max_rc ?? 0)) || 0);
    if (max <= 0) {
      // vests are real; mana is not measurable — the planner will fail-closed on rcPct null
      return { account, chain: 'steem', rcPct: null, vestingShares, delegatedOut, receivedIn, measuredAtMs: nowMs, source: 'missing', reason: 'rc_api unavailable or max_rc<=0 — mana unmeasurable' };
    }
    const last = Number(rc.rc_manabar?.last_update_time ?? 0) || 0;
    const eff = projectMana(current, max, last, nowMs);
    const rcPct = Math.round((100 * eff) / max * 100) / 100;
    return { account, chain: 'steem', rcPct, vestingShares, delegatedOut, receivedIn, measuredAtMs: nowMs, source: 'chain' };
  });

  return { ok: measures.every((m) => m.source === 'chain'), rpcUrl: cfg.rpcUrl, atMs: nowMs, measures };
}
