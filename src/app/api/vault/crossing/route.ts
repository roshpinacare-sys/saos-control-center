// ═══ GET /api/vault/crossing — הוכחת-חציית-הגבול (EXEC-CD-29) ═══════════════
// העובדות-הקבועות (txids קבועים-על-השרשרות) + בדיקות-חי של יתרות-הכספת.
// אפס-סודות: קריאה-ציבורית בלבד.
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_RPC = 'https://api.mainnet-beta.solana.com';
const TRON_API = 'https://api.trongrid.io';

interface CrossingFile {
  kind: string;
  exec: string;
  at: string;
  verdict: string;
  facts: Record<string, unknown>;
}

async function jup<T>(method: string, params: unknown[], timeoutMs = 12000): Promise<T> {
  const r = await fetch(SOL_RPC, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return (await r.json()) as T;
}

async function liveProbes(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  try {
    const bal = await jup<{ result?: { value?: number } }>('getBalance', ['hYWKEiQb5VV9HjQWiNMakJFZBm2UkuRZLrkDqrCLqDj']);
    out.solLamports = bal.result?.value ?? null;
  } catch { out.solLamports = null; }
  try {
    const toks = await jup<{ result?: { value?: Array<{ account?: { data?: { parsed?: { info?: { mint?: string; tokenAmount?: { uiAmount?: number } } } } } }> } }>(
      'getTokenAccountsByOwner',
      ['hYWKEiQb5VV9HjQWiNMakJFZBm2UkuRZLrkDqrCLqDj', { mint: USDC_MINT }, { encoding: 'jsonParsed' }],
    );
    const accs = toks.result?.value ?? [];
    out.usdc = accs[0]?.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
  } catch { out.usdc = null; }
  try {
    const r = await fetch(`${TRON_API}/wallet/getaccount`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: 'TPFmkfW6CbnPTSMaMkSS6xPgh7aRDE4zjH', visible: true }),
      signal: AbortSignal.timeout(12000),
    });
    const a = await r.json() as { balance?: number };
    out.trxSun = a.balance ?? 0;
  } catch { out.trxSun = null; }
  return out;
}

export async function GET() {
  try {
    const p = path.join(process.cwd(), 'repo-vault', 'crossing.json');
    const facts = JSON.parse(fs.readFileSync(p, 'utf8')) as CrossingFile;
    const live = await liveProbes();
    return NextResponse.json({ ok: true, exec: facts.exec, at: facts.at, verdict: facts.verdict, facts: facts.facts, live });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e).slice(0, 120) }, { status: 500 });
  }
}
