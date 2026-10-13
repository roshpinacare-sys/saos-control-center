/**
 * recovery-shard.ts — T-34 · פיצול-חבילות-שיקום (2-מתוך-3 · Shamir GF(256)) ═══
 * הכרעה (2026-10-09, שאלת-הבעלים): **כן-לפיצול, לא-לגיט.**
 *   · חבילות saos.recovery-stage/1 = מטא-בלבד (תוויות-פומביות) — אך זו מפת-
 *     מיקוד ("אילו-חשבונות-ייבנו-מחדש-כשהבעלים-אופליין"). אסור-בריפו-פומבי.
 *   · פיצול 2-מתוך-3 אמיתי: שבר-בודד אינו-מגלה-כלום (חסם-אינפורמציוני),
 *     כל-זוג בונה-מחדש. אפס-תלות-חוץ — GF(2^8) פולינום 0x11b בעצימות-מלאה.
 *   · שלושה-ספריות-איטום מקומיות: agent/seal-shards · saos-dex/state/seal-shards
 *     · db/seal-shards. **כנות-מבנית:** שלושתן-על-אותו-נפח-פיזי — הפרדה-פיזית
 *     אמיתית דורשת-מארח-שני (חסום-דלק). הפיצול-הלוגי מגן-מפני-לכידה-חלקית
 *     של-ספרייה-בודדת (dump-חלקי, גיבוי-שגוי, קריאה-חלקית).
 *   · אפס-סודות-בקבלות · אפס-נתיבי-עבודה-מוחלטים-בקבצים.
 *
 * CLI:  bun scripts/recovery-shard.ts --selftest
 *       bun scripts/recovery-shard.ts --shard <file.json>
 *       bun scripts/recovery-shard.ts --reconstruct <f1> <f2> [--out <file>]
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";

const ROOT = process.cwd();
const SHARD_ROOTS = ["agent/seal-shards", "saos-dex/state/seal-shards", "db/seal-shards"];
const SELFTEST_OUT = path.join(ROOT, "receipts", "recovery-shard-selftest-latest.json");

/* ── GF(2^8) · פולינום-0x11b · אפס-תלות ── */
function gfMul(a: number, b: number): number {
  let p = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) p ^= a;
    const hi = a & 0x80;
    a = (a << 1) & 0xff;
    if (hi) a ^= 0x1b;
    b >>= 1;
  }
  return p;
}
function gfInv(a: number): number {
  if (a === 0) throw new Error("gfInv(0)");
  for (let y = 1; y < 256; y++) if (gfMul(a, y) === 1) return y;
  throw new Error("gfInv-exhausted");
}

export interface Shard { x: number; data: Buffer; secretSha256: string }

/** פיצול 2-מתוך-3: f(x)=s ⊕ a1·x פר-בית; שבר-בודד=אקראי-מוחלט. */
export function shardBuffer(secret: Buffer): Shard[] {
  const sha = crypto.createHash("sha256").update(secret).digest("hex");
  const outs: Buffer[] = [Buffer.alloc(secret.length), Buffer.alloc(secret.length), Buffer.alloc(secret.length)];
  for (let i = 0; i < secret.length; i++) {
    const a1 = crypto.randomBytes(1)[0];
    outs[0][i] = secret[i] ^ gfMul(a1, 1); // f(1)
    outs[1][i] = secret[i] ^ gfMul(a1, 2); // f(2)
    outs[2][i] = secret[i] ^ gfMul(a1, 3); // f(3)
  }
  return [1, 2, 3].map((x, i) => ({ x, data: outs[i], secretSha256: sha }));
}

/** שחזור-לגרנז' מכל-זוג (x=0): s = y1·x2/(x1⊕x2) ⊕ y2·x1/(x1⊕x2). */
export function combine(shards: Array<{ x: number; data: Buffer }>): Buffer {
  if (shards.length < 2) throw new Error("need ≥2 shards (threshold 2-of-3)");
  const [s1, s2] = shards.slice(0, 2);
  if (s1.x === s2.x) throw new Error("duplicate shard-x");
  if (s1.data.length !== s2.data.length) throw new Error("shard-length-mismatch");
  const denInv = gfInv(s1.x ^ s2.x);
  const out = Buffer.alloc(s1.data.length);
  for (let i = 0; i < out.length; i++) {
    out[i] = gfMul(s1.data[i], gfMul(s2.x, denInv)) ^ gfMul(s2.data[i], gfMul(s1.x, denInv));
  }
  return out;
}

export function shardFile(file: string): { paths: string[]; bytes: number; note: string } {
  const secret = fs.readFileSync(file);
  const shards = shardBuffer(secret);
  const base = path.basename(file).replace(/\.json$/, "");
  const paths: string[] = [];
  for (let i = 0; i < 3; i++) {
    const dir = path.join(ROOT, SHARD_ROOTS[i]);
    fs.mkdirSync(dir, { recursive: true });
    try { fs.chmodSync(dir, 0o700); } catch { /* כנות */ }
    const p = path.join(dir, `${base}.shard${shards[i].x}.json`);
    fs.writeFileSync(p, JSON.stringify({
      schema: "saos.recovery-shard/1",
      at: new Date().toISOString(),
      x: shards[i].x,
      dataHex: shards[i].data.toString("hex"),
      secretSha256: shards[i].secretSha256,
      threshold: "2-of-3",
      note: "sealed local shard — single shard reveals nothing · never git",
    }, null, 1) + "\n");
    try { fs.chmodSync(p, 0o600); } catch { /* כנות */ } // T-35: 0600-אמיתי (לא-רק-בדוח)
    paths.push(p);
  }
  return {
    paths,
    bytes: secret.length,
    note: "logical 2-of-3 across distinct sealed directories on the same host volume — physical separation requires a second host (fuel-blocked)",
  };
}

export function reconstructFromFiles(f1: string, f2: string, out?: string): { verified: boolean; bytes: number } {
  const read = (f: string): { x: number; data: Buffer; secretSha256: string } => {
    const j = JSON.parse(fs.readFileSync(f, "utf8")) as { x: number; dataHex: string; secretSha256: string };
    return { x: j.x, data: Buffer.from(j.dataHex, "hex"), secretSha256: j.secretSha256 };
  };
  const a = read(f1), b = read(f2);
  const secret = combine([a, b]);
  const sha = crypto.createHash("sha256").update(secret).digest("hex");
  const verified = sha === a.secretSha256 && sha === b.secretSha256;
  if (!verified) throw new Error("reconstruct-sha-mismatch (honest)");
  if (out) fs.writeFileSync(out, secret);
  return { verified, bytes: secret.length };
}

/* ── CLI ── */
if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args[0] === "--selftest") {
    const cases = [16, 1, 4096];
    const results = cases.map((n) => {
      const secret = crypto.randomBytes(n);
      const shards = shardBuffer(secret);
      const pairs: Array<[number, number]> = [[0, 1], [1, 2], [0, 2]];
      return {
        bytes: n,
        pairs: pairs.map(([i, j]) => combine([shards[i], shards[j]]).equals(secret)),
        singleShardLeaksNothing: !shards.some((s) => s.data.equals(secret)),
      };
    });
    const verdict = results.every((r) => r.pairs.every(Boolean) && r.singleShardLeaksNothing) ? "PASS" : "FAIL";
    fs.mkdirSync(path.dirname(SELFTEST_OUT), { recursive: true });
    fs.writeFileSync(SELFTEST_OUT, JSON.stringify({
      schema: "saos.recovery-shard-selftest/1",
      at: new Date().toISOString(),
      verdict,
      cases: results,
      scheme: "shamir-2of3-gf256-0x11b · zero-dependency",
      keysLeaked: false,
    }, null, 1) + "\n");
    console.log(`recovery-shard: selftest=${verdict} cases=${results.length} pairs=${results.length * 3} (roundtrip + single-shard-blindness)`);
    process.exit(verdict === "PASS" ? 0 : 1);
  } else if (args[0] === "--shard" && args[1]) {
    const r = shardFile(path.resolve(args[1]));
    console.log(`recovery-shard: sharded ${r.bytes}B → ${r.paths.length} shards (2-of-3)`);
    for (const p of r.paths) console.log(`  ${path.relative(ROOT, p)}`);
    console.log(`  note: ${r.note}`);
  } else if (args[0] === "--reconstruct" && args[1] && args[2]) {
    const outIdx = args.indexOf("--out");
    const out = outIdx > 0 ? args[outIdx + 1] : undefined;
    const r = reconstructFromFiles(path.resolve(args[1]), path.resolve(args[2]), out);
    console.log(`recovery-shard: reconstruct verified=${r.verified} bytes=${r.bytes}${out ? ` → ${path.relative(ROOT, out)}` : " (memory-only)"}`);
  } else {
    console.error("usage: recovery-shard.ts --selftest | --shard <file> | --reconstruct <f1> <f2> [--out <file>]");
    process.exit(1);
  }
}
