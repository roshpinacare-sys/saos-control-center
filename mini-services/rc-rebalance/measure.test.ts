// ═══ rc-rebalance · measure — the honest chain-reader (TDD) ═══════════════════
// Laws: (1) real RPC reads only — a configurable endpoint, zero secrets in URLs;
// (2) fail-honest — any RPC failure/malformation surfaces as source:'missing'
//     with a reason, NEVER as fabricated numbers; (3) the manabar regen
//     projection is the fleet canon (scripts/fuel-state.ts): effective mana =
//     min(max, current + max/432000 × elapsed); (4) integer µVESTS everywhere.
// Tests run against a local mock RPC (ephemeral port) — zero external traffic.

import { describe, expect, test } from 'bun:test';
import { measureSoldiers, parseVests, projectMana } from './measure';

const NOW = 1_700_000_100_000;

// NOTE: real handler wiring lives in each test via startMock below.
function startMock(rcAccounts: unknown[], condenserAccounts: unknown[], opts?: { fail?: boolean; rcFail?: boolean }) {
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      if (opts?.fail) return new Response('boom', { status: 500 });
      let body: { method?: string } = {};
      try { body = (await req.json()) as { method?: string }; } catch { /* bad json → empty */ }
      if (opts?.rcFail && body.method === 'rc_api.find_rc_accounts') return new Response('rc down', { status: 500 });
      if (body.method === 'rc_api.find_rc_accounts') return Response.json({ jsonrpc: '2.0', id: 1, result: { rc_accounts: rcAccounts } });
      if (body.method === 'condenser_api.get_accounts') return Response.json({ jsonrpc: '2.0', id: 1, result: condenserAccounts });
      return Response.json({ jsonrpc: '2.0', id: 1, error: 'unknown method' }, { status: 400 });
    },
  });
  return server;
}

describe('measure: parsing + projection (pure)', () => {
  test('parseVests: "123.456789 VESTS" → integer µVESTS', () => {
    expect(parseVests('123.456789 VESTS')).toBe(123_456_789);
    expect(parseVests('0.000000 VESTS')).toBe(0);
    expect(parseVests('')).toBe(0);
    expect(parseVests('garbage')).toBe(0);
  });

  test('projectMana: fleet-canon regen (max/432000 per second), clamped at max', () => {
    const nowMs = NOW;
    // current=0, max=432_000_000 → +1000/s → after 1000s: 1_000_000 (last_update in SECONDS)
    expect(projectMana(0, 432_000_000, Math.floor(nowMs / 1000) - 1000, nowMs)).toBe(1_000_000);
    // above max → clamped
    expect(projectMana(432_000_000, 432_000_000, Math.floor(nowMs / 1000) - 1000, nowMs)).toBe(432_000_000);
    // negative elapsed (clock skew) → no regression
    expect(projectMana(100, 1000, Math.floor(nowMs / 1000) + 50, nowMs)).toBe(100);
  });
});

describe('measure: honest chain reads', () => {
  test('happy path: rc_api + condenser merged into integer measures with source chain', async () => {
    const server = startMock(
      [
        {
          account: 'whale',
          rc_manabar: { current_mana: '400000000', last_update_time: Math.floor(NOW / 1000) - 60 },
          max_rc: '400000000',
        },
      ],
      [
        {
          name: 'whale',
          vesting_shares: '50000000.000000 VESTS',
          delegated_vesting_shares: '10000000.000000 VESTS',
          received_vesting_shares: '0.000000 VESTS',
        },
      ],
    );
    try {
      const res = await measureSoldiers(['whale'], { rpcUrl: `http://127.0.0.1:${server.port}`, nowMs: NOW });
      expect(res.ok).toBe(true);
      expect(res.measures.length).toBe(1);
      const w = res.measures[0];
      expect(w.account).toBe('whale');
      expect(w.source).toBe('chain');
      expect(w.vestingShares).toBe(50_000_000_000_000); // 50M VESTS in µVESTS
      expect(w.delegatedOut).toBe(10_000_000_000_000);
      expect(w.receivedIn).toBe(0);
      expect(w.rcPct).toBe(100); // full mana at last_update, clamped
      expect(w.measuredAtMs).toBe(NOW);
    } finally {
      await server.stop(true);
    }
  });

  test('regen projection reflected in rcPct (60s elapsed on 432000s full-regen)', async () => {
    const max = '432000000';
    const server = startMock(
      [{ account: 'a', rc_manabar: { current_mana: '0', last_update_time: Math.floor(NOW / 1000) - 60 }, max_rc: max }],
      [{ name: 'a', vesting_shares: '1.000000 VESTS', delegated_vesting_shares: '0.000000 VESTS', received_vesting_shares: '0.000000 VESTS' }],
    );
    try {
      const res = await measureSoldiers(['a'], { rpcUrl: `http://127.0.0.1:${server.port}`, nowMs: NOW });
      // 60s of regen on a 432000s bar = 0.0138…% → honest rounding to 2dp
      expect(res.measures[0].rcPct).toBeCloseTo(0.01, 2);
    } finally {
      await server.stop(true);
    }
  });

  test('RPC total failure → ok:false, every account source missing with reason (no fabrication)', async () => {
    const server = startMock([], [], { fail: true });
    try {
      const res = await measureSoldiers(['x', 'y'], { rpcUrl: `http://127.0.0.1:${server.port}`, nowMs: NOW });
      expect(res.ok).toBe(false);
      expect(res.measures.length).toBe(2);
      for (const m of res.measures) {
        expect(m.source).toBe('missing');
        expect(m.rcPct).toBeNull();
        expect((m.reason ?? '').length).toBeGreaterThan(0);
      }
    } finally {
      await server.stop(true);
    }
  });

  test('rc_api down but condenser up → mana unmeasurable honestly (rcPct null), vests still real', async () => {
    const server = startMock(
      [],
      [{ name: 'a', vesting_shares: '2.000000 VESTS', delegated_vesting_shares: '0.000000 VESTS', received_vesting_shares: '0.000000 VESTS' }],
      { rcFail: true },
    );
    try {
      const res = await measureSoldiers(['a'], { rpcUrl: `http://127.0.0.1:${server.port}`, nowMs: NOW });
      const m = res.measures[0];
      expect(m.vestingShares).toBe(2_000_000);
      expect(m.rcPct).toBeNull();
      expect(m.reason).toContain('rc_api');
    } finally {
      await server.stop(true);
    }
  });

  test('account absent from chain response → missing with honest reason', async () => {
    const server = startMock(
      [],
      [{ name: 'present', vesting_shares: '1.000000 VESTS', delegated_vesting_shares: '0.000000 VESTS', received_vesting_shares: '0.000000 VESTS' }],
    );
    try {
      const res = await measureSoldiers(['present', 'ghost'], { rpcUrl: `http://127.0.0.1:${server.port}`, nowMs: NOW });
      const ghost = res.measures.find((m) => m.account === 'ghost');
      expect(ghost?.source).toBe('missing');
      expect(ghost?.reason).toContain('absent');
      expect(res.ok).toBe(false); // any-missing → the beat is not fully measured (planner will fail-closed)
    } finally {
      await server.stop(true);
    }
  });
});
