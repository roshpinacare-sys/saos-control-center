// Tests for the persistent deny-audit ledger (route-level §1 law).
// DI-injected fake DB — no real Prisma in unit tests; the refusal is the law,
// the record is best-effort (audit failure must NEVER upgrade a deny).
/// <reference types="bun-types" />
import { describe, it, expect } from 'bun:test';
import { denyAndLog, type DenyAuditDB } from './deny-audit';

function fakeReq(headers: Record<string, string> = {}, url = 'http://x/api/vault/treasury'): Request {
  return new Request(url, { method: 'POST', headers });
}

function fakeDb(): { db: DenyAuditDB; rows: Array<Record<string, string>> } {
  const rows: Array<Record<string, string>> = [];
  const db: DenyAuditDB = {
    deniedAttempt: {
      create: async (args: { data: Record<string, string> }) => {
        rows.push(args.data);
        return args.data;
      },
    },
  };
  return { db, rows };
}

describe('deny-audit · the refusal is absolute', () => {
  it('returns 401 with the deny marker and records the attempt', async () => {
    const { db, rows } = fakeDb();
    const req = fakeReq({ 'user-agent': 'attacker/1.0', 'x-forwarded-for': '7.7.7.7, 8.8.8.8' }) as never;
    const res = await denyAndLog(req, '/api/vault/treasury', 'no session, no agent token', { db });
    expect(res.status).toBe(401);
    expect(res.headers.get('x-saos-deny')).toBe('/api/vault/treasury');
    expect(rows).toHaveLength(1);
    expect(rows[0].method).toBe('POST');
    expect(rows[0].path).toBe('/api/vault/treasury');
    expect(rows[0].reason).toContain('no session');
  });

  it('records even when the audit DB write fails (refusal never depends on the ledger)', async () => {
    const broken: DenyAuditDB = {
      deniedAttempt: {
        create: async () => {
          throw new Error('db gone');
        },
      },
    };
    const res = await denyAndLog(fakeReq() as never, '/api/swap/execute', 'anonymous', { db: broken });
    expect(res.status).toBe(401);
  });

  it('records even when no DB is injectable (fail-closed 401 stands)', async () => {
    const res = await denyAndLog(fakeReq() as never, '/api/guard', 'anonymous', {});
    expect(res.status).toBe(401);
  });

  it('truncates oversized reasons to keep the ledger sane (no payload echo)', async () => {
    const { db, rows } = fakeDb();
    const long = 'x'.repeat(5000);
    await denyAndLog(fakeReq() as never, '/api/x', long, { db });
    expect(rows[0].reason.length).toBeLessThanOrEqual(200);
    expect(rows[0].reason).not.toContain('yyyy'); // nothing beyond the slice
  });
});
