// ═══ שער-ה-RPC-הריבוני · חישה-אמיתית-של-מש-NAT (STUN חי) ════════════════════
// מודד-כנה: מה-שהנתב מדווח עליו — או כישלון-גלוי. אף-דבר-לא-מאולף.

import { randomBytes } from 'node:crypto';
import dgram from 'node:dgram';
import { encodeBindingRequest, decodeStunMessage, type StunEndpoint } from './nat';

export interface MeshReport {
  ok: boolean;
  probeEnabled?: boolean;
  xorMapped?: StunEndpoint;
  error?: string;
  measuredMs?: number;
}

export function probeStun(opts: { host: string; port: number; timeoutMs?: number }): Promise<MeshReport> {
  const { host, port, timeoutMs = 2000 } = opts;
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    const txId = new Uint8Array(randomBytes(12));
    const req = encodeBindingRequest(txId);
    let settled = false;
    const done = (r: MeshReport) => {
      if (settled) return;
      settled = true;
      try { sock.close(); } catch { /* already closed */ }
      resolve(r);
    };
    const t0 = Date.now();
    sock.on('message', (msg) => {
      try {
        const decoded = decodeStunMessage(new Uint8Array(msg));
        if (decoded.xorMapped) {
          done({ ok: true, xorMapped: decoded.xorMapped, measuredMs: Date.now() - t0 });
        } else {
          done({ ok: false, error: 'no-xor-mapped-address-in-response' });
        }
      } catch (e) {
        done({ ok: false, error: `decode-failed:${(e as Error).message}` });
      }
    });
    sock.on('error', (e) => done({ ok: false, error: `socket:${e.message}` }));
    sock.send(Buffer.from(req), port, host, (err) => {
      if (err) done({ ok: false, error: `send:${err.message}` });
    });
    setTimeout(() => done({ ok: false, error: 'timeout' }), timeoutMs);
  });
}
