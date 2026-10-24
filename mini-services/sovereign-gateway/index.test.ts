// ═══ שער-ה-RPC-הריבוני · חוזי-בדיקה-קודמים-ללוגיקה (TDD) ═══════════════════
// דטרמיניסטי · אופליין · אימותי-שלילה-כנים · שרשרת-מסגרות · fail-closed.
// השעה/המזל מוזרקים; ה-e2e הוא-היחיד-שנוגע-בסוקטים אמיתיים (localhost אפמרלי).

import { describe, test, expect, afterAll } from 'bun:test';
import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { canonJson, sealFrame, verifyChain, GENESIS, type Frame, type Topic } from './protocol';
import { createAuth, assertScope } from './auth';
import { makeFilter, takeToken, newTokenBucket } from './topics';
import { pollHealth, pollLedger, deltaSince, type LedgerEntry } from './upstream';
import { GatewayCore, type ClientHandle } from './gateway-core';
import { startGateway } from './index';

/** bun-types מחזיר unknown מ-Response.json() — מטיפוס-בנקודת-הקריאה, בכנות. */
const json = async <T>(r: Response): Promise<T> => (await r.json()) as T;

// ─── protocol ────────────────────────────────────────────────────────────────
describe('protocol: canonical JSON + hash-chained frames', () => {
  test('canonJson sorts keys recursively, preserves array order, keeps Hebrew verbatim', () => {
    expect(canonJson({ b: 1, a: { d: 0, c: [2, 1] } })).toBe('{"a":{"c":[2,1],"d":0},"b":1}');
    expect(canonJson({ r: 'שלום' })).toBe('{"r":"שלום"}');
  });

  test('canonJson throws on non-JSON-safe values (fail-closed)', () => {
    expect(() => canonJson({ x: Number.NaN })).toThrow();
    expect(() => canonJson({ x: undefined })).toThrow();
    expect(() => canonJson({ f: () => 1 })).toThrow();
  });

  test('sealFrame hash = sha256(canonJson(frame minus hash)) — independently recomputed', () => {
    const f = sealFrame('ledger.health', 1, 111, { seq: 7 }, GENESIS);
    const { hash, ...rest } = f;
    const h = new Bun.CryptoHasher('sha256').update(canonJson(rest)).digest('hex');
    expect(hash).toBe(h);
    expect(f.prev).toBe(GENESIS);
    expect(GENESIS).toBe('0'.repeat(64));
  });

  test('verifyChain: sealed sequence verifies; tamper/broken-prev/seq-jump each surface a seam', () => {
    const ts = [1, 2, 3];
    let prev = GENESIS;
    const frames: Frame[] = ts.map((t, i) => {
      const f = sealFrame('ledger.health', i + 1, t, { beat: i }, prev);
      prev = f.hash;
      return f;
    });
    expect(verifyChain(frames)).toEqual({ ok: true, verified: 3, seams: [] });

    const tampered = frames.map((f, i) => (i === 1 ? { ...f, payload: { beat: 99 } } : f));
    expect(verifyChain(tampered)).toMatchObject({ ok: false, verified: 2, seams: [1] });

    const brokenPrev = frames.map((f, i) => (i === 2 ? { ...f, prev: 'f'.repeat(64) } : f));
    expect(verifyChain(brokenPrev).ok).toBe(false);

    const seqJump = frames.map((f, i) => (i === 2 ? { ...f, seq: 9 } : f));
    expect(verifyChain(seqJump).ok).toBe(false);

    expect(verifyChain([])).toEqual({ ok: true, verified: 0, seams: [] });
  });

  test('chains are per-topic: interleaved topics verify with independent seq counters', () => {
    let prevA = GENESIS;
    let prevB = GENESIS;
    const frames: Frame[] = [];
    for (let i = 0; i < 2; i++) {
      const a = sealFrame('ledger.state', i + 1, i, { to: i }, prevA);
      prevA = a.hash;
      const b = sealFrame('gateway.stats', i + 1, i, { frames: i }, prevB);
      prevB = b.hash;
      frames.push(a, b);
    }
    const v = verifyChain(frames);
    expect(v.ok).toBe(true);
    expect(v.verified).toBe(4);
  });
});

// ─── auth ────────────────────────────────────────────────────────────────────
describe('auth: HMAC challenge/session — fail-closed, replay-proof', () => {
  const SECRET = 's3cret-sovereign';

  test('empty secret is refused at construction (fail-closed law)', () => {
    expect(() => createAuth({ secret: '' })).toThrow();
  });

  test('challenge→mac verifies exactly once; replay and wrong mac are refused', () => {
    let now = 1000;
    const rng = (() => {
      let n = 0;
      return () => Uint8Array.of(0xaa, 0xbb, ++n, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c);
    })();
    const auth = createAuth({ secret: SECRET, now: () => now, rng });
    const ch = auth.issueChallenge();
    expect(ch.nonce).toHaveLength(32);
    const mac = createHmac('sha256', SECRET).update(ch.nonce).digest('hex');
    expect(auth.verifyChallenge(ch.nonce, mac)).toBe(true);
    expect(auth.verifyChallenge(ch.nonce, mac)).toBe(false); // replay
    const ch2 = auth.issueChallenge();
    expect(auth.verifyChallenge(ch2.nonce, mac)).toBe(false); // mac of another nonce
    now += 60_000;
    const ch3 = auth.issueChallenge();
    expect(auth.verifyChallenge(ch3.nonce, mac)).toBe(false); // ...and nonce consumed
  });

  test('expired challenge is refused via injected clock', () => {
    let now = 1000;
    const auth = createAuth({ secret: SECRET, now: () => now, rng: () => Uint8Array.from({ length: 16 }, (_, i) => i) });
    const ch = auth.issueChallenge();
    const mac = createHmac('sha256', SECRET).update(ch.nonce).digest('hex');
    now += 61_000; // beyond default ttl 60s
    expect(auth.verifyChallenge(ch.nonce, mac)).toBe(false);
  });

  test('session token: valid→payload; tampered→bad-signature; expired→expired; scopes enforced', () => {
    let now = 1000;
    let ctr = 0;
    const auth = createAuth({
      secret: SECRET, now: () => now,
      rng: () => Uint8Array.of(0, 0, ++ctr, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12),
    });
    const tok = auth.issueSession('agent-1', ['ledger.state'], 60_000);
    const v = auth.verifySession(tok);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.payload.agentId).toBe('agent-1');
      expect(assertScope(v.payload, 'ledger.state')).toBe(true);
      expect(assertScope(v.payload, 'gateway.admin')).toBe(false);
    }
    const parts = tok.split('.');
    const evil = (parts[0] === 'x' ? '.' : 'x') + tok.slice(1);
    expect(auth.verifySession(evil).ok).toBe(false);
    now += 61_000;
    expect(auth.verifySession(tok)).toMatchObject({ ok: false });
  });

  test('jti is unique across sessions', () => {
    let ctr = 0;
    const auth = createAuth({
      secret: SECRET, now: () => 1,
      rng: () => Uint8Array.of(0, 0, ++ctr, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12),
    });
    const a = auth.issueSession('a', [], 1000);
    const b = auth.issueSession('a', [], 1000);
    const pa = auth.verifySession(a);
    const pb = auth.verifySession(b);
    expect(pa.ok && pb.ok && pa.payload.jti !== pb.payload.jti).toBe(true);
  });
});

// ─── topics ──────────────────────────────────────────────────────────────────
describe('topics: subscription filter + deterministic token bucket', () => {
  test('filter matches exactly the subscribed topics', () => {
    const f = makeFilter(['ledger.state', 'mesh.status'] as Topic[]);
    expect(f('ledger.state')).toBe(true);
    expect(f('mesh.status')).toBe(true);
    expect(f('gateway.stats')).toBe(false);
    expect(f('ledger.health')).toBe(false);
  });

  test('token bucket: capacity honored, refill deterministic on injected clock', () => {
    let now = 0;
    const b = newTokenBucket({ capacity: 3, refillPerMs: 1 / 1000 });
    expect(takeToken(b, now)).toBe(true);
    expect(takeToken(b, now)).toBe(true);
    expect(takeToken(b, now)).toBe(true);
    expect(takeToken(b, now)).toBe(false);
    now += 1000; // refills exactly 1 token
    expect(takeToken(b, now)).toBe(true);
    expect(takeToken(b, now)).toBe(false);
  });
});

// ─── upstream ────────────────────────────────────────────────────────────────
describe('upstream: fleet-economy ledger adapter — honest nulls, never fabricated', () => {
  const entries: LedgerEntry[] = [
    { seq: 5, ts: 1, kind: 'stake', from: 'a', to: 'a', asset: 'SAOS', amount: 1, h: 'h5' },
    { seq: 6, ts: 2, kind: 'swap', from: 'b', to: 'pool', asset: 'SAOS', amount: 2, fee: 0.01, price: 1.3, outUsds: 2.6, h: 'h6' },
    { seq: 7, ts: 3, kind: 'stake', from: 'c', to: 'c', asset: 'SAOS', amount: 3, h: 'h7' },
  ];

  test('pollHealth parses the engine contract; failures surface as null (honest)', async () => {
    const ok = await pollHealth('http://fake', async () => new Response(JSON.stringify({ ok: true, engine: 'fleet-economy', seq: 7, uptimeMs: 9, lastH: 'h7' }), { status: 200 }));
    expect(ok).toEqual({ ok: true, engine: 'fleet-economy', seq: 7, uptimeMs: 9, lastH: 'h7' });
    expect(await pollHealth('http://fake', async () => { throw new Error('down'); })).toBe(null);
    expect(await pollHealth('http://fake', async () => new Response('nope', { status: 502 }))).toBe(null);
    expect(await pollHealth('http://fake', async () => new Response('{bad', { status: 200 }))).toBe(null);
  });

  test('pollLedger returns the tail slice', async () => {
    const out = await pollLedger('http://fake', 2, async () => new Response(JSON.stringify({ tail: entries.slice(0, 2) }), { status: 200 }));
    expect(out?.tail).toHaveLength(2);
    expect(await pollLedger('http://fake', 2, async () => new Response('{}', { status: 200 }))).toBe(null);
  });

  test('deltaSince keeps only seq>last, ascending, and reports nextSeq', () => {
    const d = deltaSince(entries, 5);
    expect(d.entries.map((e) => e.seq)).toEqual([6, 7]);
    expect(d.nextSeq).toBe(7);
    expect(deltaSince(entries, 7).entries).toEqual([]);
  });
});

// ─── gateway-core ────────────────────────────────────────────────────────────
describe('gateway-core: routing, per-topic chains, honest backpressure', () => {
  const fakeClient = (id: string, bucketCap: number): { handle: ClientHandle; got: Frame[] } => {
    const got: Frame[] = [];
    const handle: ClientHandle = {
      id,
      subscribed: [],
      send: (f) => { got.push(f); return true; },
      stats: { sent: 0, dropped: 0 },
    };
    return { handle, got };
  };

  test('publish routes strictly to subscribed clients and chains per topic', () => {
    const core = new GatewayCore({ nowMs: () => 1, secret: 'sec' });
    const c1 = fakeClient('c1', 10);
    const c2 = fakeClient('c2', 10);
    core.registerClient(c1.handle);
    core.registerClient(c2.handle);
    core.setSubscriptions('c1', ['ledger.state']);
    core.setSubscriptions('c2', ['mesh.status']);
    core.publish('ledger.state', { to: 5 }, 1);
    core.publish('mesh.status', { nat: 'offline' }, 1);
    core.publish('ledger.state', { to: 6 }, 1);
    expect(c1.got.map((f) => f.topic)).toEqual(['ledger.state', 'ledger.state']);
    expect(c2.got.map((f) => f.topic)).toEqual(['mesh.status']);
    expect(verifyChain(c1.got).ok).toBe(true);
    expect(verifyChain(c2.got).ok).toBe(true);
    expect(core.stats().frames).toBe(3);
  });

  test('slow client (bucket exhausted) is dropped honestly; healthy client unaffected', () => {
    const core = new GatewayCore({ nowMs: () => 1, secret: 'sec', bucket: { capacity: 1, refillPerMs: 0 } });
    const slow = fakeClient('slow', 1);
    const fast = fakeClient('fast', 1);
    core.registerClient(slow.handle);
    core.registerClient(fast.handle, { capacity: 10, refillPerMs: 0 }); // healthy client keeps headroom
    for (const c of [slow, fast]) core.setSubscriptions(c.handle.id, ['ledger.state']);
    core.publish('ledger.state', { to: 1 }, 1);
    core.publish('ledger.state', { to: 2 }, 1);
    expect(slow.got).toHaveLength(1);
    expect(fast.got).toHaveLength(2);
    expect(core.stats().dropped).toBe(1);
    expect(slow.handle.stats.dropped).toBe(1);
  });

  test('setSubscriptions mid-flight takes effect; lastFrame serves the latest sealed frame', () => {
    const core = new GatewayCore({ nowMs: () => 1, secret: 'sec' });
    const c = fakeClient('c', 10);
    core.registerClient(c.handle);
    core.publish('gateway.stats', { frames: 1 }, 1);
    expect(c.got).toHaveLength(0);
    core.setSubscriptions('c', ['gateway.stats']);
    core.publish('gateway.stats', { frames: 2 }, 1);
    expect(c.got).toHaveLength(1);
    const last = core.lastFrame('gateway.stats');
    expect(last?.payload).toEqual({ frames: 2 });
    expect(verifyChain([last as Frame]).ok).toBe(true);
    expect(core.lastFrame('mesh.status')).toBe(null);
  });
});

// ─── e2e: real sockets, real loop, real state file ───────────────────────────
describe('e2e integration: fake-ledger → sovereign gateway → WS client', () => {
  let seqVar = 7;
  const entriesUpTo = (to: number): LedgerEntry[] =>
    Array.from({ length: to - 4 }, (_, i) => ({
      seq: 5 + i, ts: 1000 + i, kind: 'swap' as const, from: 'yarden', to: 'pool',
      asset: 'SAOS', amount: 0.5, fee: 0.001, price: 1.34, outUsds: 0.67, h: `x${5 + i}`,
    }));

  const upstream = Bun.serve({
    port: 0,
    fetch: (req) => {
      const u = new URL(req.url);
      if (u.pathname === '/health') {
        return new Response(JSON.stringify({ ok: true, engine: 'fake-ledger', seq: seqVar, uptimeMs: 9, lastH: `h${seqVar}` }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (u.pathname === '/ledger') {
        return new Response(JSON.stringify({ tail: entriesUpTo(seqVar) }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    },
  });

  const statePath = join(mkdtempSync(join(tmpdir(), 'sgw-')), 'gateway-status.json');
  const gw = startGateway({
    port: 0,
    upstreamUrl: `http://127.0.0.1:${upstream.port}`,
    pollMs: 60,
    token: 'e2e-secret',
    statePath,
    meshProbe: false,
    log: false,
  });

  afterAll(async () => {
    await gw.stop();
    void upstream.stop(true);
  });

  const waitUntil = async (cond: () => boolean | Promise<boolean>, timeoutMs = 4000): Promise<void> => {
    const t0 = Date.now();
    while (!(await cond())) {
      if (Date.now() - t0 > timeoutMs) throw new Error('timeout waiting for condition');
      await new Promise((r) => setTimeout(r, 15));
    }
  };

  test('gateway HTTP /health rises with token authMode and live upstream stats', async () => {
    await waitUntil(async () => {
      const j = await json<{ frames: number; upstream: { engine: string | null; stale: boolean } }>(await fetch(`${gw.httpUrl()}/health`));
      return j.frames > 0 && j.upstream.engine === 'fake-ledger' && j.upstream.stale === false;
    });
    const h = await json<{ ok: boolean; service: string; authMode: string; upstream: { engine: string; lastSeq: number; stale: boolean } }>(await fetch(`${gw.httpUrl()}/health`));
    expect(h.ok).toBe(true);
    expect(h.service).toBe('sovereign-gateway');
    expect(h.authMode).toBe('token');
    expect(h.upstream.engine).toBe('fake-ledger');
    expect(h.upstream.lastSeq).toBeGreaterThanOrEqual(7);
    expect(h.upstream.stale).toBe(false);
  });

  test('auth flow: challenge→session issues; wrong mac 401; replay 401; garbage session refused', async () => {
    const ch = await json<{ nonce: string }>(await fetch(`${gw.httpUrl()}/auth/challenge`, { method: 'POST' }));
    expect(typeof ch.nonce).toBe('string');
    const mac = createHmac('sha256', 'e2e-secret').update(ch.nonce).digest('hex');
    const ses = await fetch(`${gw.httpUrl()}/auth/session`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: 'agent-1', nonce: ch.nonce, mac, scopes: ['ledger.state', 'gateway.stats'] }),
    });
    expect(ses.status).toBe(200);
    const { token } = await json<{ token: string }>(ses);
    expect(typeof token).toBe('string');

    const bad = await fetch(`${gw.httpUrl()}/auth/session`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: 'agent-1', nonce: 'f'.repeat(32), mac, scopes: [] }),
    });
    expect(bad.status).toBe(401);

    const replay = await fetch(`${gw.httpUrl()}/auth/session`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: 'agent-1', nonce: ch.nonce, mac, scopes: [] }),
    });
    expect(replay.status).toBe(401);

    const noAuth = await fetch(`${gw.httpUrl()}/ws?session=garbage`);
    expect(noAuth.status).toBe(401);
    void token;
  });

  test('WS client: subscribes, receives chained ledger frames, chain verifies across live delta', async () => {
    const ch = await json<{ nonce: string }>(await fetch(`${gw.httpUrl()}/auth/challenge`, { method: 'POST' }));
    const mac = createHmac('sha256', 'e2e-secret').update(ch.nonce).digest('hex');
    const { token } = await json<{ token: string }>(await fetch(`${gw.httpUrl()}/auth/session`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: 'agent-2', nonce: ch.nonce, mac, scopes: ['ledger.state'] }),
    }));

    const ws = new WebSocket(`${gw.wsUrl()}/ws?session=${encodeURIComponent(token)}`);
    const frames: Frame[] = [];
    const opened = new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = () => rej(new Error('ws failed')); });
    await opened;
    ws.send(JSON.stringify({ op: 'subscribe', topics: ['ledger.state'] }));

    const gotFrame = (wantTo: number): Promise<void> => new Promise((res) => {
      ws.onmessage = (ev) => {
        const f = JSON.parse(String(ev.data));
        frames.push(f);
        if ((f.payload as { to?: number } | undefined)?.to === wantTo) res();
      };
    });
    seqVar = 9; // live delta #1: the engine advanced
    await gotFrame(9);
    seqVar = 11; // live delta #2: the engine advanced again
    await gotFrame(11);
    ws.close();

    const ledgerFrames = frames.filter((f) => f.topic === 'ledger.state');
    expect(ledgerFrames.length).toBeGreaterThanOrEqual(2);
    const last = ledgerFrames[ledgerFrames.length - 1];
    expect((last.payload as { to?: number }).to).toBe(11);
    expect(verifyChain(ledgerFrames).ok).toBe(true);
  }, 10_000);

  test('state file: heartbeat persists, parses, and reports honest counters', async () => {
    await waitUntil(async () => {
      const f = Bun.file(statePath);
      if (!(await f.exists())) return false;
      const s = await f.json();
      return s.frames >= 3 && s.ok === true && s.upstream.lastSeq === 11;
    });
    const s = await Bun.file(statePath).json();
    expect(s.service).toBe('sovereign-gateway');
    expect(s.upstream.lastSeq).toBe(11);
    expect(s.upstream.stale).toBe(false);
    expect(s.lastFrameHashes['ledger.state']).toHaveLength(64);
    expect(s.mesh.probeEnabled).toBe(false);
  });

  test('fail-closed mode: no token configured → auth 503, plain /ws probe 401, authMode fail-closed', async () => {
    const noTok = startGateway({ port: 0, upstreamUrl: `http://127.0.0.1:${upstream.port}`, pollMs: 60_000, token: '', statePath: join(mkdtempSync(join(tmpdir(), 'sgw2-')), 's.json'), meshProbe: false, log: false });
    try {
      const h = await json<{ authMode: string }>(await fetch(`${noTok.httpUrl()}/health`));
      expect(h.authMode).toBe('fail-closed');
      const ch = await fetch(`${noTok.httpUrl()}/auth/challenge`, { method: 'POST' });
      expect(ch.status).toBe(503);
      const probe = await fetch(`${noTok.httpUrl()}/ws?session=x`);
      expect(probe.status).toBe(401);
    } finally {
      await noTok.stop();
    }
  });

  test('once(): a single CI-provable cycle baselines the ledger and writes the state file', async () => {
    const sp = join(mkdtempSync(join(tmpdir(), 'sgw3-')), 's.json');
    seqVar = 13;
    const once = startGateway({ port: 0, upstreamUrl: `http://127.0.0.1:${upstream.port}`, pollMs: 60_000, token: 'once-secret', statePath: sp, meshProbe: false, log: false, autoStart: false });
    try {
      const summary = await once.once();
      expect(summary.published).toBeGreaterThanOrEqual(1);
      expect(summary.topics).toContain('ledger.state'); // baseline publishes the real tail
      const s = await Bun.file(sp).json();
      expect(s.frames).toBeGreaterThanOrEqual(1);
      expect(s.upstream.lastSeq).toBe(13);
    } finally {
      await once.stop();
    }
  });
});
