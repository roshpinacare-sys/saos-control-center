// ═══ rc-rebalance · service — beat loop, --once, token-gated surface (TDD) ═══
// SECURITY LAW (§1, directive 1a173c95d5ec1431): the data surface (/status, /plan)
// sits behind Bearer-token auth with constant-time compare and FAIL-CLOSED when
// RC_REBALANCE_TOKEN is unset (503). /health is a bare liveness probe (guardian
// pattern) that carries zero operational data.

import { describe, expect, test } from 'bun:test';
import { verifyBearerToken } from './auth';
import { startService, type RcRebalanceConfig } from './index';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WORK = mkdtempSync(join(tmpdir(), 'rc-index-'));

function mockRpc() {
  return Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json().catch(() => ({}))) as { method?: string };
      if (body.method === 'rc_api.find_rc_accounts') {
        return Response.json({
          jsonrpc: '2.0', id: 1,
          result: { rc_accounts: [{ account: 'whale', rc_manabar: { current_mana: '900000000', last_update_time: 1 }, max_rc: '900000000' }] },
        });
      }
      if (body.method === 'condenser_api.get_accounts') {
        return Response.json({
          jsonrpc: '2.0', id: 1,
          result: [{ name: 'whale', vesting_shares: '10000000.000000 VESTS', delegated_vesting_shares: '0.000000 VESTS', received_vesting_shares: '0.000000 VESTS' }],
        });
      }
      return Response.json({ jsonrpc: '2.0', id: 1, error: 'unknown' }, { status: 400 });
    },
  });
}

async function cfgWith(rpcUrl: string, token: string, pollMs = 3_600_000): Promise<RcRebalanceConfig> {
  return {
    port: 0,
    rpcUrl,
    token,
    statePath: join(WORK, `state-${Math.random().toString(36).slice(2)}.json`),
    draftsPath: join(WORK, `drafts-${Math.random().toString(36).slice(2)}.json`),
    roster: ['whale'],
    pollMs,
    policy: {
      floorPct: 20, targetPct: 60, ceilingPct: 85,
      doseVests: 1_000_000, maxDosesPerReceiver: 1, reservationVests: 1_000_000, maxStaleMs: 15 * 60_000,
    },
    autoStart: false,
    log: false,
  };
}

describe('auth: bearer verification (fail-closed, constant-time)', () => {
  test('empty configured token → refuse everything (fail-closed)', () => {
    expect(verifyBearerToken('anything', '')).toBe(false);
    expect(verifyBearerToken('', '')).toBe(false);
  });
  test('right token passes; wrong/garbage/empty fail', () => {
    expect(verifyBearerToken('s3cret', 's3cret')).toBe(true);
    expect(verifyBearerToken('s3creT', 's3cret')).toBe(false);
    expect(verifyBearerToken('', 's3cret')).toBe(false);
    expect(verifyBearerToken('x'.repeat(5000), 's3cret')).toBe(false);
  });
});

describe('service: beat loop (honest, single-flight)', () => {
  test('beat: measure → plan → drafts + state file; summary reports real counts', async () => {
    const rpc = mockRpc();
    try {
      const svc = startService(await cfgWith(`http://127.0.0.1:${rpc.port}`, 'tok'));
      try {
        const summary = await svc.beat();
        expect(summary.measured).toBe(1);
        expect(summary.planOk).toBe(true);
        // single soldier roster, mana 100% ≥ target → balanced, no moves
        expect(summary.moves).toBe(0);
        expect(summary.drafted).toBe(0);
      } finally {
        await svc.stop();
      }
    } finally {
      await rpc.stop(true);
    }
  });

  test('beat with RPC down → honest empty plan, no crash, state file records the blocker', async () => {
    const dead = 'http://127.0.0.1:9'; // nothing listens here
    const svc = startService(await cfgWith(dead, 'tok'));
    try {
      const summary = await svc.beat();
      expect(summary.measured).toBe(0);
      expect(summary.planOk).toBe(false);
      expect(summary.moves).toBe(0);
      expect(summary.reason).toBe('stale-or-absent-measurement');
    } finally {
      await svc.stop();
    }
  });
});

describe('service: HTTP surface (§1 token law)', () => {
  test('/health is bare liveness with zero operational data', async () => {
    const rpc = mockRpc();
    try {
      const svc = startService(await cfgWith(`http://127.0.0.1:${rpc.port}`, 'tok'));
      try {
        const res = await fetch(`${svc.httpUrl()}/health`);
        expect(res.status).toBe(200);
        const j = (await res.json()) as Record<string, unknown>;
        expect(j.ok).toBe(true);
        expect(j.service).toBe('rc-rebalance');
        expect(JSON.stringify(j)).not.toContain('moves');
        expect(JSON.stringify(j)).not.toContain('roster');
      } finally {
        await svc.stop();
      }
    } finally {
      await rpc.stop(true);
    }
  });

  test('/status + /plan: 401 anonymous, 401 wrong token, 200 correct token', async () => {
    const rpc = mockRpc();
    try {
      const svc = startService(await cfgWith(`http://127.0.0.1:${rpc.port}`, 'tok'));
      try {
        await svc.beat();
        const anon = await fetch(`${svc.httpUrl()}/status`);
        expect(anon.status).toBe(401);
        const bad = await fetch(`${svc.httpUrl()}/status`, { headers: { authorization: 'Bearer wrong' } });
        expect(bad.status).toBe(401);
        const good = await fetch(`${svc.httpUrl()}/status`, { headers: { authorization: 'Bearer tok' } });
        expect(good.status).toBe(200);
        const j = (await good.json()) as { ok: boolean; lastBeat?: { measured: number }; lastMeasures?: Array<{ account: string; rcPct: number | null }> };
        expect(j.ok).toBe(true);
        expect(j.lastBeat?.measured).toBe(1);
        expect(j.lastMeasures?.[0]).toEqual({ account: 'whale', rcPct: 100 });

        const planAnon = await fetch(`${svc.httpUrl()}/plan`);
        expect(planAnon.status).toBe(401);
        const planOk = await fetch(`${svc.httpUrl()}/plan`, { headers: { authorization: 'Bearer tok' } });
        expect(planOk.status).toBe(200);
        const plan = (await planOk.json()) as { planId: string };
        expect(plan.planId).toMatch(/^[0-9a-f]{64}$/);
      } finally {
        await svc.stop();
      }
    } finally {
      await rpc.stop(true);
    }
  });

  test('no token configured → data endpoints 503 fail-closed (never open)', async () => {
    const rpc = mockRpc();
    try {
      const svc = startService(await cfgWith(`http://127.0.0.1:${rpc.port}`, ''));
      try {
        const s = await fetch(`${svc.httpUrl()}/status`);
        expect(s.status).toBe(503);
        const p = await fetch(`${svc.httpUrl()}/plan`);
        expect(p.status).toBe(503);
        const h = await fetch(`${svc.httpUrl()}/health`);
        expect(h.status).toBe(200); // liveness only
      } finally {
        await svc.stop();
      }
    } finally {
      await rpc.stop(true);
    }
  });
});
