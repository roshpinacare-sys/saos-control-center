// ═══ משטח-מצב-ההוכחה-הרציפה — חלון-המפעיל-לרץ-ההוכחה (EXEC-CD-36) ════════════
// GET  → הריצה-האחרונה (latest-proof.json) + זנב-התראות + עומק-פנקס + סנכרון-גיט
//        מקור-האמת: קבצי-הפנקס שרץ-ההוכחה כותב (saos-dex/audit-package/proof-pack)
//        — אפס-הצהרות-בזמן-ריצה, אפס-סודות (פנקס-ציבורי-מוגש-בגיט).
// POST → הזנקת-ריצת-הוכחה עכשיו (detached — הריצה ~30-90ש' ונרשמת-לפנקס).
//        פעולת-מפעיל (requireOwner) + הגבלת-קצב.
import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

export const dynamic = 'force-dynamic';

const PP = '/home/z/my-project/saos-dex/audit-package/proof-pack';

function readJson<T>(path: string): T | null {
  try { return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : null; } catch { return null; }
}

export async function GET() {
  try {
    const latest = readJson<Record<string, unknown>>(`${PP}/latest-proof.json`);
    if (!latest) {
      return NextResponse.json({ ok: true, exists: false, note: 'טרם-רץ — הזנק דרך הכפתור או `bun scripts/saosctl.ts proof`' });
    }
    const alertsRaw = existsSync(`${PP}/alerts.jsonl`)
      ? readFileSync(`${PP}/alerts.jsonl`, 'utf8').trim().split('\n').filter(Boolean).slice(-8).reverse()
      : [];
    const alerts: Array<{ ts: string; rule: string; state: string; detail: string }> = [];
    for (const l of alertsRaw) { try { alerts.push(JSON.parse(l)); } catch { /* שורה-פגומה תדולג */ } }
    const ledgerLines = existsSync(`${PP}/proof-ledger.jsonl`)
      ? readFileSync(`${PP}/proof-ledger.jsonl`, 'utf8').trim().split('\n').filter(Boolean).length : 0;
    const bmc = readJson<{ verdict?: string; depth?: number; sequences?: number; applies?: number; elapsedMs?: number; ts?: string }>(`${PP}/bmc.json`);
    return NextResponse.json({ ok: true, exists: true, latest, alerts, ledgerLines, bmc });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message.slice(0, 200) : 'proof-status read failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rl = rateLimit(`proof-run:${ip}`, 3, 300_000);
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: `הגבלת-קצב — נסה-שוב-בעוד ${rl.retryAfterSec}ש׳` }, { status: 429, headers: { 'retry-after': String(rl.retryAfterSec) } });
  }
  const owner = await requireOwner(req);
  if (!owner) {
    return NextResponse.json({ ok: false, error: 'auth-required', note: 'הזנקת-הוכחה היא-פעולת-מפעיל' }, { status: 401 });
  }
  try {
    const dexRoot = '/home/z/my-project/saos-dex';
    const child = spawn('bun', ['harness/proof-runner.ts', '--once'], {
      cwd: dexRoot, detached: true, stdio: 'ignore',
      env: { ...process.env, DATABASE_URL: `file:${dexRoot}/db/dex.db` },
    });
    child.unref();
    return NextResponse.json({ ok: true, spawned: true, pid: child.pid, note: 'ריצת-הוכחה הוזנקה — BMC+fuzzer+חיווט+התראות; התוצאה תירשם-לפנקס בעוד ~30-90ש׳' });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message.slice(0, 200) : 'spawn failed' }, { status: 500 });
  }
}
