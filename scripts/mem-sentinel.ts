/**
 * mem-sentinel.ts — T-15 · MEMORY SENTINEL · "הזיכרון הוא גבול-ריבונות"
 * ═════════════════════════════════════════════════════════════════════════
 * החלטת-מפעיל (2026-10-08 — שאלת-הקדנס שנענתה-בקוד): **כן** — המנוע מודד-צריכת-
 * זיכרון-מארח דינמית וכותב ל-receipts/ כל-5דק' (קדנס: liquidity-cadence.sh), עם
 * טריגר-דחיסה אוטומטי **לפני** תקרת-ה-2.5GB:
 *
 *   WARN     ≥ 2.00GiB  — מסומן-בקבלה · הקוקפיט מאיר-ענבר
 *   CRITICAL ≥ 2.30GiB  — טריגר-דחיסה: סיבוב-לוגים >10MB → .tail (דפוס-boot-all) ·
 *                           גיזום-history-JSONL ל-500-שורות · דיווח-מעשים-בכנות
 *
 * מקור-אמת: /proc/meminfo (stdlib-מוחלט — אפס-ספאון) · MemTotal−MemAvailable.
 * חוזה-סודות: הקבלות מכילות ספירות-בלבד · הדחיסה לעולם לא נוגעת ב-keys/receipts-latest.
 */
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "receipts", "mem-sentinel-latest.json");
const HISTORY = path.join(ROOT, "receipts", "mem-sentinel-history.jsonl");
const GiB = 1024 ** 3;
const WARN = 2.0 * GiB;
const CRIT = 2.3 * GiB;
const CEIL = 2.5 * GiB;
const HISTORY_CAP = 500;

function readMemInfo(): { usedBytes: number; totalBytes: number } | null {
  try {
    const txt = fs.readFileSync("/proc/meminfo", "utf8");
    const get = (k: string): number | null => {
      const m = txt.match(new RegExp(`^${k}:\\s+(\\d+)`, "m"));
      return m ? Number(m[1]) * 1024 : null; // kB → B
    };
    const total = get("MemTotal"), avail = get("MemAvailable") ?? get("MemFree");
    if (total == null || avail == null) return null;
    return { usedBytes: total - avail, totalBytes: total };
  } catch { return null; } // לא-לינוקס/אין-proc — כנות
}

/* דחיסה: סיבוב-לוגים >10MB (root + saos-dex) — אותו-דפוס של boot-all (F8a) */
function compactLogs(): string[] {
  const acts: string[] = [];
  for (const dir of [ROOT, path.join(ROOT, "saos-dex")]) {
    let names: string[] = [];
    try { names = fs.readdirSync(dir).filter((f) => f.endsWith(".log")); } catch { continue; }
    for (const f of names) {
      const p = path.join(dir, f);
      try {
        const st = fs.statSync(p);
        if (st.size > 10 * 1024 * 1024) {
          const buf = fs.readFileSync(p);
          fs.writeFileSync(p + ".tail", buf.subarray(buf.length - 1024 * 1024));
          fs.writeFileSync(p, `[mem-sentinel] log rotated (${Math.round(st.size / 1e6)}MB → .tail) at ${new Date().toISOString()}\n`);
          acts.push(`${path.join(path.basename(dir), f)} ${Math.round(st.size / 1e6)}MB→.tail`);
        }
      } catch { /* race — כנות: מדלגים */ }
    }
  }
  return acts;
}

/* גיזום-history: שמירת-500-שורות-אחרונות בלבד (union-ts-ordered מוקרן) */
function pruneHistory(): boolean {
  try {
    if (!fs.existsSync(HISTORY)) return false;
    const lines = fs.readFileSync(HISTORY, "utf8").trim().split("\n").filter(Boolean);
    if (lines.length <= HISTORY_CAP) return false;
    fs.writeFileSync(HISTORY, lines.slice(lines.length - HISTORY_CAP).join("\n") + "\n");
    return true;
  } catch { return false; }
}

const mem = readMemInfo();
const used = mem?.usedBytes ?? null;
const total = mem?.totalBytes ?? null;
const level = used == null ? "unknown" : used >= CRIT ? "critical" : used >= WARN ? "warn" : "ok";
const headroom = used == null ? null : Math.max(0, CEIL - used);

const compacted = level === "critical" ? { logs: compactLogs(), historyPruned: pruneHistory() } : null;

const receipt = {
  schema: "saos.mem-sentinel/1",
  at: new Date().toISOString(),
  level,
  usedBytes: used,
  usedGiB: used == null ? null : Math.round((used / GiB) * 1000) / 1000,
  totalGiB: total == null ? null : Math.round((total / GiB) * 1000) / 1000,
  ceilingGiB: 2.5,
  warnGiB: 2.0,
  criticalGiB: 2.3,
  headroomGiB: headroom == null ? null : Math.round((headroom / GiB) * 1000) / 1000,
  compaction: compacted,
  keysLeaked: false,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(receipt, null, 1) + "\n");
try { fs.appendFileSync(HISTORY, JSON.stringify({ at: receipt.at, usedGiB: receipt.usedGiB, level }) + "\n"); } catch { /* כנות */ }

console.log(`mem-sentinel: level=${level} usedGiB=${receipt.usedGiB ?? "?"} headroomGiB=${receipt.headroomGiB ?? "?"}${compacted ? ` compaction=${compacted.logs.length}-logs` : ""}`);
process.exit(level === "critical" ? 3 : 0); // 3 = דחיסה-בוצעה (הקדנס ממשיך)
