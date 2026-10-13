/**
 * port-guard.ts — F-6 (EXEC-CD-35): native strict-port guard for the dex-daemon.
 *
 * השער-הקודם היה `if fuser 3010/tcp ...` — fuser אינו קיים בסנדבוקס (נמדד-חי),
 * ולכן השער היה אינרטי: next dev על-פורט-תפוס היה זולג ל-:3011 = כותב-זומבי-שני
 * על dex.db (האסון-המתועד R17-c·F3). עתה: בדיקת-LISTEN יליד-/proc/net/tcp{,6} —
 * אפס-כלים-חיצוניים. exit 1 = פורט-תפוס (המשגר מוותר בכבוד, אפס-כותב-כפול).
 *
 * שימוש: bun port-guard.ts <port>  (exit 0 = פנוי · exit 1 = תפוס)
 */
const port = Number(process.argv[2] ?? "3010");
const hexPort = port.toString(16).padStart(4, "0").toUpperCase();
let held = false;
for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
  let txt: string;
  try {
    txt = require("fs").readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const line of txt.split("\n").slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 10) continue;
    const local = (f[1] ?? "").split(":")[1] ?? "";
    if ((f[3] ?? "") === "0A" && local.toUpperCase() === hexPort) {
      held = true;
      break;
    }
  }
  if (held) break;
}
if (held) {
  console.log(`port-guard: ${port} HELD — refusing spawn (strict-port guard, F-6 native — next dev היה זולג ל-${port + 1} ומייצר זומבי-כותב-dex.db)`);
  process.exit(1);
}
console.log(`port-guard: ${port} free — proceeding`);
process.exit(0);
