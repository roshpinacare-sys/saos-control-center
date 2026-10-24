// ═══ שער-ה-RPC-הריבוני · ריצה-חיה — HTTP+WS על-פורט-מקומי-אחד ═══════════════
// המעגל: סקר-ספר-הכלכלה (single-flight) → מסגרות-שרשרת → מנויים-מקומיים
// · קובץ-לב-אטומי (tmp+rename) לכל-פעימה · fail-closed בלי SOVEREIGN_GATEWAY_TOKEN
// · אפס-תלות-חוץ — הספר והסוכנים על אותו מחשב, אפס-בקבוקי-צוואר-ציבוריים (§4).

import { randomUUID } from 'node:crypto';
import { rename, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { GatewayCore } from './gateway-core';
import { createAuth, type SovereignAuth } from './auth';
import { TOPICS, type Topic, type Frame } from './protocol';
import { isTopic } from './topics';
import { pollHealth, pollLedger, deltaSince } from './upstream';
import { probeStun, type MeshReport } from './mesh/probe';

export interface GatewayConfig {
  port: number; // 0 = ephemeral (tests/CI)
  upstreamUrl: string; // e.g. http://127.0.0.1:3016 (fleet-economy)
  pollMs: number;
  token: string; // '' → fail-closed auth mode (health/status/mesh only)
  statePath: string; // heartbeat file (atomic, for the control-center /api/mesh)
  meshProbe: boolean; // live STUN probe on /mesh when true
  log: boolean;
  autoStart?: boolean; // default true; false = first beat only via once() (--once/CI)
}

export interface GatewayInstance {
  port: number;
  httpUrl(): string;
  wsUrl(): string;
  once(): Promise<{ published: number; topics: string[] }>;
  stop(): Promise<void>;
}

// WeakMap-זהות-שקע — מנותק-מהחוזה-הגנרי של ws.data ב-bun-types; הזיכרון משוחרר עם השקע.
const wsIds = new WeakMap<object, string>();

export function startGateway(cfg: GatewayConfig): GatewayInstance {
  const startedAt = Date.now();
  const auth: SovereignAuth | null = cfg.token ? createAuth({ secret: cfg.token }) : null;
  const authMode: 'token' | 'fail-closed' = auth ? 'token' : 'fail-closed';
  const core = new GatewayCore({ nowMs: () => Date.now(), secret: cfg.token || undefined });

  const upstream = {
    url: cfg.upstreamUrl,
    engine: null as string | null,
    lastSeq: null as number | null, // null = not yet baselined at the live head
    lastOkMs: 0,
    stale: true,
  };

  let polling = false; // single-flight inside doBeat
  let inFlight: Promise<{ published: number; topics: string[] }> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });

  async function writeState(): Promise<void> {
    const stat = {
      ok: true,
      service: 'sovereign-gateway',
      at: new Date(Date.now()).toISOString(),
      uptimeMs: Date.now() - startedAt,
      authMode,
      mesh: { probeEnabled: cfg.meshProbe },
      ...core.stats(),
      upstream: { url: upstream.url, engine: upstream.engine, lastSeq: upstream.lastSeq, lastOkMs: upstream.lastOkMs, stale: upstream.stale },
      lastFrameHashes: core.lastFrameHashes(),
    };
    try {
      await mkdir(dirname(cfg.statePath), { recursive: true });
      const tmp = `${cfg.statePath}.tmp`;
      await writeFile(tmp, JSON.stringify(stat, null, 2));
      await rename(tmp, cfg.statePath); // atomic — the fleet's rename discipline
    } catch {
      // state write failure never kills the gateway; honesty lives in /health
    }
  }

  async function doBeat(): Promise<{ published: number; topics: string[] }> {
    if (polling || stopped) return { published: 0, topics: [] };
    polling = true;
    const publishedTopics: string[] = [];
    try {
      const health = await pollHealth(cfg.upstreamUrl);
      if (health) {
        upstream.engine = health.engine;
        upstream.lastOkMs = Date.now();
        upstream.stale = false;
        core.publish('ledger.health', health);
        publishedTopics.push('ledger.health');

        const led = await pollLedger(cfg.upstreamUrl, 200);
        if (led) {
          // First cycle: baseline at the live head and publish the REAL tail as
          // initial state (agents must see the ledger immediately, not a void).
          // Later cycles: only true deltas — health.seq never overwrites the
          // applied position (that overwrite was the void-ledger bug, TDD-caught).
          const base = upstream.lastSeq ?? health.seq;
          const delta = deltaSince(led.tail, base);
          const baseline = upstream.lastSeq === null;
          if (baseline || delta.entries.length > 0) {
            const entries = baseline ? led.tail : delta.entries;
            upstream.lastSeq = delta.nextSeq;
            core.publish('ledger.state', { to: delta.nextSeq, count: entries.length, entries });
            publishedTopics.push('ledger.state');
          }
        }
      } else {
        upstream.stale = true; // honest — never fabricate ledger state
      }
      core.publish('gateway.stats', { ...core.stats(), upstreamStale: upstream.stale });
      publishedTopics.push('gateway.stats');
      await writeState();
    } finally {
      polling = false;
    }
    return { published: publishedTopics.length, topics: publishedTopics };
  }

  /** פעימה-אחת: אם-יש-פעימה-בעיצומה — ממתין-לה-ואז-רץ-בעצמו (בלי-מירוץ). */
  async function pollOnce(): Promise<{ published: number; topics: string[] }> {
    if (stopped) return { published: 0, topics: [] };
    const racing = inFlight;
    if (racing) await racing.catch(() => undefined);
    const beat = doBeat();
    inFlight = beat;
    try {
      return await beat;
    } finally {
      if (inFlight === beat) inFlight = null;
    }
  }

  const server = Bun.serve({
    port: cfg.port,
    async fetch(req, server): Promise<Response | undefined> {
      const u = new URL(req.url);

      if (u.pathname === '/ws') {
        if (!auth) return json({ ok: false, error: 'unauthorized', authMode }, 401);
        const v = auth.verifySession(u.searchParams.get('session') ?? '');
        if (!v.ok) return json({ ok: false, error: 'unauthorized', authMode }, 401);
        const ok = server.upgrade(req); // identity tracked via wsIds WeakMap, not ws.data
        return ok ? undefined : json({ ok: false, error: 'upgrade-failed' }, 426);
      }

      if (u.pathname === '/health') {
        const s = core.stats();
        return json({
          ok: true,
          service: 'sovereign-gateway',
          authMode,
          uptimeMs: Date.now() - startedAt,
          frames: s.frames,
          dropped: s.dropped,
          clients: s.clients,
          upstream: { url: upstream.url, engine: upstream.engine, lastSeq: upstream.lastSeq, lastOkMs: upstream.lastOkMs, stale: upstream.stale },
        });
      }

      if (u.pathname === '/status') {
        const s = core.stats();
        return json({
          ok: true,
          service: 'sovereign-gateway',
          authMode,
          uptimeMs: Date.now() - startedAt,
          ...s,
          upstream: { url: upstream.url, engine: upstream.engine, lastSeq: upstream.lastSeq, lastOkMs: upstream.lastOkMs, stale: upstream.stale },
          lastFrameHashes: core.lastFrameHashes(),
        });
      }

      if (u.pathname === '/mesh') {
        let report: MeshReport;
        if (cfg.meshProbe) {
          report = await probeStun({
            host: process.env.SOVEREIGN_STUN_HOST ?? 'stun.l.google.com',
            port: Number(process.env.SOVEREIGN_STUN_PORT ?? 19302),
            timeoutMs: 2000,
          });
        } else {
          report = { ok: false, probeEnabled: false, error: 'probe-disabled' };
        }
        return json({ ok: true, service: 'sovereign-gateway', mesh: report });
      }

      if (u.pathname === '/auth/challenge') {
        if (!auth) return json({ ok: false, error: 'fail-closed', reason: 'SOVEREIGN_GATEWAY_TOKEN not configured' }, 503);
        return json(auth.issueChallenge());
      }

      if (u.pathname === '/auth/session') {
        if (!auth) return json({ ok: false, error: 'fail-closed', reason: 'SOVEREIGN_GATEWAY_TOKEN not configured' }, 503);
        let body: { agentId?: string; nonce?: string; mac?: string; scopes?: string[] };
        try {
          body = (await req.json()) as typeof body; // body read exactly once (G68 lesson)
        } catch {
          return json({ ok: false, error: 'bad-json' }, 400);
        }
        if (!body.nonce || !body.mac || !body.agentId) return json({ ok: false, error: 'missing-fields' }, 400);
        if (!auth.verifyChallenge(body.nonce, body.mac)) return json({ ok: false, error: 'challenge-failed' }, 401);
        const scopes = (body.scopes ?? []).filter((x): x is Topic => isTopic(x));
        const token = auth.issueSession(body.agentId, scopes, 3_600_000);
        return json({ ok: true, token, ttlMs: 3_600_000 });
      }

      return json({ ok: false, error: 'not-found' }, 404);
    },

    websocket: {
      open(ws) {
        const id = randomUUID();
        wsIds.set(ws, id);
        core.registerClient({
          id,
          subscribed: [],
          send: (f: Frame) => {
            try {
              ws.send(JSON.stringify(f));
              return true;
            } catch {
              return false;
            }
          },
          stats: { sent: 0, dropped: 0 },
        });
      },
      message(ws, raw) {
        const id = wsIds.get(ws);
        if (!id) return;
        try {
          const msg = JSON.parse(String(raw)) as { op?: string; topics?: string[] };
          if (msg.op === 'subscribe' && Array.isArray(msg.topics)) {
            const topics = msg.topics.filter((t): t is Topic => isTopic(t));
            core.setSubscriptions(id, topics);
            ws.send(JSON.stringify({ ok: true, subscribed: topics })); // control ack — chain frames flow next
            return;
          }
          ws.send(JSON.stringify({ error: 'unknown-op' }));
        } catch {
          ws.send(JSON.stringify({ error: 'bad-json' }));
        }
      },
      close(ws) {
        const id = wsIds.get(ws);
        if (id) core.removeClient(id);
      },
    },
  });

  timer = setInterval(() => void pollOnce().catch(() => undefined), Math.max(1000, cfg.pollMs));
  if (cfg.autoStart) void pollOnce().catch(() => undefined); // first beat immediately (skippable for --once)

  const instance: GatewayInstance = {
    port: server.port ?? cfg.port,
    httpUrl: () => `http://127.0.0.1:${server.port}`,
    wsUrl: () => `ws://127.0.0.1:${server.port}`,
    once: pollOnce,
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
  return instance;
}

// ─── CLI: ריצה-קבועה או מחזור-בודד (--once) ─────────────────────────────────
if (import.meta.main) {
  const once = process.argv.includes('--once');
  const config: GatewayConfig = {
    port: Number(process.env.SOVEREIGN_GATEWAY_PORT ?? 3140),
    upstreamUrl: process.env.SOVEREIGN_UPSTREAM_URL ?? 'http://127.0.0.1:3016',
    pollMs: Math.max(1000, Number(process.env.SOVEREIGN_GATEWAY_POLL_MS ?? 5000)),
    token: process.env.SOVEREIGN_GATEWAY_TOKEN ?? '',
    statePath: process.env.SOVEREIGN_GATEWAY_STATE_PATH ?? `${import.meta.dir}/state/gateway-status.json`,
    meshProbe: process.env.SOVEREIGN_GATEWAY_MESH_PROBE !== '0',
    log: !once,
  };

  if (once) {
    const gw = startGateway({ ...config, log: false });
    const summary = await gw.once();
    console.log(JSON.stringify({ ok: true, mode: 'once', ...summary }));
    await gw.stop();
    process.exit(0);
  }

  const gw = startGateway(config);
  console.log(`[sovereign-gateway] listening ${gw.httpUrl()} · upstream=${config.upstreamUrl} · auth=${config.token ? 'token' : 'fail-closed'}`);
  if (!config.token) {
    console.log('[sovereign-gateway] SOVEREIGN_GATEWAY_TOKEN is empty — WS auth is FAIL-CLOSED (health/status/mesh only)');
  }
  const shutdown = async (sig: string) => {
    console.log(`[sovereign-gateway] ${sig} — graceful stop`);
    await gw.stop();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}
