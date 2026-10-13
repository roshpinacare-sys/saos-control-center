/**
 * grid-twin — המפעיל-הפנימי של-רשת-הגריד (T-51).
 *
 * למה-הוא-קיים: grid-trigger-twin-בענן (Domain, ריפו-ציבורי, דקות-בלתי-מוגבלות) רץ-יומית;
 * הטיק-המקומי-הזה מריץ את אותו `grids/run.mjs` (µ-sim, אפס-מפתחות, חותם-כלום) כל-30-דק'
 * כדי-שמצב-הגריד/ההצעה-הכנה-יהיו-חיים-תמיד — ו-state-push (20-דק') מחייב-אותם-לגיט.
 * התאום-הענן-נשאר-הקדנס-הקנוני; הזה = רצף-מקומי-בלי-הפסקות.
 *
 * סבלנות: run.mjs --loop כבר-עם-backoff-פנימי (לא-יוצא לעולם); ה-wrapper-הזה מוסיף
 * החייאת-תהליך (אם-הילד-מת — מוקם-מחדש-אחרי-30-שנ') וקבלת-טיק-יומנת.
 * אפס-פורט · אפס-HTTP · אפס-מפתחות — סימולציה-ומדידה-בלבד.
 */
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const DEX = path.resolve(import.meta.dir, "..", "..", "saos-dex");
const LOG = path.join(import.meta.dir, "twin.log");
const INTERVAL_MS = 30 * 60 * 1000; // 30-דק' — אותו-קצב-דופק-כמו-הלב-הריבוני
const REVIVE_DELAY_MS = 30 * 1000;

function log(msg: string): void {
  const line = `[grid-twin ${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    mkdirSync(path.dirname(LOG), { recursive: true });
    appendFileSync(LOG, line + "\n");
  } catch { /* קבלה-היא-לא-קריטית-להמשך-החיים */ }
}

let child: ReturnType<typeof spawn> | null = null;

function launch(): void {
  // T-66: אפס-דליפות-ילדים — hot-reload של bun --hot מריץ-שוב-את-launch() והשאיר
  // 5-run.mjs-חיים-במקביל (נמדד). הילד-הקודם-נהרג-לפני-החדש, תמיד.
  if (child && child.pid !== undefined) {
    try { child.kill("SIGKILL"); log(`killed previous child pid=${child.pid} (אפס-דליפות)`); } catch { /* כבר-מת */ }
    child = null;
  }
  log(`spawn: node grids/run.mjs --loop ${INTERVAL_MS} (cwd=${DEX} · µ-sim · zero-keys)`);
  child = spawn("node", ["grids/run.mjs", "--loop", String(INTERVAL_MS)], {
    cwd: DEX,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "production" },
  });
  child.stdout?.on("data", (d: Buffer) => process.stdout.write(d));
  child.stderr?.on("data", (d: Buffer) => process.stderr.write(d));
  child.on("exit", (code, sig) => {
    log(`child exited code=${code} sig=${sig} — revive in ${REVIVE_DELAY_MS / 1000}s`);
    child = null;
    // T-66: debounce — N-מוות-סגורים-ברצף (pkill-המוני/קריסה-מרובה) חייבים-להניב
    // בדיוק-החייאה-אחת, לא-N (נמדד-חי: 6-החייאות-במקביל-אחרי-ניקוי).
    if (revivePending) return;
    revivePending = true;
    setTimeout(() => { revivePending = false; launch(); }, REVIVE_DELAY_MS);
  });
}

let revivePending = false;

// T-66 · מנעול-מופע-יחיד (הלקח-מהכפילויות-החיות-של-14:26): start.sh +
// instrumentation + כל-משגר-אחר יכולים-להקים-עותקים — מנעול-PID-קנוני
// מחזיר-ל"סינגל-אינסטנס" אמת-בפועל: עותק-שני-חי = יוצא-בכנות מיד.
import { writeFileSync, readFileSync, unlinkSync } from "node:fs";

const INSTANCE_LOCK = "/tmp/saos-grid-twin.lock";
try {
  const prev = parseInt(readFileSync(INSTANCE_LOCK, "utf8").trim(), 10);
  if (Number.isFinite(prev) && prev > 0 && prev !== process.pid) {
    try {
      process.kill(prev, 0);
      console.log(`[grid-twin] instance-alive-exiting (pid ${prev} כבר-חי — אפס-כפילויות)`);
      process.exit(0);
    } catch { /* מחזיק-ישן-מת — תופסים-את-המנעול */ }
  }
} catch { /* אין-מנעול — ראשון */ }
writeFileSync(INSTANCE_LOCK, String(process.pid));
process.on("exit", () => { try { unlinkSync(INSTANCE_LOCK); } catch { /* כבר-נמחק */ } });

log("grid-twin supervisor up (single instance, pid-locked)");
launch();

// דופק-עצל: אם-הילד-נעלם-בלי-אירוע-exit (קרס-קשה) — הקם-מחדש (מדוכדב-באותו-revivePending)
setInterval(() => {
  if (!revivePending && (!child || child.pid === undefined)) {
    log("watchdog: child missing — relaunching (debounced)");
    revivePending = true;
    setTimeout(() => { revivePending = false; launch(); }, 1000);
  }
}, 5 * 60 * 1000);
