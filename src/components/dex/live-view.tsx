'use client';

// ═══ גשר-החי — חיבור ממשי לרשתות ומטבעות ═══════════════════════════════════
// כל-הנתונים כאן נשלפים ישירות-ע"י הקונסולה-הריבונית ממקורות-אמת-ציבוריים:
//   · פרובות-בלוק חיות על 10 רשתות (RPC ציבורי — אפס-מפתחות, אפס-רישום)
//   · מחירי-שוק אמת (CoinGecko) + זוגות-מסחר אמת (DexScreener)
//   · ציטוטי-מסלול אמת (Jupiter · Solana) וציטוטים/גישור חוצה-שרשראות (Li.Fi)
//   · מטריצת-השוואה מול 23 הפרוטוקולים המתקדמים (מחקר EXEC-CD-15-a)
// כנות-גלויה: ציטוט = קריאה-בלבד (ביצוע-דורש-ארנק-חתימה) · מקור-שנפל = מדווח,
// לא-מזויף. אפס-תלות במנוע-ה-DEX הפנימי — שכבה-ריבונית-עצמאית לגמרי.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Radio, Search, Loader2, AlertTriangle, CheckCircle2, ExternalLink,
  ArrowDown, RefreshCw, ShieldCheck, Swords, Wifi, WifiOff,
} from 'lucide-react';
import { usePoll } from './common';

// ─── types ───────────────────────────────────────────────────────────────────
interface ChainStatus { id: string; name: string; kind: 'solana' | 'evm'; symbol: string; live: boolean; height: number | null; latencyMs: number | null; rpc: string | null; error: string | null; probedAt: string }
interface CoinRow { id: string; symbol: string; name: string; image: string; current_price: number; price_change_percentage_24h: number | null; market_cap: number; total_volume: number }
interface DsPair { chainId: string; dexId: string; pairAddress: string; url: string; baseToken: { address: string; name: string; symbol: string }; quoteToken?: { symbol: string }; priceUsd?: string; priceChange?: { h24?: number }; volume?: { h24?: number }; liquidity?: { usd?: number } }
interface ChainPairGroup { chain: string; label: string; pairs: DsPair[]; error?: string }
interface QuoteResult { ok: boolean; engine: string; tool?: string; outAmountHuman: number; outMinHuman: number; priceImpactPct?: string; slippageBps?: number; route?: string[]; subSteps?: string[]; outUsd?: number; gasUsd?: number; feeUsd?: number; durationSec?: number; crossChain?: boolean; probe?: boolean; error?: string }
interface BridgeRoute { rank: number; id: string; tools: string[]; outAmountHuman: number; outMinHuman: number; outUsd?: number; gasUsd?: number; feeUsd?: number; durationSec: number; stepsCount: number }
interface TokenRow { chain: string; address: string; symbol: string; name: string; icon?: string; priceUsd?: number; liquidityUsd?: number; mcapUsd?: number; verified?: boolean; organicScore?: number; source: string }
interface VersusData { protocols: Array<{ name: string; chains: string; highlights: string[]; features: string[]; notable: string }>; checklist: Array<{ feature: string; why: string; leaders: string; adoption: 'live' | 'partial' | 'planned' | 'out'; note: string }>; score: { live: number; partial: number; planned: number; out: number; total: number } }

// ─── helpers ─────────────────────────────────────────────────────────────────
function fmtUsd(n: number | undefined | null, digits = 2): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(digits)}`;
}
function fmtPrice(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return '—';
  if (n >= 100) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (n >= 1) return `$${n.toFixed(3)}`;
  return `$${n.toPrecision(4)}`;
}
function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}
function fmtInt(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US');
}
function fmtNum(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 });
}
function fmtDur(sec: number | undefined): string {
  if (!sec || !Number.isFinite(sec)) return '—';
  if (sec < 60) return `${Math.round(sec)}ש׳`;
  return `${Math.floor(sec / 60)}ד׳ ${Math.round(sec % 60)}ש׳`;
}

const ADOPTION_STYLE: Record<string, string> = {
  live: 'bg-[color:var(--green-soft)] text-[color:var(--green)] border-[color:var(--green)]/30',
  partial: 'bg-[color:var(--amber-soft,rgba(245,158,11,0.12))] text-[color:var(--amber,#f59e0b)] border-amber-500/30',
  planned: 'bg-white/5 text-[color:var(--text-2)] border-[color:var(--line)]',
  out: 'bg-white/[0.03] text-[color:var(--text-3)] border-[color:var(--line)] opacity-70',
};
const ADOPTION_LABEL: Record<string, string> = { live: 'חי', partial: 'חלקי', planned: 'בתכנון', out: 'מחוץ-לתחום' };

// ─── poll hook with pause-on-hidden (same doctrine as usePoll) ───────────────
function useLivePoll<T>(path: string, periodMs: number): { data: T | null; err: string | null; loading: boolean; refetch: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const alive = useRef(true);

  const refetch = useCallback(() => { setLoading(true); setTick(t => t + 1); }, []);

  useEffect(() => {
    alive.current = true;
    fetch(path, { cache: 'no-store' })
      .then(r => r.json())
      .then((j: T & { ok?: boolean; error?: string }) => {
        if (!alive.current) return;
        if (j && (j as { ok?: boolean }).ok === false) { setErr((j as { error?: string }).error || 'מקור-לא-נענה'); }
        else { setData(j); setErr(null); }
        setLoading(false);
      })
      .catch(e => { if (alive.current) { setErr(e instanceof Error ? e.message : String(e)); setLoading(false); } });
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return; // השהיה-בטאב-נסתר
      fetch(path, { cache: 'no-store' })
        .then(r => r.json())
        .then((j: T & { ok?: boolean; error?: string }) => {
          if (!alive.current) return;
          if (j && (j as { ok?: boolean }).ok === false) setErr((j as { error?: string }).error || 'מקור-לא-נענה');
          else { setData(j); setErr(null); }
        })
        .catch(() => { /* סבב-הבא ינסה שוב */ });
    }, periodMs);
    return () => { alive.current = false; clearInterval(timer); };
  }, [path, periodMs, tick]);

  return { data, err, loading, refetch };
}

// ═══ section 1: רשתות חיות ═══════════════════════════════════════════════════
function NetworksGrid() {
  const { data, err, loading, refetch } = useLivePoll<{ chains: ChainStatus[]; summary: { total: number; live: number } }>('/api/live/networks', 20000);
  const chains = data?.chains || [];

  return (
    <section aria-label="רשתות חיות" className="dx-card rounded-2xl p-4 md:p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h2 className="flex items-center gap-2 text-[15px] font-bold">
          <Radio className="w-4 h-4 text-[color:var(--pink)]" />
          רשתות-אמת · פרובות-בלוק חיות
          <span className="dx-chip h-6 px-2 text-[10px] flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${data && data.summary.live === data.summary.total ? 'bg-[color:var(--green)] pulse-ring' : 'bg-[color:var(--amber,#f59e0b)]'}`} />
            <span className="dx-num" dir="ltr">{data ? `${data.summary.live}/${data.summary.total}` : '…'}</span>
          </span>
        </h2>
        <button onClick={refetch} className="dx-chip h-8 px-3 text-[11px] flex items-center gap-1.5 hover:border-[color:var(--line-strong)]" aria-label="פרובה-מחדש">
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> פרובה
        </button>
      </div>
      {err && <div className="text-[12px] text-[color:var(--amber,#f59e0b)] flex items-center gap-1.5 mb-2"><AlertTriangle className="w-3.5 h-3.5" />{err} — מוצגת-הפרובה-האחרונה</div>}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {chains.length === 0 && !err && (
          Array.from({ length: 10 }).map((_, i) => <div key={i} className="dx-raised rounded-xl h-[86px] animate-pulse" />)
        )}
        {chains.map(c => (
          <div key={c.id} data-testid={`chain-${c.id}`} className={`dx-raised rounded-xl p-3 flex flex-col gap-1 ${c.live ? '' : 'opacity-70'}`}>
            <div className="flex items-center justify-between gap-1">
              <span className="font-bold text-[12.5px]">{c.name}</span>
              {c.live ? <CheckCircle2 className="w-3.5 h-3.5 text-[color:var(--green)]" /> : <WifiOff className="w-3.5 h-3.5 text-[color:var(--red)]" />}
            </div>
            <div className="dx-num text-[13px] text-[color:var(--text-1)]" dir="ltr">
              {c.live ? `#${fmtInt(c.height)}` : 'DOWN'}
            </div>
            <div className="flex items-center justify-between text-[10px] text-[color:var(--text-3)]">
              <span className="dx-num" dir="ltr">{c.live ? `${c.latencyMs}ms` : (c.error || 'נכשל').slice(0, 22)}</span>
              <span>{c.kind === 'solana' ? 'slot' : 'block'}</span>
            </div>
            {c.live && c.rpc && <div className="text-[9px] text-[color:var(--text-3)] truncate dx-num" dir="ltr" title={`RPC: ${c.rpc}`}>{c.rpc}</div>}
          </div>
        ))}
      </div>
      <p className="text-[10.5px] text-[color:var(--text-3)] mt-2.5 leading-relaxed">
        פרובה = קריאת-גובה-בלוק/סלוט אמת מצומת-RPC-ציבורי (סולם-שני-צמתים-לרשת). אפס-מפתחות, אפס-רישום, אפס-תלות-מוסדית. כישלון-מדווח-בכנות — אין-מצב-מזויף.
      </p>
    </section>
  );
}

// ═══ section 2: מטבעות מובילים + זוגות-אמת ══════════════════════════════════
function MarketsLive() {
  const { data, err } = useLivePoll<{ coins: CoinRow[]; coinsAgeMs: number; stale?: boolean; coinsSource?: string; chainPairs: ChainPairGroup[] }>('/api/live/markets', 90000);
  const [pairChain, setPairChain] = useState<string>('solana');
  const coins = (data?.coins || []).slice(0, 14);
  const groups = data?.chainPairs || [];
  const activeGroup = groups.find(g => g.chain === pairChain) || groups[0];

  return (
    <section aria-label="שווקים חיים" className="dx-card rounded-2xl p-4 md:p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="flex items-center gap-2 text-[15px] font-bold">
          <ShieldCheck className="w-4 h-4 text-[color:var(--green)]" />
          מטבעות-מובילים · מחירי-שוק אמת
        </h2>
        {data && (
          <span className="text-[10px] text-[color:var(--text-3)] dx-num" dir="ltr">
            {data.stale ? 'STALE · last-known' : `age ${Math.round(data.coinsAgeMs / 1000)}s`} · {data.coinsSource === 'binance' ? 'Binance (CG-429 fallback)' : 'CoinGecko'}
          </span>
        )}
      </div>
      {err && <div className="text-[12px] text-[color:var(--amber,#f59e0b)] flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" />{err}</div>}
      <div className="flex gap-2 overflow-x-auto scroll-slim pb-1" role="list" aria-label="מחירי מטבעות">
        {coins.length === 0 && !err && Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="dx-raised rounded-xl w-[128px] h-[86px] shrink-0 animate-pulse" />
        ))}
        {coins.map(c => (
          <div key={c.id} role="listitem" className="dx-raised rounded-xl p-3 w-[128px] shrink-0 flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              {c.image ? (
                <img src={c.image} alt={c.name} width={18} height={18} className="w-[18px] h-[18px] rounded-full" loading="lazy" />
              ) : (
                <span className="w-[18px] h-[18px] rounded-full bg-[color:var(--pink-soft)] flex items-center justify-center text-[8px] font-black shrink-0">{(c.symbol || '?').slice(0, 2).toUpperCase()}</span>
              )}
              <span className="font-bold text-[12px] uppercase">{c.symbol}</span>
            </div>
            <div className="dx-num text-[13px]" dir="ltr">{fmtPrice(c.current_price)}</div>
            <div className={`dx-num text-[10.5px] ${(c.price_change_percentage_24h ?? 0) >= 0 ? 'text-[color:var(--green)]' : 'text-[color:var(--red)]'}`} dir="ltr">
              {fmtPct(c.price_change_percentage_24h)} 24h
            </div>
            <div className="dx-num text-[9px] text-[color:var(--text-3)]" dir="ltr">{fmtUsd(c.market_cap)}</div>
          </div>
        ))}
      </div>

      {/* זוגות-אמת לרשת — DexScreener */}
      <div className="border-t border-[color:var(--line)] pt-3">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <h3 className="text-[13px] font-bold">זירת-הנזילות-האמת · זוגות-מסחר חיים</h3>
          <span className="text-[9.5px] text-[color:var(--text-3)]">DexScreener · עמוקי-נזילות · ממוינים-בווליום-24ש׳</span>
        </div>
        <div className="flex gap-1.5 overflow-x-auto scroll-slim pb-1 mb-2" role="tablist" aria-label="בחירת רשת לזוגות">
          {groups.map(g => (
            <button key={g.chain} role="tab" aria-selected={activeGroup?.chain === g.chain} onClick={() => setPairChain(g.chain)}
              className={`dx-chip h-7 px-2.5 text-[11px] shrink-0 ${activeGroup?.chain === g.chain ? 'dx-chip-active' : ''}`}>
              {g.chain}
            </button>
          ))}
        </div>
        {activeGroup?.error && (
          <div className="text-[11.5px] text-[color:var(--amber,#f59e0b)] flex items-center gap-1.5 py-2"><AlertTriangle className="w-3.5 h-3.5" />{activeGroup.chain}: {activeGroup.error}</div>
        )}
        <div className="grid gap-1.5 max-h-72 overflow-y-auto scroll-slim">
          {(activeGroup?.pairs || []).map(p => {
            const chg = p.priceChange?.h24 ?? 0;
            return (
              <a key={p.pairAddress} href={p.url} target="_blank" rel="noopener noreferrer"
                className="dx-raised rounded-xl px-3 py-2.5 flex items-center gap-3 hover:border-[color:var(--line-strong)] transition-colors group">
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-bold truncate">
                    {p.baseToken.symbol}<span className="text-[color:var(--text-3)]">/{p.quoteToken?.symbol || '?'}</span>
                    <span className="dx-chip h-4.5 px-1.5 text-[8.5px] ml-2 align-middle hidden sm:inline-flex">{p.dexId}</span>
                  </div>
                  <div className="text-[10px] text-[color:var(--text-3)] dx-num" dir="ltr">
                    liq {fmtUsd(p.liquidity?.usd)} · vol24 {fmtUsd(p.volume?.h24)}
                  </div>
                </div>
                <div className="text-left shrink-0">
                  <div className="dx-num text-[12.5px]" dir="ltr">{fmtPrice(p.priceUsd ? Number.parseFloat(p.priceUsd) : undefined)}</div>
                  <div className={`dx-num text-[10px] ${chg >= 0 ? 'text-[color:var(--green)]' : 'text-[color:var(--red)]'}`} dir="ltr">{fmtPct(chg)}</div>
                </div>
                <ExternalLink className="w-3.5 h-3.5 text-[color:var(--text-3)] opacity-0 group-hover:opacity-100 transition-opacity" />
              </a>
            );
          })}
          {!activeGroup && !err && <div className="dx-raised rounded-xl h-16 animate-pulse" />}
          {activeGroup && !activeGroup.error && (activeGroup.pairs || []).length === 0 && (
            <div className="text-[12px] text-[color:var(--text-3)] py-3 text-center">אין-זוגות-עם-נזילות-מעל-$25K — כנות-גלויה</div>
          )}
        </div>
      </div>
    </section>
  );
}

// ═══ section 3: סטודיו ציטוטים חי ════════════════════════════════════════════
type QuoteMode = 'solana' | 'evm' | 'bridge';

const SOL_PRESETS = [
  { sym: 'SOL', mint: 'So11111111111111111111111111111111111111112', decimals: 9 },
  { sym: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
  { sym: 'USDT', mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
  { sym: 'JUP', mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', decimals: 6 },
  { sym: 'BONK', mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5 },
];

const EVM_CHAINS = [
  { id: 1, name: 'Ethereum', native: 'ETH', stable: { sym: 'USDC', addr: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 } },
  { id: 56, name: 'BNB Chain', native: 'BNB', stable: { sym: 'USDT', addr: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 } },
  { id: 8453, name: 'Base', native: 'ETH', stable: { sym: 'USDC', addr: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 } },
  { id: 42161, name: 'Arbitrum', native: 'ETH', stable: { sym: 'USDC', addr: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 } },
  { id: 137, name: 'Polygon', native: 'POL', stable: { sym: 'USDC', addr: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 } },
  { id: 43114, name: 'Avalanche', native: 'AVAX', stable: { sym: 'USDC', addr: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', decimals: 6 } },
  { id: 10, name: 'Optimism', native: 'ETH', stable: { sym: 'USDC', addr: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6 } },
  { id: 534352, name: 'Scroll', native: 'ETH', stable: { sym: 'USDC', addr: '0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4', decimals: 6 } },
  { id: 59144, name: 'Linea', native: 'ETH', stable: { sym: 'USDC', addr: '0x176211869cA2b568f2A7D4EE941E073a821EE1ff', decimals: 6 } },
];
const NATIVE = '0x0000000000000000000000000000000000000000';

function QuoteStudio() {
  const [mode, setMode] = useState<QuoteMode>('solana');

  // solana state (TokPick: addr = mint base58)
  const [solIn, setSolIn] = useState<TokPick>({ sym: 'SOL', addr: 'So11111111111111111111111111111111111111112', decimals: 9 });
  const [solOut, setSolOut] = useState<TokPick>({ sym: 'USDC', addr: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 });
  const [solAmt, setSolAmt] = useState('1');
  const [slip, setSlip] = useState(50);

  // evm/bridge state
  const [fromChain, setFromChain] = useState(EVM_CHAINS[0]);
  const [toChain, setToChain] = useState(EVM_CHAINS[4]); // Polygon
  const [fromTok, setFromTok] = useState<{ sym: string; addr: string; decimals: number }>({ sym: 'ETH', addr: NATIVE, decimals: 18 });
  const [toTok, setToTok] = useState<{ sym: string; addr: string; decimals: number }>(EVM_CHAINS[4].stable);
  const [evmAmt, setEvmAmt] = useState('0.1');

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<QuoteResult | null>(null);
  const [routes, setRoutes] = useState<BridgeRoute[] | null>(null);
  const [qErr, setQErr] = useState<string | null>(null);

  const pickFromChain = (c: typeof EVM_CHAINS[0]) => {
    setFromChain(c);
    setFromTok({ sym: c.native, addr: NATIVE, decimals: 18 });
    if (toChain.id === c.id) { setToChain(EVM_CHAINS.find(x => x.id !== c.id)!); }
  };
  const pickToChain = (c: typeof EVM_CHAINS[0]) => {
    setToChain(c);
    setToTok({ sym: c.stable.sym, addr: c.stable.addr, decimals: c.stable.decimals });
  };

  async function runQuote() {
    setBusy(true); setQErr(null); setResult(null); setRoutes(null);
    try {
      if (mode === 'solana') {
        const q = new URLSearchParams({
          mode: 'solana', inputMint: solIn.addr, outputMint: solOut.addr,
          amount: solAmt, inDecimals: String(solIn.decimals), outDecimals: String(solOut.decimals),
          slippageBps: String(slip),
        });
        const r = await fetch(`/api/live/quote?${q}`, { cache: 'no-store' });
        const j = await r.json();
        if (!j.ok) setQErr(j.error || 'ציטוט-נכשל');
        else setResult(j);
      } else {
        const cross = mode === 'bridge';
        const fc = cross ? fromChain : fromChain;
        const tc = cross ? toChain : fromChain;
        const q = new URLSearchParams({
          mode: 'evm', fromChain: String(fc.id), toChain: String(tc.id),
          fromToken: fromTok.addr, toToken: cross ? toTok.addr : toTok.addr,
          amount: evmAmt, inDecimals: String(fromTok.decimals), outDecimals: String((cross ? toTok : toTok).decimals),
        });
        const r = await fetch(`/api/live/quote?${q}`, { cache: 'no-store' });
        const j = await r.json();
        if (!j.ok) setQErr(j.error || 'ציטוט-נכשל');
        else setResult(j);
        if (cross) {
          const bq = new URLSearchParams({
            fromChainId: String(fc.id), toChainId: String(tc.id),
            fromToken: fromTok.addr, toToken: toTok.addr,
            amount: evmAmt, inDecimals: String(fromTok.decimals), outDecimals: String(toTok.decimals),
          });
          const br = await fetch(`/api/live/bridge?${bq}`, { cache: 'no-store' });
          const bj = await br.json();
          if (bj.ok) setRoutes(bj.routes); else setQErr(bj.error || 'מסלולי-גשר-נכשלו');
        }
      }
    } catch (e) {
      setQErr(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  const evmChainsValid = fromChain.id !== toChain.id || mode !== 'bridge';

  return (
    <section aria-label="סטודיו ציטוטים חיים" className="dx-card rounded-2xl p-4 md:p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h2 className="flex items-center gap-2 text-[15px] font-bold">
          <Swords className="w-4 h-4 text-[color:var(--pink)]" />
          סטודיו-ציטוטים · מסלולי-אמת חיים
        </h2>
        <div className="flex gap-1.5" role="tablist" aria-label="מצב ציטוט">
          {([['solana', 'Solana · Jupiter'], ['evm', 'EVM · Li.Fi'], ['bridge', 'גשר חוצה-שרשראות']] as Array<[QuoteMode, string]>).map(([m, label]) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setResult(null); setRoutes(null); setQErr(null); }}
              className={`dx-chip h-7 px-2.5 text-[11px] ${mode === m ? 'dx-chip-active' : ''}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* סוואפ Solana */}
      {mode === 'solana' && (
        <div className="space-y-2.5" data-testid="quote-solana">
          <div className="grid sm:grid-cols-2 gap-2.5">
            <TokenPick
              label="מ-"
              presets={SOL_PRESETS.map(p => ({ sym: p.sym, addr: p.mint, decimals: p.decimals }))}
              value={solIn} onChange={setSolIn}
              amount={solAmt} onAmount={setSolAmt}
            />
            <TokenPick
              label="ל-"
              presets={SOL_PRESETS.map(p => ({ sym: p.sym, addr: p.mint, decimals: p.decimals }))}
              value={solOut} onChange={setSolOut}
              amount={null} onAmount={null}
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-[color:var(--text-3)]">החלקה:</span>
            {[50, 100, 300].map(b => (
              <button key={b} onClick={() => setSlip(b)} className={`dx-chip h-7 px-2.5 text-[11px] dx-num ${slip === b ? 'dx-chip-active' : ''}`} dir="ltr">{b / 100}%</button>
            ))}
          </div>
          <button onClick={runQuote} disabled={busy || solIn.addr === solOut.addr || !(Number.parseFloat(solAmt) > 0)}
            className="dx-cta w-full h-11 rounded-xl text-[14px] font-bold flex items-center justify-center gap-2 disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowDown className="w-4 h-4" />}
            ציטוט-אמת מהאגרגטור
          </button>
        </div>
      )}

      {/* EVM / גשר */}
      {mode !== 'solana' && (
        <div className="space-y-2.5" data-testid="quote-evm">
          <div className="grid sm:grid-cols-2 gap-2.5">
            <div className="space-y-1.5">
              <label className="text-[11px] text-[color:var(--text-3)]">מרשת</label>
              <select value={fromChain.id} onChange={e => pickFromChain(EVM_CHAINS.find(c => c.id === Number(e.target.value))!)}
                className="dx-raised w-full h-10 rounded-xl px-3 text-[13px] bg-transparent outline-none" dir="ltr">
                {EVM_CHAINS.map(c => <option key={c.id} value={c.id} className="bg-[color:var(--canvas)] text-white">{c.name}</option>)}
              </select>
              <EvmTokenPick label="מטבע-מקור" chain={fromChain} value={fromTok} onChange={setFromTok} />
              <input value={evmAmt} onChange={e => setEvmAmt(e.target.value)} inputMode="decimal" dir="ltr"
                className="dx-raised w-full h-10 rounded-xl px-3 text-[14px] dx-num bg-transparent outline-none" placeholder="כמות" aria-label="כמות" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] text-[color:var(--text-3)]">לרשת {mode === 'evm' && '(אותה-רשת = סוואף EVM)'}</label>
              {mode === 'bridge' ? (
                <select value={toChain.id} onChange={e => pickToChain(EVM_CHAINS.find(c => c.id === Number(e.target.value))!)}
                  className="dx-raised w-full h-10 rounded-xl px-3 text-[13px] bg-transparent outline-none" dir="ltr">
                  {EVM_CHAINS.filter(c => c.id !== fromChain.id).map(c => <option key={c.id} value={c.id} className="bg-[color:var(--canvas)] text-white">{c.name}</option>)}
                </select>
              ) : (
                <div className="dx-raised w-full h-10 rounded-xl px-3 text-[13px] flex items-center text-[color:var(--text-2)]">{fromChain.name}</div>
              )}
              <EvmTokenPick label="מטבע-יעד" chain={mode === 'bridge' ? toChain : fromChain} value={toTok} onChange={setToTok} />
              <div className="dx-raised w-full h-10 rounded-xl px-3 text-[12px] flex items-center text-[color:var(--text-3)]">
                ציטוט-קריאה-בלבד · אין-חתימה · אין-תזוזת-כספים
              </div>
            </div>
          </div>
          <button onClick={runQuote} disabled={busy || !evmChainsValid || !(Number.parseFloat(evmAmt) > 0)}
            className="dx-cta w-full h-11 rounded-xl text-[14px] font-bold flex items-center justify-center gap-2 disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowDown className="w-4 h-4" />}
            {mode === 'bridge' ? 'מסלולי-גשר-אמת' : 'ציטוט-אמת חוצה-דקסים'}
          </button>
        </div>
      )}

      {/* שגיאה-כנה */}
      {qErr && (
        <div data-testid="quote-error" className="mt-3 rounded-xl border border-[color:var(--red)]/40 bg-[color:var(--red)]/10 px-3.5 py-2.5 text-[12px] text-[color:var(--red)] flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{qErr}
        </div>
      )}

      {/* תוצאת-ציטוט */}
      {result && result.ok && (
        <div data-testid="quote-result" className="mt-3 dx-raised rounded-xl p-4 space-y-2" dir="rtl">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="dx-chip h-6 px-2 text-[10px] flex items-center gap-1">
              <Wifi className="w-3 h-3 text-[color:var(--green)]" />
              {result.engine === 'jupiter' ? 'Jupiter (Solana)' : `Li.Fi · ${result.tool || ''}`}
            </span>
            {result.probe && <span className="text-[9.5px] text-[color:var(--text-3)]">כתובת-בדיקה-ריבונית (אין-ארנק-מחובר)</span>}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="dx-num text-[24px] font-black text-[color:var(--green)]" dir="ltr">{fmtNum(result.outAmountHuman)}</span>
            <span className="text-[13px] text-[color:var(--text-2)] font-bold">
              {mode === 'solana' ? solOut.sym : mode === 'bridge' ? toTok.sym : (result.crossChain ? toTok.sym : toTok.sym)}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10.5px]">
            <Stat label="מינימום-מובטח" value={fmtNum(result.outMinHuman)} />
            {result.outUsd !== undefined && <Stat label="שווי" value={fmtUsd(result.outUsd)} />}
            {result.priceImpactPct !== undefined && <Stat label="השפעת-מחיר" value={`${(Number.parseFloat(result.priceImpactPct) * 100).toFixed(3)}%`} />}
            {result.gasUsd !== undefined && <Stat label="גז" value={fmtUsd(result.gasUsd)} />}
            {result.feeUsd !== undefined && <Stat label="עמלות" value={fmtUsd(result.feeUsd)} />}
            {result.durationSec !== undefined && <Stat label="משך" value={fmtDur(result.durationSec)} />}
          </div>
          {result.route && result.route.length > 0 && (
            <div className="pt-1.5 border-t border-[color:var(--line)]">
              <div className="text-[10px] text-[color:var(--text-3)] mb-1">מסלול-אמת:</div>
              <div className="flex flex-wrap gap-1.5">
                {result.route.map((v, i) => <span key={`${v}-${i}`} className="dx-chip h-6 px-2 text-[10px]">{v}</span>)}
              </div>
            </div>
          )}
          {result.subSteps && result.subSteps.length > 0 && (
            <div className="pt-1.5 border-t border-[color:var(--line)]">
              <div className="text-[10px] text-[color:var(--text-3)] mb-1">שלבי-ביצוע:</div>
              <div className="flex flex-wrap gap-1.5">
                {result.subSteps.map((s, i) => <span key={`${s}-${i}`} className="dx-chip h-6 px-2 text-[10px]">{s}</span>)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* מסלולי-גשר מתחרים */}
      {routes && routes.length > 0 && (
        <div className="mt-3 space-y-2" data-testid="bridge-routes">
          <div className="text-[11px] text-[color:var(--text-3)]">השוואת-גשרים · {routes.length} מסלולים-מתחרים (אמת-מ-Li.Fi):</div>
          {routes.map(r => (
            <div key={r.id} className="dx-raised rounded-xl p-3 flex items-center gap-3">
              <span className="dx-chip h-7 w-7 shrink-0 flex items-center justify-center text-[11px] font-black">{r.rank}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-bold truncate">{r.tools.join(' → ')}</div>
                <div className="text-[10px] text-[color:var(--text-3)] dx-num" dir="ltr">
                  min {fmtNum(r.outMinHuman)} · gas {fmtUsd(r.gasUsd)} · fee {fmtUsd(r.feeUsd)} · {fmtDur(r.durationSec)}
                </div>
              </div>
              <div className="text-left shrink-0">
                <div className="dx-num text-[13px] text-[color:var(--green)]" dir="ltr">{fmtNum(r.outAmountHuman)}</div>
                {r.outUsd !== undefined && <div className="dx-num text-[9.5px] text-[color:var(--text-3)]" dir="ltr">{fmtUsd(r.outUsd)}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="dx-raised rounded-lg px-2.5 py-1.5">
      <div className="text-[9px] text-[color:var(--text-3)]">{label}</div>
      <div className="dx-num text-[12px]" dir="ltr">{value}</div>
    </div>
  );
}

interface TokPick { sym: string; addr: string; decimals: number }

function TokenPick({ label, presets, value, onChange, amount, onAmount }: {
  label: string;
  presets: TokPick[];
  value: TokPick;
  onChange: (t: TokPick) => void;
  amount: string | null;
  onAmount: ((v: string) => void) | null;
}) {
  const custom = !presets.some(p => p.addr === value.addr);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value.addr);

  return (
    <div className="space-y-1.5">
      <label className="text-[11px] text-[color:var(--text-3)]">{label}</label>
      <div className="flex gap-1.5 flex-wrap">
        {presets.map(p => (
          <button key={p.addr} onClick={() => onChange(p)}
            className={`dx-chip h-7 px-2.5 text-[11px] font-bold ${value.addr === p.addr ? 'dx-chip-active' : ''}`}>
            {p.sym}
          </button>
        ))}
        <button onClick={() => { setEditing(!editing); setDraft(value.addr); }}
          className={`dx-chip h-7 px-2.5 text-[10px] ${custom ? 'dx-chip-active' : ''}`}>מטבע-מותאם</button>
      </div>
      {editing && (
        <div className="flex gap-1.5">
          <input value={draft} onChange={e => setDraft(e.target.value)} dir="ltr" placeholder="כתובת-mint (base58)"
            className="dx-raised flex-1 h-9 rounded-lg px-2.5 text-[11px] dx-num bg-transparent outline-none" aria-label="כתובת mint" />
          <button onClick={() => { if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(draft.trim())) onChange({ sym: custom || value.addr !== draft ? 'CUSTOM' : value.sym, addr: draft.trim(), decimals: value.decimals }); setEditing(false); }}
            className="dx-chip h-9 px-3 text-[11px]">אישור</button>
        </div>
      )}
      <div className="text-[9.5px] text-[color:var(--text-3)] dx-num truncate" dir="ltr" title={value.addr}>{value.addr}</div>
      {onAmount && (
        <input value={amount ?? ''} onChange={e => onAmount(e.target.value)} inputMode="decimal" dir="ltr" placeholder="כמות"
          className="dx-raised w-full h-10 rounded-xl px-3 text-[14px] dx-num bg-transparent outline-none" aria-label="כמות" />
      )}
    </div>
  );
}

function EvmTokenPick({ label, chain, value, onChange }: {
  label: string; chain: typeof EVM_CHAINS[0]; value: TokPick; onChange: (t: TokPick) => void;
}) {
  const presets: TokPick[] = [
    { sym: chain.native, addr: NATIVE, decimals: 18 },
    { sym: chain.stable.sym, addr: chain.stable.addr, decimals: chain.stable.decimals },
  ];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const custom = !presets.some(p => p.addr.toLowerCase() === value.addr.toLowerCase());

  return (
    <div className="space-y-1.5">
      <label className="text-[11px] text-[color:var(--text-3)]">{label}</label>
      <div className="flex gap-1.5">
        {presets.map(p => (
          <button key={p.addr} onClick={() => onChange(p)}
            className={`dx-chip h-7 px-2.5 text-[11px] font-bold ${value.addr.toLowerCase() === p.addr.toLowerCase() ? 'dx-chip-active' : ''}`}>
            {p.sym}
          </button>
        ))}
        <button onClick={() => setEditing(!editing)} className={`dx-chip h-7 px-2.5 text-[10px] ${custom ? 'dx-chip-active' : ''}`}>ERC-20</button>
      </div>
      {editing && (
        <div className="flex gap-1.5">
          <input value={draft} onChange={e => setDraft(e.target.value)} dir="ltr" placeholder="כתובת-חוזה 0x…"
            className="dx-raised flex-1 h-9 rounded-lg px-2.5 text-[11px] dx-num bg-transparent outline-none" aria-label="כתובת חוזה" />
          <button onClick={() => { if (/^0x[0-9a-fA-F]{40}$/.test(draft.trim())) { onChange({ sym: 'TOKEN', addr: draft.trim(), decimals: value.decimals }); setEditing(false); } }}
            className="dx-chip h-9 px-3 text-[11px]">אישור</button>
        </div>
      )}
      <div className="text-[9.5px] text-[color:var(--text-3)] dx-num truncate" dir="ltr" title={value.addr}>{value.addr}</div>
    </div>
  );
}

// ═══ section 4: סייר טוקנים ══════════════════════════════════════════════════
function TokenExplorer() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<TokenRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const deb = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback((query: string) => {
    if (query.trim().length < 2) { setRows(null); setErr(null); return; }
    setBusy(true); setErr(null);
    fetch(`/api/live/tokens?q=${encodeURIComponent(query.trim())}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => {
        if (j.ok) { setRows(j.tokens); if (j.jupError) setErr(`Jupiter: ${j.jupError} — מוצג-DexScreener-בלבד`); }
        else setErr(j.error || 'חיפוש-נכשל');
        setBusy(false);
      })
      .catch(e => { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); });
  }, []);

  useEffect(() => {
    if (deb.current) clearTimeout(deb.current);
    deb.current = setTimeout(() => search(q), 400);
    return () => { if (deb.current) clearTimeout(deb.current); };
  }, [q, search]);

  return (
    <section aria-label="סייר טוקנים" className="dx-card rounded-2xl p-4 md:p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h2 className="flex items-center gap-2 text-[15px] font-bold">
          <Search className="w-4 h-4 text-[color:var(--pink)]" />
          סייר-טוקנים · כל-הרשתות
        </h2>
        <span className="text-[10px] text-[color:var(--text-3)]">Jupiter (Solana) + DexScreener (EVM) — מחירי-אמת</span>
      </div>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="חפש טוקן — למשל: USDC, SOL, PEPE, WBNB…"
        className="dx-raised w-full h-11 rounded-xl px-4 text-[14px] bg-transparent outline-none mb-3" aria-label="חיפוש טוקן" data-testid="token-search" />
      {busy && <div className="flex items-center gap-2 text-[12px] text-[color:var(--text-3)] py-2"><Loader2 className="w-3.5 h-3.5 animate-spin" />מחפש…</div>}
      {err && <div className="text-[11.5px] text-[color:var(--amber,#f59e0b)] flex items-center gap-1.5 py-1"><AlertTriangle className="w-3.5 h-3.5" />{err}</div>}
      <div className="grid gap-1.5 max-h-96 overflow-y-auto scroll-slim">
        {(rows || []).map(t => (
          <div key={`${t.chain}-${t.address}`} className="dx-raised rounded-xl px-3 py-2.5 flex items-center gap-3">
            {t.icon ? (
              <img src={t.icon} alt="" width={26} height={26} className="w-[26px] h-[26px] rounded-full shrink-0" loading="lazy" />
            ) : (
              <span className="w-[26px] h-[26px] rounded-full bg-[color:var(--pink-soft)] shrink-0 flex items-center justify-center text-[10px] font-black">{(t.symbol || '?').slice(0, 2)}</span>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-bold truncate">
                {t.symbol} <span className="text-[color:var(--text-3)] font-normal text-[11px]">{t.name}</span>
                {t.verified && <span className="dx-chip h-4 px-1.5 text-[8.5px] ml-1.5 align-middle text-[color:var(--green)]">verified</span>}
              </div>
              <div className="text-[9.5px] text-[color:var(--text-3)] dx-num" dir="ltr">
                {t.chain}{t.liquidityUsd ? ` · liq ${fmtUsd(t.liquidityUsd)}` : ''}{t.mcapUsd ? ` · mcap ${fmtUsd(t.mcapUsd)}` : ''}
              </div>
            </div>
            <div className="dx-num text-[12.5px] shrink-0" dir="ltr">{fmtPrice(t.priceUsd)}</div>
          </div>
        ))}
        {rows && rows.length === 0 && !busy && !err && (
          <div className="text-[12px] text-[color:var(--text-3)] text-center py-4">לא-נמצאו-תוצאות-אמת לחיפוש</div>
        )}
      </div>
    </section>
  );
}

// ═══ section 5: מטריצת-השוואה ════════════════════════════════════════════════
function VersusMatrix() {
  const { data } = useLivePoll<VersusData>('/api/live/versus', 600000);
  const [open, setOpen] = useState<string | null>(null);
  const protocols = data?.protocols || [];

  return (
    <section aria-label="מטריצת השוואה" className="dx-card rounded-2xl p-4 md:p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h2 className="flex items-center gap-2 text-[15px] font-bold">
          <Swords className="w-4 h-4 text-[color:var(--pink)]" />
          מטריצת-השוואה · {protocols.length || '…'} פרוטוקולים-מתקדמים נבחנו
        </h2>
        {data && (
          <div className="flex gap-1.5 flex-wrap text-[10px]">
            <span className="dx-chip h-6 px-2 text-[color:var(--green)]">חי {data.score.live}</span>
            <span className="dx-chip h-6 px-2 text-[color:var(--amber,#f59e0b)]">חלקי {data.score.partial}</span>
            <span className="dx-chip h-6 px-2">בתכנון {data.score.planned}</span>
            <span className="dx-chip h-6 px-2 opacity-60">מחוץ-לתחום {data.score.out}</span>
          </div>
        )}
      </div>
      <p className="text-[11px] text-[color:var(--text-3)] mb-3 leading-relaxed">
        מחקר-רשת-חי (EXEC-CD-15-a · 25+ חיפושים 2024-2025). צ'קליסט-הפיצ'רים של הדקסים-המתקדמים והמצב-הריבוני-הכן שלנו מול-כל-אחד:
      </p>
      <div className="space-y-1.5 max-h-96 overflow-y-auto scroll-slim" role="list">
        {(data?.checklist || []).map(item => (
          <div key={item.feature} className="dx-raised rounded-xl overflow-hidden">
            <button onClick={() => setOpen(open === item.feature ? null : item.feature)}
              className="w-full px-3.5 py-2.5 flex items-center gap-2.5 text-right" aria-expanded={open === item.feature}>
              <span className={`dx-chip h-6 px-2 text-[9.5px] shrink-0 border ${ADOPTION_STYLE[item.adoption]}`}>{ADOPTION_LABEL[item.adoption]}</span>
              <span className="text-[12.5px] font-bold flex-1 min-w-0 truncate">{item.feature.replace(/^\d+\.\s*/, '')}</span>
            </button>
            {open === item.feature && (
              <div className="px-3.5 pb-3 pt-1 space-y-1.5 text-[11.5px] leading-relaxed">
                <div className="text-[color:var(--text-2)]">{item.why}</div>
                <div className="text-[color:var(--text-3)]">מובילים: <span dir="ltr" className="dx-num">{item.leaders}</span></div>
                <div className="dx-chip h-auto py-1.5 px-2.5 text-[10.5px] leading-relaxed inline-block whitespace-normal">
                  אצלנו: {item.note}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {protocols.length > 0 && (
        <details className="mt-4 group">
          <summary className="cursor-pointer text-[12px] font-bold text-[color:var(--text-2)] flex items-center gap-1.5">
            <ExternalLink className="w-3.5 h-3.5 text-[color:var(--text-3)]" />
            כל-הפרוטוקולים-שנבחנו ({protocols.length}) — טכנולוגיות-ופיצ'רים
          </summary>
          <div className="grid sm:grid-cols-2 gap-2 mt-3 max-h-80 overflow-y-auto scroll-slim">
            {protocols.map(p => (
              <div key={p.name} className="dx-raised rounded-xl p-3">
                <div className="text-[12.5px] font-bold">{p.name}</div>
                <div className="text-[9.5px] text-[color:var(--text-3)] mb-1.5">{p.chains}</div>
                <ul className="text-[10.5px] text-[color:var(--text-2)] space-y-0.5 list-disc pr-4">
                  {p.highlights.slice(0, 2).map((h, i) => <li key={i}>{h}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

// ═══ the view ════════════════════════════════════════════════════════════════
export function LiveView() {
  return (
    <div className="space-y-4" data-testid="live-view">
      {/* sovereignty banner */}
      <div className="dx-card rounded-2xl p-4 md:p-5 border-r-4 border-r-[color:var(--green)]" data-testid="live-banner">
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-full bg-[color:var(--green-soft)] flex items-center justify-center shrink-0">
            <Radio className="w-5 h-5 text-[color:var(--green)]" />
          </span>
          <div className="min-w-0">
            <h1 className="text-[17px] font-black">גשר-החי · חיבור ממשי לרשתות ומטבעות</h1>
            <p className="text-[12px] text-[color:var(--text-2)] mt-1 leading-relaxed">
              10 רשתות-אמת בפרובות-בלוק-חיות · מחירי-שוק אמת · ציטוטי-מסלול אמת מהאגרגטורים-המובילים (Jupiter · Li.Fi · 60+ שרשראות) · מסלולי-גישור מתחרים.
              {' '}<span className="text-[color:var(--green)] font-bold">הכל נשלף ישירות-ע"י הקונסולה-הריבונית</span> — אפס-תלות בשירותים-פנימיים-או-מוסדיים, אפס-מפתחות, אפס-רישום.
            </p>
            <p className="text-[10.5px] text-[color:var(--text-3)] mt-1.5">
              כנות-גלויה: הציטוטים כאן = קריאה-בלבד (read-only). ביצוע-עסקאות-על-רשתות-חוץ דורש ארנק-חתימה-עצמאי (self-custody) — הפלטפורמה אינה-מחזיקה-מפתחות-חוץ.
            </p>
          </div>
        </div>
      </div>

      <NetworksGrid />
      <QuoteStudio />
      <MarketsLive />
      <TokenExplorer />
      <VersusMatrix />
    </div>
  );
}
