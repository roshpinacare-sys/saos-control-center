/**
 * heal.ts — self-restore of the DEX runtime from git (sovereign-over-git).
 *
 * THE DOCTRINE (operator directive 2026-10-06): the sandbox is wiped several
 * times a day — NOTHING may rely on it. git is the sovereign source of truth:
 * the Domain twin (public repo, unlimited Actions minutes) commits the chain
 * state on cadence; this healer rebuilds the local runtime from the latest
 * committed snapshot on every boot. Wipe cost: zero code, ≤1 cadence of state.
 *
 * Token discipline (zero-secrets-in-repo law):
 *   1. /tmp/pat_extract/pat.env  (session extraction, if present)
 *   2. upload/pat.rar (operator's sealed archive) opened with the pass from
 *      upload/rar.pass (0600, gitignored shelf — NEVER committed)
 *   The token is never printed, never written inside the repo, and the clone
 *   remote is stripped immediately.
 *
 * Test override: HEAL_TARGET=/tmp/heal-test bun heal.ts
 */
import fs from "fs";
import path from "path";
import os from "os";

const PROJ = "/home/z/my-project";
const TARGET = process.env.HEAL_TARGET || path.join(PROJ, "saos-dex");
const UPLOAD = path.join(PROJ, "upload");

function log(m: string) {
  console.log(`[heal ${new Date().toISOString()}] ${m}`);
}

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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "heal-"));
  try {
    // install the extractor OUTSIDE the repo (zero new deps in project)
    const proc = Bun.spawn(["bun", "add", "node-unrar-js@1.1.0"], {
      cwd: tmp,
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    });
    if ((await proc.exited) !== 0) {
      log("heal: extractor install failed (network?)");
      return null;
    }
    const { createExtractorFromData } = await import(
      path.join(tmp, "node_modules", "node-unrar-js")
    );
    const buf = fs.readFileSync(rarPath);
    const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const ext = await createExtractorFromData({ data, password: pass });
    const extracted = ext.extract({ password: pass });
    for (const f of extracted.files) {
      const name = String(f.fileHeader.name).split("/").pop() || "pat.env";
      if (name === "pat.env") {
        const out = path.join(tmp, name);
        fs.writeFileSync(out, Buffer.from(f.extraction));
        const token = tokenFromPatEnv(out);
        // shred the temp copy immediately after reading
        try { fs.unlinkSync(out); } catch {}
        return token;
      }
    }
    return null;
  } catch (e) {
    log(`heal: rar extraction failed: ${(e as Error).message}`);
    return null;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

async function sh(cmd: string[], cwd?: string, env?: Record<string, string>): Promise<number> {
  const p = Bun.spawn(cmd, {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "ignore",
    env: env ? { ...process.env, ...env } : process.env,
  });
  return p.exited;
}

async function main() {
  const hasRepo = fs.existsSync(path.join(TARGET, ".git"));
  const hasDeps = fs.existsSync(path.join(TARGET, "node_modules"));
  const hasDb = fs.existsSync(path.join(TARGET, "db", "dex.db"));
  if (hasRepo && hasDeps && hasDb) {
    log("healthy — nothing to do");
    return;
  }
  log(`runtime incomplete (git=${hasRepo} deps=${hasDeps} db=${hasDb}) — restoring from git`);

  let token = tokenFromPatEnv("/tmp/pat_extract/pat.env");
  let source = "/tmp/pat_extract/pat.env";
  if (!token) {
    token = tokenFromPatEnv(path.join(UPLOAD, "pat.env")); // T-51: הזרקת-המפעיל-הקנונית — הייתה-נעלמת
    source = "upload/pat.env";
  }
  if (!token) {
    token = await tokenFromSealedRar();
    source = "upload/pat.rar + upload/rar.pass";
  }
  if (!token) {
    log("FAIL-LOUD: no token source. Remedy: re-extract upload/pat.rar (operator pass) → /tmp/pat_extract/pat.env, or place the pass at upload/rar.pass (0600).");
    process.exit(1);
  }
  log(`token acquired from ${source} (never printed)`);

  if (hasRepo) {
    // repo present but deps/db missing — refresh install only
    log("existing clone found — installing deps");
    if ((await sh(["bun", "install"], TARGET)) !== 0) process.exit(1);
  } else {
    if (fs.existsSync(TARGET)) fs.rmSync(TARGET, { recursive: true, force: true });
    log("cloning saos-dex (depth 1, latest committed state)");
    if ((await sh(["git", "clone", "--depth", "1", "--quiet", `https://x-access-token:${token}@github.com/roshpinacare-sys/saos-dex.git`, TARGET])) !== 0) {
      log("clone failed");
      process.exit(1);
    }
    // strip the token from the clone config immediately (token-in-config = never)
    await sh(["git", "-C", TARGET, "remote", "set-url", "origin", "https://github.com/roshpinacare-sys/saos-dex.git"]);
    log("installing dependencies");
    if ((await sh(["bun", "install"], TARGET)) !== 0) process.exit(1);
  }

  log("pushing prisma schema (absolute path derived from target — colonization guard)");
  if ((await sh(["bunx", "prisma", "db", "push"], TARGET, {
    DATABASE_URL: `file:${path.join(TARGET, "db", "dex.db")}`,
  })) !== 0) process.exit(1);

  log("heal complete — chain state restores deterministically from the committed snapshot");
}

main().catch((e) => {
  log(`fatal: ${(e as Error).message}`);
  process.exit(1);
});
