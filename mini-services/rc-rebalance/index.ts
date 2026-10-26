// ═══ rc-rebalance · service — beat loop + --once + token-gated surface (:3141) ═══
// THE LOOP (one beat): measure (2 public RPC calls) → plan (pure, deterministic)
//   → write delegation DRAFTS (never broadcast) → atomic state file → honest log.
// THE SURFACE (§1 deny-by-default law, directive 1a173c95d5ec1431):
//   · GET /health — bare liveness for the guardian (zero operational data)
//   · GET /status — Bearer RC_REBALANCE_TOKEN (constant-time); NO token → 503 fail-closed
//   · GET /plan   — same law; the last deterministic plan
// A new endpoint without auth = mission failure — /status and /plan are
// token-gated and fail-closed; /health carries no fleet data (guardian pattern).
//
// CI PROVABILITY: `bun index.ts --once` runs exactly one beat, prints a JSON
// summary, exits 0 — an honest empty plan is a valid exit (fail-honest, not crash).

import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { planRebalance, type RebalancePlan, type RebalancePolicy, type SoldierMeasure } from './planner';
import { measureSoldiers } from './measure';
import { writeDelegationDrafts } from './execute';
import { extractBearer, verifyBearerToken } from './auth';

// ── the canon roster: the ROT1 soldier identities (same list the soldiers API
//    publishes — src/app/api/saos/soldiers/route.ts). Override: RC_REBALANCE_SOLDIERS CSV.
export const DEFAULT_ROSTER = ['headcorner', 'cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq'] as const;

export interface RcRebalanceConfig {
  port: number; // 0 = ephemeral (tests/CI)
  rpcUrl: string;
  token: string; // '' → fail-closed (data endpoints 503)
  statePath: string;
  draftsPath: string;
  roster: string[];
  pollMs: number;
  policy: RebalancePolicy;
  autoStart?: boolean; // default true; false = beats only via beat()/once
  log?: boolean;
}

export interface BeatSummary {
  at: string;
  ok: boolean;
  reason: string;
  measured: number;
  moves: number;
  drafted: number;
  planOk: boolean;
  planId: string | null;
  blocked: number;
}

export interface RcRebalanceInstance {
  port: number;
  httpUrl(): string;
  beat(): Promise<BeatSummary>;
  stop(): Promise<void>;
}

export function defaultPolicyFromEnv(): RebalancePolicy {
  const num = (v: string | undefined, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  return {
    floorPct: num(process.env.RC_REBALANCE_FLOOR_PCT, 20),
    targetPct: num(process.env.RC_REBALANCE_TARGET_PCT, 60),
    ceilingPct: num(process.env.RC_REBALANCE_CEILING_PCT, 85),
    doseVests: num(process.env.RC_REBALANCE_DOSE_VESTS, 10_000_000_000), // 10k VESTS per dose (µVESTS)
    maxDosesPerReceiver: num(process.env.RC_REBALANCE_MAX_DOSES, 2),
    reservationVests: num(process.env.RC_REBALANCE_RESERVATION_VESTS, 10_000_000_000), // 10k VESTS a donor always keeps
    maxStaleMs: num(process.env.RC_REBALANCE_MAX_STALE_MS, 900_000),
  };
}

export function rosterFromEnv(): string[] {
  const csv = process.env.RC_REBALANCE_SOLDIERS?.trim();
  if (!csv) return [...DEFAULT_ROSTER];
  const list = csv.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length > 0 ? list : [...DEFAULT_ROSTER];
}

async function writeStateFile(statePath: string, state: unknown): Promise<void> {
  try {
    await mkdir(dirname(statePath), { recursive: true });
    const tmp = `${statePath}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2));
    await rename(tmp, statePath); // atomic — the fleet's rename discipline
  } catch {
    // state write failure never kills the beat; honesty lives in /status + logs
  }
}

const say = (log: boolean, line: unknown) => {
  if (log) console.log(typeof line === 'string' ? line : JSON.stringify(line));
};

export function startService(cfg: RcRebalanceConfig): RcRebalanceInstance {
  const startedAt = Date.now();
  const authMode: 'token' | 'fail-closed' = cfg.token ? 'token' : 'fail-closed';
  let beats = 0;
  let lastBeat: BeatSummary | null = null;
  let lastPlan: RebalancePlan | null = null;
  let lastMeasures: SoldierMeasure[] = [];

  let beating = false; // single-flight
  let inFlight: Promise<BeatSummary> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

  const unauthorized = () => json({ ok: false, error: 'unauthorized' }, 401);

  async function doBeat(): Promise<BeatSummary> {
    const nowMs = Date.now();
    const measuredRes = await measureSoldiers(cfg.roster, { rpcUrl: cfg.rpcUrl, nowMs });
    lastMeasures = measuredRes.measures;

    let plan: RebalancePlan;
    try {
      plan = planRebalance({ roster: cfg.roster, measures: measuredRes.measures, policy: cfg.policy, nowMs });
    } catch (e) {
      // invalid policy config → honest blocked plan, never a crash loop
      plan = {
        ok: false,
        reason: `planner-refused: ${e instanceof Error ? e.message.slice(0, 160) : 'unknown'}`,
        moves: [],
        blocked: [{ account: '*', reason: 'policy rejected (fail-closed)' }],
        planId: '',
        nowMs,
      };
    }

    const drafts = await writeDelegationDrafts(plan, cfg.draftsPath);
    lastPlan = plan;
    beats += 1;

    const summary: BeatSummary = {
      at: new Date(nowMs).toISOString(),
      ok: measuredRes.ok && plan.ok,
      reason: plan.reason,
      measured: measuredRes.measures.filter((m) => m.source === 'chain').length,
      moves: plan.moves.length,
      drafted: drafts.count,
      planOk: plan.ok,
      planId: plan.planId || null,
      blocked: plan.blocked.length,
    };
    lastBeat = summary;

    await writeStateFile(cfg.statePath, {
      schema: 'saos.rc-rebalance/1',
      service: 'rc-rebalance',
      at: summary.at,
      authMode,
      rpcUrl: cfg.rpcUrl,
      roster: cfg.roster,
      policy: cfg.policy,
      beats,
      lastBeat: summary,
      lastPlan: plan,
      lastMeasures,
      custody: { keyMaterial: 'never-touched', broadcast: false, draftsOnly: true },
    });

    say(cfg.log !== false, JSON.stringify({ sev: 'rc-beat', ...summary }));
    return summary;
  }

  async function beat(): Promise<BeatSummary> {
    if (stopped) return lastBeat ?? { at: new Date().toISOString(), ok: false, reason: 'service-stopped', measured: 0, moves: 0, drafted: 0, planOk: false, planId: null, blocked: 0 };
    const racing = inFlight;
    if (racing) await racing.catch(() => undefined);
    const b = doBeat();
    inFlight = b;
    try {
      return await b;
    } finally {
      if (inFlight === b) inFlight = null;
    }
  }

  const server = Bun.serve({
    port: cfg.port,
    fetch(req) {
      const u = new URL(req.url);

      if (u.pathname === '/health') {
        return json({ ok: true, service: 'rc-rebalance', authMode, uptimeMs: Date.now() - startedAt });
      }

      // ── every data endpoint below the token law: no token → 503; bad token → 401 ──
      if (authMode === 'fail-closed') {
        if (u.pathname === '/status' || u.pathname === '/plan') {
          return json({ ok: false, error: 'fail-closed', reason: 'RC_REBALANCE_TOKEN not configured' }, 503);
        }
        return json({ ok: false, error: 'not-found' }, 404);
      }
      if (!verifyBearerToken(extractBearer(req.headers.get('authorization')) ?? '', cfg.token)) return unauthorized();

      if (u.pathname === '/status') {
        return json({
          ok: true,
          service: 'rc-rebalance',
          authMode,
          uptimeMs: Date.now() - startedAt,
          beats,
          rosterCount: cfg.roster.length,
          rpcUrl: cfg.rpcUrl,
          custody: { keyMaterial: 'never-touched', broadcast: false, draftsOnly: true },
          lastBeat,
          lastPlanId: lastPlan?.planId ?? null,
          lastMeasures: lastMeasures
            .filter((m) => m.source === 'chain')
            .map((m) => ({ account: m.account, rcPct: m.rcPct })),
        });
      }

      if (u.pathname === '/plan') {
        if (!lastPlan) return json({ ok: false, error: 'no-plan-yet' }, 404);
        return json(lastPlan);
      }

      return json({ ok: false, error: 'not-found' }, 404);
    },
  });

  if (cfg.autoStart !== false) {
    void beat().catch(() => undefined); // first beat immediately
    timer = setInterval(() => void beat().catch(() => undefined), Math.max(1000, cfg.pollMs));
  }

  return {
    port: server.port ?? cfg.port,
    httpUrl: () => `http://127.0.0.1:${server.port}`,
    beat,
    stop: () =>
      new Promise<void>((resolve) => {
        stopped = true;
        if (timer) clearInterval(timer);
        timer = null;
        try {
          server.stop(true);
        } catch {
          // already stopped
        }
        resolve();
      }),
  };
}

// ─── CLI: persistent loop or a single CI-provable beat (--once) ───────────────
if (import.meta.main) {
  const once = process.argv.includes('--once');
  const config: RcRebalanceConfig = {
    port: Number(process.env.RC_REBALANCE_PORT ?? 3141),
    rpcUrl: process.env.RC_REBALANCE_RPC_URL ?? 'https://api.steemit.com',
    token: process.env.RC_REBALANCE_TOKEN ?? '',
    statePath: process.env.RC_REBALANCE_STATE_PATH ?? `${import.meta.dir}/state/rc-rebalance-status.json`,
    draftsPath: process.env.RC_REBALANCE_DRAFTS_PATH ?? `${import.meta.dir}/state/delegation-drafts.json`,
    roster: rosterFromEnv(),
    pollMs: Math.max(1000, Number(process.env.RC_REBALANCE_POLL_MS ?? 60_000)),
    policy: defaultPolicyFromEnv(),
    autoStart: !once,
    log: !once,
  };

  if (once) {
    const svc = startService({ ...config, autoStart: false, log: false });
    const summary = await svc.beat();
    console.log(JSON.stringify({ mode: 'once', service: 'rc-rebalance', ...summary }));
    await svc.stop();
    process.exit(0);
  }

  const svc = startService(config);
  console.log(`[rc-rebalance] listening ${svc.httpUrl()} · rpc=${config.rpcUrl} · roster=${config.roster.length} · auth=${config.token ? 'token' : 'fail-closed'}`);
  if (!config.token) console.log('[rc-rebalance] RC_REBALANCE_TOKEN is empty — data endpoints FAIL-CLOSED (503); /health liveness only');
  const shutdown = async (sig: string) => {
    console.log(`[rc-rebalance] ${sig} — graceful stop`);
    await svc.stop();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}
