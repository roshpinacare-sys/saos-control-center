/**
 * dex-state-push — ריבונות-מצב: דחיפת-קדנס של קובצי-מצב-השרשרת ל-גיט.
 * ═════════════════════════════════════════════════════════════════════════════
 * דוקטרינת-המפעיל (2026-10-06): הסנדבוקס נמחק כמה-פעמים-ביום — **אסור להסתמך
 * עליו**. הגיט = מקור-האמת. עד-היום מצב-השרשרת הגיע-לגיט רק-בדחיפות-ידניות או
 * בפעימות-הטווין הציבורי — מחיקת-סנדבוקס הייתה עולה קדנס-ארוך. עכשיו: כל-20-דק'
 * דחיפה של state-snapshot + tape + klines (אם-השתנו) → מחיקה-מלאה עולה ≤20 דק'
 * שרשרת. הטוקן: אותו-מסלול של heal.ts (pat.env → rar-אטום) — לעולם לא נדפס,
 * לעולם לא נשמר-בקונפיג (set-url → push → scrub כל-מחזור).
 * אפס-פורט · אפס-HTTP — לופ טהור; מתחיל אוטומטית מ-start.sh (mini-services).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";

const REPO = "/home/z/my-project/saos-dex";
const UPLOAD = "/home/z/my-project/upload";
const STATE_FILES = ["db/state-snapshot.json", "db/tape.jsonl", "db/klines.json", "db/maker-stats.json", "db/book-gas.json", "grids/state/state.json", "grids/state/offer.json"]; // EXEC-CD-8/9 · מצב-חוץ-קנוני-מוצמד-גיט (ייחוס-מייקרים + מד-גז-הספר) · T-51: מצב-הגריד-וההצעה-הכנה-נוסעים-עם-הקדנס
const INTERVAL_MS = 20 * 60 * 1000; // 20 דק'
const FIRST_DELAY_MS = 90 * 1000;

function log(msg: string): void {
  console.log(`[state-push ${new Date().toISOString()}] ${msg}`);
}

/* ── טוקן — אותו-מסלול-כנות של heal.ts (אפס-הדפסה, אפס-שמירה) ─────────────── */
function tokenFromPatEnv(file: string): string | null {
  try {
    const t = fs.readFileSync(file, "utf8").trim();
    const eq = t.indexOf("=");
    const token = eq > 0 && !t.startsWith("github") ? t.slice(eq + 1).trim() : t;
    return token.length > 20 ? token : null;
  } catch {
    return null;
  }
}

async function tokenFromSealedRar(): Promise<string | null> {
  const rarPath = path.join(UPLOAD, "pat.rar");
  const passPath = path.join(UPLOAD, "rar.pass");
  if (!fs.existsSync(rarPath) || !fs.existsSync(passPath)) return null;
  const pass = fs.readFileSync(passPath, "utf8").trim();
  if (!pass) return null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "spush-"));
  try {
    const proc = Bun.spawn(["bun", "add", "node-unrar-js@1.1.0"], { cwd: tmp, stdout: "ignore", stderr: "ignore", stdin: "ignore" });
    if ((await proc.exited) !== 0) return null;
    const { createExtractorFromData } = await import(path.join(tmp, "node_modules", "node-unrar-js"));
    const buf = fs.readFileSync(rarPath);
    const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const ext = await createExtractorFromData({ data, password: pass });
    for (const f of ext.extract({ password: pass }).files) {
      const name = String(f.fileHeader.name).split("/").pop() || "";
      if (name === "pat.env") {
        const out = path.join(tmp, name);
        fs.writeFileSync(out, Buffer.from(f.extraction));
        const token = tokenFromPatEnv(out);
        try { fs.unlinkSync(out); } catch {}
        return token;
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

async function acquireToken(): Promise<{ token: string; source: string } | null> {
  const fromEnv = tokenFromPatEnv("/tmp/pat_extract/pat.env");
  if (fromEnv) return { token: fromEnv, source: "/tmp/pat_extract/pat.env" };
  // T-51: הזרקת-המפעיל-הקנונית (sovereign-push.doctrine: PAT-גולמי-בupload/pat.env) — הייתה-נעלמת-מהשרשרת-הזאת
  const fromPlain = tokenFromPatEnv(path.join(UPLOAD, "pat.env"));
  if (fromPlain) return { token: fromPlain, source: "upload/pat.env" };
  const fromRar = await tokenFromSealedRar();
  if (fromRar) return { token: fromRar, source: "upload/pat.rar + rar.pass" };
  return null;
}

/* ── git helpers ───────────────────────────────────────────────────────────── */
function git(cwd: string, args: string): string {
  return execSync(`git ${args}`, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/* ריפוי-עצמי: UU תקוע (כמו-זה שנמצא-חי 2026-10-06 17:58) חוסם-קדנס — דוקטרינה:
 * מצב-העבודה-החי מנצח; המנוע משפך-מחדש-תוך-שניות. אם-rebase עצור-באמצע —
 * מבטלים-אותו-בכנות לפני-הכל. */
function healStateIndex(): void {
  try {
    if (fs.existsSync(path.join(REPO, ".git", "rebase-merge")) || fs.existsSync(path.join(REPO, ".git", "rebase-apply"))) {
      log("self-heal: rebase in progress — aborting to last-good commit");
      git(REPO, "rebase --abort");
    }
  } catch (e) {
    log(`self-heal: rebase abort failed: ${String(e).slice(0, 80)}`);
  }
  try {
    const unmerged = git(REPO, `diff --name-only --diff-filter=U -- ${STATE_FILES.join(" ")}`);
    if (unmerged) {
      log(`self-heal: unmerged state files (${unmerged.split("\n").length}) — resolving live-wins`);
      git(REPO, `add ${STATE_FILES.join(" ")}`);
      git(REPO, `reset -- ${STATE_FILES.join(" ")}`);
      git(REPO, "stash drop");
    }
  } catch {
    /* אין-unmerged או אין-stash — תקין */
  }
}

function readHeight(): number {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(REPO, "db", "state-snapshot.json"), "utf8")) as { state?: { height?: number } };
    return raw?.state?.height ?? 0;
  } catch {
    return 0;
  }
}

async function cycle(): Promise<void> {
  const acquired = await acquireToken();
  if (!acquired) {
    log("FAIL-LOUD: no token source (pat.env / sealed rar) — state push skipped this cycle");
    return;
  }
  const { token } = acquired;
  try {
    // 0) ריפוי-עצמי לפני-כל-פעולה (UU/rebase-תקוע לא-יחסום-קדנס)
    healStateIndex();
    // 0.5) הטוקן-על-הקונפיג רק-למחזור-הזה (set → עבודה → scrub בפיינלי)
    git(REPO, `remote set-url origin https://oauth2:${token}@github.com/roshpinacare-sys/saos-dex.git`);
    // 1) רק קובצי-מצב — הקוד נדחף-ידנית על-ידי-סשנים (כנות: הפרדת-רשויות)
    const changed = git(REPO, `status --porcelain -- ${STATE_FILES.join(" ")}`);
    if (!changed) {
      log("no state changes — skip");
      return;
    }
    const h = readHeight();
    git(REPO, `add ${STATE_FILES.join(" ")}`);
    git(REPO, `-c user.name=roshpinacare-sys -c user.email=roshpinacare-sys@users.noreply.github.com commit -m "[state] sandbox: h${h} (state-push cadence — wipe costs ≤20min chain)"`);
    // 2) סנכרון-מול-הטווין: הדמון-החי שופך-מצב-כל-רגע → stash → rebase → pop.
    //    קונפליקטים נפתרים-לטובת-המצב-החי-המקומי (-X ours); הטווין דוחף בעיקר
    //    ticks-מצב — אם-הוא דחף-קוד, נרשם-רועש ונתון-לטריאז'-ידני.
    try {
      git(REPO, "fetch origin main");
      const local = git(REPO, "rev-parse HEAD");
      const remoteHead = git(REPO, "rev-parse origin/main");
      if (local !== remoteHead) {
        let stashed = false;
        try { git(REPO, "stash push -m state-push-live-flush"); stashed = true; } catch { /* אין-שינויים */ }
        try {
          git(REPO, "rebase origin/main -X ours");
          log("rebased onto origin/main (-X ours: live state wins)");
        } finally {
          if (stashed) {
            try { git(REPO, "stash pop"); }
            catch (e) {
              log(`stash pop conflict — healing per doctrine (live wins): resolve-add + drop-stash; engine re-flushes in seconds`);
              try { git(REPO, `add ${STATE_FILES.join(" ")}`); } catch {}
              try { git(REPO, `reset -- ${STATE_FILES.join(" ")}`); } catch {}
              try { git(REPO, "stash drop"); } catch {}
              void e;
            }
          }
        }
      }
    } catch (e) {
      log(`rebase step failed (push will retry next cycle): ${String(e).slice(0, 120)}`);
      return;
    }
    // 3) דחיפה + ניקוי-טוקן-מהקונפיג מיד
    git(REPO, "push origin main");
    log(`pushed state h${h}`);
  } catch (e) {
    log(`cycle error: ${String(e).slice(0, 200)}`);
  } finally {
    try { git(REPO, 'remote set-url origin https://github.com/roshpinacare-sys/saos-dex.git'); } catch {}
  }
}

/* ── מנגנון-מופע-יחיד (F1-נעילה — כמו-dex-watchdog) ─────────────────────────── */
const LOCK = "/tmp/saos-state-push.lock";
try {
  if (fs.existsSync(LOCK)) {
    const pid = Number(fs.readFileSync(LOCK, "utf8").trim());
    // FIX(self-hot): bun --hot מריץ-מחדש את-המודול באותו-pid — עצמו אינו מופע-יריב
    if (pid !== process.pid) {
      try { process.kill(pid, 0); console.error(`[state-push] instance ${pid} alive — exiting`); process.exit(0); }
      catch { log("stale lock — taking over"); }
    }
  }
} catch { /* כנות: נעילה-לא-קריאה = המשך */ }
fs.writeFileSync(LOCK, String(process.pid));
process.on("exit", () => {
  try { if (Number(fs.readFileSync(LOCK, "utf8").trim()) === process.pid) fs.unlinkSync(LOCK); } catch {}
});

log(`on duty — cadence ${INTERVAL_MS / 60_000}min · repo ${REPO} · files: ${STATE_FILES.join(", ")}`);
setTimeout(() => {
  void cycle();
  setInterval(() => void cycle(), INTERVAL_MS);
}, FIRST_DELAY_MS);
