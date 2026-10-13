// ═══════════════════════════════════════════════════════════════════════════
// SAOS-LEGION — SAEC · Sovereign Autonomous Execution Center (:3012)
// ═══════════════════════════════════════════════════════════════════════════
// EXEC-CD-22 · פקודת-המפעיל: "מה שקרה עם החיילים שאיבדנו את מפתחותיהם —
// תבנה עליהם אימפריה" + "איך נוכל להפוך את הדקס שלנו למרכז-ביצוע-ריבוני
// אוטונומי עבור סוכני-הריבונות של הרשת, כיצד הם יהפכו את הרשת לפעילה?"
//
// התשובה ההנדסית-הכנה:
//  · מפתחות-השרשרת-החוץ של חיילי-ה-ROT1 אבדו (VaultKey=0, תועד-חי — אין
//    שחזור). אבל זהות-אינה-מפתח: כל חייל זוכה כאן לחיים-שניים — חשבון-סוכן
//    ריבוני משלו על רשת-ה-DEX (יתרות + credits + פקודות-משלו, owner בספר).
//  · כל פעולה = פקודה/סוואג' אמת על המנוע → עמלים אמת → כספת-העתודה →
//    סולם-הרלוונטיות (EXEC-CD-21). התחזוקה עצמה = מנוע-הרווח.
//  · ריבונות-גיט: אפס-תלות בסנדבוקס. הקוד בגיט; מצבת-האמת = chain-journal
//    של המנוע (שדה soldier) שנדחף ל-saos-dex origin כל ≤20 דקות (state-push);
//    ה-LEDGER המקומי כאן הוא נוחות-בלבד (state/ledger.jsonl, gitignored) —
//    המקור הקנוני תמיד השרשרת של המנוע.
//
// בטיחות (גבולות-נזק מבניים, כולם בקוד-הזה):
//  · תקרת-גודל-פקודה · מקס-פקודות-פתוחות · cooldown-פר-סוכן
//  · סטייה-מהמחיר-החי → דילוג (state ישן >15s או |מחיר-mid| > 15%)
//  · עצירת-הפסד-יומי-פר-סוכן (baseline-מול-ערך-תיק) → עצירה-אוטומטית
//  · מתג-הרג-גלובלי + פר-סוכן (POST /api/legion/control, אימות-טוקן)
//  · אין-סחר-מול-בריכות-סטייה (USDS/WSTEEM, USDS/WTRX) — סנטינלים-בלבד:
//    סחר-מול-מיספור-שגוי של בריכה-בבעלות-האוצר = רעל-עצמי (האיסור היחיד
//    שהמפעיל קבע: אין-הטעיה). דיווח-סטייה → הצעת-repeg לאוצר.
//  · אפס-סודות-בקוד: DEX_OPERATOR_TOKEN + LEGION_OPERATOR_TOKEN מ-.env בלבד
//    (bun טוען-אוטומטית); אף-ערך-סוד לא נכתב ללוג/ל-ledger.
// ═══════════════════════════════════════════════════════════════════════════
import type { Server } from "bun";
import { writeFileSync, readFileSync, unlinkSync } from "node:fs";

// T-66 · מנעול-מופע-יחיד — הלקח-מהכפילויות-החיות (instrumentation + watchdog +
// start.sh כולם-משגרים-את-הלגיון; בלי-מנעול = 3-עותקים-חיים). עותק-שני-חי
// = יוצא-בכנות מיד. היציב-מנצח, המגיע-מאוחר מוותר.
const INSTANCE_LOCK = "/tmp/saos-legion.lock";
try {
  const prev = parseInt(readFileSync(INSTANCE_LOCK, "utf8").trim(), 10);
  if (Number.isFinite(prev) && prev > 0 && prev !== process.pid) {
    try {
      process.kill(prev, 0);
      console.log(`[saos-legion] instance-alive-exiting (pid ${prev} כבר-חי — אפס-כפילויות)`);
      process.exit(0);
    } catch { /* מחזיק-ישן-מת — תופסים-את-המנעול */ }
  }
} catch { /* אין-מנעול — ראשון */ }
writeFileSync(INSTANCE_LOCK, String(process.pid));
process.on("exit", () => { try { unlinkSync(INSTANCE_LOCK); } catch { /* כבר-נמחק */ } });

const PORT = 3012;
const ENGINE = "http://127.0.0.1:3010/saos-dex/api/dex";
const OP_TOKEN = process.env.DEX_OPERATOR_TOKEN || "";
const CTRL_TOKEN = process.env.LEGION_OPERATOR_TOKEN || "";

// חיים-קשוחים: שגיאה-לא-מטופלת לא מפילה את הלגיון (הכנות: נרשם-וממשיך)
process.on("uncaughtException", (e) => { try { log(`uncaught: ${e.message}`); } catch {} });
process.on("unhandledRejection", (e) => { try { log(`unhandled: ${e instanceof Error ? e.message : String(e).slice(0, 120)}`); } catch {} });

// ── גבולות-נזק (µ-יחידות; µ=MU=1000) ────────────────────────────────────────
const MAX_OPEN_ORDERS = 4;      // פר-סוכן
const COOLDOWN_MS = 10_000;     // פר-סוכן (מוטציות)
const STATE_STALE_MS = 15_000;  // state ישן → דילוג-כנה
const PRICE_SANITY_BPS = 1500;  // אסור-פקודה > 15% מה-mid-החי
const DAILY_LOSS_STOP_BPS = 300; // -3% מערך-הפתיחה → עצירת-הסוכן
const PROFIT_SWEEP_BPS = 200;   // +2% מעל-baseline → הסוואר מעביר-עודף

// ── הצבא: 11 חיילי-ROT1 → תפקידי-חיים-שניים ────────────────────────────────
// (ROT1_ACCOUNTS — אותה-רשימה בדיוק מ-src/lib/keys.ts של הריפו-האם)
type Strategy = "COMMANDER" | "MM" | "GRID" | "ARB" | "PULSE" | "SENTINEL" | "SWEEPER";
interface AgentDef {
  name: string;            // חשבון-המנוע: legion-<name>
  fallen: string;          // החייל-שנפל (שם-ה-ROT1)
  strategy: Strategy;
  pair?: [string, string]; // [base, quote]
  clipMu?: number;         // גודל-פקודה
  spreadBps?: number;      // MM/GRID
  levels?: number;         // GRID
  arbBps?: number;         // ARB threshold
  pulseMs?: number;        // PULSE cadence
  seed?: { [asset: string]: number }; // זריעה-חד-פעמית מהאוצר
  fuel?: number;           // credits-זריעה
  note: string;
}
export const FLEET: AgentDef[] = [
  { name: "legion-headcorner", fallen: "headcorner", strategy: "COMMANDER", fuel: 2000,
    note: "המפקד: בריאות-הלגיון, תדלוק-credits לסוכנים-שאזל, אכיפת-עצירות-הפסד" },
  { name: "legion-cashmachine", fallen: "cashmachine", strategy: "MM", pair: ["SAOS", "USDS"],
    clipMu: 1500, spreadBps: 120, fuel: 3000,
    seed: { SAOS: 40000, USDS: 60000 },
    note: "מייקר-דו-צדדי על הדגל SAOS/USDS — מרווח-פרסה, נזילות-רציפה לספר" },
  { name: "legion-haran", fallen: "haran", strategy: "GRID", pair: ["SAOS", "USDS"],
    clipMu: 800, spreadBps: 120, levels: 3, fuel: 3000,
    seed: { SAOS: 40000, USDS: 60000 },
    note: "גריד 3+3 מדרגות סביב ה-mid — קוטף-תנודתיות, מזין-עמלים" },
  { name: "legion-israelnews", fallen: "israelnews", strategy: "MM", pair: ["ENERGY", "SAOS"],
    clipMu: 3000, spreadBps: 180, fuel: 3000,
    seed: { ENERGY: 15000, SAOS: 12000 },
    note: "מייקר על ENERGY/SAOS (הבריכה השנייה-המאונכת) — נזילות-רוחב" },
  { name: "legion-lsa", fallen: "lsa", strategy: "ARB", pair: ["SAOS", "USDS"],
    clipMu: 4000, arbBps: 250, pulseMs: 60_000, fuel: 3000,
    seed: { SAOS: 30000, USDS: 40000 },
    note: "ארביטראז' mid-בריכה מול עוגן-האורקל (refPrice) — מצמיד-מחיר-פנימי-לאמת" },
  { name: "legion-macrame", fallen: "macrame", strategy: "PULSE", pair: ["SAOS", "USDS"],
    clipMu: 300, pulseMs: 90_000, fuel: 2000,
    seed: { SAOS: 8000, USDS: 12000 },
    note: "דופק-הרשת: סוואג'-AMM קטן-מתחלף כל-90ש׳ — עמלים-אמת ל-LP/אוצר" },
  { name: "legion-siq", fallen: "siq", strategy: "SENTINEL",
    note: "סנטינל USDS/WSTEEM: הבריכה סוטה מהעוגן (×300) — אסור-סחר-מול-מיספור-שגוי; דיווח-והצעת-repeg" },
  { name: "legion-tov", fallen: "tov", strategy: "PULSE", pair: ["SAOS", "USDS"],
    clipMu: 250, pulseMs: 75_000, fuel: 2000,
    seed: { SAOS: 8000, USDS: 12000 },
    note: "דופק שני — קצב-שונה, מכסה-חלונות-שהראשון מפספס" },
  { name: "legion-wic", fallen: "wic", strategy: "SENTINEL",
    note: "סנטינל USDS/WTRX: סטיית-העיגון-המתועדת (דלת-המטבעות: WTRX DIVERGENT) — עין-חיה, אפס-סחר" },
  { name: "legion-wog", fallen: "wog", strategy: "ARB", pair: ["ENERGY", "SAOS"],
    clipMu: 1500, arbBps: 300, pulseMs: 90_000, fuel: 3000,
    seed: { ENERGY: 10000, SAOS: 8000 },
    note: "ארביטראז' ENERGY/SAOS מול צולב-העוגנים (ENERGY-ref÷SAOS-ref)" },
  { name: "legion-woq", fallen: "woq", strategy: "SWEEPER", pulseMs: 300_000, fuel: 1000,
    note: "הסוואר: עודף-רווח מארנקי-הסוכנים → האוצר (עיגון-baseline, +2% סף) — הרווח-מתנקז-לכספת" },
];

// ── מצב-ריצה ────────────────────────────────────────────────────────────────
interface AgentState {
  def: AgentDef; enabled: boolean; stoppedReason?: string;
  lastActionAt: number; lastAction?: string; lastError?: string;
  ordersPlaced: number; ordersCanceled: number; swapsDone: number;
  feesPaidMu: number; openOrders: number;
  sweptMu: number; // EXEC-CD-31: Σ רווחים-אמת שנסחבו מהארנק-שלו → האוצר (מדידה)
  baseline?: { [asset: string]: number }; // ערך-פתיחה לעצירת-הפסד/רווח
  credits?: number; balances?: { [a: string]: number };
  valueMu?: number; // שווי-תיק ב-µ-USDS (מדידה)
}
interface LedgerEntry { at: number; h: number; agent: string; kind: string; note: string; }
const st = {
  startedAt: Date.now(), kill: false,
  agents: new Map<string, AgentState>(),
  ledger: [] as LedgerEntry[],
  bootstrapped: false, bootstrapLog: [] as string[],
  ticks: 0,
};

// ── עזרים ───────────────────────────────────────────────────────────────────
const log = (m: string) => console.log(`[legion] ${new Date().toISOString()} ${m}`);
function led(agent: string, kind: string, note: string) {
  const h = lastHeight;
  st.ledger.push({ at: Date.now(), h, agent, kind, note });
  if (st.ledger.length > 600) st.ledger.splice(0, st.ledger.length - 600);
  try {
    const { appendFileSync, mkdirSync } = require("fs");
    mkdirSync(`${import.meta.dir}/state`, { recursive: true });
    appendFileSync(`${import.meta.dir}/state/ledger.jsonl`, JSON.stringify({ at: Date.now(), h, agent, kind, note }) + "\n");
  } catch { /* נוחות-בלבד — השרשרת היא המקור */ }
}

let lastHeight = 0;
let engState: any = null;
let engStateAt = 0;
async function engineState(force = false): Promise<any> {
  if (!force && engState && Date.now() - engStateAt < 3000) return engState;
  const r = await fetch(`${ENGINE}/state`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`engine HTTP ${r.status}`);
  const j = await r.json();
  engState = j; engStateAt = Date.now();
  lastHeight = j?.state?.height ?? j?.version ?? lastHeight;
  return j;
}
async function enginePost(path: string, body: unknown): Promise<{ ok: boolean; error?: string; note?: string; [k: string]: unknown }> {
  const r = await fetch(`${ENGINE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-saos-operator": OP_TOKEN, "x-saos-dex-console": "1" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  return await r.json().catch(() => ({ ok: false, error: `bad-json HTTP ${r.status}` }));
}
function poolOf(state: any, base: string, quote: string): any | null {
  const want = new Set([`${base}/${quote}`, `${quote}/${base}`]);
  return (state.pools ?? []).find((p: any) => want.has(p.key)) ?? null;
}
// mid קנוני ביחידות quote-מילי ליחידת-base (מ-AMM ra/rb אמת)
function poolMid(p: any, base: string, quote: string): number | null {
  if (!p) return null;
  const ra = p.a === base ? p.ra : p.rb, rb = p.a === base ? p.rb : p.ra;
  if (!(ra > 0) || !(rb > 0)) return null;
  return Math.floor((rb / ra) * 1000); // µ-quote per µ-base ×1000 → milli-quote per base... 
}
// הערה-על-יחידות: mid של SAOS/USDS=1324 = 1.324 USDS ל-SAOS. חישוב-ה-AMM:
// מחיר-שוק = rb/ra כש-ra=SAOS (base), rb=USDS (quote) → יחידות-raw של quote-µ
// ל-unit-base... המנוע מציג mid=1324 עבור 1.324 — כלומר mid הוא milli-quote
// ל-unit-base. אנחנו מייצרים-את-אותו-מספר בדיוק מ-ra/rb.
function midFor(state: any, base: string, quote: string): number | null {
  const p = poolOf(state, base, quote);
  if (!p) return null;
  return typeof p.mid === "number" ? p.mid : poolMid(p, base, quote);
}

// ── בוטסטראפ: זריעה חד-פעמית מהאוצר לארנקי-הסוכנים ─────────────────────────
async function bootstrap() {
  const state = await engineState(true);
  const have = new Set((state.wallets ?? []).map((w: any) => w.name));
  for (const d of FLEET) {
    const wallet = d.name;
    if (!d.seed && !d.fuel) continue;
    if (have.has(wallet)) { st.bootstrapLog.push(`${wallet}: קיים — דילוג (live-wins)`); continue; }
    let okAll = true;
    for (const [asset, amt] of Object.entries(d.seed ?? {})) {
      const r = await enginePost("/transfer", { from: "treasury", to: wallet, asset, amountMu: amt });
      if (!r.ok) { okAll = false; st.bootstrapLog.push(`${wallet}: זריעה ${asset} נדחתה — ${r.error}`); led("system", "seed-reject", `${wallet} ${asset} ${r.error}`); }
      else { led("system", "seed", `${wallet} ${amt}µ ${asset}`); await new Promise(r2 => setTimeout(r2, 350)); }
    }
    if (d.fuel) {
      const r = await enginePost("/maker/refuel", { to: wallet, amount: d.fuel });
      if (!r.ok) { okAll = false; st.bootstrapLog.push(`${wallet}: דלק נדחה — ${r.error}`); led("system", "fuel-reject", `${wallet} ${r.error}`); }
      else { led("system", "fuel", `${wallet} ${d.fuel} credits`); await new Promise(r2 => setTimeout(r2, 350)); }
    }
    if (okAll) st.bootstrapLog.push(`${wallet}: זריעה מלאה`);
  }
  st.bootstrapped = true;
  try { require("fs").writeFileSync(`${import.meta.dir}/state/bootstrapped.json`, JSON.stringify({ at: Date.now(), h: lastHeight })); } catch {}
  log(`bootstrap done: ${st.bootstrapLog.length} רשומות`);
}

// ── אימות-פקודה-בטוחה ───────────────────────────────────────────────────────
function sanityPrice(px: number, mid: number): boolean {
  if (!(px > 0) || !(mid > 0)) return false;
  return Math.abs(px - mid) / mid <= PRICE_SANITY_BPS / 10000;
}
async function myOrders(agent: string): Promise<any[]> {
  try {
    const r = await fetch(`${ENGINE}/my-orders?issuer=${agent}`, { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    return j?.orders ?? [];
  } catch { return []; }
}

// ── אסטרטגיות ───────────────────────────────────────────────────────────────
async function tickMM(a: AgentState) {
  const d = a.def; const [base, quote] = d.pair!;
  const state = await engineState();
  const mid = midFor(state, base, quote);
  if (!mid) { a.lastError = `אין-mid ל-${base}/${quote}`; return; }
  const mine = await myOrders(d.name);
  const live = mine.filter(o => o.base === base && o.quote === quote);
  // ניקוי-פקודות-סוטות (> 2×spread מה-mid הנוכחי)
  const half = (d.spreadBps! / 2) / 10000;
  for (const o of live) {
    const drift = Math.abs(o.price - mid) / mid;
    if (drift > half * 2.2) {
      const r = await enginePost("/cancel", { orderId: o.id, issuer: d.name });
      if (r.ok) { a.ordersCanceled++; led(d.name, "cancel", `#${o.id} סטה ${(drift * 10000).toFixed(0)}bps`); }
      await new Promise(r2 => setTimeout(r2, 300));
    }
  }
  const stillLive = (await myOrders(d.name)).filter(o => o.base === base && o.quote === quote);
  if (stillLive.length >= 2) { a.lastAction = `מחזיק ${stillLive.length} פקודות-חיות`; return; }
  // הצעה-חסרה: קנייה מתחת ל-mid, מכירה מעליו (postOnly — אף-הצלבה-עצמית)
  const px = Math.floor(mid * (1 - half));
  const missingBuy = !stillLive.some(o => o.side === "buy");
  const missingSell = !stillLive.some(o => o.side === "sell");
  if (missingBuy) {
    const r = await enginePost("/order", { action: "order", base, quote, side: "buy", price: px, amount: d.clipMu, postOnly: true, issuer: d.name });
    if (r.ok) { a.ordersPlaced++; a.lastAction = `buy ${d.clipMu}µ @${px}`; led(d.name, "order", `buy ${d.clipMu}µ ${base} @${px}`); }
    else { a.lastError = r.error; led(d.name, "order-reject", `buy @${px}: ${r.error}`); }
    await new Promise(r2 => setTimeout(r2, 300));
  }
  if (missingSell) {
    const px2 = Math.floor(mid * (1 + half));
    const r = await enginePost("/order", { action: "order", base, quote, side: "sell", price: px2, amount: d.clipMu, postOnly: true, issuer: d.name });
    if (r.ok) { a.ordersPlaced++; a.lastAction = `sell ${d.clipMu}µ @${px2}`; led(d.name, "order", `sell ${d.clipMu}µ ${base} @${px2}`); }
    else { a.lastError = r.error; led(d.name, "order-reject", `sell @${px2}: ${r.error}`); }
  }
}
async function tickGRID(a: AgentState) {
  const d = a.def; const [base, quote] = d.pair!;
  const state = await engineState();
  const mid = midFor(state, base, quote);
  if (!mid) { a.lastError = "אין-mid"; return; }
  const mine = (await myOrders(d.name)).filter(o => o.base === base && o.quote === quote);
  const step = d.spreadBps! / 10000;
  const need: Array<{ side: "buy" | "sell"; price: number; amount: number }> = [];
  for (let i = 1; i <= (d.levels ?? 3); i++) {
    need.push({ side: "buy", price: Math.floor(mid * (1 - step * i)), amount: d.clipMu! });
    need.push({ side: "sell", price: Math.floor(mid * (1 + step * i)), amount: d.clipMu! });
  }
  // ביטול-פקודות-שכבר-אינן-בגריד (mid זז > 0.6%)
  for (const o of mine) {
    const inGrid = need.some(n => n.side === o.side && Math.abs(n.price - o.price) / o.price < 0.004);
    if (!inGrid) {
      const r = await enginePost("/cancel", { orderId: o.id, issuer: d.name });
      if (r.ok) { a.ordersCanceled++; led(d.name, "cancel", `#${o.id} יצא-מהגריד`); }
      await new Promise(r2 => setTimeout(r2, 250));
    }
  }
  const live2 = (await myOrders(d.name)).filter(o => o.base === base && o.quote === quote);
  if (live2.length >= MAX_OPEN_ORDERS) return;
  for (const n of need) {
    if (live2.length >= MAX_OPEN_ORDERS) break;
    if (live2.some(o => o.side === n.side && Math.abs(o.price - n.price) / n.price < 0.004)) continue;
    if (!sanityPrice(n.price, mid)) continue;
    const r = await enginePost("/order", { action: "order", base, quote, side: n.side, price: n.price, amount: n.amount, postOnly: true, issuer: d.name });
    if (r.ok) { a.ordersPlaced++; a.lastAction = `${n.side} ${n.amount}µ @${n.price}`; led(d.name, "order", `${n.side} ${n.amount}µ @${n.price}`); }
    else { a.lastError = r.error; led(d.name, "order-reject", `${n.side} @${n.price}: ${r.error}`); }
    await new Promise(r2 => setTimeout(r2, 250));
  }
}
async function tickARB(a: AgentState) {
  const d = a.def; const [base, quote] = d.pair!;
  const state = await engineState();
  const mid = midFor(state, base, quote);
  if (!mid) { a.lastError = "אין-mid"; return; }
  // עוגן: refPrice של הבסיס ב-milli-quote ל-unit (קנוני-מנוע); ENERGY/SAOS =
  // ENERGY-ref(מילי-USDS) ÷ SAOS-ref(מילי-USDS) × 1000 → milli-SAOS ל-ENERGY
  const refBase = state.assets?.[base]?.refPrice; const refQuote = state.assets?.[quote]?.refPrice;
  if (!(refBase > 0) || !(refQuote > 0)) { a.lastError = "אין-עוגן"; return; }
  const anchor = Math.floor((refBase / refQuote) * 1000);
  const dev = (mid - anchor) / anchor;
  a.lastAction = `mid ${mid} מול עוגן ${anchor} (${(dev * 10000).toFixed(0)}bps)`;
  if (Math.abs(dev) * 10000 < d.arbBps!) return; // אין-סטייה-מספקת
  // mid>עוגן → מוכרים-base-לבריכה (מוריד-mid); mid<עוגן → קונים
  const assetIn = dev > 0 ? base : quote;
  const amount = assetIn === base ? d.clipMu! : Math.floor((d.clipMu! * mid) / 1000);
  const r = await enginePost("/swap", { pair: `${base}/${quote}`, assetIn, amount, issuer: d.name });
  if (r.ok) { a.swapsDone++; led(d.name, "arb", `${amount}µ ${assetIn} (dev ${(dev * 10000).toFixed(0)}bps)`); }
  else { a.lastError = r.error; led(d.name, "arb-reject", `${assetIn}: ${r.error}`); }
}
async function tickPULSE(a: AgentState) {
  const d = a.def; const [base, quote] = d.pair!;
  const state = await engineState();
  const mid = midFor(state, base, quote);
  if (!mid) return;
  // מתחלף-כיוון לפי-זמן — קטן, כנגד-הבריכה (עמלים-אמת ל-LP)
  const dir = Math.floor(Date.now() / (d.pulseMs ?? 90_000)) % 2 === 0;
  const assetIn = dir ? base : quote;
  const amount = dir ? d.clipMu! : Math.floor((d.clipMu! * mid) / 1000);
  const r = await enginePost("/swap", { pair: `${base}/${quote}`, assetIn, amount, issuer: d.name });
  if (r.ok) { a.swapsDone++; a.lastAction = `דופק ${amount}µ ${assetIn}`; led(d.name, "pulse", `${amount}µ ${assetIn} → בריכה`); }
  else { a.lastError = r.error; led(d.name, "pulse-reject", `${assetIn}: ${r.error}`); }
}
async function tickSENTINEL(a: AgentState) {
  const d = a.def;
  const state = await engineState();
  if (d.name === "legion-siq") {
    const mid = midFor(state, "WSTEEM", "USDS");
    const ref = state.assets?.WSTEEM?.refPrice;
    if (mid && ref) {
      const dev = Math.abs(mid - ref) / ref;
      a.lastAction = `USDS/WSTEEM mid ${mid} מול עוגן ${ref} — סטייה ${(dev * 100).toFixed(0)}% — אסור-סחר; הצעת-repeg לאוצר`;
      a.lastError = dev > 0.5 ? "pool-divergent (סחר-אסור-מבנית)" : undefined;
    }
  } else if (d.name === "legion-wic") {
    const mid = midFor(state, "WTRX", "USDS");
    const ref = state.assets?.WTRX?.refPrice;
    if (mid && ref) {
      const dev = Math.abs(mid - ref) / ref;
      a.lastAction = `USDS/WTRX mid ${mid} מול עוגן ${ref} — סטייה ${(dev * 100).toFixed(0)}% (תואם-דלת-המטבעות: DIVERGENT)`;
      a.lastError = dev > 0.5 ? "pool-divergent (סחר-אסור-מבנית)" : undefined;
    }
  }
}
async function tickSWEEPER(a: AgentState) {
  const state = await engineState(true);
  const wallets = new Map<string, any>((state.wallets ?? []).map((w: any) => [w.name, w]));
  const mid = midFor(state, "SAOS", "USDS") ?? 1324;
  for (const d of FLEET) {
    if (d.strategy === "COMMANDER" || d.strategy === "SWEEPER" || d.strategy === "SENTINEL" || !d.seed) continue;
    const w = wallets.get(d.name); if (!w) continue;
    const base = d.pair?.[0] ?? "SAOS";
    const bal = w.balances ?? {};
    const pxOf: Record<string, number> = { USDS: 1000, [base]: mid };
    let value = 0; for (const [a2, amt] of Object.entries(bal)) value += (amt as number) * (pxOf[a2] ?? 0);
    a2s(d.name).valueMu = Math.floor(value);
    if (!a2s(d.name).baseline) { a2s(d.name).baseline = { ...bal }; continue; }
    const base0 = a2s(d.name).baseline!;
    const profit = value - Object.entries(base0).reduce((s, [a2, amt]) => s + amt * (pxOf[a2] ?? 0), 0);
    const openPct = profit / Math.max(1, Object.entries(base0).reduce((s, [a2, amt]) => s + amt * (pxOf[a2] ?? 0), 0));
    if (openPct > PROFIT_SWEEP_BPS / 10000) {
      const surplus = Math.floor((bal.USDS ?? 0) - (base0.USDS ?? 0) - 1000);
      if (surplus > 2000) {
        const r = await enginePost("/transfer", { from: d.name, to: "treasury", asset: "USDS", amountMu: surplus });
        if (r.ok) {
          led(d.name, "sweep", `→אוצר ${surplus}µ USDS (רווח ${(openPct * 100).toFixed(1)}%)`); a.ordersPlaced++;
          // EXEC-CD-31: מד-הרווחים — הסחיבה-הזאת היא רווח-אמת של הסוכן-המקור
          const src = st.agents.get(d.name); if (src) src.sweptMu += surplus;
          a.sweptMu = (a.sweptMu ?? 0) + surplus; // צבירה-גם-אצל-הסוואר (הכלי-שהניב)
        }
        await new Promise(r2 => setTimeout(r2, 300));
      }
    }
  }
}
function a2s(name: string): AgentState { return st.agents.get(name)!; }
async function tickCOMMANDER(a: AgentState) {
  const state = await engineState(true);
  const wallets = new Map<string, any>((state.wallets ?? []).map((w: any) => [w.name, w]));
  for (const d of FLEET) {
    if (d.strategy === "COMMANDER") continue;
    const w = wallets.get(d.name); if (!w) continue;
    const credits = w.credits ?? 0;
    a2s(d.name).credits = credits;
    if (credits < 600) {
      const r = await enginePost("/maker/refuel", { to: d.name, amount: 1500 });
      if (r.ok) { led(d.name, "refuel", "+1500 credits (מפקד)"); a.ordersPlaced++; }
      else { led(d.name, "refuel-reject", String(r.error)); }
      await new Promise(r2 => setTimeout(r2, 300));
    }
  }
  a.lastAction = `פיקוד: ${FLEET.length} חיילים · גובה ${lastHeight}`;
}

// ── לולאת-הטיק הראשית (מדורגת-פר-סוכן) ──────────────────────────────────────
const STRATS: Record<Strategy, (a: AgentState) => Promise<void>> = {
  COMMANDER: tickCOMMANDER, MM: tickMM, GRID: tickGRID, ARB: tickARB,
  PULSE: tickPULSE, SENTINEL: tickSENTINEL, SWEEPER: tickSWEEPER,
};
async function tickAgent(a: AgentState) {
  if (st.kill || !a.enabled) return;
  const now = Date.now();
  if (now - a.lastActionAt < COOLDOWN_MS && a.def.strategy !== "SENTINEL") return;
  if (a.stoppedReason) return;
  try {
    // רענון-מדינה קודם-כל (cache 3s) — ואז בדיקת-טריות כנה (על-הערך-המרוענן)
    await engineState();
    if (Date.now() - engStateAt > STATE_STALE_MS) { a.lastError = "state-ישן — דילוג-כנה"; return; }
    await STRATS[a.def.strategy](a);
    a.lastActionAt = now; a.lastError = undefined;
  } catch (e: unknown) {
    a.lastError = e instanceof Error ? e.message.slice(0, 90) : "שגיאה-לא-ידועה";
  }
  st.ticks++;
}
async function mainLoop() {
  // מדורג: כל-סוכן על-קצב-משלו
  for (const d of FLEET) {
    const a = st.agents.get(d.name);
    if (!a) continue;
    const period = d.strategy === "COMMANDER" ? 60_000
      : d.strategy === "SWEEPER" ? (d.pulseMs ?? 300_000)
      : d.strategy === "SENTINEL" ? 30_000
      : d.strategy === "PULSE" ? 15_000 // פועל-כל-טיק-אבל-הדופק-עצמו מוגבל-pulseMs (כיוון לפי-זמן)
      : 12_000;
    setInterval(() => { void tickAgent(a); }, period + Math.floor(Math.random() * 1500));
  }
  // מוניטור-ערך-תיק כל-30ש׳ (עצירת-הפסד)
  setInterval(async () => {
    try {
      const state = await engineState(true);
      const wallets = new Map<string, any>((state.wallets ?? []).map((w: any) => [w.name, w]));
      const mid = midFor(state, "SAOS", "USDS") ?? 1324;
      for (const d of FLEET) {
        if (!d.seed) continue;
        const a = st.agents.get(d.name)!; const w = wallets.get(d.name);
        if (!w) continue;
        a.balances = w.balances ?? {}; a.credits = w.credits ?? 0;
        const base = d.pair?.[0] ?? "SAOS";
        const pxOf: Record<string, number> = { USDS: 1000, [base]: mid };
        let openVal = 0; for (const [a2, amt] of Object.entries(a.baseline ?? {})) openVal += amt * (pxOf[a2] ?? 0);
        let val = 0; for (const [a2, amt] of Object.entries(a.balances)) val += amt * (pxOf[a2] ?? 0);
        a.valueMu = Math.floor(val);
        if (openVal > 0 && !a.stoppedReason) {
          const chg = (val - openVal) / openVal;
          if (chg < -DAILY_LOSS_STOP_BPS / 10000) {
            a.stoppedReason = `עצירת-הפסד: ${(chg * 100).toFixed(1)}% מערך-הפתיחה`;
            // ביטול-כל-הפקודות-החיות שלו
            const mine = await myOrders(d.name);
            for (const o of mine) { await enginePost("/cancel", { orderId: o.id, issuer: d.name }); await new Promise(r => setTimeout(r, 250)); }
            led(d.name, "loss-stop", a.stoppedReason);
          }
        }
      }
      // מונה-פקודות-פתוחות
      for (const d of FLEET) { const a = st.agents.get(d.name)!; try { a.openOrders = (await myOrders(d.name)).length; } catch { /* כנות */ } }
    } catch { /* מנוע-לא-זמין — הטיק-הבא ינסה */ }
  }, 30_000);
}

// ── HTTP ────────────────────────────────────────────────────────────────────
function fleetSnapshot() {
  return FLEET.map(d => {
    const a = st.agents.get(d.name)!;
    return {
      name: d.name, fallen: d.fallen, strategy: d.strategy, pair: d.pair ?? null, note: d.note,
      enabled: a.enabled, stoppedReason: a.stoppedReason ?? null,
      ordersPlaced: a.ordersPlaced, ordersCanceled: a.ordersCanceled, swapsDone: a.swapsDone,
      openOrders: a.openOrders, credits: a.credits ?? null, balances: a.balances ?? null,
      valueMu: a.valueMu ?? null, sweptMu: a.sweptMu ?? 0,
      lastAction: a.lastAction ?? null, lastError: a.lastError ?? null,
      lastActionAt: a.lastActionAt || null,
    };
  });
}
async function control(body: any): Promise<{ ok: boolean; note?: string; error?: string }> {
  const op = String(body?.op ?? "");
  const agent = typeof body?.agent === "string" ? body.agent : null;
  if (op === "kill") { st.kill = true; led("system", "kill", "מתג-הרג-גלובלי"); return { ok: true, note: "הלגיון עוצר" }; }
  if (op === "resume") { st.kill = false; led("system", "resume", "הלגיון חוזר"); return { ok: true, note: "הלגיון פועל" }; }
  if ((op === "start" || op === "stop") && agent) {
    const a = st.agents.get(agent); if (!a) return { ok: false, error: "agent-לא-נמצא" };
    a.enabled = op === "start"; if (op === "start") a.stoppedReason = undefined;
    led(agent, op, op === "start" ? "הופעל-על-ידי-המפעיל" : "הושבת-על-ידי-המפעיל");
    return { ok: true, note: `${agent} ${op === "start" ? "פועל" : "מושבת"}` };
  }
  if (op === "bootstrap") { await bootstrap(); return { ok: true, note: `bootstrap: ${st.bootstrapLog.length} רשומות` }; }
  return { ok: false, error: "op-לא-מוכר (kill|resume|start|stop|bootstrap)" };
}
const server = Bun.serve({
  port: PORT, hostname: "127.0.0.1",
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/api/legion/health") {
      return Response.json({ ok: true, service: "saos-legion", kill: st.kill, bootstrapped: st.bootstrapped, height: lastHeight, ticks: st.ticks });
    }
    if (u.pathname === "/api/legion/state") {
      return Response.json({
        ok: true, service: "saos-legion", kill: st.kill, bootstrapped: st.bootstrapped,
        startedAt: st.startedAt, height: lastHeight, ticks: st.ticks,
        doctrine: "כל-פעולה-כאן = פקודה-אמת על רשת-ה-DEX → עמלים → כספת-העתודה → סולם-הרלוונטיות. מצבת-האמת: chain-journal של המנוע (שדה soldier) + state-push ל-git.",
        fleet: fleetSnapshot(),
        ledger: st.ledger.slice(-80).reverse(),
        bootstrapLog: st.bootstrapLog.slice(-24),
      });
    }
    if (u.pathname === "/api/legion/control" && req.method === "POST") {
      if (!CTRL_TOKEN) return Response.json({ ok: false, error: "legion-unconfigured" }, { status: 503 });
      if (req.headers.get("x-legion-key") !== CTRL_TOKEN) return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
      const body = await req.json().catch(() => ({}));
      return Response.json(await control(body));
    }
    return Response.json({ ok: false, error: "not-found" }, { status: 404 });
  },
});

// ── עלייה ───────────────────────────────────────────────────────────────────
for (const d of FLEET) {
  st.agents.set(d.name, {
    def: d, enabled: true, lastActionAt: 0,
    ordersPlaced: 0, ordersCanceled: 0, swapsDone: 0, feesPaidMu: 0, openOrders: 0, sweptMu: 0,
  });
}
log(`SAOS-LEGION עולה על :${PORT} — ${FLEET.length} חיילים (חיים-שניים ל-ROT1)`);
void (async () => {
  // המתנה-למנוע ואז בוטסטראפ (חד-פעמי — live-wins: ארנקים-קיימים לא-נגעים)
  for (let i = 0; i < 30; i++) {
    try { await engineState(true); break; } catch { await new Promise(r => setTimeout(r, 3000)); }
  }
  try { await bootstrap(); } catch (e) { log(`bootstrap-נכשל: ${e instanceof Error ? e.message : e}`); }
  void mainLoop();
})();
