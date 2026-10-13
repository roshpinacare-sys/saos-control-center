/* fuel-state.ts — Task 3-c · מפיק-ה-Telemetry העצמאי של הצי (תשתית-קוקפיט)
 * ═════════════════════════════════════════════════════════════════════════════
 * "TELEMETRY INDEPENDENCE" (דבר-הבעלים): מדידה-חיה של זהויות-הצי על כל-השרשראות —
 * מקור-ראשוני-ציבורי (condenser/rc_api/trongrid/ETH-RPC/SOL-RPC) + מצב-המנוע
 * המקומי (relay מ-3010 — שכולל fleet מוטמע). נכתב ל-receipts/fuel-state-latest.json
 * (מזין את /api/fuel → Fuel Deck). ריצה-אחת = ~15-קריאות-ספר-זולות.
 *
 * אפס-המצאות: כל-זהות נלקחת מהמנוע-המחומש (relay.identities/tronIdentity) —
 * אם-המנוע לא מדווח → null-כנה, לא-כתובת-בדויה.
 *
 * קדנס: scripts/fuel-state-cadence.sh (כל-15דק' · commit+push דרך sovereign-push).
 */
import fs from "fs";
import path from "path";

const NOW = new Date().toISOString();
const OUT = path.join(process.cwd(), "receipts", "fuel-state-latest.json");
const PRIMARY = (process.env.FUEL_PRIMARY_ACCOUNT ?? "headcorner").toLowerCase();

async function jget<T>(url: string, body?: unknown, timeoutMs = 9000): Promise<T | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = body
        ? await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal })
        : await fetch(url, { signal: ctl.signal });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } finally { clearTimeout(t); }
  } catch { return null; }
}

async function graphene(url: string, method: string, params: unknown): Promise<any | null> {
  return jget<any>(url, { jsonrpc: "2.0", method, params, id: 1 });
}

/* RC-אפקטיבי-קנוני (הקרנת-relay: current + regen עד-max) + max לאחוזים */
async function rcMeasure(url: string, account: string): Promise<{ eff: number; max: number } | null> {
  const r = await graphene(url, "rc_api.find_rc_accounts", { accounts: [account] });
  const a = r?.result?.rc_accounts?.[0];
  if (!a) return null;
  const cur = Number(a.rc_manabar?.current_mana) || 0;
  const max = Number(a.max_rc) || 0;
  const last = Number(a.rc_manabar?.last_update_time) || 0;
  const elapsed = Math.max(0, Math.floor(Date.now() / 1000) - last);
  return { eff: Math.min(max, cur + (max / 432000) * elapsed), max };
}

async function measureGraphene(name: string) {
  const out: Record<string, unknown> = {};
  const ha = (await graphene("https://api.hive.blog", "condenser_api.get_accounts", [[name]]))?.result?.[0];
  if (ha) {
    const rc = await rcMeasure("https://api.hive.blog", name);
    out.hive = {
      rc: rc?.eff ?? null, rcMax: rc?.max ?? null,
      rcPct: rc && rc.max > 0 ? Math.round((100 * rc.eff / rc.max) * 100) / 100 : null,
      liquid: Number(ha.balance?.split(" ")[0]) || 0,
    };
  }
  const sa = (await graphene("https://api.steemit.com", "condenser_api.get_accounts", [[name]]))?.result?.[0];
  if (sa) {
    const rc = await rcMeasure("https://api.steemit.com", name);
    out.steem = {
      rc: rc?.eff ?? null, rcMax: rc?.max ?? null,
      liquid: Number(sa.balance?.split(" ")[0]) || 0,
      sbd: Number(sa.sbd_balance?.split(" ")[0]) || 0,
      rewardSteem: Number(sa.reward_steem_balance?.split(" ")[0]) || 0,
      rewardSbd: Number(sa.reward_sbd_balance?.split(" ")[0]) || 0,
      rewardVesting: Number(sa.reward_vesting_balance?.split(" ")[0]) || 0,
    };
  }
  const ba = (await graphene("https://rpc.blurt.blog", "condenser_api.get_accounts", [[name]]))?.result?.[0];
  if (ba) out.blurt = { balance: Number(ba.balance?.split(" ")[0]) || 0, vests: Number(ba.vesting_shares?.split(" ")[0]) || 0 };
  return out;
}

async function measureTron(addr: string | null): Promise<number | null> {
  if (!addr) return null;
  const r = await jget<{ data?: { balance?: number }[] }>(`https://api.trongrid.io/v1/accounts/${addr}`);
  return r?.data?.[0]?.balance ?? 0;
}
async function measureEth(addr: string | null): Promise<number | null> {
  if (!addr) return null;
  const r = await jget<{ result?: string }>("https://ethereum-rpc.publicnode.com", { jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [addr, "latest"] });
  return r?.result ? Number(BigInt(r.result)) : null;
}
async function measureSol(addr: string | null): Promise<number | null> {
  if (!addr) return null;
  const r = await jget<{ result?: { value?: number } }>("https://api.mainnet-beta.solana.com", { jsonrpc: "2.0", id: 1, method: "getBalance", params: [addr] });
  return r?.result?.value ?? null;
}

async function engine<T>(p: string): Promise<T | null> {
  return jget<T>(`http://127.0.0.1:3010/saos-dex/api/dex/${p}`);
}

const relay = await engine<{ relay?: any }>("relay");
const r = relay?.relay ?? null;

const ethId: string | null = r?.identities?.eth ?? null;
const solId: string | null = r?.identities?.sol ?? null;
const tronId: string | null = r?.tronIdentity ?? null;

const [primary, tron, eth, sol] = await Promise.all([
  measureGraphene(PRIMARY),
  measureTron(tronId),
  measureEth(ethId),
  measureSol(solId),
]);

/* ── חוסמים-כנים (דלק-בלבד — הקסטודיה 7/7 מוכחת) ── */
const RC_MIN = 1_000_000;
const blockers: string[] = [];
const hiveRc = (primary.hive as { rc?: number } | undefined)?.rc;
const steemRc = (primary.steem as { rc?: number } | undefined)?.rc;
const blurtBal = (primary.blurt as { balance?: number } | undefined)?.balance;
if (hiveRc !== null && hiveRc !== undefined && hiveRc < 210_000_000) blockers.push("hive:rc-depleted (rotation-engine responde — fleet.usableByChain)");
if (steemRc !== null && steemRc !== undefined && steemRc < RC_MIN) blockers.push("steem:rc-low");
if (blurtBal !== null && blurtBal !== undefined && blurtBal < 1) blockers.push("blurt:fee-balance (<1 BLURT)");
if (tron !== null && tron < 1_000_000) blockers.push("tron:fee (<1 TRX)");
if (eth !== null && eth < 100_000_000_000_000) blockers.push("eth:unfunded-gas");
if (sol !== null && sol < 895_880) blockers.push("sol:unfunded-fee");

const state = {
  schema: "saos.fuel-state/1",
  at: NOW,
  doctrine: "fuel-only blockers — custody 7/7 proven (rails.env.enc v2 c5b4758); rotation engine rescues hive/steem/blurt fuel-failures from the vault army",
  engine: r ? { account: r.account, uptimeMs: r.uptimeMs } : null,
  rails: r
    ? Object.fromEntries(Object.entries(r.chains ?? {}).map(([k, v]) => {
        const s = v as Record<string, unknown>;
        return [k, { enabled: s.enabled, status: s.status, anchored: s.anchored, verified: s.verified, mismatches: s.mismatches, lastError: s.lastError ?? null }];
      }))
    : null,
  metrics: r?.metrics ?? null,
  fleet: r?.fleet
    ? {
        configured: (r.fleet as Record<string, unknown>).configured,
        usableByChain: (r.fleet as Record<string, unknown>).usableByChain ?? null,
        probedAt: (r.fleet as Record<string, unknown>).probedAt ?? null,
        accounts: (r.fleet as Record<string, unknown>).accounts ?? [],
      }
    : null,
  primary: { account: PRIMARY, ...primary, tron: { sun: tron }, eth: { wei: eth, address: ethId }, sol: { lamports: sol, address: solId } },
  blockers,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(state, null, 2));
const rails = state.rails ? Object.entries(state.rails).map(([k, v]) => `${k}:${(v as { enabled?: boolean }).enabled ? "on" : "off"}`).join(" ") : "engine-unreachable";
console.log(`[fuel-state] at=${NOW} rails[${rails}] blockers=${blockers.length} fleetUsable=${JSON.stringify((state.fleet?.usableByChain as unknown) ?? null)} → ${path.relative(process.cwd(), OUT)}`);
