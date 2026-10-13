/**
 * instrumentation.ts — הדמונים הנלווים:
 *  · גשר saos-dex: משגר את דמון הבורסה הריבונית (saos-dex, פורט 3010) כילד-תהליך
 *    של שרת האם — כך הוא שורד את מחזור-החיים של קריאות-המעטפת (מורשת guardian_boot).
 *  · הפעלה חד-פעמית לכל תהליך-שרת; בדיקת-תפוסה לפני שיגור + אימות-לאחר-שגר.
 *  · יבוא-דינמי בלבד (edge-safe) — net/child_process/fs בענף-nodejs בלבד.
 *
 * FIX(Roast-65-b):
 *  · M5 — allowlist-סביבה מפורש לילד: היה { ...process.env } שהזריק את כל-סביבת
 *    האם — כולל SOVEREIGN_VAULT_SECRET (מפתח-ה-AES של הכספת!) — לתהליך-הדקס,
 *    החשוף-ביותר-לרשת. עכשיו: deny-by-default, רק שמות-שהדקס באמת קורא
 *    (נמדדו מול saos-dex/src + .env.example) ומשתני-ריצה נטולי-סוד.
 *  · M6 — spawn לא-עיוור: stdout/stderr מנותבים ל-daemon-spawn.log (0600),
 *    poll-אימות-לאחר-שגר מקליט launchVerified (כמו ה-guardian), bun-אבסולוטי.
 *  · L5 — פרסר-.env מוקשח: מרכאות/הערות-בשורה/ייצוא נחתכים; שורות-פגומות
 *    נרשמות ומדולגות בקול (היה: ערכים-מושחתים-שקטים).
 */
// FIX(10-d-6): DEX_DIR env-overridable — no more machine-bound path hardcode
const DEX_DIR = process.env.DEX_DIR || "/home/z/my-project/saos-dex";
const DEX_PORT = 3010;
const DEX_LOG = `${DEX_DIR}/daemon-spawn.log`;

// EXEC-CD-22 · THE-LEGION — מרכז-הביצוע-הריבוני (SAEC): 11 סוכנים-ריבוניים
// (חיים-שניים לחיילי-ROT1) — אותו-דפוס-הישרדות בדיוק: ילד-של-שרת-האם.
const LEGION_DIR = process.env.LEGION_DIR || "/home/z/my-project/mini-services/saos-legion";
const LEGION_PORT = 3012;
const LEGION_LOG = `${LEGION_DIR}/legion-spawn.log`;

interface LegionRT { pid: number | null; launchVerified: boolean | null; lastError: string | null; }
const gl = globalThis as unknown as { __saosLegion?: LegionRT };
function rtLegion(): LegionRT {
  if (!gl.__saosLegion) gl.__saosLegion = { pid: null, launchVerified: null, lastError: null };
  return gl.__saosLegion;
}

// המצב-החי של הגשר — נרשם על globalThis כמו ה-guardian (Roast-64-a · F8)
interface BridgeRT {
  pid: number | null;
  launchVerified: boolean | null;
  launchVerifiedAt: number;
  lastError: string | null;
}
const g = globalThis as unknown as { __saosBridge?: BridgeRT };
function rt(): BridgeRT {
  if (!g.__saosBridge) g.__saosBridge = { pid: null, launchVerified: null, launchVerifiedAt: 0, lastError: null };
  return g.__saosBridge;
}

// ── M5: allowlist — כל-מה-שלא-רשום כאן לעולם לא חוצה את גבול-התהליך ─────────
// מדוד מול saos-dex/src (process.env.* שהדקס באמת קורא) + .env.example שלו.
const ALLOW_EXACT = new Set([
  // משתני-ריצה בסיסיים — אין-סודות
  "NODE_ENV", "PORT", "PATH", "HOME", "TMPDIR", "LANG", "LC_ALL",
  // שמות-מפורשים שהדקס קורא (קונפיג לא-סודי)
  "DEX_OPERATOR_TOKEN", "LEGION_OPERATOR_TOKEN", "SAOS_RELAY_AGENT_ACCOUNT", "SAOS_FLEET_VAULT_DIR",
  "SAOS_EXTERNAL_SIGNER_URL", "SAOS_EXTERNAL_SIGNER_TOKEN",
  "HIVE_ANCHOR_ACCOUNT", "ETH_EXPECTED_ADDRESS", "SOL_EXPECTED_ADDRESS",
  "ETH_RPC_URL", "SOL_RPC_URL", "ETH_BROADCAST_ENABLED", "SOL_BROADCAST_ENABLED",
]);
// מפתחות-חתימה/עיגון של הדקס — שמות-מפורשים-בלבד, לעולם לא ירושה-כללית
const ALLOW_KEYS = new Set([
  "STEEM_ACTIVE_WIF", "STEEM_POSTING_WIF", "HIVE_ACTIVE_WIF", "HIVE_POSTING_WIF",
  "BLURT_ACTIVE_WIF", // Roast-82: מסילת-BLURT — השרשרת-השביעית (אפס-RC, אפס-עלות)
  "ETH_PRIVATE_KEY", "SOL_PRIVATE_KEY", "TRON_PRIVATE_KEY",
]);
// משפחות-שמות ספציפיות-לדקס
const ALLOW_PREFIXES = ["SAOS_DEX_", "DEX_"];
function envAllowed(k: string): boolean {
  if (k.startsWith("SOVEREIGN_")) return false; // סודות-האם — חסימה-אקספליציטית גם-אם-נקרא-אחרת
  return ALLOW_EXACT.has(k) || ALLOW_KEYS.has(k) || ALLOW_PREFIXES.some(p => k.startsWith(p));
}

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const [{ spawn }, net, fs] = await Promise.all([import("child_process"), import("net"), import("fs")]);
    const portBusy = (port: number): Promise<boolean> =>
      new Promise((resolve) => {
        const s = net.createConnection({ port });
        const done = (v: boolean) => { s.destroy(); resolve(v); };
        s.once("connect", () => done(true));
        s.once("error", () => done(false));
        setTimeout(() => done(false), 900).unref?.();
      });
    const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms).unref?.(); });

    try {
      if (!(await portBusy(DEX_PORT))) {
        // FIX(Roast-65-b · M5): deny-by-default — הילד מקבל רק את ה-allowlist;
        // SOVEREIGN_VAULT_SECRET / SOVEREIGN_RELAY_TOKEN ושאר סודות-האם לא עוברים.
        const childEnv: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV || 'development' };
        for (const [k, v] of Object.entries(process.env)) {
          if (v !== undefined && envAllowed(k)) childEnv[k] = v;
        }
        try {
          const envPath = `${DEX_DIR}/.env`;
          const raw = fs.readFileSync(envPath, "utf8");
          // FIX(Roast-65-b · L5): פרסר-מוקשח — export/מרכאות/הערות-בשורה; שורה
          // פגומה → יומן-דילוג (לא ערך-מושחת-שקט). גם-כאן deny-by-default.
          raw.split("\n").forEach((line, i) => {
            const t = line.trim();
            if (!t || t.startsWith("#")) return;
            const body = t.startsWith("export ") ? t.slice(7).trim() : t;
            const eq = body.indexOf("=");
            if (eq <= 0) {
              console.log(`[saos-bridge] dex .env line ${i + 1} skipped (malformed: no KEY=VALUE)`);
              return;
            }
            const k = body.slice(0, eq).trim();
            let v = body.slice(eq + 1).trim();
            if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) {
              v = v.slice(1, -1); // מרכאות = חלק-מהערך-בלבד
            } else {
              const hash = v.indexOf(" #"); // הערה-בשורה (מחוץ-למרכאות)
              if (hash >= 0) v = v.slice(0, hash).trim();
            }
            if (!k) {
              console.log(`[saos-bridge] dex .env line ${i + 1} skipped (empty key)`);
              return;
            }
            if (!envAllowed(k)) return; // deny-by-default גם-בתוך ה-.env של הדקס
            childEnv[k] = v;
          });
        } catch {
          console.log("[saos-bridge] no saos-dex/.env found — relay will wait (honest pending)");
        }
        // הפרדת-מסדי-נתונים מחייבת: הדמון מקבל את ה-DB שלו-עצמו (saos-dex/db/dex.db) —
        // לעולם לא את ה-DATABASE_URL של הפלטפורמה-האם (custom.db). דורס-תמיד.
        childEnv.DATABASE_URL = "file:/home/z/my-project/saos-dex/db/dex.db";
        if (childEnv.SOVEREIGN_VAULT_SECRET) delete childEnv.SOVEREIGN_VAULT_SECRET; // belt&braces — לא-אמור-להגיע-לכאן

        // FIX(Roast-65-b · M6/L6): bun-אבסולוטי (process.execPath = הבינארי
        // שמריץ את השרת-הזה) — היה "bun" מ-PATH כשהילד-מקבל-env-סודות.
        // FIX(roast-84 · revival): execPath=bun היה ההנחה; בסביבות שמריצות next דרך
        // node (שימור-סנדבוקס) ה-spawn נופל ("Cannot find module 'run'") והשרת-האם
        // מת בעקבותיו. עתה: SAOS_BUN_BIN → bun-אמתי-אם-execPath-אינו-bun → execPath.
        const BUN = process.env.SAOS_BUN_BIN
          || (process.execPath.includes("bun") ? process.execPath : "/usr/local/bin/bun");
        // כנות-מצב-ריצה: דמון-כסף על-סקריפט-dev רק-בפיתוח; בפרודקשן — start.
        const script = process.env.NODE_ENV === "production" ? "start" : "dev";
        if (script === "dev") {
          console.log("[saos-bridge] honest-note: launching dex with DEV script (next dev) — a money daemon on a dev server (Roast-65-b · M6 flag)");
        }
        // FIX(Roast-65-b · M6): stdio מנותב ללוג (היה stdio:"ignore" = שקט-מוחלט
        // שבלם-EADDRINUSE/קריסות-שגר); הקובץ 0600.
        let logFd: number;
        try {
          logFd = fs.openSync(DEX_LOG, "a", 0o600);
        } catch {
          logFd = fs.openSync("/dev/null", "a"); // אין-לוג → לא קריסה; ה-poll-למטה מספק-אמת
        }
        const child = spawn(BUN, ["run", script], {
          cwd: DEX_DIR,
          stdio: ["ignore", logFd, logFd],
          env: childEnv,
        });
        child.unref();
        rt().pid = child.pid ?? null;
        child.on("error", (e: Error) => {
          rt().lastError = `dex spawn error: ${e.message}`;
          console.log("[saos-bridge] dex spawn error:", e.message);
        });
        child.on("exit", (code: number | null) => {
          rt().lastError = `dex child exited (code=${code})`;
          console.log(`[saos-bridge] dex child exited (code=${code}) — guardian watchdog will revive on next poll`);
        });
        console.log(`[saos-bridge] saos-dex daemon spawning on :${DEX_PORT} (pid ${child.pid}, bun=${BUN}, script=bun run ${script}, stdout/stderr → daemon-spawn.log)`);

        // FIX(Roast-65-b · M6): אימות-לאחר-שגר — poll-עד-90ש׳ (next dev מתקמפל
        // לאט), התוצאה נקלטת ל-launchVerified כמו אצל ה-guardian.
        void (async () => {
          for (let i = 0; i < 45; i++) {
            await sleep(2000);
            if (child.killed || rt().lastError?.startsWith("dex child exited")) break;
            if (await portBusy(DEX_PORT)) {
              const r = rt();
              r.launchVerified = true;
              r.launchVerifiedAt = Date.now();
              r.lastError = null;
              console.log(`[saos-bridge] launch-verified: dex responding on :${DEX_PORT} (after ~${(i + 1) * 2}s)`);
              return;
            }
          }
          const r = rt();
          r.launchVerified = false;
          r.launchVerifiedAt = Date.now();
          if (!r.lastError) r.lastError = "post-spawn-verification-failed (port did not come up in 90s)";
          console.log(`[saos-bridge] launch-verification FAILED: ${r.lastError} — inspect ${DEX_LOG}`);
        })();
      } else {
        console.log(`[saos-bridge] saos-dex already listening on :${DEX_PORT}`);
      }
    } catch (e) {
      console.log("[saos-bridge] spawn skipped:", e instanceof Error ? e.message : e);
    }

    // ══ EXEC-CD-22 · THE-LEGION (SAEC) — ילד-של-שרת-האם ══
    try {
      if (!(await portBusy(LEGION_PORT))) {
        const childEnv: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV || "development" };
        for (const [k, v] of Object.entries(process.env)) {
          if (v !== undefined && (envAllowed(k) || ["PATH", "HOME", "NODE_ENV", "LANG", "LC_ALL", "TMPDIR"].includes(k))) childEnv[k] = v;
        }
        const BUN = process.env.SAOS_BUN_BIN
          || (process.execPath.includes("bun") ? process.execPath : "/usr/local/bin/bun");
        let logFd: number;
        try { logFd = fs.openSync(LEGION_LOG, "a", 0o600); } catch { logFd = fs.openSync("/dev/null", "a"); }
        const child = spawn(BUN, ["--hot", "index.ts"], {
          cwd: LEGION_DIR,
          stdio: ["ignore", logFd, logFd],
          env: childEnv,
        });
        child.unref();
        rtLegion().pid = child.pid ?? null;
        child.on("error", (e: Error) => { rtLegion().lastError = e.message; console.log("[saos-legion] spawn error:", e.message); });
        child.on("exit", (code: number | null) => { rtLegion().lastError = `child exited (code=${code})`; console.log(`[saos-legion] child exited (code=${code})`); });
        console.log(`[saos-legion] SAEC legion spawning on :${LEGION_PORT} (pid ${child.pid}, stdout → legion-spawn.log)`);
        void (async () => {
          for (let i = 0; i < 20; i++) {
            await sleep(2000);
            if (child.killed || rtLegion().lastError?.startsWith("child exited")) break;
            if (await portBusy(LEGION_PORT)) {
              rtLegion().launchVerified = true;
              rtLegion().lastError = null;
              console.log(`[saos-legion] launch-verified: legion responding on :${LEGION_PORT} (after ~${(i + 1) * 2}s)`);
              return;
            }
          }
          rtLegion().launchVerified = false;
          if (!rtLegion().lastError) rtLegion().lastError = "post-spawn-verification-failed";
          console.log(`[saos-legion] launch-verification FAILED — inspect ${LEGION_LOG}`);
        })();
      } else {
        console.log(`[saos-legion] legion already listening on :${LEGION_PORT}`);
      }
    } catch (e) {
      console.log("[saos-legion] spawn skipped:", e instanceof Error ? e.message : e);
    }

    // ══ EXEC-CD-32 · SELF-HEALING-הערימה — boot-all מוסדי ══
    // הפער-המבני-שנמדד-חי: instrumentation הקים רק דקס+לגיון — relay/governor/
    // watchdog/state-push מתו בקור-סטארט עד-התערבות-ידנית, ומנוע-הרווח השוטף
    // (קציר-ve · תדלוק-ארנה · שריפות · דחיפת-מצב-לגיט) היה מושבת בשקט.
    // עתה: boot-all (אידמפוטנטי מטבעו — בודק פורט/לוק לפני-כל-שיגור, מוותר-על
    // מה שכבר-חי) רץ detached אחרי-הקמת-הילדים הקנוניים. כיבוי: SAOS_STACK_BOOT=off.
    try {
      const gg = globalThis as unknown as { __saosStackBoot?: boolean };
      if (!gg.__saosStackBoot && process.env.SAOS_STACK_BOOT !== "off") {
        gg.__saosStackBoot = true;
        const BUN = process.env.SAOS_BUN_BIN
          || (process.execPath.includes("bun") ? process.execPath : "/usr/local/bin/bun");
        const stack = spawn(BUN, ["run", "scripts/boot-all.ts"], {
          cwd: process.cwd(),
          stdio: "ignore",
          detached: true,
        });
        stack.unref();
        stack.on("error", (e: Error) => console.log("[saos-stack] boot-all spawn error:", e.message));
        console.log(`[saos-stack] boot-all מוסדי הושק (pid ${stack.pid}) — relay/governor/watchdog/state-push מחויבים-חיים אחרי-כל-קור-סטארט (אידמפוטנטי)`);
      }
    } catch (e) {
      console.log("[saos-stack] init skipped:", e instanceof Error ? e.message : e);
    }

    // ══ EXEC-CD-26 · צופה-האוצר — הלופ-האוטונומי ══
    // הריבונות עוקבת-בעצמה אחרי-יתרות-כתובות-כספת-הריפו (קריאה-ציבורית — אפס-סודות):
    // כל-15-דקות סיבוב-צפייה → תצפיות-נרשמות → אירועי-שינוי-יתרה (funding!) נרשמים
    // ל-DB ומוצהרים-בלוג. כיבוי: SAOS_TREASURY_WATCH=off.
    try {
      const gg = globalThis as unknown as { __saosTreasuryLoop?: boolean };
      if (!gg.__saosTreasuryLoop && process.env.SAOS_TREASURY_WATCH !== "off") {
        gg.__saosTreasuryLoop = true;
        const WATCH_MS = 15 * 60 * 1000;
        const tick = async (first: boolean) => {
          try {
            const w = await import("./lib/treasury-watcher");
            const s = await w.watchOnce();
            if (s.events.length > 0) {
              for (const ev of s.events) {
                console.log(
                  `[treasury-watcher] אירוע: ${ev.network} ${ev.kind} ${ev.deltaHuman} ${ev.unit}` +
                    (ev.balanceHuman ? ` (יתרה: ${ev.balanceHuman})` : "")
                );
              }
            } else if (first) {
              console.log(`[treasury-watcher] סיבוב-ראשון: ${s.probed} רשתות נבדקו, אין-שינויי-יתרה (לופ-כל-15-דק')`);
            }
          } catch (e) {
            console.log("[treasury-watcher] סיבוב-נכשל (fail-honest, הלופ-ממשיך):", e instanceof Error ? e.message.slice(0, 160) : e);
          }
        };
        const firstTimer = setTimeout(() => { void tick(true); }, 45_000);
        firstTimer.unref?.();
        const interval = setInterval(() => { void tick(false); }, WATCH_MS);
        interval.unref?.();
        console.log("[treasury-watcher] הלופ-האוטונומי חי — צופה בכתובות-כספת-הריפו כל-15-דקות (אפס-סודות)");
      }
    } catch (e) {
      console.log("[treasury-watcher] init skipped:", e instanceof Error ? e.message : e);
    }

    // ══ EXEC-CD-30 · מנוע-הערך-האמתי — הלופ-האוטונומי של שטיפת-הערך ══
    // כל-30-דקות: מדידת-האוצר-האמיתי (כתובות-הכספת × מחירי-שוק) + סולם-העתודה
    // של הדקס → תמונת-ValueSnapshot. השטיפה (פנימי → אמיתי) הופכת-עקומה-מדידה.
    // כיבוי: SAOS_VALUE_ENGINE=off.
    try {
      const gg = globalThis as unknown as { __saosValueLoop?: boolean };
      if (!gg.__saosValueLoop && process.env.SAOS_VALUE_ENGINE !== "off") {
        gg.__saosValueLoop = true;
        const TICK_MS = 30 * 60 * 1000;
        const vtick = async (first: boolean) => {
          try {
            const ve = await import("./lib/value-engine");
            const r = await ve.valueTick();
            if (r.ok) {
              const usd = Number(BigInt(r.realUsdMicro)) / 1e6;
              console.log(`[value-engine] פעימה h${r.height}: גיבוי-אמת ${realUsdMicroToStr(r.realUsdMicro)}µ$ (אוצר-חוץ $${usd.toFixed(2)}) — snapshot נרשם`);
            } else if (first) {
              console.log(`[value-engine] פעימה-ראשונה כשלה כנה: ${r.error ?? "?"} (הלופ-ממשיך)`);
            }
          } catch (e) {
            console.log("[value-engine] פעימה-נכשלה (fail-honest, הלופ-ממשיך):", e instanceof Error ? e.message.slice(0, 160) : e);
          }
        };
        const vFirst = setTimeout(() => { void vtick(true); }, 90_000);
        vFirst.unref?.();
        const vInterval = setInterval(() => { void vtick(false); }, TICK_MS);
        vInterval.unref?.();
        console.log("[value-engine] הלופ-האוטונומי חי — שטיפת-הערך נמדדת-ונרשמת כל-30-דקות");
      }
    } catch (e) {
      console.log("[value-engine] init skipped:", e instanceof Error ? e.message : e);
    }

    // ══ EXEC-CD-31 · כלכלת-הסוכנים — הלופ-האוטונומי של הבונטים ══
    // כל-20-דקות: פקיעות-כנות · אימות-ראיות-מול-מציאות (report↔מדידה · code↔git ·
    // trade↔מנוע) · תשלום-אמת מהאוצר · auto-claim-ללגיון · הזרעה-מפערים-נמדדים.
    // הפליוויל: עבודת-סוכן → בונטי → ארנק → מסחר → עמלות → סולם-העתודה.
    // כיבוי: SAOS_BOUNTY_ENGINE=off.
    try {
      const gg = globalThis as unknown as { __saosBountyLoop?: boolean };
      if (!gg.__saosBountyLoop && process.env.SAOS_BOUNTY_ENGINE !== "off") {
        gg.__saosBountyLoop = true;
        const BTICK_MS = 20 * 60 * 1000;
        const btick = async (first: boolean) => {
          try {
            const be = await import("./lib/bounty-engine");
            const r = await be.bountyTick();
            if (r.ok) {
              console.log(`[bounty-engine] פעימה: ${r.note}`);
            } else if (first) {
              console.log(`[bounty-engine] פעימה-ראשונה כשלה כנה: ${r.note} (הלופ-ממשיך)`);
            }
          } catch (e) {
            console.log("[bounty-engine] פעימה-נכשלה (fail-honest, הלופ-ממשיך):", e instanceof Error ? e.message.slice(0, 160) : e);
          }
        };
        const bFirst = setTimeout(() => { void btick(true); }, 120_000);
        bFirst.unref?.();
        const bInterval = setInterval(() => { void btick(false); }, BTICK_MS);
        bInterval.unref?.();
        console.log("[bounty-engine] הלופ-האוטונומי חי — כלכלת-הסוכנים רצה כל-20-דקות (בונטים→תשלום→מסחר→סולם)");
      }
    } catch (e) {
      console.log("[bounty-engine] init skipped:", e instanceof Error ? e.message : e);
    }
    // ══ EXEC-CD-36 · רץ-ההוכחה-הרציף — ה-self-hosted runner של הענקים ══
    // ה-CI-המתארח של GitHub אדום (אזלו-דקות — SAOS-CI-OUTAGE-2026-10-06). התשובה-
    // של-הענקים: self-hosted runner. כל-4-שעות: BMC-אקסהוסטיבי + fuzzer-אדיברסרי
    // + חיווט-חי + סנכרון-גיט + התראות → proof-ledger.jsonl + latest-proof.json.
    // כיבוי: SAOS_PROOF_RUNNER=off.
    try {
      const gg = globalThis as unknown as { __saosProofLoop?: boolean };
      if (!gg.__saosProofLoop && process.env.SAOS_PROOF_RUNNER !== "off") {
        gg.__saosProofLoop = true;
        const PTICK_MS = 4 * 60 * 60 * 1000;
        const ptick = async (first: boolean) => {
          try {
            const { spawn } = await import("node:child_process");
            const dexRoot = "/home/z/my-project/saos-dex";
            const child = spawn("bun", ["harness/proof-runner.ts", "--once"], {
              cwd: dexRoot, detached: true, stdio: "ignore",
              env: { ...process.env, DATABASE_URL: `file:${dexRoot}/db/dex.db` },
            });
            child.unref();
            console.log(`[proof-runner] ריצת-הוכחה הוזנקה (pid ${child.pid}) — BMC+fuzzer+חיווט+התראות → proof-pack`);
          } catch (e) {
            console.log("[proof-runner] הזנקה-נכשלה (fail-honest, הלופ-ממשיך):", e instanceof Error ? e.message.slice(0, 160) : e);
          }
          void first;
        };
        const pFirst = setTimeout(() => { void ptick(true); }, 10 * 60_000);
        pFirst.unref?.();
        const pInterval = setInterval(() => { void ptick(false); }, PTICK_MS);
        pInterval.unref?.();
        console.log("[proof-runner] הלופ-האוטונומי חי — ההוכחה רצה ברציפות כל-4-שעות (self-hosted runner)");
      }
    } catch (e) {
      console.log("[proof-runner] init skipped:", e instanceof Error ? e.message : e);
    }
  }
}

function realUsdMicroToStr(micro: string): string {
  const n = Number(BigInt(micro)) / 1e6;
  return Number.isFinite(n) ? n.toFixed(2) : "0";
}
