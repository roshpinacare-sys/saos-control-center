/**
 * boot-all (FIX R17-c·F2) — המשגר-המוסדי-הקנוני של-צי-השירותים-אחרי-הפעמה-קרה.
 *
 * האירוע-שחסם-את-התיקון-הזה (13.9.26): cold-start של-הסנדבוקס הקים רק-את-האם (3000)
 * + dex (דרך-instrumentation). relay (3003), governor (3042), watchdog — כולם-מתו,
 * ו**שום-דבר-בריפו** לא-ידע-להקים-אותם (אפס-תסריטי-boot — נבדק). ה-watchdog היה-מת
 * עד-שיד-אנושית-תקים-אותו.
 *
 * עקרונות:
 *  - אידמפוטנטי: שירות-שה-port/lock שלו-חי = מדולג (לעולם-לא-כפילויות — הלקח-מ-F1).
 *  - דפוס-האימוץ המוכח-בשדה (worklog 84-f/2077): bash -c "setsid nohup ... &" —
 *    ppid=1, שורד-קצירת-shell.
 *  - אפס-סודות: לא-נוגע-ב-.env, לא-מדפיס-סביבה; רק-בדיקות-port + ספאון-קנוני.
 *  - סדר-ההקמה: relay → governor → watchdog (ה-watchdog אחרון — מיד-משגיח-על-השניים).
 *  - שימוש: bun run scripts/boot-all.ts   (בטוח-להרצה-חוזרת בכל-עת)
 */
import fs from "fs";
import net from "node:net";

function portBusy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host: "127.0.0.1" });
    const done = (v: boolean) => { s.destroy(); resolve(v); };
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
    setTimeout(() => done(false), 900).unref?.();
  });
}

function lockHeld(path: string): boolean {
  try {
    const pid = parseInt(fs.readFileSync(path, "utf8").trim(), 10);
    if (Number.isFinite(pid) && pid > 0) {
      try { process.kill(pid, 0); return true; } catch { return false; } // מת = lock נטוש
    }
  } catch { return false; }
  return false;
}

// FIX(R17-c·F8a): קצירת-לוג — מעל 10MB מתחילים-מחדש; last-1MB נשמר ב-.tail
function rotateLogIfHuge(logFile: string): void {
  try {
    const st = fs.statSync(logFile);
    if (st.size > 10 * 1024 * 1024) {
      const buf = fs.readFileSync(logFile);
      fs.writeFileSync(logFile + ".tail", buf.subarray(buf.length - 1024 * 1024));
      fs.writeFileSync(logFile, `[boot-all] log rotated (${Math.round(st.size / 1e6)}MB → .tail)\n`);
    }
  } catch { /* אין-לוג-עדיין */ }
}

function spawnDetached(cwd: string, logFile: string): void {
  rotateLogIfHuge(logFile);
  // דפוס-האימוץ המוכח (כמו-ב-watchdog עצמו): bash -c + setsid nohup + & → מאומץ-init
  const proc = Bun.spawn(
    ["bash", "-c", `setsid nohup bun run dev >> "${logFile}" 2>&1 & echo spawned`],
    { cwd, stdout: "pipe", stderr: "ignore", stdin: "ignore" },
  );
  void proc.exited;
}

async function main(): Promise<void> {
  const root = "/home/z/my-project";
  const plan: Array<{ name: string; check: () => Promise<boolean> | boolean; cwd: string; log: string }> = [
    { name: "relay-service (:3003)", check: () => portBusy(3003), cwd: `${root}/mini-services/relay-service`, log: `${root}/relay-dev.log` },
    { name: "revenue-governor (:3042)", check: () => portBusy(3042), cwd: `${root}/mini-services/revenue-governor`, log: `${root}/mini-services/revenue-governor/governor.log` },
    { name: "dex-watchdog (lock)", check: () => lockHeld("/tmp/saos-dex-watchdog.lock"), cwd: `${root}/mini-services/dex-watchdog`, log: `${root}/mini-services/dex-watchdog/watchdog.log` },
    // FIX(EXEC-CD-32): state-push היה חסר-מהתוכנית — דחיפת-המצב-לגיט (קדנס 20דק')
    // הייתה נשארת מתה אחרי-קור-סטארט. ה-lock שלו (מדוד מהקוד: /tmp/saos-state-push.lock)
    // מונע-עותקים; הוא עצמו מוותר-בכנות אם-עותק-חי (instance-alive-exiting).
    { name: "dex-state-push (lock)", check: () => lockHeld("/tmp/saos-state-push.lock"), cwd: `${root}/mini-services/dex-state-push`, log: `${root}/statepush-dev.log` },
    // T-66: grid-twin נעדר-מהתוכנית — המפעיל-הפנימי-של-רשת-הגריד מת-בקור-בוט-ואף-אחד
    // לא-העיר-אותו. מנעול-המופע-שלו (/tmp/saos-grid-twin.lock) מה-T-66 מונע-כפילויות.
    { name: "grid-twin (lock)", check: () => lockHeld("/tmp/saos-grid-twin.lock"), cwd: `${root}/mini-services/grid-twin`, log: `${root}/mini-services/grid-twin/twin-dev.log` },
  ];
  for (const item of plan) {
    const up = await item.check();
    if (up) {
      console.log(`[boot-all] ${item.name} — כבר-חי, מדולג (אידמפוטנטי)`);
      continue;
    }
    spawnDetached(item.cwd, item.log);
    console.log(`[boot-all] ${item.name} — הוקם (setsid, מאומץ-init)`);
  }
  // האם-והדקס-לא-מוקמים-כאן: האם-היא-תהליך-הפלטפורמה-עצמו; הדקס-מוקם-ע"י
  // instrumentation-של-האם (boot one-shot) — ה-watchdog מקים-אותו אם-יפול.
  console.log("[boot-all] סיום — relay/governor/watchdog בהשגחה");
}

void main();
