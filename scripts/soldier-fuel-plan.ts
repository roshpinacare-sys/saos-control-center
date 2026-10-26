// ═══ soldier-fuel-plan — G77-a fuel-streaming plan (measured → DRAFT, broadcast:false) ═══
// One beat of the fuel mesh for the FULL grid roster:
//   repo canon (SOLDIER_ROSTER — headcorner + 10 ROT1 + saos-0004)
//   ∪ exec-armed delegationAllowlist extras (hcsoldier4/5/6) = 15 accounts.
// Outputs (ALL broadcast:false, ALL amounts measured, planId=sha256, atomic writes):
//   · delegation DRAFTS (repo execute.ts law)     → mini-services/rc-rebalance/state/delegation-drafts.json
//   · liquid-fuel transfer DRAFTS + full envelope → mini-services/rc-rebalance/state/fuel-plan.json
// Chain reads are STEEM-PINNED (api.steemit.com) — the mesh bridge :3053 run-copy
// carries no x-mesh-chain pinning (measured), and steem-only soldiers answer
// silently-empty from hive-side nodes (measured G76-i).
// Zero key material is read, needed, or touched. This lane NEVER broadcasts.
import { mkdirSync, writeFileSync, renameSync, readFileSync, existsSync, statSync } from 'node:fs';

import { measureSoldiers } from '../mini-services/rc-rebalance/measure';
import { planRebalance, type RebalancePolicy, type SoldierMeasure } from '../mini-services/rc-rebalance/planner';
import { writeDelegationDrafts } from '../mini-services/rc-rebalance/execute';
import { planLiquidFuel, type LiquidBalance, type LiquidFuelPolicy } from '../mini-services/rc-rebalance/liquid-fuel';
import { SOLDIER_ROSTER } from '../src/lib/soldier-activation';

const STATE_DIR = 'mini-services/rc-rebalance/state';
const EXEC_ARMED = '/home/z/coord-work/vaults/steem-secrets/exec-armed.json';
const RPC = process.env.RC_REBALANCE_RPC_URL ?? 'https://api.steemit.com';

// ── measured armed law (the real file, or honest absence) ──
function measureArmedLaw(): LiquidFuelPolicy['armedLaw'] {
  try {
    const raw = JSON.parse(readFileSync(EXEC_ARMED, 'utf8')) as {
      policy?: { allowTransfersOut?: boolean; transferAllowlist?: string[]; delegationAllowlist?: string[] };
    };
    return {
      allowTransfersOut: raw.policy?.allowTransfersOut === true,
      transferAllowlist: raw.policy?.transferAllowlist ?? [],
      delegationAllowlist: raw.policy?.delegationAllowlist ?? [],
      note: `measured from ${EXEC_ARMED} (mtime ${statSync(EXEC_ARMED).mtime.toISOString()})`,
    };
  } catch (e) {
    return {
      allowTransfersOut: false,
      transferAllowlist: [],
      delegationAllowlist: [],
      note: `exec-armed.json UNREADABLE (${e instanceof Error ? e.message : String(e)}) — law gate defaults to DENY (fail-closed)`,
    };
  }
}

// ── repo canon roster ∪ exec-armed body roster (additive, deduped, deterministic) ──
function fullRoster(): string[] {
  const armed = measureArmedLaw();
  const set = new Set<string>([...SOLDIER_ROSTER]);
  for (const name of armed.delegationAllowlist) set.add(name);
  return [...set].sort();
}

async function jrpc<T>(method: string, params: unknown, timeoutMs = 15000): Promise<T | null> {
  try {
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'SAOS-G77a-fuel-plan/1.0 (+rc-rebalance)' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { result?: T };
    return j.result ?? null;
  } catch {
    return null;
  }
}

interface CondenserRow { name?: unknown; balance?: unknown; sbd_balance?: unknown }

const microOf = (raw: unknown, unit: string): number => {
  const n = Number.parseFloat(String(raw ?? '').replace(new RegExp(`\\s*${unit}\\s*$`, 'i'), ''));
  return Number.isFinite(n) ? Math.round(n * 1e6) : 0;
};

function atomicWrite(path: string, data: string, mode: number = 0o600): void {
  mkdirSync(STATE_DIR, { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, data, { mode });
  renameSync(tmp, path);
}

const nowMs = Date.now();
const roster = fullRoster();
const armedLaw = measureArmedLaw();

// ── RC measurement (repo measure.ts law — 2 RPC calls) ──
const measured = await measureSoldiers(roster, { rpcUrl: RPC, nowMs });

// ── liquid balances (1 more condenser call, same pin) ──
const cond = await jrpc<CondenserRow[]>('condenser_api.get_accounts', [roster]);
const condBy = new Map<string, CondenserRow>((cond ?? []).map((r) => [String(r.name), r]));
const liquid: LiquidBalance[] = roster.map((account) => {
  const row = condBy.get(account);
  if (!row) {
    return { account, chain: 'steem', steemM: 0, sbdM: 0, measuredAtMs: nowMs, source: 'missing' as const, reason: 'absent from chain response (condenser_api)' };
  }
  return {
    account, chain: 'steem',
    steemM: microOf(row.balance, 'STEEM'),
    sbdM: microOf(row.sbd_balance, 'SBD'),
    measuredAtMs: nowMs,
    source: 'chain' as const,
  };
});

// ── policies (repo defaults + measured armed law) ──
const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};
const rcPolicy: RebalancePolicy = {
  floorPct: num(process.env.RC_REBALANCE_FLOOR_PCT, 20),
  targetPct: num(process.env.RC_REBALANCE_TARGET_PCT, 60),
  ceilingPct: num(process.env.RC_REBALANCE_CEILING_PCT, 85),
  doseVests: num(process.env.RC_REBALANCE_DOSE_VESTS, 10_000_000_000),
  maxDosesPerReceiver: num(process.env.RC_REBALANCE_MAX_DOSES, 2),
  reservationVests: num(process.env.RC_REBALANCE_RESERVATION_VESTS, 10_000_000_000),
  maxStaleMs: num(process.env.RC_REBALANCE_MAX_STALE_MS, 900_000),
};
const liquidPolicy: LiquidFuelPolicy = {
  receiverMinSteemM: 500_000,
  receiverMinSbdM: 100_000,
  donorKeepSteemM: 1_000_000,
  donorKeepSbdM: 200_000,
  doseSteemM: 300_000,
  doseSbdM: 50_000,
  maxDosesPerReceiver: 2,
  maxStaleMs: 900_000,
  armedLaw,
};

// ── plan (pure, deterministic) ──
const rcPlan = planRebalance({ roster, measures: measured.measures, policy: rcPolicy, nowMs });
const liquidPlan = planLiquidFuel({ roster, measures: liquid, policy: liquidPolicy, nowMs });

// ── delegation DRAFTS via the repo's own executor-law writer ──
const draftsResult = await writeDelegationDrafts(rcPlan, `${STATE_DIR}/delegation-drafts.json`);

// ── full fuel-plan envelope (atomic, 0600; NO secrets — public chain data only) ──
const envelope = {
  schema: 'saos.fuel-plan/1',
  service: 'soldier-fuel-plan (G77-a)',
  at: new Date(nowMs).toISOString(),
  rpcUrl: RPC,
  chainPin: 'steem (direct api.steemit.com; mesh :3053 run-copy has no x-mesh-chain pinning — measured)',
  roster,
  custody: { keyMaterial: 'never-touched', broadcast: false, draftsOnly: true },
  rc: {
    policy: rcPolicy,
    plan: rcPlan,
    measures: measured.measures,
    delegationDraftsWritten: draftsResult,
  },
  liquid: {
    policy: liquidPolicy,
    plan: liquidPlan,
    balances: liquid,
  },
  lawGates: {
    bridgeBroadcastEnabled: false, // measured /health on :3053 — fail-closed default
    execArmed: armedLaw,
    saos0004VaultStatus: existsSync('/home/z/coord-work/vaults/steem-secrets/soldier-vault.json')
      ? 'PROVISIONED-PENDING-CHAIN-ANCHOR' : 'absent',
  },
};
atomicWrite(`${STATE_DIR}/fuel-plan.json`, JSON.stringify(envelope, null, 2));

const fmtMeasures = measured.measures.map((m: SoldierMeasure) => ({ account: m.account, rcPct: m.rcPct, source: m.source }));
console.log(JSON.stringify({
  ok: rcPlan.ok && liquidPlan.ok,
  at: envelope.at,
  rosterSize: roster.length,
  measured: fmtMeasures,
  rcPlan: { ok: rcPlan.ok, reason: rcPlan.reason, planId: rcPlan.planId, moves: rcPlan.moves, blocked: rcPlan.blocked },
  liquidPlan: { ok: liquidPlan.ok, reason: liquidPlan.reason, planId: liquidPlan.planId, drafts: liquidPlan.drafts, blocked: liquidPlan.blocked, lawSummary: liquidPlan.lawSummary },
  files: { delegationDrafts: draftsResult, fuelPlan: `${STATE_DIR}/fuel-plan.json` },
}, null, 1));
