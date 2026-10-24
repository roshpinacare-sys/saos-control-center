// ═══ /api/mesh · מצב-שער-ה-RPC-הריבוני-מול-הצי ══════════════════════════════
// קורא-את-דופק-השער (קובץ-לב-אטומי שה-gateway כותב-בכל-פעימה).
// fail-closed: אין-דופק = 503 כן — לעולם לא מציירים-שער-דמיוני.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const dynamic = 'force-dynamic';

const STALE_MS = 60_000;

export async function GET() {
  const statePath = path.join(process.cwd(), 'mini-services', 'sovereign-gateway', 'state', 'gateway-status.json');
  try {
    const raw = await readFile(statePath, 'utf8');
    const gateway = JSON.parse(raw) as {
      at?: string;
      ok?: boolean;
      service?: string;
      frames?: number;
      dropped?: number;
      clients?: number;
      authMode?: string;
      upstream?: { engine?: string | null; lastSeq?: number; stale?: boolean };
      lastFrameHashes?: Record<string, string>;
    };
    const atMs = gateway.at ? Date.parse(gateway.at) : Number.NaN;
    const ageMs = Number.isFinite(atMs) ? Math.max(0, Date.now() - atMs) : null;
    return Response.json(
      { ok: true, ageMs, stale: ageMs === null || ageMs > STALE_MS, gateway },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch {
    return Response.json(
      { ok: false, reason: 'gateway-heartbeat-absent', statePath: 'mini-services/sovereign-gateway/state/gateway-status.json' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}
