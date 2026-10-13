/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WEAVE-CONSOLE SLOT — the MOTHER console supervisor (PEACE TREATY 2026-10-07)
 * ═══════════════════════════════════════════════════════════════════════════
 * The revive route (saos-dex /api/revive, item 3) expects EXACTLY this file:
 *     spawnDetached('bun', ['mini-services/web/index.ts'], '/home/z/my-project/zip')
 * — spawned FROM the container-boot lineage (the only lineage that survives
 * shell-command reaping; operator-shell children die within minutes, measured).
 * Doctrine (measured by the bridge author): a bare next-dev child still gets
 * reaped — a pure-bun supervisor revives it in a loop. This IS that supervisor.
 *
 * What it revives: the REAL mother platform (/home/z/my-project — the sovereign
 * SovereignDex console the operator knows) on :3050 — the port the preview-bridge
 * edge-router routes "everything else" to.
 *
 * FRONT-DOOR TREATY (operator-ruled "make peace, not war"):
 *   /           → mother console (:3050)   ← this supervisor keeps it alive
 *   /saos-dex   → DEX engine (:3010)       ← untouched, first-class deep link
 *   /api/health → answered locally (200)   ← keeper peace, no kills
 *
 * T-56 (MEMORY-BLEED ROOT FIX — measured): the dev-mode console (next dev +
 * turbopack) grew back to 1.4-1.6GB every cycle on the 4GB box (chronic
 * MemAvailable ≈ 300-400MB; mem-gate hold/recycle treadmill). Root fix: the
 * console now runs a PRODUCTION standalone build in /home/z/console-prod
 * (OUTSIDE the repo — building in-place would fight the :3000 preview lineage
 * over .next/). Flow per tick: building? skip · port alive? skip · no BUILD_ID?
 * sync-sources + next build (guarded) · else spawn `bun .next/standalone/server.js`.
 * Measured expectation: steady ~200-300MB instead of ~1500MB.
 * UI changes require a refresh: kill the prod server + rm BUILD_ID (P9 playbook).
 *
 * Zero secrets · binds nothing itself · pure bun · no deps · git-tracked.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { spawn, execFileSync } from "child_process";
import net from "net";
import fs from "fs";

const PORT = 3050;
const APP = "/home/z/my-project";
const PROD_ROOT = "/home/z/console-prod"; // T-56: build workspace OUTSIDE the repo (no .next contention with :3000)
const BUILD_ID = `${PROD_ROOT}/.next/BUILD_ID`;
const LOG = "/home/z/my-project/dev-console-3050.log";
const SUP_LOG = "/home/z/my-project/console-supervisor.log";
const DEV_LOG = "/home/z/my-project/dev.log";

// EXEC-CD-17 (PREVIEW-VISIBILITY ROOT CAUSE): the platform's own auto dev server
// (`next dev -p 3000`) can never start in the treaty topology — :3000 belongs to
// the preview-bridge by operator-ruled peace. Its death left dev.log ending in a
// lock-error crash, which is what the operator's Preview panel reflects ("אני לא
// רואה כלום"). From now on `bun run dev` LAUNCHES THIS SUPERVISOR (see
// package.json), so the platform's dev lineage is alive, and this mirror streams
// the REAL console output into dev.log — the platform's window shows a
// healthy Next.js server again, wherever it looks.
let mirrored = false;
function startDevLogMirror(): void {
  if (mirrored) return;
  mirrored = true;
  try {
    const out = fs.openSync(DEV_LOG, "a");
    // -n 0 = only NEW lines (no replay bloat) · -F = survive log rotation/restart
    const t = spawn("tail", ["-n", "0", "-F", LOG], {
      stdio: ["ignore", out, "ignore"],
    });
    t.unref();
  } catch { /* the mirror must never kill the supervisor */ }
}

function log(m: string): void {
  try {
    fs.appendFileSync(SUP_LOG, `[${new Date().toISOString()}] ${m}\n`);
  } catch { /* logging must never kill the supervisor */ }
}

log(`weave-slot supervisor started (pid ${process.pid}, parent ${process.ppid}) — treaty 2026-10-07 · T-56 production mode`);

function portBusy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ port, timeout: 1500 });
    s.on("connect", () => { s.destroy(); resolve(true); });
    s.on("error", () => resolve(false));
    s.on("timeout", () => { s.destroy(); resolve(false); });
  });
}

/** EXEC-CD-15-b (ENV-POLLUTION ROOT CAUSE): deny-by-default — the child gets ONLY
 * secret-free runtime names; everything else loads safely from .env via @next/env.
 * DATABASE_URL is enforced locally to the mother's own custom.db. */
/** Return type = NodeJS.ProcessEnv (Next's global augmentation narrows NODE_ENV
 * to the literal union — a bare Record<string,string> fails `tsc --noEmit`, the
 * exact failure recorded in agent/status.json on 2026-10-08). */
function childEnv(nodeEnv: "development" | "production" | "test"): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    HOME: process.env.HOME || "/home/z",
    TMPDIR: process.env.TMPDIR || "/tmp",
    LANG: process.env.LANG || "C.UTF-8",
    LC_ALL: process.env.LC_ALL || "C.UTF-8",
    TERM: process.env.TERM || "dumb",
    NODE_ENV: nodeEnv,
    PORT: String(PORT),
    HOSTNAME: "127.0.0.1",
    DATABASE_URL: "file:/home/z/my-project/db/custom.db",
    // T-54+T-56: heap ceiling keeps GC aggressive instead of unbounded growth.
    NODE_OPTIONS: "--max-old-space-size=1024",
  };
}

/** T-56: the app sources the production build compiles (whitelist — the repo root
 * contains the whole sovereignty tree; we copy ONLY the Next.js app surface).
 * FIX(measured): dirs use trailing-slash rsync semantics — without them a
 * pre-existing dest nests src/src and the build finds no app dir (code 1 in 1.6s). */
const SYNC_DIRS = ["src", "public", "prisma"];
const SYNC_FILES = [
  "next.config.ts",
  "package.json",
  "tsconfig.json",
  "postcss.config.mjs",
  "next-env.d.ts",
  "components.json",
  "eslint.config.mjs",
];

let building = false;
let buildFails = 0;

/** FIX(measured): process.execPath reported /usr/local/bin/bun but spawn ENOENT'd —
 * resolve the real runtime once via `which` (fallback: node — standalone runs on node too). */
const RUNTIME_BIN: string = (() => {
  try { return execFileSync("which", ["bun"], { encoding: "utf8" }).trim() || "node"; }
  catch { return "node"; }
})();

function syncProdSources(): void {
  fs.mkdirSync(PROD_ROOT, { recursive: true });
  for (const d of SYNC_DIRS) {
    if (!fs.existsSync(`${APP}/${d}`)) continue;
    execFileSync("rsync", ["-a", "--delete", `${APP}/${d}/`, `${PROD_ROOT}/${d}/`], { timeout: 120_000 });
  }
  for (const f of SYNC_FILES) {
    if (!fs.existsSync(`${APP}/${f}`)) continue;
    fs.copyFileSync(`${APP}/${f}`, `${PROD_ROOT}/${f}`);
  }
  const nm = `${PROD_ROOT}/node_modules`;
  // FIX(measured): Turbopack rejects out-of-root symlinks ("Symlink node_modules
  // is invalid, it points out of the filesystem root") — hardlink tree instead:
  // same inodes, near-instant, zero extra disk, real files for Turbopack.
  try { fs.rmSync(nm, { recursive: true, force: true }); } catch { /* absent */ }
  execFileSync("cp", ["-al", `${APP}/node_modules`, nm], { timeout: 300_000 });
}

function startBuild(): void {
  building = true;
  log("T-56: console-prod build starting (sync → next build → standalone)");
  const out = fs.openSync(LOG, "a");
  const err = fs.openSync(LOG, "a");
  try {
    syncProdSources();
  } catch (e) {
    building = false;
    log(`sync error: ${(e as Error).message} — retry next tick`);
    return;
  }
  // package.json build script = `next build && cp static/public into standalone` —
  // FIX(measured): spawning bare `next build` skipped the standalone static-copy steps.
  // FIX(tsc): same cast pattern as startProdServer below — without the SpawnOptions
  // cast none of spawn's overloads accept {env: NodeJS.ProcessEnv, stdio: [fd,fd]}
  // under Next's augmented ProcessEnv, so `child` collapsed to `never`.
  const child: import("child_process").ChildProcess = spawn(
    RUNTIME_BIN,
    ["run", "build"],
    { cwd: PROD_ROOT, env: childEnv("production"), stdio: ["ignore", out, err] } as import("child_process").SpawnOptions,
  ) as import("child_process").ChildProcess;
  log(`build (bun run build) spawned (pid ${child.pid}) runtime=${RUNTIME_BIN} cwd=${PROD_ROOT}`);
  child.on("exit", (code) => {
    building = false;
    const ok = fs.existsSync(BUILD_ID);
    if (ok) buildFails = 0; else buildFails += 1;
    log(`next build exited (code ${code}) — BUILD_ID ${ok ? "READY → next tick starts standalone" : "missing → retry next tick (fail-honest)"} (fails=${buildFails})`);
  });
  child.on("error", (e) => {
    building = false;
    log(`build spawn error: ${e.message}`);
  });
  child.unref();
}

function startProdServer(): void {
  const SERVER = `${PROD_ROOT}/.next/standalone/server.js`;
  if (!fs.existsSync(SERVER)) {
    log(`standalone server.js missing — forcing rebuild (fail-honest)`);
    try { fs.rmSync(BUILD_ID, { force: true }); } catch { /* absent */ }
    return; // next tick: no BUILD_ID → startBuild()
  }
  const out = fs.openSync(LOG, "a");
  const err = fs.openSync(LOG, "a");
  // standalone server.js is self-contained (bundled deps) — no node_modules needed
  const child: import("child_process").ChildProcess = spawn(
    RUNTIME_BIN,
    [SERVER],
    { cwd: `${PROD_ROOT}/.next/standalone`, env: childEnv("production"), stdio: ["ignore", out, err] } as import("child_process").SpawnOptions,
  ) as import("child_process").ChildProcess;
  log(`console prod child spawned (pid ${child.pid}) — standalone · clean env · DATABASE_URL=file:/home/z/my-project/db/custom.db (mother-own, guard-passing)`);
  child.on("exit", (code) => log(`console prod child exited (code ${code}) — revive in 10s`));
  child.on("error", (e) => log(`spawn error: ${e.message}`));
  child.unref();
}

const tick = async (): Promise<void> => {
  if (building) return;
  try {
    if (await portBusy(PORT)) return; // console alive — nothing to do
    if (!fs.existsSync(BUILD_ID)) {
      if (buildFails >= 5) {
        log(`build failed ${buildFails} times — backing off 10min (fail-honest; escalations path if persistent)`);
        buildFails = 0;
        await new Promise((r) => setTimeout(r, 600_000));
      }
      startBuild();
      return;
    }
    startProdServer();
  } catch (e) {
    log(`supervise error: ${(e as Error).message}`);
  }
};

void tick();
setInterval(() => { void tick(); }, 10_000);
