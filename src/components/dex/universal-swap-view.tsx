'use client';

// ─── החלפת-הכל · אגרגטור-ריבוני-אמת (EXEC-CD-23) ────────────────────────────
// עקרונות: כל-מקור-נשאל-חי → דירוג-נטו → ביצוע-ללא-משמורת.
//   wallet-kind  → חתימת-ארנק-מקומית (EVM: injected · Solana: Phantom/injected)
//   deposit-kind → הפקדה-מהארנק-שלך לכספת-רשת (Maya ממואר / SideShift שער-נעול)
// כנות-מלאה: מקור-שנכשל מוצג-ככזה עם-הסיבה; אין-עמלות-סמויות; אין-משמורת-מפתחות.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown, ChevronDown, Loader2, Search, Copy, Check, Wallet, ExternalLink,
  RefreshCcw, ShieldCheck, TriangleAlert, XCircle, Clock, Info, Repeat2, Landmark,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PROVIDER_META, type ProviderId, type UToken, type UniversalQuote, type ProviderFailure } from '@/lib/live/universal';

// ─── types mirroring the API ───
type ChainInfo = {
  key: string; name: string; kind: string; chainId?: number; ssNetwork?: string;
  explorerTx?: string; explorerAddr?: string;
  native: { symbol: string; name: string; decimals: number }; hue: number;
  providers: Record<string, boolean>;
};
type Health = Record<string, boolean> & { checkedAt: string };
type ExecDeposit = {
  kind: 'deposit'; provider: string;
  depositAddress: string; depositAddressQr?: string; depositMemo?: string; memo?: string;
  memoOversized?: boolean; router?: string;
  depositChain: string; depositAsset: string; depositAmountHuman: number;
  settleChain: string; settleAsset: string; settleAddress: string;
  expectedOut?: number; settleAmount?: number; expiresAt?: string;
  etaSec?: number; dustThreshold?: string; minInHuman?: number;
  explorerDeposit?: string; explorerSettle?: string;
  notes?: string; warning?: string; steps: string[]; shiftId?: string;
};
type ExecWallet = {
  kind: 'wallet'; chainClass: 'evm' | 'solana'; provider: string;
  txRequest?: Record<string, unknown>; swapTransaction?: string;
  expectedOut?: number; toChainId?: number;
};
type ExecResult = ExecDeposit | ExecWallet;

const nfmt = (n: number, d = 6): string =>
  n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 });

function hueColor(h: number): string { return `hsl(${h} 62% 52%)`; }
function hexify(v: unknown): string | undefined {
  if (v === undefined || v === null || v === '0x' || v === '0x0' || v === 0 || v === '0') return undefined;
  const s = String(v);
  if (s.startsWith('0x')) return s;
  try { return `0x${BigInt(s).toString(16)}`; } catch { return undefined; }
}

// ─── wallet helpers (injected providers, no custody) ───
type EthProvider = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
type SolProvider = {
  connect: () => Promise<{ publicKey?: { toString(): string } }>;
  signAndSendTransaction?: (tx: unknown) => Promise<{ signature: string }>;
};
function eth(): EthProvider | null {
  const w = window as unknown as { ethereum?: EthProvider };
  return w.ethereum ?? null;
}
function sol(): SolProvider | null {
  const w = window as unknown as { solana?: SolProvider; phantom?: { solana?: SolProvider } };
  return w.solana ?? w.phantom?.solana ?? null;
}

export function UniversalSwapView() {
  // catalog + health
  const [chains, setChains] = useState<ChainInfo[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [catalogErr, setCatalogErr] = useState('');

  // selection
  const [fromTok, setFromTok] = useState<UToken | null>(null);
  const [toTok, setToTok] = useState<UToken | null>(null);
  const [amountStr, setAmountStr] = useState('');
  const [pickOpen, setPickOpen] = useState<'in' | 'out' | null>(null);

  // quotes
  const [quotes, setQuotes] = useState<UniversalQuote[]>([]);
  const [failed, setFailed] = useState<ProviderFailure[]>([]);
  const [quoting, setQuoting] = useState(false);
  const [quoteErr, setQuoteErr] = useState('');
  const [rankedAt, setRankedAt] = useState('');
  const [selected, setSelected] = useState<UniversalQuote | null>(null);

  // wallets
  const [evmAddr, setEvmAddr] = useState('');
  const [solAddr, setSolAddr] = useState('');
  const [walletMsg, setWalletMsg] = useState('');

  // execution
  const [execBusy, setExecBusy] = useState(false);
  const [execErr, setExecErr] = useState('');
  const [exec, setExec] = useState<ExecResult | null>(null);
  const [txHash, setTxHash] = useState('');
  const [copied, setCopied] = useState('');
  const [nowTick, setNowTick] = useState(Date.now());

  // deposit inputs
  const [settleAddr, setSettleAddr] = useState('');
  const [refundAddr, setRefundAddr] = useState('');

  // כספת-הריפו — משפך-האוצר (EXEC-CD-25): כתובות-הקבלה-הריבוניות
  const [vault, setVault] = useState<{ label: string; addresses: Record<string, string> } | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch('/api/vault/addresses', { cache: 'no-store' });
        const j = await r.json() as { ok?: boolean; exists?: boolean; label?: string; addresses?: Record<string, string> };
        if (j.ok && j.exists && j.addresses) setVault({ label: j.label ?? 'sovereign', addresses: j.addresses });
      } catch { /* כספת-לא-נגישה — הכפתורים-יוסתרו בכנות */ }
    })();
  }, []);

  const amount = useMemo(() => {
    const n = Number.parseFloat(amountStr.replace(/,/g, ''));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amountStr]);

  // ── catalog ──
  const loadCatalog = useCallback(async () => {
    try {
      const r = await fetch('/api/swap/chains', { cache: 'no-store' });
      const j = await r.json();
      if (j.ok) {
        setChains(j.chains as ChainInfo[]);
        setHealth(j.health as Health);
        setCatalogErr('');
        setFromTok(prev => prev ?? (j.majors as UToken[]).find(m => m.chain === 'bitcoin' && m.native) ?? null);
        setToTok(prev => prev ?? (j.majors as UToken[]).find(m => m.chain === 'ethereum' && m.native) ?? null);
      } else setCatalogErr(j.error || 'קטלוג-נכשל');
    } catch { setCatalogErr('קטלוג-לא-נגיש'); }
  }, []);
  useEffect(() => { void loadCatalog(); }, [loadCatalog]);

  // countdown tick
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── משפך-הכספת: כתובת-הכספת-המתאימה-לרשת (EXEC-CD-25) ──
  // evm → כל-רשתות-EVM · solana/tron → ישיר · utxo → Bitcoin בלבד (LTC/DOGE/BCH/DASH פורמטים-שונים — לא-ממלאים-בכוח!)
  const vaultAddrFor = useCallback((tok: UToken | null): string | null => {
    if (!vault || !tok) return null;
    const A = vault.addresses;
    if (tok.kind === 'evm') return A.evm ?? null;
    if (tok.kind === 'solana') return A.solana ?? null;
    if (tok.kind === 'tron') return A.tron ?? null;
    if (tok.kind === 'utxo' && tok.chain === 'bitcoin') return A.bitcoin ?? null;
    return null;
  }, [vault]);
  const funnelToVault = useCallback(() => {
    const s = vaultAddrFor(toTok);
    const r = vaultAddrFor(fromTok);
    if (s) setSettleAddr(s);
    if (r) setRefundAddr(r);
  }, [vaultAddrFor, toTok, fromTok]);
  const settleIsVault = !!toTok && settleAddr.length > 0 && settleAddr === vaultAddrFor(toTok);

  // ── quotes: debounce ──
  const quoteKey = `${fromTok?.id}|${toTok?.id}|${amount}|${evmAddr}|${solAddr}`;
  const qKeyRef = useRef('');
  useEffect(() => {
    if (!fromTok || !toTok || !amount) { setQuotes([]); setFailed([]); setSelected(null); setQuoteErr(''); return; }
    if (fromTok.id === toTok.id && fromTok.chain === toTok.chain) { setQuotes([]); setFailed([]); setSelected(null); return; }
    const run = async () => {
      qKeyRef.current = quoteKey;
      setQuoting(true); setQuoteErr(''); setExec(null); setExecErr(''); setTxHash('');
      try {
        const r = await fetch('/api/swap/quotes', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromChain: fromTok.chain, toChain: toTok.chain, fromToken: fromTok, toToken: toTok,
            amount, toPriceUsd: toTok.priceUsd, walletEvm: evmAddr || undefined, walletSolana: solAddr || undefined,
          }),
        });
        const j = await r.json();
        if (j.ok) {
          setQuotes(j.quotes as UniversalQuote[]);
          setFailed(j.failed as ProviderFailure[]);
          setRankedAt(j.rankedAt as string);
          setSelected((j.quotes as UniversalQuote[])[0] ?? null);
        } else { setQuoteErr(j.error || 'ציטוט-נכשל'); setQuotes([]); setFailed([]); setSelected(null); }
      } catch { setQuoteErr('רשת-לא-זמינה'); setQuotes([]); setFailed([]); }
      finally { setQuoting(false); }
    };
    const t = setTimeout(() => { void run(); }, 650);
    return () => clearTimeout(t);
  }, [quoteKey]);

  // ── status polling for sideshift orders ──
  const [shiftStatus, setShiftStatus] = useState('');
  useEffect(() => {
    if (!exec || exec.kind !== 'deposit' || exec.provider !== 'sideshift' || !exec.shiftId) return;
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch(`/api/swap/status?provider=sideshift&id=${encodeURIComponent(exec.shiftId!)}`, { cache: 'no-store' });
        const j = await r.json();
        if (alive && j.ok && j.shift) setShiftStatus(String(j.shift.status ?? ''));
      } catch { /* כנות: ממשיכים-לנסות */ }
    };
    void poll();
    const t = setInterval(poll, 20000);
    return () => { alive = false; clearInterval(t); };
  }, [exec]);

  // ── wallets ──
  const connectEvm = async () => {
    setWalletMsg('');
    const p = eth();
    if (!p) { setWalletMsg('לא-נמצא ארנק-EVM בדפדפן (MetaMask/Rabby…). למסלולים-אלה השתמש במקורות-הפקדה.'); return; }
    try {
      const accs = await p.request({ method: 'eth_requestAccounts' }) as string[];
      setEvmAddr(accs?.[0] ?? '');
    } catch { setWalletMsg('החיבור-נדחה'); }
  };
  const connectSol = async () => {
    setWalletMsg('');
    const p = sol();
    if (!p?.connect) { setWalletMsg('לא-נמצא ארנק-Solana (Phantom…). למסלולים-אלה השתמש במקורות-הפקדה.'); return; }
    try {
      const res = await p.connect();
      setSolAddr(res?.publicKey?.toString() ?? '');
    } catch { setWalletMsg('החיבור-נדחה'); }
  };

  const needEvm = selected?.kind === 'wallet' && fromTok && fromTok.kind === 'evm';
  const needSol = selected?.kind === 'wallet' && fromTok && fromTok.kind === 'solana';
  const walletReady = needEvm ? !!evmAddr : needSol ? !!solAddr : false;

  // ── execute ──
  const doExecute = async () => {
    if (!selected || !fromTok || !toTok) return;
    setExecBusy(true); setExecErr(''); setExec(null); setTxHash(''); setShiftStatus('');
    try {
      const body: Record<string, unknown> = {
        provider: selected.provider,
        fromChain: fromTok.chain, toChain: toTok.chain,
        fromToken: fromTok, toToken: toTok, amount,
        settleAddress: settleAddr, refundAddress: refundAddr,
        walletAddress: needEvm ? evmAddr : needSol ? solAddr : '',
      };
      const r = await fetch('/api/swap/execute', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!j.ok) { setExecErr(j.error || 'ביצוע-נכשל'); return; }
      if (j.kind === 'deposit') {
        setExec(j as ExecDeposit);
        setShiftStatus('');
      } else {
        const w = j as ExecWallet;
        setExec(w);
        // חתימה-מקומית — המפתח-אף-פעם-לא-עוזב-את-הארנק
        if (w.chainClass === 'evm') {
          const p = eth();
          const tx = w.txRequest ?? {};
          const params = [{
            from: evmAddr, to: String(tx.to ?? ''),
            data: String(tx.data ?? '0x'),
            ...(hexify(tx.value) ? { value: hexify(tx.value) } : {}),
            ...(hexify(tx.gas) ? { gas: hexify(tx.gas) } : {}),
            ...(hexify(tx.gasPrice) ? { gasPrice: hexify(tx.gasPrice) } : {}),
          }];
          try {
            const hash = await p!.request({ method: 'eth_sendTransaction', params }) as string;
            setTxHash(hash);
          } catch (e) { setExecErr(e instanceof Error ? e.message : 'החתימה-בוטלה/נכשלה'); }
        } else if (w.chainClass === 'solana') {
          const p = sol();
          if (!p?.signAndSendTransaction) { setExecErr('ארנק-Solana לא-תומך-בחתימה (עדכן Phantom)'); return; }
          try {
            const { VersionedTransaction } = await import('@solana/web3.js');
            const raw = Buffer.from(w.swapTransaction ?? '', 'base64');
            const vtx = VersionedTransaction.deserialize(raw);
            const res = await p.signAndSendTransaction(vtx);
            setTxHash(res.signature);
          } catch (e) { setExecErr(e instanceof Error ? e.message : 'החתימה-בוטלה/נכשלה'); }
        }
      }
    } catch { setExecErr('רשת-לא-זמינה'); }
    finally { setExecBusy(false); }
  };

  const copy = async (text: string, tag: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag); setTimeout(() => setCopied(''), 1500);
    } catch { /* */ }
  };

  const flip = () => {
    if (!fromTok || !toTok) return;
    setFromTok(toTok); setToTok(fromTok); setAmountStr('');
  };

  const chainOf = (key: string): ChainInfo | undefined => chains.find(c => c.key === key);
  const fromChain = fromTok ? chainOf(fromTok.chain) : undefined;
  const toChain = toTok ? chainOf(toTok.chain) : undefined;
  const liveChains = chains.filter(c => Object.values(c.providers).some(Boolean));

  const expiresIn = exec && exec.kind === 'deposit' && exec.expiresAt
    ? Math.max(0, Math.floor((new Date(exec.expiresAt).getTime() - nowTick) / 1000))
    : null;

  // ═════════════════════════ render ═════════════════════════
  return (
    <div className="w-full max-w-[880px] mx-auto flex flex-col gap-4" data-testid="universal-swap">
      {/* כותרת + ריבונות */}
      <div className="dx-card p-4 md:p-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg md:text-xl font-extrabold flex items-center gap-2">
              <Repeat2 className="w-5 h-5 text-[color:var(--pink)]" />
              החלפת-הכל · אגרגטור ריבוני
            </h1>
            <p className="text-[12px] text-[color:var(--text-2)] mt-1 leading-relaxed max-w-[560px]">
              כל-רשת, כל-טוקן — חמישה-מקורות נשאלים-חי במקביל, והפלט-הטוב-ביותר מדורג ראשון.
              אין-מפתחות-פרטיים, אין-משמורת, אין-KYC: הכסף-זז ישירות מהארנק-שלך אליך.
            </p>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {(['maya', 'sideshift', 'lifi', 'paraswap', 'jupiter'] as ProviderId[]).map(p => {
              const ok = health?.[p] === true;
              return (
                <span key={p} data-testid={`prov-${p}`}
                  title={PROVIDER_META[p].note}
                  className={`dx-chip h-7 px-2 flex items-center gap-1.5 text-[10px] ${ok ? 'text-[color:var(--green)]' : 'text-[color:var(--red)]'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-[color:var(--green)] pulse-ring' : 'bg-[color:var(--red)]'}`} />
                  {PROVIDER_META[p].name}
                </span>
              );
            })}
          </div>
        </div>
        {catalogErr && (
          <div className="mt-3 text-[11px] text-[color:var(--amber)] flex items-center gap-1.5">
            <TriangleAlert className="w-3.5 h-3.5" /> {catalogErr}
            <button onClick={() => void loadCatalog()} className="underline">נסה-שוב</button>
          </div>
        )}
      </div>

      {/* כרטיס-ההחלפה */}
      <div className="dx-card p-4 md:p-6 relative">
        <SideCard
          label="משלם · From" token={fromTok} chain={fromChain}
          amountStr={amount === 0 ? '' : amountStr} onAmount={setAmountStr}
          editable onPick={() => setPickOpen('in')}
        />
        <div className="flex justify-center -my-2.5 relative z-10">
          <button onClick={flip} aria-label="היפוך-כיוון"
            className="dx-raised w-11 h-11 rounded-2xl flex items-center justify-center hover:border-[color:var(--pink)]/60 transition-colors bg-[color:var(--canvas)]">
            <ArrowDown className="w-4.5 h-4.5 text-[color:var(--pink)]" />
          </button>
        </div>
        <SideCard
          label="מקבל · To" token={toTok} chain={toChain}
          amountStr={selected ? nfmt(selected.outAmount, 8) : quoting ? '…' : ''}
          editable={false} onPick={() => setPickOpen('out')}
        />

        {/* כנות-ריבונות */}
        <div className="mt-4 flex items-center gap-2 text-[10.5px] text-[color:var(--text-3)]">
          <ShieldCheck className="w-3.5 h-3.5 text-[color:var(--green)]" />
          אין-משמורת · אין-חשבונות · אין-עמלת-פלטפורמה על-מקורות-אלה (עמלות-הרשת/המקור מוצגות)
        </div>

        {/* מקורות-שנכשלו — כנות */}
        {failed.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5">
            {failed.map(f => (
              <div key={f.provider} className="flex items-center gap-2 text-[10.5px] text-[color:var(--text-3)]" data-testid={`failed-${f.provider}`}>
                <XCircle className="w-3.5 h-3.5 text-[color:var(--red)]/70 shrink-0" />
                <span className="font-semibold">{f.providerName}</span>
                <span className="truncate">{f.error}</span>
              </div>
            ))}
          </div>
        )}
        {quoteErr && (
          <div className="mt-3 text-[11px] text-[color:var(--red)] flex items-center gap-1.5">
            <TriangleAlert className="w-3.5 h-3.5" /> {quoteErr}
          </div>
        )}
      </div>

      {/* דירוג-מקורות */}
      {(quotes.length > 0 || quoting) && (
        <div className="dx-card p-4 md:p-6 flex flex-col gap-2.5" data-testid="quote-rank">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <RefreshCcw className={`w-3.5 h-3.5 ${quoting ? 'animate-spin text-[color:var(--pink)]' : 'text-[color:var(--text-3)]'}`} />
              דירוג-מקורות · לפי-פלט-נטו
            </h2>
            {rankedAt && !quoting && (
              <span className="text-[10px] text-[color:var(--text-3)] font-data" dir="ltr">
                {new Date(rankedAt).toLocaleTimeString('he-IL')}
              </span>
            )}
          </div>
          {quotes.map((q, i) => {
            const meta = PROVIDER_META[q.provider];
            const isSel = selected?.provider === q.provider;
            const c = hueColor(meta.hue);
            return (
              <button key={q.provider} onClick={() => { setSelected(q); setExec(null); setExecErr(''); setTxHash(''); }}
                className={`text-start dx-raised p-3.5 rounded-2xl transition-all hover:border-[color:var(--line-strong)] ${isSel ? 'border-[color:var(--pink)]/70 shadow-[0_0_24px_-8px_rgba(255,55,199,0.45)]' : ''}`}
                data-testid={`quote-${q.provider}`}>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="dx-token shrink-0" style={{ width: 34, height: 34, fontSize: 11, background: `linear-gradient(135deg, ${c}26, ${c}55)`, border: `1px solid ${c}66`, color: c }}>
                    {i === 0 ? '1' : String(i + 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-[13px]">{q.providerName}</span>
                      {i === 0 && <span className="text-[9.5px] font-bold px-2 py-0.5 rounded-full bg-[color:var(--pink)]/15 text-[color:var(--pink)] border border-[color:var(--pink)]/40">הטוב-ביותר</span>}
                      <span className={`text-[9.5px] px-2 py-0.5 rounded-full border ${q.kind === 'deposit' ? 'text-[color:var(--amber)] border-[color:var(--amber)]/40 bg-[color:var(--amber-soft)]' : 'text-[color:var(--green)] border-[color:var(--green)]/40 bg-[color:var(--green-soft)]'}`}>
                        {q.kind === 'deposit' ? 'הפקדה-מארנק-חוץ' : 'חתימת-ארנק-מקומית'}
                      </span>
                    </div>
                    <div className="text-[10.5px] text-[color:var(--text-3)] mt-0.5 truncate">
                      {q.route.join(' → ')} · {q.etaLabel ?? '—'}
                      {q.gasUsd !== undefined ? ` · גז ≈$${nfmt(q.gasUsd, 2)}` : ''}
                      {q.feeUsd !== undefined ? ` · עמלה ≈$${nfmt(q.feeUsd, 2)}` : ''}
                    </div>
                  </div>
                  <div className="text-end shrink-0">
                    <div className="font-extrabold text-[15px] dx-num" dir="ltr" data-testid={`out-${q.provider}`}>
                      {nfmt(q.outAmount, 8)} <span className="text-[11px] text-[color:var(--text-2)]">{toTok?.symbol}</span>
                    </div>
                    {q.usdOut !== undefined && (
                      <div className="text-[10px] text-[color:var(--text-3)] dx-num" dir="ltr">≈ ${nfmt(q.usdOut, 2)}</div>
                    )}
                  </div>
                </div>
                {q.caveats.length > 0 && (
                  <div className="mt-2 flex flex-col gap-1 border-t border-[color:var(--line)] pt-2">
                    {q.caveats.map((cv, k) => (
                      <div key={k} className="text-[10px] text-[color:var(--text-3)] flex items-start gap-1.5">
                        <Info className="w-3 h-3 mt-0.5 shrink-0 text-[color:var(--amber)]" /> {cv}
                      </div>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* פאנל-ביצוע */}
      {selected && (
        <div className="dx-card p-4 md:p-6 flex flex-col gap-3" data-testid="exec-panel">
          <h2 className="text-sm font-bold flex items-center gap-2">
            <Wallet className="w-4 h-4 text-[color:var(--pink)]" />
            ביצוע · {PROVIDER_META[selected.provider].name}
          </h2>

          {selected.kind === 'wallet' && (
            <div className="flex flex-col gap-2.5">
              {!walletReady ? (
                <div className="flex flex-col gap-2">
                  <div className="text-[11.5px] text-[color:var(--text-2)]">
                    מקור-זה דורש חתימת-ארנק-מקומית ({fromTok?.kind === 'solana' ? 'Solana' : 'EVM'}).
                    המפתח-הפרטי-אף-פעם-לא-עוזב-את-הדפדפן.
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {fromTok?.kind === 'evm' && (
                      <Button onClick={() => void connectEvm()} className="dx-cta h-11 px-4 text-[13px]">
                        <Wallet className="w-4 h-4" /> חבר-ארנק-EVM
                      </Button>
                    )}
                    {fromTok?.kind === 'solana' && (
                      <Button onClick={() => void connectSol()} className="dx-cta h-11 px-4 text-[13px]">
                        <Wallet className="w-4 h-4" /> חבר-ארנק-Solana
                      </Button>
                    )}
                  </div>
                  {walletMsg && <div className="text-[11px] text-[color:var(--amber)]">{walletMsg}</div>}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="text-[11.5px] text-[color:var(--text-2)] dx-num" dir="ltr">
                    ארנק: {needEvm ? evmAddr : solAddr}
                  </div>
                  <Button onClick={() => void doExecute()} disabled={execBusy}
                    className="dx-cta h-12 px-5 text-[14px] font-bold disabled:opacity-50"
                    data-testid="exec-btn">
                    {execBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                    {execBusy ? 'מכין-עסקה…' : `בצע-החלפה · ${amount} ${fromTok?.symbol} → ${toTok?.symbol}`}
                  </Button>
                </div>
              )}
            </div>
          )}

          {selected.kind === 'deposit' && (
            <div className="flex flex-col gap-2.5">
              <div className="text-[11.5px] text-[color:var(--text-2)] leading-relaxed">
                מקור-זה פועל בהפקדה: תשלח {fromTok?.symbol} מהארנק-שלך (ארנק-חוץ רגיל) אל
                כספת-הרשת, והרשת תשלח את {toTok?.symbol} ישירות לכתובת-הקבלה שלך.
                ההחזרות-חוזרות אליך-אוטומטית.
              </div>
              {vault && (vaultAddrFor(toTok) || vaultAddrFor(fromTok)) && (
                <button type="button" onClick={funnelToVault}
                  className="flex items-center gap-2 self-start dx-raised rounded-xl px-3 h-9 text-[12px] font-semibold text-[color:var(--green)] hover:opacity-90 transition-opacity border border-[color:var(--green)]/30"
                  data-testid="vault-funnel">
                  <Landmark className="w-3.5 h-3.5" />
                  הזרם-אל-כספת-הריפו ({vault.label}) — כתובות-הקבלה-הריבוניות
                </button>
              )}
              {settleIsVault && (
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-[color:var(--green)]" data-testid="vault-funnel-active">
                  <Landmark className="w-3.5 h-3.5" /> יעד-הקבלה = כספת-הריפו — התקבלות-אוצר-ריבוני (שורד-מחיקת-סנדבוקס)
                </div>
              )}
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-[color:var(--text-2)]">
                  כתובת-קבלה על {toChain?.name ?? toTok?.chain} ({toTok?.symbol})
                </span>
                <Input value={settleAddr} onChange={e => setSettleAddr(e.target.value)}
                  dir="ltr" placeholder={toTok?.kind === 'evm' ? '0x…' : toTok?.kind === 'solana' ? 'כתובת-Solana…' : 'כתובת-קבלה…'}
                  className="h-11 text-[12.5px] font-data" data-testid="settle-addr" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-[color:var(--text-2)]">
                  כתובת-החזרה על {fromChain?.name ?? fromTok?.chain} ({fromTok?.symbol}) — למקרה-כישלון
                </span>
                <Input value={refundAddr} onChange={e => setRefundAddr(e.target.value)}
                  dir="ltr" placeholder="כתובת-הארנק-שממנו-תשלח…"
                  className="h-11 text-[12.5px] font-data" data-testid="refund-addr" />
              </label>
              <Button onClick={() => void doExecute()} disabled={execBusy}
                className="dx-cta h-12 px-5 text-[14px] font-bold disabled:opacity-50" data-testid="exec-btn">
                {execBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
                {execBusy ? 'מזמין-מסלול…' : 'צור-הזמנה + כתובת-הפקדה'}
              </Button>
            </div>
          )}

          {execErr && (
            <div className="text-[11.5px] text-[color:var(--red)] flex items-start gap-1.5 dx-raised p-3 rounded-xl" data-testid="exec-error">
              <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" /> {execErr}
            </div>
          )}

          {/* תוצאת-חתימה */}
          {txHash && exec?.kind === 'wallet' && (
            <div className="dx-raised p-4 rounded-2xl flex flex-col gap-2 border-[color:var(--green)]/40" data-testid="tx-sent">
              <div className="flex items-center gap-2 text-[13px] font-bold text-[color:var(--green)]">
                <Check className="w-4 h-4" /> נשלח-לרשת בהצלחה
              </div>
              <div className="text-[10.5px] font-data break-all text-[color:var(--text-2)]" dir="ltr">{txHash}</div>
              {exec.chainClass === 'evm' && chainOf(exec.toChainId === 42161 ? 'arbitrum' : fromTok?.chain ?? '')?.explorerTx && (
                <a className="text-[11px] text-[color:var(--pink)] underline flex items-center gap-1"
                  href={chainOf(exec.toChainId === 42161 ? 'arbitrum' : fromTok?.chain ?? '')!.explorerTx!.replace('{tx}', txHash)} target="_blank" rel="noreferrer">
                  <ExternalLink className="w-3 h-3" /> צפה-בסייר
                </a>
              )}
              {exec.chainClass === 'solana' && (
                <a className="text-[11px] text-[color:var(--pink)] underline flex items-center gap-1"
                  href={`https://solscan.io/tx/${txHash}`} target="_blank" rel="noreferrer">
                  <ExternalLink className="w-3 h-3" /> צפה-ב-solscan
                </a>
              )}
            </div>
          )}

          {/* תוצאת-הפקדה */}
          {exec && exec.kind === 'deposit' && (
            <DepositPanel exec={exec} copied={copied} onCopy={copy}
              shiftStatus={shiftStatus} expiresIn={expiresIn}
              toChain={toChain} fromChain={fromChain} />
          )}
        </div>
      )}

      {/* בורר-טוקנים */}
      <TokenPicker
        open={pickOpen !== null} side={pickOpen}
        chains={liveChains} onClose={() => setPickOpen(null)}
        other={pickOpen === 'in' ? toTok : fromTok}
        onPick={tok => {
          if (pickOpen === 'in') {
            if (toTok && tok.id === toTok.id && tok.chain === toTok.chain) setToTok(fromTok);
            setFromTok(tok);
          } else {
            if (fromTok && tok.id === fromTok.id && tok.chain === fromTok.chain) setFromTok(toTok);
            setToTok(tok);
          }
          setAmountStr(''); setQuotes([]); setSelected(null); setExec(null); setPickOpen(null);
        }}
      />
    </div>
  );
}

// ─── כרטיס-צד ───
function SideCard({ label, token, chain, amountStr, onAmount, editable, onPick }: {
  label: string; token: UToken | null; chain?: ChainInfo;
  amountStr: string; onAmount?: (v: string) => void; editable: boolean; onPick: () => void;
}) {
  const c = token ? hueColor(token.hue) : 'hsl(200 20% 50%)';
  return (
    <div className="dx-raised rounded-2xl p-3.5 md:p-4">
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[11px] font-semibold text-[color:var(--text-3)]">{label}</span>
        {chain && <span className="text-[10px] px-2 py-0.5 rounded-full dx-chip" style={{ color: c, borderColor: `${c}55` }}>{chain.name}</span>}
      </div>
      <div className="flex items-center gap-3">
        <button onClick={onPick} data-testid={`pick-${label.includes('From') ? 'in' : 'out'}`}
          className="flex items-center gap-2 dx-chip h-11 px-3 rounded-2xl shrink-0 hover:border-[color:var(--line-strong)] transition-colors">
          {token ? (
            <>
              <span className="dx-token" style={{ width: 26, height: 26, fontSize: 10, background: `linear-gradient(135deg, ${c}26, ${c}55)`, border: `1px solid ${c}66`, color: c }}>
                {token.symbol.slice(0, 1)}
              </span>
              <span className="font-bold text-[13px]">{token.symbol}</span>
              <ChevronDown className="w-3.5 h-3.5 opacity-50" />
            </>
          ) : <span className="text-[13px] text-[color:var(--text-3)]">בחר</span>}
        </button>
        <input
          value={amountStr} onChange={e => editable && onAmount?.(e.target.value.replace(/[^\d.,]/g, ''))}
          readOnly={!editable} inputMode="decimal" dir="ltr"
          placeholder={editable ? '0.0' : '—'}
          className="flex-1 min-w-0 bg-transparent outline-none text-end text-[18px] md:text-[20px] font-extrabold dx-num placeholder:text-[color:var(--text-3)]/50"
          data-testid={`amount-${label.includes('From') ? 'in' : 'out'}`}
        />
      </div>
      {token?.priceUsd !== undefined && editable && (
        <div className="mt-1 text-end text-[10px] text-[color:var(--text-3)] dx-num" dir="ltr">
          ≈ ${(Number.parseFloat(amountStr.replace(/,/g, '')) || 0) * token.priceUsd >= 0 ? nfmt((Number.parseFloat(amountStr.replace(/,/g, '')) || 0) * token.priceUsd, 2) : '—'}
        </div>
      )}
    </div>
  );
}

// ─── בורר-טוקנים (רשת+טוקן מאוחדים) ───
function TokenPicker({ open, side, chains, onClose, onPick, other }: {
  open: boolean; side: 'in' | 'out' | null;
  chains: ChainInfo[]; onClose: () => void;
  onPick: (t: UToken) => void; other: UToken | null;
}) {
  const [q, setQ] = useState('');
  const [chainSel, setChainSel] = useState('');
  const [results, setResults] = useState<UToken[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (open) { setQ(''); setChainSel(''); } }, [open, side]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/swap/universe?q=${encodeURIComponent(q)}${chainSel ? `&chain=${chainSel}` : ''}`, { cache: 'no-store' });
        const j = await r.json();
        if (alive && j.ok) setResults(j.results as UToken[]);
      } catch { if (alive) setResults([]); }
      finally { if (alive) setLoading(false); }
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [q, chainSel, open]);

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="dx-card border-[color:var(--line)] rounded-3xl max-w-[520px] max-h-[80vh] flex flex-col" dir="rtl">
        <DialogHeader className="p-0 pb-3">
          <DialogTitle className="text-sm font-bold">{side === 'in' ? 'בחר מטבע-מקור · כל-הרשתות' : 'בחר מטבע-יעד · כל-הרשתות'}</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute end-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[color:var(--text-3)]" />
          <Input autoFocus value={q} onChange={e => setQ(e.target.value)}
            placeholder="שם/סמל/כתובת-חוזה… (למשל USDT, PEPE, 0x…)"
            className="h-11 pe-9 text-[13px]" data-testid="token-search" />
        </div>
        <div className="flex gap-1.5 overflow-x-auto scroll-slim py-2.5" role="tablist" aria-label="סינון-רשתות">
          <button onClick={() => setChainSel('')}
            className={`dx-chip h-7 px-2.5 shrink-0 text-[10.5px] ${!chainSel ? 'border-[color:var(--pink)]/60 text-[color:var(--pink)]' : ''}`}>
            הכל
          </button>
          {chains.map(c => {
            const cc = hueColor(c.hue);
            return (
              <button key={c.key} onClick={() => setChainSel(c.key)} role="tab" aria-selected={chainSel === c.key}
                className={`dx-chip h-7 px-2.5 shrink-0 text-[10.5px] ${chainSel === c.key ? 'border-[color:var(--pink)]/60 text-[color:var(--pink)]' : ''}`}
                style={chainSel === c.key ? { borderColor: `${cc}88`, color: cc } : undefined}>
                {c.name}
              </button>
            );
          })}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto scroll-slim flex flex-col gap-1.5 max-h-[46vh]" data-testid="token-list">
          {loading && results.length === 0 && (
            <div className="flex items-center justify-center py-8 text-[color:var(--text-3)]">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          )}
          {!loading && results.length === 0 && (
            <div className="py-8 text-center text-[12px] text-[color:var(--text-3)]">לא-נמצאו-התאמות</div>
          )}
          {results.map(t => {
            const cc = hueColor(t.hue);
            const isOther = !!other && other.id === t.id && other.chain === t.chain;
            return (
              <button key={t.id} onClick={() => onPick(t)} disabled={isOther}
                className={`text-start dx-raised rounded-xl p-2.5 flex items-center gap-2.5 hover:border-[color:var(--line-strong)] transition-colors ${isOther ? 'opacity-40' : ''}`}
                data-testid={`tok-${t.chain}-${t.symbol}`}>
                <span className="dx-token shrink-0" style={{ width: 30, height: 30, fontSize: 10, background: `linear-gradient(135deg, ${cc}26, ${cc}55)`, border: `1px solid ${cc}66`, color: cc }}>
                  {t.symbol.slice(0, 1)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[12.5px]">{t.symbol}</span>
                    <span className="text-[9.5px] px-1.5 py-0.5 rounded-full dx-chip" style={{ color: cc, borderColor: `${cc}44` }}>{t.chainName}</span>
                  </div>
                  <div className="text-[10px] text-[color:var(--text-3)] truncate">{t.name}</div>
                </div>
                {t.priceUsd !== undefined && (
                  <span className="text-[10.5px] text-[color:var(--text-2)] dx-num shrink-0" dir="ltr">${nfmt(t.priceUsd, 4)}</span>
                )}
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── פאנל-הפקדה (QR + ממואר + שלבים) ───
function DepositPanel({ exec, copied, onCopy, shiftStatus, expiresIn, toChain, fromChain }: {
  exec: ExecDeposit; copied: string; onCopy: (t: string, tag: string) => void;
  shiftStatus: string; expiresIn: number | null;
  toChain?: ChainInfo; fromChain?: ChainInfo;
}) {
  return (
    <div className="dx-raised p-4 rounded-2xl flex flex-col gap-3" data-testid="deposit-panel">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-[13px] font-bold flex items-center gap-2">
          <Clock className="w-4 h-4 text-[color:var(--amber)]" />
          ההזמנה-נוצרה · שלח כעת
        </span>
        {expiresIn !== null && (
          <span className={`dx-num text-[11px] font-bold ${expiresIn < 120 ? 'text-[color:var(--red)]' : 'text-[color:var(--amber)]'}`} dir="ltr">
            {expiresIn > 3600 ? `נותרו ${Math.floor(expiresIn / 3600)} שע׳` : expiresIn > 0 ? `נותרו ${Math.floor(expiresIn / 60)}:${String(expiresIn % 60).padStart(2, '0')}` : 'פקע — אל-תשלח'}
          </span>
        )}
        {shiftStatus && (
          <span className="text-[10px] px-2 py-0.5 rounded-full dx-chip text-[color:var(--green)]">סטטוס: {shiftStatus}</span>
        )}
      </div>

      <div className="flex gap-4 flex-wrap items-start">
        {exec.depositAddressQr && (
          <img src={exec.depositAddressQr} alt="QR כתובת-הפקדה" className="w-[132px] h-[132px] rounded-xl bg-white p-1.5 shrink-0" />
        )}
        <div className="flex flex-col gap-2 min-w-[240px] flex-1">
          <CopyRow label={`כתובת-הפקדה (${exec.depositAsset} · ${fromChain?.name ?? exec.depositChain})`}
            value={exec.depositAddress} tag="addr" copied={copied} onCopy={onCopy} />
          {(exec.memo || exec.depositMemo) && (
            <CopyRow label="ממואר (memo/data) — חובה!" value={(exec.memo || exec.depositMemo)!} tag="memo" copied={copied} onCopy={onCopy} warn={exec.memoOversized} />
          )}
          <CopyRow label={`כתובת-קבלה-שלך (${exec.settleAsset} · ${toChain?.name ?? exec.settleChain})`}
            value={exec.settleAddress} tag="settle" copied={copied} onCopy={onCopy} />
          <div className="flex items-center gap-2 text-[11px] flex-wrap">
            <span className="text-[color:var(--text-2)]">תקבל בדיוק:</span>
            <span className="font-extrabold text-[color:var(--green)] dx-num" dir="ltr">
              {nfmt(exec.expectedOut ?? exec.settleAmount ?? 0, 8)} {exec.settleAsset}
            </span>
            {exec.etaSec !== undefined && <span className="text-[color:var(--text-3)]">· ≈{Math.max(1, Math.round(exec.etaSec / 60))} דק׳</span>}
          </div>
        </div>
      </div>

      <ol className="flex flex-col gap-1.5 border-t border-[color:var(--line)] pt-3">
        {exec.steps.map((s, i) => (
          <li key={i} className="text-[11px] text-[color:var(--text-2)] flex items-start gap-2">
            <span className="w-4.5 h-4.5 rounded-full bg-[color:var(--pink)]/15 text-[color:var(--pink)] text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>

      {(exec.warning || exec.notes) && (
        <div className="text-[10px] text-[color:var(--text-3)] flex items-start gap-1.5">
          <Info className="w-3 h-3 mt-0.5 shrink-0 text-[color:var(--amber)]" />
          <span className="break-words">{exec.warning ?? exec.notes}</span>
        </div>
      )}

      <div className="flex gap-3 flex-wrap">
        {exec.explorerDeposit && (
          <a href={exec.explorerDeposit} target="_blank" rel="noreferrer" className="text-[11px] text-[color:var(--pink)] underline flex items-center gap-1">
            <ExternalLink className="w-3 h-3" /> כתובת-ההפקדה-בסייר
          </a>
        )}
        {exec.explorerSettle && (
          <a href={exec.explorerSettle} target="_blank" rel="noreferrer" className="text-[11px] text-[color:var(--pink)] underline flex items-center gap-1">
            <ExternalLink className="w-3 h-3" /> כתובת-הקבלה-בסייר
          </a>
        )}
      </div>
    </div>
  );
}

function CopyRow({ label, value, tag, copied, onCopy, warn }: {
  label: string; value: string; tag: string; copied: string;
  onCopy: (t: string, tag: string) => void; warn?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <div className={`text-[9.5px] font-semibold ${warn ? 'text-[color:var(--red)]' : 'text-[color:var(--text-3)]'}`}>{label}{warn ? ' · חורג-מ-80-בייטים!' : ''}</div>
        <div className="text-[11px] font-data break-all text-[color:var(--text-1)]" dir="ltr">{value}</div>
      </div>
      <button onClick={() => onCopy(value, tag)} aria-label={`העתק ${label}`}
        className="dx-chip h-8 px-2 shrink-0 flex items-center gap-1 text-[10px] hover:border-[color:var(--line-strong)]">
        {copied === tag ? <Check className="w-3 h-3 text-[color:var(--green)]" /> : <Copy className="w-3 h-3" />}
        {copied === tag ? 'הועתק' : 'העתק'}
      </button>
    </div>
  );
}
