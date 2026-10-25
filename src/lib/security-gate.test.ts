// Tests for the §1 deny-by-default edge law (EMERGENCY DIRECTIVE 2026-10-25).
// The decision core is pure — every verdict here is a law vector, not an anecdote.
/// <reference types="bun-types" />
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  gateDecision,
  recordDeny,
  recentDenies,
  clearDeniesForTest,
  DENY_RING_SIZE,
} from './security-gate';

const H = (h: Record<string, string> = {}): Headers => new Headers(h);

function cookieHeader(cookies: string | null): Headers {
  // Headers can't set Cookie in some runtimes via constructor? It can. Keep helper.
  return cookies === null ? H() : H({ cookie: cookies });
}

describe('security-gate · public-read allowlist (measured surface)', () => {
  it('allows GET health/mesh/fuel anonymously', () => {
    for (const p of ['/api/health', '/api/mesh', '/api/fuel']) {
      expect(gateDecision('GET', p, H(), null).allowed).toBe(true);
    }
  });

  it('allows GET market-data proxies and swap read endpoints anonymously', () => {
    for (const p of ['/api/live/quote', '/api/live/markets', '/api/live/tokens', '/api/live/versus', '/api/live/networks', '/api/live/bridge', '/api/swap/universe', '/api/swap/quotes', '/api/swap/chains', '/api/swap/status']) {
      expect(gateDecision('GET', p, H(), null).allowed).toBe(true);
    }
  });

  it('allows the measured public status GETs anonymously', () => {
    for (const p of ['/api/saos/status', '/api/saos/revenue', '/api/saos/rpc-mesh', '/api/saos/kernel', '/api/saos/energy', '/api/saos/verify-pack', '/api/saos/economy', '/api/saos/custody-alert', '/api/saos/soldiers', '/api/saos/research', '/api/legion', '/api/task', '/api/chat', '/api/saos/bounty', '/api/saos/proof-status', '/api/saos/value-engine']) {
      expect(gateDecision('GET', p, H(), null).allowed).toBe(true);
    }
  });

  it('allows the auth bootstrap POSTs (login/challenge/logout) anonymously', () => {
    for (const p of ['/api/vault/login', '/api/vault/challenge', '/api/vault/logout']) {
      const d = gateDecision('POST', p, H(), null);
      expect(d.allowed).toBe(true);
      expect(d.reason).toBe('public-read');
    }
  });

  it('tolerates a trailing slash on public paths', () => {
    expect(gateDecision('GET', '/api/health/', H(), null).allowed).toBe(true);
  });

  it('never upgrades HEAD into a write', () => {
    // HEAD counts as read on public reads — but POST/PUT/DELETE are never public
    expect(gateDecision('HEAD', '/api/health', H(), null).allowed).toBe(true);
    expect(gateDecision('POST', '/api/health', H(), null).allowed).toBe(false);
  });
});

describe('security-gate · deny-by-default (the directive law)', () => {
  it('DENIES anonymous POST to every known mutator (treasury watch, swap execute, task, chat, seal, dx, guard, agent register, legion, bounty, proof-status, value-engine)', () => {
    for (const p of [
      '/api/vault/treasury', '/api/swap/execute', '/api/task', '/api/chat', '/api/saos/seal',
      '/api/dx', '/api/guard', '/api/agent/register', '/api/legion', '/api/saos/bounty',
      '/api/saos/proof-status', '/api/saos/value-engine',
    ]) {
      const d = gateDecision('POST', p, H(), null);
      expect(d.allowed).toBe(false);
      expect(d.reason).toBe('deny-by-default');
    }
  });

  it('DENIES anonymous reads of the vault recon surface (estate/status/sovereign/addresses/crossing/verify/login GET)', () => {
    for (const p of [
      '/api/vault/estate', '/api/vault/status', '/api/vault/sovereign',
      '/api/vault/addresses', '/api/vault/crossing', '/api/vault/verify',
    ]) {
      const d = gateDecision('GET', p, H(), null);
      expect(d.allowed).toBe(false);
    }
  });

  it('DENIES anonymous access to unknown/undocumented endpoints (fail-closed by construction)', () => {
    expect(gateDecision('GET', '/api/anything-new', H(), null).allowed).toBe(false);
    expect(gateDecision('POST', '/api/anything-new', H(), null).allowed).toBe(false);
    expect(gateDecision('DELETE', '/api/saos/status', H(), null).allowed).toBe(false);
    expect(gateDecision('PUT', '/api/mesh', H(), null).allowed).toBe(false);
  });

  it('denies a BARE Bearer header (no token) — carrier must be non-empty', () => {
    const h = H({ authorization: 'Bearer ' });
    expect(gateDecision('POST', '/api/task', h, null).allowed).toBe(false);
  });
});

describe('security-gate · credential carriers pass THROUGH (route still verifies)', () => {
  it('passes Bearer-token requests to the routes (reason carries-credentials)', () => {
    const d = gateDecision('POST', '/api/vault/treasury', H({ authorization: 'Bearer junk-token' }), null);
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe('carries-credentials');
  });

  it('passes session-cookie requests to the routes', () => {
    const h = cookieHeader('sv_session=sometoken');
    const d = gateDecision('GET', '/api/vault/estate', h, 'sv_session=sometoken');
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe('carries-credentials');
  });

  it('an authenticated caller hitting a PUBLIC path still passes (same verdict family)', () => {
    const d = gateDecision('GET', '/api/health', H({ authorization: 'Bearer x' }), null);
    expect(d.allowed).toBe(true);
  });
});

describe('security-gate · deny ring (drop+log law)', () => {
  beforeEach(() => clearDeniesForTest());

  it('records every deny with method/path/ip/ua and never any body content', () => {
    const r = recordDeny({ method: 'POST', path: '/api/vault/treasury', ip: '1.2.3.4', ua: 'bot/1' });
    expect(r.at).toBeTruthy();
    const ring = recentDenies();
    expect(ring).toHaveLength(1);
    expect(ring[0].path).toBe('/api/vault/treasury');
    expect(ring[0].ip).toBe('1.2.3.4');
  });

  it('caps the ring at the law size (bounded memory on edge)', () => {
    for (let i = 0; i < DENY_RING_SIZE + 25; i++) {
      recordDeny({ method: 'GET', path: `/api/x/${i}`, ip: '9.9.9.9', ua: 't' });
    }
    const ring = recentDenies(DENY_RING_SIZE);
    expect(ring.length).toBe(DENY_RING_SIZE);
    expect(ring[0].path).toBe(`/api/x/${25}`); // oldest evicted
    expect(ring[ring.length - 1].path).toBe(`/api/x/${DENY_RING_SIZE + 24}`);
  });

  it('recentDenies respects a smaller limit', () => {
    for (let i = 0; i < 5; i++) recordDeny({ method: 'POST', path: `/api/y/${i}`, ip: 'i', ua: 'u' });
    expect(recentDenies(2).map((r) => r.path)).toEqual(['/api/y/3', '/api/y/4']);
  });
});
