// Tests for the §1 deny-by-default edge law (EMERGENCY DIRECTIVE 2026-10-25).
// The decision core is pure — every verdict here is a law vector, not an anecdote.
/// <reference types="bun-types" />
import { describe, it, expect, beforeEach } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
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
      // G76-c: the all-soldier activation surface is token-gated from birth —
      // anonymous (credential-less) reads are refused at the edge, fail-closed.
      '/api/soldiers',
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

// ═══ G77-a: THE SOLDIER-NODE SURFACE LAW ═════════════════════════════════════
// Every surface a soldier node / its agent plumbing touches, measured from the
// route inventory @ed4ff8f (src/app/api/**/route.ts). The deny-by-default law
// must hold on EACH: anonymous reads only on the measured public-read set;
// anonymous writes NEVER; credential-carried requests pass through to the
// route's own fail-closed re-verification (the edge never grants).
const SOLDIER_NODE_SURFACES: Array<{ path: string; publicRead: boolean }> = [
  { path: '/api/soldiers', publicRead: false },     // all-soldier activation surface — token-gated from birth (ed4ff8f)
  { path: '/api/saos/soldiers', publicRead: true }, // public soldier list (by design law)
  { path: '/api/saos/custody-alert', publicRead: true },
  { path: '/api/agent/register', publicRead: false },
  { path: '/api/agent/task', publicRead: false },   // NOT '/api/task' — the agent plane has no public rule
  { path: '/api/agent/message', publicRead: false },
  { path: '/api/agent/bounty', publicRead: false }, // NOT '/api/saos/bounty'
  { path: '/api/legion', publicRead: true },
  { path: '/api/task', publicRead: true },
  { path: '/api/mesh', publicRead: true },
  { path: '/api/fuel', publicRead: true },
  { path: '/api/guard', publicRead: false },
  { path: '/api/guardian', publicRead: false },
];

describe('security-gate · soldier-node surface law (G77-a — every surface, one law)', () => {
  it('surface list cannot rot: every listed soldier-node surface is a real route file', () => {
    const apiRoot = join(import.meta.dir, '..', 'app', 'api');
    for (const s of SOLDIER_NODE_SURFACES) {
      const routeFile = join(apiRoot, ...s.path.slice('/api/'.length).split('/'), 'route.ts');
      expect(existsSync(routeFile)).toBe(true);
    }
  });

  it('anonymous GET: allowed ONLY on the measured public-read set, denied otherwise', () => {
    for (const s of SOLDIER_NODE_SURFACES) {
      const d = gateDecision('GET', s.path, H(), null);
      expect(d.allowed).toBe(s.publicRead);
      expect(d.reason).toBe(s.publicRead ? 'public-read' : 'deny-by-default');
    }
  });

  it('anonymous writes (POST/PUT/DELETE) are denied on EVERY soldier-node surface — no exceptions', () => {
    for (const s of SOLDIER_NODE_SURFACES) {
      for (const method of ['POST', 'PUT', 'DELETE']) {
        const d = gateDecision(method, s.path, H(), null);
        expect(d.allowed).toBe(false);
        expect(d.reason).toBe('deny-by-default');
      }
    }
  });

  it('credential-carried requests pass THROUGH on every surface (route re-verifies, edge never grants)', () => {
    for (const s of SOLDIER_NODE_SURFACES) {
      const d = gateDecision('POST', s.path, H({ authorization: 'Bearer agent-token-shape' }), null);
      expect(d.allowed).toBe(true);
      expect(d.reason).toBe('carries-credentials');
    }
  });

  it('the token-gated activation surface (/api/soldiers) is denied anonymous GET but passes a Bearer carrier', () => {
    const anon = gateDecision('GET', '/api/soldiers', H(), null);
    expect(anon.allowed).toBe(false);
    const carried = gateDecision('GET', '/api/soldiers', H({ authorization: 'Bearer x' }), null);
    expect(carried.allowed).toBe(true);
    expect(carried.reason).toBe('carries-credentials');
  });
});
