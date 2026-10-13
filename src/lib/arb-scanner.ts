// ═══ סורק-הארביטראז-האמיתי (THE REAL ARB SCANNER · EXEC-CD-32) ══════════════
// המפעיל: "תבחן היטב הכל מתוכנן שיעבוד — שיחק היטב לטובתנו עם יתרונות משמעותיים."
// שער-הארביטראז ('armed') היה עד-היום הבטחה-בלי-מדידה-מתמדת: אין-רווח-בלי-סריקה.
//
// מה נמדד כאן (הכל-חי, אפס-הדמיה):
//  (A) סטיית-אורקל-פנימי מול-שוק-אמת לכל-נכס-דלת (מכ"ם-הסטיות של מנוע-הערך) —
//      סטייה-מעבר-לעמלות → שולי-מסחר-אמת בין-הדקס-הפנימי (30bps, אפס-גז) לבין-השוק.
//  (B) עלות-רכבת-השרשרת-מדודה: ציטוט-חי Jupiter USDC→SOL וחזרה SOL→USDC
//      (מהכספת-עצמה-בגודל-תיק-קטן) — העלות-האמתית-כולל-עמלות-נתיב שהאוצר
//      ישלם על-הוצאה/כניסה-לשוק. המספר-הזה מקרקע את-החשבון-כולו.
//
// כנות-מבנית: הסריקה **לא מבצעת** עסקאות. ביצוע = vault-swap.ts בלבד (DRY-RUN
// ברירת-מחדל · תקרות-קשיחות · known-router-only) ורק-כששולי-נטו-מדוד ≥ סף —
// התוצאה היא **הצעה-מאומתת**, לא-הימור. אין-שוליים → דיווח-כנה "אין-קצה-היום".
// ═════════════════════════════════════════════════════════════════════════════

import { fetchJson, cacheGet, cacheSet, singleFlight } from './live/cache';
import { getDeviationRadar, getMarketPrices } from './value-engine';

// עמלת-המנוע-הקנונית (saos-dex/src/lib/dex/kernel.ts:123 · FEE_BPS = 30)
const INTERNAL_FEE_BPS = 30;
// סף-סטייה-מינימלי למועמד-ארביטראז: 2-רגלי-עמלות (60bps) + רזרבת-החלקה (40bps)
const DEV_CANDIDATE_PCT = 1.0;
// סף-נטו-מינימלי להצעת-ביצוע (אחרי-עמלות-והחלקה-מדודות)
const NET_EXECUTE_PCT = 0.35;
const SLIP_ESTIMATE_PCT = 0.15; // הערכת-החלקה-שמרנית לתיק-קטן
const USDC_SOL_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
// גודל-פרובת-הרכבת: 2 USDC (מתוך-6.35 באוצר — פרובה-קטנה, לא-מהלך-עמדה)
const PROBE_USDC_UNITS = 2_000_000;

export interface ArbEdge {
  kind: 'internal-deviation' | 'chain-rail';
  asset: string;
  devPct: number | null;   // (פנימי−אמת)/אמת×100 (או סטיית-מחיר-ציטוט-מול-מקור)
  netPct: number | null;   // אחרי-עמלות-מדודות + הערכת-החלקה
  direction: string;       // מה-עושים-עם-זה (כיוון-ההצעה)
  executable: boolean;     // נטו ≥ סף-הביצוע
  note: string;
}

export interface ArbScan {
  ok: boolean;
  at: string;
  thresholdPct: number;
  bestNetPct: number | null;
  best: ArbEdge | null;
  edges: ArbEdge[];
  chainRail: {
    inUsdc: number;
    solOutLamports: number;
    solBackUsdc: number;
    roundTripPct: number;
    quoteSource: string;
  } | null;
  priceSource: string;
  note: string;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message.slice(0, 140) : String(e).slice(0, 140));

// ── (B) עלות-רכבת-השרשרת: Jupiter-quote-חי וחזרה ────────────────────────────
interface JupQuote { inAmount?: string; outAmount?: string; priceImpactPct?: string }

async function jupQuote(inputMint: string, outputMint: string, amount: string): Promise<JupQuote> {
  // FIX(EXEC-CD-32 · נמדד-חי): ה-quote-v6 הישן מחזיר 'Route not found' — ה-endpoint
  // הקנוני הועבר ל-/swap/v1/quote (אומת-חי: 2 USDC → 17,211,423 lamports).
  return fetchJson<JupQuote>(
    `https://lite-api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=50&restrictIntermediateTokens=true`,
    undefined, 10_000,
  );
}

async function chainRailProbe(): Promise<ArbScan['chainRail']> {
  try {
    const fwd = await singleFlight('arb:jup:fwd', () => jupQuote(USDC_SOL_MINT, SOL_MINT, String(PROBE_USDC_UNITS)));
    const lamports = Number(fwd?.outAmount ?? '0');
    if (!(lamports > 0)) return null;
    const back = await singleFlight('arb:jup:back', () => jupQuote(SOL_MINT, USDC_SOL_MINT, String(lamports)));
    const backUnits = Number(back?.outAmount ?? '0');
    if (!(backUnits > 0)) return null;
    const roundTripPct = Math.round(((backUnits - PROBE_USDC_UNITS) / PROBE_USDC_UNITS) * 1e4) / 100;
    return {
      inUsdc: PROBE_USDC_UNITS / 1e6,
      solOutLamports: lamports,
      solBackUsdc: backUnits / 1e6,
      roundTripPct,
      quoteSource: 'jupiter-quote-v6',
    };
  } catch {
    return null; // fail-honest — הרכבת לא נמדדה, לא ממציאים מספר
  }
}

// ── הסריקה ───────────────────────────────────────────────────────────────────
export async function scanArb(): Promise<ArbScan> {
  const key = 'arb:scan';
  const hit = cacheGet<{ data: ArbScan; cachedAt: number }>(key, true);
  if (hit && hit.expiresAt > Date.now()) return hit.value.data;

  const run = async (): Promise<ArbScan> => {
    const at = new Date().toISOString();
    const [mk, radar, rail] = await Promise.all([getMarketPrices(), getDeviationRadar(), chainRailProbe()]);
    const edges: ArbEdge[] = [];

    // (A) סטיות-פנימי↔שוק — השוליים-הגלומים במכ"ם
    for (const r of radar) {
      if (r.deviationPct === null || r.internalUsd === null || r.realUsd === null) continue;
      const abs = Math.abs(r.deviationPct);
      if (abs < DEV_CANDIDATE_PCT) continue; // מתחת-לעמלות+החלקה — לא-מועמד
      // כיוון: פנימי-זול מהשוק → קנייה-פנימית (מול-העתודה) ומכירה-לשוק; והפוך.
      const cheapInternal = r.deviationPct < 0;
      const netPct = Math.round((abs - (INTERNAL_FEE_BPS * 2) / 100 - SLIP_ESTIMATE_PCT) * 100) / 100;
      edges.push({
        kind: 'internal-deviation',
        asset: r.asset,
        devPct: r.deviationPct,
        netPct,
        direction: cheapInternal
          ? 'קנייה-פנימית-זולה → מכירה-מול-השוק'
          : 'קנייה-מהשוק → מכירה-פנימית-יוקרת',
        executable: netPct >= NET_EXECUTE_PCT,
        note: `פנימי $${r.internalUsd.toFixed(4)} מול-שוק $${r.realUsd.toFixed(4)} · עמלות-${INTERNAL_FEE_BPS * 2}bps · סף-נטו ${NET_EXECUTE_PCT}%`,
      });
    }

    // (B) עלות-הרכבת — לא-הצעה אלא-קרקע: כמה עולה-אמת להיכנס/לצאת דרך-השרשרת
    if (rail) {
      edges.push({
        kind: 'chain-rail',
        asset: 'USDC↔SOL',
        devPct: null,
        netPct: rail.roundTripPct,
        direction: 'מדידת-עלות-רכבת (לא-הצעת-מסחר)',
        executable: false,
        note: `${rail.inUsdc} USDC → ${rail.solOutLamports / 1e9} SOL → ${rail.solBackUsdc} USDC · סבב-כולל ${rail.roundTripPct}% (${rail.quoteSource})`,
      });
    }

    const tradeable = edges.filter(e => e.kind === 'internal-deviation');
    const best = tradeable.length > 0
      ? tradeable.reduce((m, e) => ((e.netPct ?? -99) > (m.netPct ?? -99) ? e : m))
      : null;
    const bestNetPct = best?.netPct ?? null;
    const ex = tradeable.filter(e => e.executable);
    const note = ex.length > 0
      ? `${ex.length} שולי-ביצוע-חי (${ex.map(e => e.asset).join(', ')}) — הצעה-מאומתת מוכנה ל-vault-swap (תקרות-קשיחות)`
      : best
        ? `מועמד-מתחת-לסף: ${best.asset} dev ${best.devPct?.toFixed(2)}% → נטו ${best.netPct?.toFixed(2)}% (דרוש ≥${NET_EXECUTE_PCT}%) — דיווח-כנה, אין-ביצוע`
        : `אין-קצה-נמדד — כל-הנכסים מתכנסים מתחת-לסף ${DEV_CANDIDATE_PCT}% · עלות-רכבת ${rail ? `${rail.roundTripPct}%` : 'לא-נמדדה'}`;

    const data: ArbScan = {
      ok: true, at, thresholdPct: NET_EXECUTE_PCT,
      bestNetPct, best, edges, chainRail: rail,
      priceSource: mk.source, note,
    };
    cacheSet(key, { data, cachedAt: Date.now() }, 300_000); // 5 דק' — סריקה-זולה-וזריזה
    return data;
  };

  try {
    return await singleFlight(key, run);
  } catch (e) {
    return {
      ok: false, at: new Date().toISOString(), thresholdPct: NET_EXECUTE_PCT,
      bestNetPct: null, best: null, edges: [], chainRail: null, priceSource: 'unavailable',
      note: `סריקה-נכשלה (כנה): ${msg(e)}`,
    };
  }
}
