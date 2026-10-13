/**
 * dex-watchdog (roast-79) — סדום-הפעמה של מנוע-ה-DEX.
 *
 * האילוץ-המתועד (worklog 78-g): ה-sandbox מרג-את-תהליך-ה-DEX (~60-90ש׳ אחרי-boot,
 * oom_kill מצטבר ב-cgroup). השרשרת עצמה בטוחה — חוזרת-מ-snapshot בדטרמיניזם-מלא —
 * אבל-הפעמה נעצרת, והכלכלה (חיילים→מסחר→עמלות→מזרקה→דלק) לא-מספיקה-להחלים-בין-
 * ההריגות. הפתרון-הכנה: לופ-השגחה שמעיר-את-המנוע דרך-המשגר-הקנוני (dex-daemon)
 * בכל-פעם-שהוא-נעלם. אפס-גישה-למפתחות, אפס-גישה-ל-db — רק-בדיקת-HTTP + ספאון.
 *
 * FIX(R17-c·F1): השומר-הזה היה חסר-מכסה-יחיד — שני-עותקים-חיים-נמדדו-בשדה
 * (pids 23000+25217; ה-cold-start של-הסנדבוקס הקים-אחד, יד-אנושית הקימה-שני) —
 * שניהם-מריצים-פקיל+ספאון-במקביל על מות-הדמון → next-dev-כפול + שני-כותבי-שרשרת
 * על dex.db אחד. עתה: lockfile /tmp/saos-dex-watchdog.lock (wx, 0600) עם-קצירת-pid-מת —
 * עותק-שני יוצא בשקט.
 *
 * FIX(R17-c·F2/Mission2): מפת-ההשגחה נסגרה — mother←relay · dex←watchdog ·
 * relay←watchdog · ו-governor ← watchdog (היה: **אף-אחד** לא-משגיח-על-המושל).
 */
import fs from "fs";
// FIX(chaos3 · F-6 · EXEC-CD-35): כל-נתיבי-ההריגה/השער היו תלויי `fuser` — שלא
// קיים בסנדבוקס (נמדד-חי: command -v fuser → exit 1). התוצאה הנמדדת: (א) ההחייאה
// לא יכלה להרוג מחזיק-3010 חי (pkill-תבניות אף-פעם לא מתאימות ל-`next-server (v16.3.4)`
// — אין-פורט ב-cmdline), (ב) שני-שערי-הפורט-הקפדניים היו אינרטיים → ספאון-על-יד-תפוסה
// היה זולג ל-:3011 = כותב-זומבי-שני על dex.db. עתה: קוטל-מחזיקי-פורט יליד-/proc
// (השיטה-המוכחת-מ-chaos2/chaos3) + אישור-השתחררות לפני-כל-ספאון.
import { killPortHolder, portHeld } from "./porth";

const STATE_URL = "http://127.0.0.1:3010/saos-dex/api/dex/state";
const PROBE_MS = 20_000; // כל-20ש׳
const TIMEOUT_MS = 6_000; // תגובה-איטית-מדי = לא-חי
const FAILS_TO_RESTART = 2; // שני-כישלונות-רצופים לפני-הפעלה-מחדש
const RESTART_COOLDOWN_MS = 60_000; // לפחות-דקה-בין-הפעלות (מניעת-סופת-ריסטארטים)
// FIX(R17-c·F7): 90ש׳ היה קצר מגבול-האתחול-המתועד (60–90ש׳ × grace+2×probe →
// ~130ש׳ = גבול-סופת-ריסטארטים). עתה: 150ש׳ — מרווח-ביטחון מעל הגבול.
const BOOT_GRACE_MS = 150_000;

const LOCK_PATH = "/tmp/saos-dex-watchdog.lock";

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
}

// ─── FIX(R17-c·F1): מכסה-יחיד — lockfile עם-קצירת-pid-מת ────────────────────
function acquireLock(): boolean {
  try {
    const fd = fs.openSync(LOCK_PATH, "wx", 0o600);
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    return true;
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code !== "EEXIST") throw e;
    try {
      const raw = fs.readFileSync(LOCK_PATH, "utf8").trim();
      const pid = parseInt(raw, 10);
      if (Number.isFinite(pid) && pid > 0) {
        try {
          process.kill(pid, 0); // חי (או EPERM=חי-שלא-שלנו)
          log(`watchdog-אחר-חי (pid ${pid}) — עותק-שני יוצא (F1)`);
          return false;
        } catch {
          fs.unlinkSync(LOCK_PATH);
          log(`lock-נטוש (pid ${pid} מת) — משתלט`);
          return acquireLock();
        }
      }
    } catch { /* lock-לא-קריא — לא-גונבים-סמאים */ }
    log("lock תפוס — יוצא (F1: מכסה-יחיד)");
    return false;
  }
}
if (!acquireLock()) process.exit(0);

let fails = 0;
let lastRestartAt = 0;
let booting = false;

// FIX(R16-c·M2): BOOT_GRACE_MS היה dead-code — ה-cooldown (60ש׳) היה קצר מזמן-האתחול
// המתועד (60–90ש׳) → fails נצברו-מחדש תוך-כדי-boot וה-restart הבא היה רץ- pkill על
// דמון-שעוד-נטען (סופת-ריסטארטים). עתה: בתוך-חלון-החסד אחרי-הפעלה — probe-כישלון
// לא-נספר (הדמון-מותר-לו-להיות-עדיין-באתחול), ו-restart נדחה-כנה.
function withinBootGrace(): boolean {
  return lastRestartAt > 0 && Date.now() - lastRestartAt < BOOT_GRACE_MS;
}

async function probe(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const r = await fetch(STATE_URL, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

async function restart(): Promise<void> {
  if (booting) return;
  const now = Date.now();
  if (now - lastRestartAt < RESTART_COOLDOWN_MS) {
    log(`restart-suppressed (cooldown ${RESTART_COOLDOWN_MS / 1000}s)`);
    return;
  }
  if (withinBootGrace()) {
    log(`restart-suppressed (boot-grace ${BOOT_GRACE_MS / 1000}s — הדמון עוד-עלול-להיות-באתחול; FIX(R16-c·M2))`);
    return;
  }
  booting = true;
  lastRestartAt = now;
  fails = 0;
  log("DEX נעלם — משגר-מחדש דרך dex-daemon (DATABASE_URL-קנוני, הגנת-הקולוניזציה)");
  // FIX(F-6 · EXEC-CD-35): ההריגה-והשער עוברים ל-/proc-native — pkill-תבניות לא
  // מתאימות ל-`next-server (v16.3.4)` (אין-פורט ב-cmdline) ו-fuser-נעדר בסנדבוקס.
  // killPortHolder מאתר-מחזיק-LISTEN-אמתי (inode→/proc/*/fd) → SIGKILL → מאשר-שחרור.
  // אם-הפורט-עדיין-מוחזק-אחרי-הניסיון — לא-משגרים כלל (הגה-F3-אמתית, לא-אינרטית).
  const kill = killPortHolder(3010);
  log(`dex-kill: holders=[${kill.holders.join(",") || "אין"}] freed=${kill.freed}`);
  if (kill.heldAfter) {
    log("spawn-נמנע (F3-חסות-אמתית): 3010-עדיין-תפוס אחרי-ההריגה — לא-משגרים-על-יד-תפוסה");
    return;
  }
  try {
    const proc = Bun.spawn(["bash", "-c", "cd /home/z/my-project/mini-services/dex-daemon && nohup bun run dev >> /home/z/my-project/dex-dev.log 2>&1 & echo dex-spawned"], {
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    log("spawn הושלם — הדמון באתחול (boot-grace 150s)");
  } catch (e) {
    log(`spawn-נכשל: ${e}`);
  } finally {
    booting = false;
  }
}

async function loop() {
  // FIX(roast-79): try/catch-כולל — בלי-זה rejection יתום הרג-לופ-השגחה בשקט.
  try {
    const alive = await probe();
    if (alive) {
      if (fails > 0) log(`DEX חזר-לחיים (${fails} כישלונות-קודמים)`);
      fails = 0;
      return;
    }
    // FIX(R16-c·M2): boot-grace — אחרי-הפעלה, כישלונות-זמניים-באתחול לא-נספרים
    if (withinBootGrace()) {
      log(`probe-כישלון בתוך-חלון-חסד-האתחול (לא-נספר) — ממתין לדמון-שנסגר`);
      return;
    }
    fails++;
    log(`probe-כישלון ${fails}/${FAILS_TO_RESTART}`);
    if (fails >= FAILS_TO_RESTART) await restart();
  } catch (e) {
    log(`loop-שגיאה-נתפסת (ממשיך): ${e}`);
  }
}

log("dex-watchdog על-תורן — משגיח על 3010 (roast-79)");
process.on("unhandledRejection", (e) => log(`unhandledRejection-נבלע (ממשיך): ${e}`));
process.on("uncaughtException", (e) => log(`uncaughtException-נבלע (ממשיך): ${e}`));

// ─── FIX(R16-c·M3): השגחה-מוסדית-על-ה-relay ────────────────────────────────
// guardianBoot-החוזר-לחיים-של-האם (:3000) יושב **בתוך** relay-service — relay-מת
// = האם-לא-תוקם-שוב-אחרי-נפילה. עתה: השומר הזה משגיח גם-על-ה-relay ומקים-אותו
// דרך-המשגר-הקנוני (bun run dev — אותו-קנון-כמו-dex-daemon), בלי-גישה-לסודות.
const RELAY_URL = "http://127.0.0.1:3003/"; // socket.io-משיב גם-על-GET רגיל (polling-handshake)
const RELAY_PROBE_MS = 30_000;
let relayFails = 0;
let relayLastRestartAt = 0;

async function relayProbe(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const r = await fetch(RELAY_URL, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    // 400/404-מגוף-JSON = השרת-חי (engine.io-על-נתיב-שגוי); רק-חוסר-תשובה = מת
    return r.status > 0;
  } catch {
    return false;
  }
}

async function relayRestart(): Promise<void> {
  const now = Date.now();
  if (now - relayLastRestartAt < BOOT_GRACE_MS) {
    log("relay-restart-suppressed (boot-grace — ייתכן-שעוד-באתחול)");
    return;
  }
  relayLastRestartAt = now;
  log("relay נעלם — משגר-מחדש דרך-המשגר-הקנוני (guardianBoot-החוזר-של-האם חוזר-לחיים)");
  // FIX(F-6 · EXEC-CD-35): fuser-נעדר בסנדבוקס (נמדד) — ההריגה-והשער עוברים ל-/proc-native.
  const kill3 = killPortHolder(3003);
  const kill4 = killPortHolder(3004);
  log(`relay-kill: 3003=[${kill3.holders.join(",") || "אין"}] 3004=[${kill4.holders.join(",") || "אין"}]`);
  if (kill3.heldAfter || kill4.heldAfter) {
    log("relay-spawn-נמנע (F6-אמתי): 3003/3004-עדיין-תפוסים אחרי-ההריגה");
    return;
  }
  try {
    const proc = Bun.spawn(["bash", "-c", "cd /home/z/my-project/mini-services/relay-service && nohup bun run dev >> /home/z/my-project/relay-dev.log 2>&1 & echo relay-spawned"], { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    log("relay-spawn הושלם — האפיק-הריבוני באתחול");
  } catch (e) {
    log(`relay-spawn-נכשל: ${e}`);
  }
}

async function relayLoop(): Promise<void> {
  try {
    const alive = await relayProbe();
    if (alive) { relayFails = 0; return; }
    relayFails++;
    if (relayFails >= 2) await relayRestart();
  } catch (e) {
    log(`relay-loop-שגיאה-נתפסת (ממשיך): ${e}`);
  }
}
setInterval(() => void relayLoop().catch((e) => log(`relay-interval-נפל: ${e}`)), RELAY_PROBE_MS);
void relayLoop().catch(() => {}); // בדיקה-ראשונה מיד

// ─── FIX(R17-c·F2 + port-conflict 2026-09-29): השגחה-על-המושל-הכלכלי (revenue-governor :3042 — היה 3005, התנגשות-עם-keeper/SHOMER-של-הפלטפורמה) ──────────
// מפת-ההשגחה-הייתה: governor ← **אף-אחד** (מדוד-בשדה: המושל מת-אחרי-הפעמה-הקרה
// של-הסנדבוקס ולא-חוזר). עתה: probe /status (200-ok) + הקמה דרך-המשגר-הקנוני.
// המושל-עצמו יוצא-על-EADDRINUSE (R16-c·M4) — אז-ספאון-על-יד-תפוסה מת-בכבוד.
const GOV_URL = "http://127.0.0.1:3042/status";
const GOV_PROBE_MS = 45_000;
let govFails = 0;
let govLastRestartAt = 0;

async function govProbe(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const r = await fetch(GOV_URL, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    return r.ok; // /status מחזיר 200 {"ok":true,...} — מדויק יותר מ-status>0
  } catch {
    return false;
  }
}

async function govRestart(): Promise<void> {
  const now = Date.now();
  if (now - govLastRestartAt < BOOT_GRACE_MS) {
    log("gov-restart-suppressed (boot-grace)");
    return;
  }
  govLastRestartAt = now;
  log("governor נעלם — משגר-מחדש דרך-המשגר-הקנוני (FIX R17-c·F2)");
  // FIX(F-6 · EXEC-CD-35): אותו-חור-מדוד — fuser-נעדר. /proc-native + אישור-שחרור.
  const killG = killPortHolder(3042);
  log(`gov-kill: holders=[${killG.holders.join(",") || "אין"}] freed=${killG.freed}`);
  if (killG.heldAfter) {
    log("gov-spawn-נמנע: 3042-עדיין-תפוס אחרי-ההריגה");
    return;
  }
  try {
    const proc = Bun.spawn(["bash", "-c", "cd /home/z/my-project/mini-services/revenue-governor && nohup bun run dev >> /home/z/my-project/mini-services/revenue-governor/governor.log 2>&1 & echo gov-spawned"], { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    log("gov-spawn הושלם — המושל-הכלכלי באתחול");
  } catch (e) {
    log(`gov-spawn-נכשל: ${e}`);
  }
}

async function govLoop(): Promise<void> {
  try {
    const alive = await govProbe();
    if (alive) { govFails = 0; return; }
    govFails++;
    if (govFails >= 2) await govRestart();
  } catch (e) {
    log(`gov-loop-שגיאה-נתפסת (ממשיך): ${e}`);
  }
}
setInterval(() => void govLoop().catch((e) => log(`gov-interval-נפל: ${e}`)), GOV_PROBE_MS);
void govLoop().catch(() => {}); // בדיקה-ראשונה מיד


// ─── FIX(chaos3 · F-5 · 2026-10-08): מפת-ההשגחה הייתה-פתוחה-מצד-הלגיון — נמדד-חי:
// kill-9 ל-saos-legion (:3012) נשאר-מת **240ש׳** בלי-שום-מחייה (relay-45ש׳ · governor-75ש׳
// דרך-השומר). עתה: אותו-דפוס-מדויק של-המושל — probe /api/legion/health + הקמה-דרך-המשגר.
const LEGION_URL = "http://127.0.0.1:3012/api/legion/health";
const LEGION_PROBE_MS = 45_000;
let legionFails = 0;
let legionLastRestartAt = 0;

async function legionProbe(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const r = await fetch(LEGION_URL, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

async function legionRestart(): Promise<void> {
  const now = Date.now();
  if (now - legionLastRestartAt < BOOT_GRACE_MS) {
    log("legion-restart-suppressed (boot-grace)");
    return;
  }
  legionLastRestartAt = now;
  log("legion נעלם — משגר-מחדש דרך-המשגר-הקנוני (FIX chaos3 F-5)");
  const cmd = `cd /home/z/my-project/mini-services/saos-legion && nohup bun run dev >> /home/z/my-project/legion-dev.log 2>&1 & echo legion-spawned`;
  try {
    await Bun.spawn(["bash", "-c", cmd], { stdout: "ignore", stderr: "ignore", stdin: "ignore" }).exited;
    log("legion-spawn הושלם — הלגיון באתחול");
  } catch (e) {
    log(`legion-spawn-נכשל: ${e}`);
  }
}

async function legionLoop(): Promise<void> {
  try {
    const alive = await legionProbe();
    if (alive) { legionFails = 0; return; }
    legionFails++;
    if (legionFails >= 2) await legionRestart();
  } catch (e) {
    log(`legion-loop-שגיאה-נתפסת (ממשיך): ${e}`);
  }
}
setInterval(() => void legionLoop().catch((e) => log(`legion-interval-נפל: ${e}`)), LEGION_PROBE_MS);
void legionLoop().catch(() => {}); // בדיקה-ראשונה מיד

setInterval(() => void loop().catch((e) => log(`interval-loop-נפל: ${e}`)), PROBE_MS);
void loop().catch((e) => log(`first-loop-נפל: ${e}`)); // בדיקה-ראשונה מיד
