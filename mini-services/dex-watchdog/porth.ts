/**
 * porth.ts — F-6 (EXEC-CD-35): native /proc socket-holder kill + free-check.
 *
 * THE MEASURED HOLE: every kill/guard path in the supervision stack depended on
 * `fuser` — which does NOT exist in this sandbox (command -v fuser → exit 1,
 * measured live). Result: (a) the watchdog's revive could not kill a held 3010
 * (pkill patterns never match `next-server (v16.3.4)` — no port in cmdline),
 * and (b) BOTH strict-port guards (watchdog F3 + dex-daemon R17-c) were inert,
 * so a spawn over a live holder would have drifted next dev to :3011 = zombie
 * second writer on dex.db — the exact catastrophe the guards were built for.
 *
 * THE PROVEN METHOD (chaos2/chaos3, now institutionalized): parse
 * /proc/net/tcp{,6} for the LISTEN inode of the port, walk /proc/[pid]/fd for
 * socket:[inode] holders → pid, SIGKILL, then re-parse to CONFIRM the port is
 * free before any spawn. Zero external tools. Same-user holders only.
 */

function parseListenInodes(port: number): Set<string> {
  const inodes = new Set<string>();
  const hexPort = port.toString(16).padStart(4, "0").toUpperCase();
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
      const local = f[1] ?? "";
      const st = f[3] ?? "";
      // local_address = <32hex|8hex>:<4hex-port>
      const lp = local.split(":")[1] ?? "";
      if (st === "0A" && lp.toUpperCase() === hexPort) {
        const inode = f[9];
        if (inode) inodes.add(inode);
      }
    }
  }
  return inodes;
}

/** מחזיקי-הפורט (LISTEN) — סריקת /proc/[pid]/fd מול ה-inodes. אפס-כלים-חיצוניים. */
export function portHolderPids(port: number): number[] {
  const inodes = parseListenInodes(port);
  if (inodes.size === 0) return [];
  const fs = require("fs") as typeof import("fs");
  const pids: number[] = [];
  let procIds: string[] = [];
  try {
    procIds = fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d));
  } catch {
    return [];
  }
  for (const pid of procIds) {
    let fds: string[] = [];
    try {
      fds = fs.readdirSync(`/proc/${pid}/fd`);
    } catch {
      continue; // הרשאות/זומבי
    }
    for (const fd of fds) {
      try {
        const link = fs.readlinkSync(`/proc/${pid}/fd/${fd}`);
        const m = link.match(/^socket:\[(\d+)\]$/);
        if (m && inodes.has(m[1])) {
          const p = Number(pid);
          if (!pids.includes(p)) pids.push(p);
          break; // pid נמצא — אין-צורך-לסרוק-את-שאר-ה-fd-שלו
        }
      } catch {
        continue;
      }
    }
  }
  return pids;
}

/** האם-הפורט-מוחזק-ב-LISTEN (בלי-זיהוי-מחזיק). */
export function portHeld(port: number): boolean {
  return parseListenInodes(port).size > 0;
}

export interface KillResult {
  holders: number[];
  freed: boolean;
  heldAfter: boolean;
}

/** הריגת-מחזיקי-הפורט (SIGKILL) + אישור-השתחררות — השיטה-המוכחת-מ-chaos2/chaos3. */
export function killPortHolder(port: number, waitMs = 3000): KillResult {
  const holders = portHolderPids(port);
  for (const pid of holders) {
    try {
      process.kill(pid, "SIGKILL");
    } catch { /* כבר-מת/אין-הרשאה — האישור-למטה-הוא-האמת */ }
  }
  const t0 = Date.now();
  let heldAfter = portHeld(port);
  while (heldAfter && Date.now() - t0 < waitMs) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
    heldAfter = portHeld(port);
  }
  return { holders, freed: !heldAfter, heldAfter };
}
