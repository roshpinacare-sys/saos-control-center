'use client';

// ─── SAOS DEX — הבורסה הריבונית · ממשק Uniswap-class על המנוע האמיתי ───────
// בורסה · מסחר מקצועי · בריכות · תיק · עיגונים — חיים מ-/saos-dex/api/dex/state
// הפלטפורמה הריבונית (כספת/מגדלים/מבצעים/ביקורת/הגדרות) נשארת מחוברת 1:1.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Copy, KeyRound } from 'lucide-react';
import { LoginDialog } from '@/components/sv/login-dialog';
import { VaultView } from '@/components/sv/vault-view';
import { SovereignView } from '@/components/sv/sovereign-view'; // EXEC-CD-24: כספת-הריפו הריבונית + העברה-למפעיל
import { TowersView } from '@/components/sv/towers-view';
import { OpsView } from '@/components/sv/ops-view';
import { AuditView } from '@/components/sv/audit-view';
import { SettingsView } from '@/components/sv/settings-view';
import { getToken, storeToken, authHeaders, fmtAgo } from '@/components/sv/shared';
import type { StatusData, ChatMsg, TaskT, AuditRow, SaosStatus } from '@/components/sv/shared';
import { TopNav, MobileNav, type ViewId } from '@/components/dex/nav';
import { useDexWorld, usePoll, StaleChip, fmtInt } from '@/components/dex/common';
import { SwapView } from '@/components/dex/swap-view';
import { UniversalSwapView } from '@/components/dex/universal-swap-view'; // EXEC-CD-23: החלפת-הכל — אגרגטור ריבוני
import { LiveView } from '@/components/dex/live-view'; // EXEC-CD-15: גשר-החי — חיבור-ממשי לרשתות
import { ProView } from '@/components/dex/pro-view';
import { PoolsView } from '@/components/dex/pools-view';
import { EconomyView } from '@/components/dex/economy-view';
import { PortfolioView } from '@/components/dex/portfolio-view';
import { EstateView } from '@/components/dex/estate-view';
import { AnchorsView } from '@/components/dex/anchors-view';
import { FuelDeckView } from '@/components/dex/fuel-deck'; // Task 3-c: סיפון-הדלק — טלמטריית דלק/RC חיה
import { CustodyAlertBar } from '@/components/dex/custody-alert-bar'; // T-15: פס-משמר-משמורת — דגימה 20ש'
import { RpcMeshChart } from '@/components/dex/rpc-mesh-chart'; // T-35: גרף-ביצועי-רשת-הצמתים — דירוג-חי 20ש'
import { DoorView } from '@/components/dex/door-view';
import { LegionView } from '@/components/dex/legion-view'; // EXEC-CD-22: מרכז-הביצוע-הריבוני
import { SoldiersView } from '@/components/dex/soldiers-view'; // EXEC-CD-22: הלגיון-הנופלים → האימפריה
import { AgentEconomyView } from '@/components/dex/agent-economy-view'; // EXEC-CD-31: כלכלת-הסוכנים — הפליוויל
import { RevenueView } from '@/components/dex/revenue-view';
import { GridOpsView } from '@/components/dex/grid-ops-view'; // EXEC-CD-10: מרכז-החיים של רשת-הגריד (STEEM)

export default function SovereignDex() {
  const [booted, setBooted] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [status, setStatus] = useState<StatusData | null>(null);
  const [saos, setSaos] = useState<SaosStatus | null>(null);
  const [relay, setRelay] = useState(false);
  const [relayEpoch, setRelayEpoch] = useState(0); // FIX(R16-c·C1): חיבור-מחדש-האפיק אחרי-התחברות-בעלים
  const [view, setView] = useState<ViewId>('swap');
  const [lastSync, setLastSync] = useState<number | null>(null);

  const [loginMsg, setLoginMsg] = useState<{ ok: boolean; text: string; roles?: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [tasks, setTasks] = useState<TaskT[]>([]);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [newToken, setNewToken] = useState<string | null>(null);

  // ── the live engine ──
  const { world, online, refetchNow } = useDexWorld();

  const refreshSaos = useCallback(async () => {
    try {
      const r = await fetch('/api/saos/status', { cache: 'no-store' });
      const j = await r.json();
      if (j.ok) { setSaos(j); return true; }
      return false;
    } catch { return false; }
  }, []);

  // Personal system: everything is readable WITHOUT login; mutations need a
  // session. If a mutation is attempted while logged out → open the login menu.
  const needAuth = useCallback(() => {
    if (getToken()) return false;
    setLoginOpen(true);
    setLoginMsg({ ok: false, text: 'התחבר דרך התפריט כדי לבצע פעולות מסחר — הצפייה פתוחה תמיד.' });
    return true;
  }, []);

  // FIX(Roast-65-e4 · F7): הלולאות המחזוריות עברו ל-usePoll — השהיה-בהסתרת-טאב, backoff-עם-jitter,
  // ושבב "נתונים-ישנים" במקום catch-שקט. הפונקציות עצמן נשארות-זמינות לאירועי-socket ולפעולות-משתמש.
  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const r = await fetch('/api/vault/status', { cache: 'no-store', headers: authHeaders() });
      if (!r.ok) { setBooted(true); return false; }
      const j = await r.json();
      if (j.ok) {
        setStatus(j);
        setLastSync(Date.now());
        const nowAuthed = !!j.me;
        setAuthed(nowAuthed);
        if (!nowAuthed && getToken()) {
          setLoginMsg({ ok: false, text: 'תוקף החיבור פג או בוטל — התחבר שוב עם כל מפתח. הכספת נשמרת מוצפנת ושלמה.' });
          setLoginOpen(true);
        }
        return true;
      }
      return false;
    } catch { return false; }
    finally { setBooted(true); }
  }, []);

  const refreshChat = useCallback(async (): Promise<boolean> => {
    try {
      const r = await fetch('/api/chat', { cache: 'no-store', headers: authHeaders() });
      if (r.ok) { const j = await r.json(); if (j.ok) { setMessages(j.messages); return true; } }
      return false;
    } catch { return false; }
  }, []);

  const refreshTasks = useCallback(async (): Promise<boolean> => {
    try {
      const r = await fetch('/api/task', { cache: 'no-store', headers: authHeaders() });
      if (r.ok) { const j = await r.json(); if (j.ok) { setTasks(j.tasks); return true; } }
      return false;
    } catch { return false; }
  }, []);

  const refreshAudit = useCallback(async () => {
    try {
      const r = await fetch('/api/audit', { cache: 'no-store', headers: authHeaders() });
      if (r.ok) { const j = await r.json(); if (j.ok) setAuditRows(j.logs); }
    } catch { /* */ }
  }, []);

  // boot + socket + intervals
  useEffect(() => {
    // FIX(Roast-65-e4 · F7): הרענונים-המדוגמים (vault/chat/task) רצים-דרך-usePoll; כאן נשארים רק החד-פעמיים
    const boot = setTimeout(() => { refreshAudit(); refreshSaos(); }, 0);
    // FIX(R16-c·C1): ה-socket מתחבר עם אימות-handshake (טוקן-בעלים אם-קיים);
    // אורחים-מתחברים ללא-טוקן ומקבלים את ערוצי-הצפייה-הפומבית בלבד (פרקטיקת-ה-relay).
    let cancelled = false;
    const sockets: Array<ReturnType<typeof io>> = [];
    void (async () => {
      let token = '';
      try {
        const r = await fetch('/api/relay-token', { cache: 'no-store', headers: authHeaders() });
        if (r.ok) { const j = await r.json(); if (j.ok) token = String(j.token || ''); }
      } catch { /* אורח — זרם-פומבי בלבד */ }
      if (cancelled) return;
      const sock = io('/?XTransformPort=3003', { transports: ['websocket', 'polling'], reconnection: true, reconnectionAttempts: 8, timeout: 8000, auth: { token } });
      sock.on('connect', () => setRelay(true));
      sock.on('disconnect', () => setRelay(false));
      sock.on('chat', (m: ChatMsg) => setMessages(prev => (prev.some(x => x.id === m.id) ? prev : [...prev, m])));
      sock.on('vault', () => void refresh());
      sock.on('task', () => void refreshTasks());
      sock.on('agent', () => void refresh());
      sock.on('guard', () => void refresh());
      sockets.push(sock);
    })();
    return () => { cancelled = true; for (const s of sockets.splice(0)) s.close(); clearTimeout(boot); };
  }, [relayEpoch]); // FIX(R16-c·C1): relayEpoch נדחף אחרי-התחברות → חיבור-מחדש עם-טוקן-מלא

  // FIX(Roast-65-e4 · F7): 3-לולאות-הסקירה (8ש׳) — usePoll: השהיה-בטאב-נסתר + backoff + stale-chip.
  // הקריאות-המיידיות-באבחתה מגיעות-מה-tick-הראשון של-usePoll; ה-boot-טיימאאוט משאיר רק את refreshAudit/refreshSaos.
  const vaultStale = usePoll(refresh, 8000);
  const chatStale = usePoll(refreshChat, 8000);
  const tasksStale = usePoll(refreshTasks, 8000);
  const pollStale = vaultStale || chatStale || tasksStale;

  useEffect(() => {
    if (!authed) return;
    const v = setInterval(() => { fetch('/api/vault/verify', { method: 'POST', headers: authHeaders() }).then(() => void refresh()).catch(() => { }); }, 300000);
    return () => { clearInterval(v); };
  }, [authed, refresh]);

  // ── actions ──
  async function doLogin(account: string, chain: string, wif: string, nonce: string) {
    setBusy(true); setLoginMsg(null);
    try {
      const r = await fetch('/api/vault/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account, chain, wif, nonce }), // SIWE — אתגר-חתימה חד-פעמי
      });
      const j = await r.json();
      if (j.ok) {
        storeToken(j.token || ''); // Bearer carrier — שורד רענון וסגירת-טאב
        setLoginMsg({ ok: true, text: j.message, roles: j.roles });
        setLoginOpen(false);
        setRelayEpoch((e) => e + 1); // FIX(R16-c·C1): אפיק-האירועים מתחבר-מחדש עם-הטוקן-המלא
        await refresh(); await refreshChat(); await refreshTasks(); await refreshAudit();
      } else {
        setLoginMsg({ ok: false, text: j.error || 'התחברות נכשלה' });
      }
    } catch {
      setLoginMsg({ ok: false, text: 'שגיאת רשת — ודא שהפלטפורמה נגישה ונסה שוב' });
    }
    setBusy(false);
  }

  async function verifyAll() {
    if (needAuth()) return;
    setVerifying(true);
    try { await fetch('/api/vault/verify', { method: 'POST', headers: authHeaders() }); await refresh(); } catch { /* */ }
    setVerifying(false);
  }

  function doLogout() {
    // FIX(Roast-63 · C2): התנתקות-אמת — הסשן-מבוטל-בשרת (ה-Bearer-מת, ה-30-יום-נגמרים-עכשיו)
    // בנוסף-לניקוי-המקומי. היה-תיאטרון: הכפתור-ניקה-localStorage-בלבד.
    try {
      void fetch('/api/vault/logout', { method: 'POST', headers: authHeaders() });
      document.cookie = 'sv_session=; Max-Age=0; Path=/'; // FIX(R15-b · m1): ה-cookie-האמת הוא sv_session (auth.ts SESSION_COOKIE) — saos_session לא-קיים
    } catch { /* מתנתקים-מקומית-בכל-מקרה */ }
    storeToken('');
    setAuthed(false); setStatus(s => (s ? { ...s, me: null } : s));
    setLoginMsg(null);
  }

  async function toggleLock(enable: boolean) {
    if (needAuth()) return;
    let confirm = '';
    if (!enable) { confirm = 'אני הבעלים ואני מאשר ביטול נעילת-owner'; }
    const r = await fetch('/api/guard', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ enable, confirm }) });
    const j = await r.json();
    if (!j.ok) alert(j.error || 'נכשל');
    await refresh();
  }

  // FIX(Roast-65-e4 · F18): sendChat/createTask מדווחים-כישלון (false) — OpsView שומר-את-הקלט
  // ומציג-שגיאה במקום לבלוע-את-הכשל ולנקות-קלט בכל-מקרה.
  async function sendChat(content: string): Promise<boolean> {
    if (needAuth()) return false;
    try {
      const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ content }) });
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok) { await refreshChat(); return true; }
      return false;
    } catch {
      return false;
    }
  }

  async function createTask(title: string, assignedTo: string): Promise<boolean> {
    if (needAuth()) return false;
    try {
      const r = await fetch('/api/task', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ title, assignedTo }) });
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok) { await refreshTasks(); return true; }
      return false;
    } catch {
      return false;
    }
  }

  async function registerAgent(name: string, caps: string) {
    if (needAuth()) return;
    const r = await fetch('/api/agent/register', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ name, capabilities: caps }) });
    const j = await r.json();
    if (j.ok) { setNewToken(j.token); await refresh(); }
    else alert(j.error || 'נכשל');
  }

  // ── boot guard ──
  if (!booted) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center min-h-screen gap-4">
        <span className="w-14 h-14 rounded-full bg-[color:var(--pink)] text-white font-black text-xl flex items-center justify-center shadow-[0_0_44px_-6px_rgba(255,55,199,0.8)]">S</span>
        <div className="text-[color:var(--text-2)] text-[13px]">מאתחל את הבורסה הריבונית...</div>
        {/* EXEC-CD-19 (TRUTH-AUDIT): אפס-חותמות ב-DB — התווית חייבת לומר מרקל-מוכן, לא "חתום-קונצנזוס" */}
        <div className="dx-num text-[10px] text-[color:var(--text-3)]">SAOS DEX · גשר-חי ל-10 רשתות אמת · מרקל-מוכן (אין עדיין חותמות)</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <TopNav view={view} onNavigate={setView} status={status} world={world} online={online} relay={relay} authed={authed}
        onLogin={() => { setLoginMsg(null); setLoginOpen(true); }} onLogout={doLogout} />

      {/* FIX(Roast-65-e4 · F7): חיווי-כן כשלולאות-הסקירה נכשלו — הנתונים-על-המסך ישנים */}
      {pollStale && (
        <div className="mx-auto w-full max-w-[1400px] px-3 md:px-6 pt-2">
          <StaleChip show />
        </div>
      )}

      <main key={view} className="flex-1 w-full max-w-[1400px] mx-auto px-3 md:px-6 pt-14 md:pt-6 pb-24 md:pb-8 animate-rise">
        <CustodyAlertBar />  {/* T-15 · Sovereign Liquidity Guard Node — RED = נעילת-יציאה */}
        {view === 'swap' && (
          <SwapView world={world} online={online} onNeedAuth={() => { setLoginMsg(null); setLoginOpen(true); }} />
        )}
        {view === 'universal' && <UniversalSwapView />}
        {view === 'live' && <LiveView />}
        {view === 'pro' && (
          <ProView world={world} online={online} onNeedAuth={() => { setLoginMsg(null); setLoginOpen(true); }} />
        )}
        {view === 'pools' && (
          <PoolsView world={world} onNeedAuth={() => { setLoginMsg(null); setLoginOpen(true); }} onDone={refetchNow} />
        )}
        {view === 'economy' && (
          <EconomyView onNeedAuth={() => { if (getToken()) return true; setLoginMsg({ ok: false, text: 'התחבר דרך "חבר ארנק" כדי לנעול, להצביע ולקנות בונדים.' }); setLoginOpen(true); return false; }} onDone={refetchNow} />
        )}
        {view === 'portfolio' && (
          <PortfolioView world={world} onNeedAuth={() => { setLoginMsg(null); setLoginOpen(true); }} onDone={refetchNow} />
        )}
        {view === 'grid' && <GridOpsView />}
        {view === 'revenue' && <RevenueView />}
        {view === 'estate' && <EstateView />}
        {view === 'anchors' && <AnchorsView world={world} />}
        {view === 'fuel' && <FuelDeckView />}  {/* Task 3-c: סיפון-הדלק — GET /api/fuel */}
        {view === 'door' && (
          <DoorView
            onNeedAuth={() => { setLoginMsg(null); setLoginOpen(true); }}
            onNavigate={v => setView(v)}
            onDone={refetchNow}
          />
        )}
        {view === 'legion' && <LegionView />}
        {view === 'soldiers' && <SoldiersView />}
        {view === 'agents' && <AgentEconomyView />}

        {/* platform views — the sovereign control center, dark-skinned */}
        {view === 'vault' && (
          <div className="sv-theme">
            <VaultView status={status} verifying={verifying} onVerifyAll={verifyAll} />
          </div>
        )}
        {view === 'sovereign' && (
          <div className="sv-theme">
            <SovereignView />
          </div>
        )}
        {view === 'towers' && (
          <div className="sv-theme">
            <TowersView saos={saos} onSaosRefresh={refreshSaos} />
          </div>
        )}
        {view === 'ops' && (
          <div className="sv-theme space-y-4">
            <RpcMeshChart />  {/* T-35 · רשת-הצמתים-החיה — latency + successRate פר-צומת */}
            <OpsView status={status} authed={authed} messages={messages} onSend={sendChat} tasks={tasks} onCreateTask={createTask} onRegisterAgent={registerAgent} />
          </div>
        )}
        {view === 'audit' && (
          <div className="sv-theme">
            <AuditView rows={auditRows} />
          </div>
        )}
        {view === 'settings' && (
          <div className="sv-theme">
            <SettingsView status={status} authed={authed} verifying={verifying} onToggleLock={toggleLock} onVerifyAll={verifyAll} onLogout={doLogout} />
          </div>
        )}
      </main>

      <footer className="hidden md:block mt-auto border-t border-[color:var(--line)] bg-[color:var(--canvas-deep)] px-7 py-3.5">
        <div className="max-w-[1400px] mx-auto flex items-center justify-between flex-wrap gap-2 text-[11px] text-[color:var(--text-3)]">
          <span>
            {/* EXEC-CD-28 (TRUTH): מצב-המנוע נמדד-חי — המנוע חי (h153k+, סוואפים-אמת על-השרשרת).
                הכספת והגשר-החי ל-10 רשתות — אמת מדודה מקוד זה */}
            SAOS DEX · כספת AES-256-GCM · גשר-חי ל-10 רשתות אמת · מרקל-מוכן · עיגון/מסחר: דרך מנוע-הדקס {online ? `(חי · h${world ? world.state.height.toLocaleString('en-US') : '…'})` : '(לא נגיש עתה)'}
          </span>
          <span className="dx-num" dir="ltr">
            {world ? `#${fmtInt(world.state.height)} · ${fmtInt(world.state.fills)} fills · ${fmtInt(world.state.swaps)} swaps` : ''}
            {lastSync ? ` · SYNC ${fmtAgo(new Date(lastSync).toISOString())}` : ''}
          </span>
        </div>
      </footer>

      <MobileNav view={view} onNavigate={setView} authed={authed} world={world} online={online}
        onLogin={() => { setLoginMsg(null); setLoginOpen(true); }} onLogout={doLogout} />

      {/* new agent token dialog */}
      <Dialog open={!!newToken} onOpenChange={o => !o && setNewToken(null)}>
        <DialogContent className="dx-card border-[color:var(--line)] max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <KeyRound className="w-4 h-4 text-[color:var(--green)]" />טוקן הסוכן — מוצג פעם אחת!
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-[color:var(--text-2)] leading-relaxed">העבר את הטוקן לסוכן. לא ניתן לצפות בו שוב (נשמר רק hash).</p>
            <div className="flex gap-2">
              <Input readOnly value={newToken || ''} className="bg-[color:var(--raised)] border-[color:var(--line)] font-data text-xs text-[color:var(--text-1)]" dir="ltr" />
              <button
                onClick={() => navigator.clipboard.writeText(newToken || '')}
                aria-label="העתק טוקן"
                className="w-10 h-10 shrink-0 rounded-lg dx-chip flex items-center justify-center text-[color:var(--text-2)] hover:text-[color:var(--text-1)] transition-colors"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* login dialog — הכניסה בתפריט, בלי חוסם */}
      <LoginDialog open={loginOpen} onOpenChange={o => { setLoginOpen(o); if (!o) setLoginMsg(null); }} msg={loginMsg} busy={busy} onLogin={doLogin} />
    </div>
  );
}
