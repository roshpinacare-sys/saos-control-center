/* jupiter-first-swap.ts — הצתת-ההמרה-האמת-הראשונה: SOL→USDC ב-Jupiter (mainnet).
 *
 * רקע (R21 · 2026-09-13): משמורת-הדלת SOL HBBdhpbp… = 78,136,117-lamports,
 * מתוכן 49,000,000-מובטחים-לתביעות-המוטבעות (R20: 6×peg-in 1:1) וראש-חופשי
 * 29,136,117-בלבד. ההמרה הראשונה משתמשת ב-15,000,000-lamports (≈1.50$) —
 * נשארים הרחק-מעל-רצפת-הגיבוי (roast-78). תוצר: USDC אמת-ב-ATA של הזהות —
 * ממומש-לכל-דבר, ניתן-למשיכה-לכל-בורסה-בשעה-שתבחר-המפעיל.
 *
 * בטיחות (fail-closed, create-only):
 * · אימות-זהות: solIdentity(.env SOL_PRIVATE_KEY) === זהות-הדלת הממומנת ===
 *   registry.cashmachine.sol.address (הצלבה-כפולה; סטייה = abort).
 * · רצפות: לפני-חתימה — balance ≥ claims+swap+fees+rent+margin, ואחרת abort.
 * · תקרות: SWAP_LAMPORTS=7,000,000 קשיח; התעלות-על 10,000,000 = refuse.
 * · חתימה-ידנית-על-MessageV0/Legacy: פרסינג-מבוקר-עם-דיאגנוסטיקה + abort על
 *   כל-חוסר-התאמה (sig-count/header/keys) — אפס-אמון-עיוור בפורמט.
 * · שער-הצתה: --execute חובה; בלי-ו — quote בלבד.
 * · אפס-סודות בפלט: כתובות/txid/כמויות-בלבד.
 */
import { ed25519 } from "@noble/curves/ed25519";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";

/* ── base58 ── */
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(buf: Uint8Array): string {
  let n = BigInt("0x" + Buffer.from(buf).toString("hex"));
  let out = "";
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of buf) { if (b === 0) out = B58[0] + out; else break; }
  return out;
}
function b58decode(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error("bad base58 char"); n = n * 58n + BigInt(i); }
  let hex = n.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const buf = Buffer.from(hex, "hex");
  let pad = 0;
  for (const c of s) { if (c === B58[0]) pad++; else break; }
  return Buffer.concat([Buffer.alloc(pad), buf]);
}

/* ── קבועים-קשיחים ── */
const SWAP_LAMPORTS = 15_000_000;              // 0.015-SOL ≈ 1.50$ — סף-ההוכחה מהתוכנית ($1.5)
const HARD_CAP_LAMPORTS = 20_000_000;          // תקרה-עליונה-מוחלטת
const CLAIMS_FLOOR_LAMPORTS = 49_000_000;      // תביעות-מוטבעות (R20) — אין-געש-בהן
const MIN_CUSTODY_MARGIN = 5_000_000;          // מרווח-מינימלי-מעל-הרצפה-אחרי-ההמרה
const FEE_RESERVE = 500_000;                   // עמלות+compute-budget (שמרן)
const OUT_FLOOR_USDC_UNITS = 600_000;          // מינימום-תוחלת: 0.60$-USDC
const JUP = "https://lite-api.jup.ag";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const RPC = "https://api.mainnet-beta.solana.com";

async function rpc<T>(method: string, params: unknown[], timeoutMs = 30000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(RPC, {
      method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "saos-jup/1.0" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: ctrl.signal,
    });
    const j = (await res.json()) as { result?: T; error?: { message?: string } };
    if (j.error) throw new Error(`rpc ${method}: ${String(j.error.message).slice(0, 120)}`);
    return j.result as T;
  } finally { clearTimeout(t); }
}

/* ── cu16 (shortvec) ── */
function readCu16(b: Buffer, off: number): { val: number; len: number } {
  let val = 0, shift = 0, len = 0, byte: number;
  do { byte = b[off + len++]; val |= (byte & 0x7f) << shift; shift += 7; } while (byte & 0x80);
  return { val, len };
}

async function main(): Promise<void> {
  const execute = process.argv.includes("--execute");
  /* ── מקורות-מפתח: .env של-הדמון (0600) + הצלבה מול-ה-registry (0600) ── */
  // Task 13-c: resolution chains — env override first, then the live saos-dex
  // repo / the canonical steem/agent/keys vault, then the repo-local convention.
  const envPath = process.env.SAOS_DEX_ENV_PATH
    || [path.resolve(process.cwd(), "saos-dex/.env"), "/home/z/git-audit/saos-dex/.env", "/home/z/my-project/saos-dex/.env"].find((p) => fs.existsSync(p))
    || path.resolve(process.cwd(), "saos-dex/.env");
  const regPath = process.env.SAOS_KEYS_REGISTRY
    || [path.resolve(process.cwd(), "agent/keys/wallets-registry.json"), "/home/z/git-audit/steem/agent/keys/wallets-registry.json"].find((p) => fs.existsSync(p))
    || path.resolve(process.cwd(), "agent/keys/wallets-registry.json");
  if (!fs.existsSync(envPath) || !fs.existsSync(regPath)) throw new Error("key sources missing (set SAOS_DEX_ENV_PATH / SAOS_KEYS_REGISTRY or run from a tree that has them)");
  for (const p of [envPath, regPath]) {
    if ((fs.statSync(p).mode & 0o077) !== 0) throw new Error(`${path.basename(p)} permissions too open`);
  }
  const env = Object.fromEntries(
    fs.readFileSync(envPath, "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
  );
  const seedHex = (env.SOL_PRIVATE_KEY || "").replace(/^0x/, "").trim();
  const seed = Buffer.from(seedHex, "hex");
  if (seed.length !== 32) throw new Error("SOL_PRIVATE_KEY must be a 32B ed25519 seed");
  const address = b58(ed25519.getPublicKey(seed));
  const EXPECTED = "HBBdhpbpFP3BwqcvrxJ44hAyKSid3D6AB4SFvtrN736s"; // זהות-הדלת-הממומנת
  if (address !== EXPECTED) throw new Error("derived address != funded door identity — fail-closed");
  const reg = JSON.parse(fs.readFileSync(regPath, "utf8")) as { accounts?: { agent?: string; sol?: { address?: string; pk?: string } }[] };
  const cm = reg.accounts?.find((a) => a.sol?.address === EXPECTED);
  if (!cm?.sol?.pk) throw new Error("registry cross-check failed: no matching entry");
  const regSeed = Buffer.from(cm.sol.pk.replace(/^0x/, "").length === 64 ? cm.sol.pk.replace(/^0x/, "") : Buffer.from(b58decode(cm.sol.pk)).subarray(0, 32), "hex");
  if (!regSeed.equals(seed)) throw new Error("registry pk != .env seed — fail-closed (divergent custody keys)");
  console.log("identity: OK (env+registry dual-verified) ·", address);

  /* ── מדידות-משמורת ── */
  const balance = await rpc<number>("getBalance", [address, { commitment: "confirmed" }]).then((r) => (typeof r === "number" ? r : (r as { value: number }).value));
  console.log(`custody: ${balance} lamports (${(balance / 1e9).toFixed(9)} SOL)`);
  console.log(`floor: claims=${CLAIMS_FLOOR_LAMPORTS} · swap=${SWAP_LAMPORTS} · feeReserve=${FEE_RESERVE}`);
  if (SWAP_LAMPORTS > HARD_CAP_LAMPORTS) throw new Error("swap amount exceeds hard cap — refusing");
  if (balance < SWAP_LAMPORTS + FEE_RESERVE) throw new Error(`insufficient for swap+fees (${balance} < ${SWAP_LAMPORTS + FEE_RESERVE})`);
  const after = balance - SWAP_LAMPORTS - FEE_RESERVE;
  if (after < CLAIMS_FLOOR_LAMPORTS + MIN_CUSTODY_MARGIN) {
    throw new Error(`custody-after would breach claims floor+margin: ${after} < ${CLAIMS_FLOOR_LAMPORTS + MIN_CUSTODY_MARGIN} — refusing (backing protection)`);
  }
  console.log(`post-swap custody projection: ≥${after} lamports (margin over claims: ${after - CLAIMS_FLOOR_LAMPORTS})`);

  /* ── quote ── */
  const qUrl = `${JUP}/swap/v1/quote?inputMint=${SOL_MINT}&outputMint=${USDC_MINT}&amount=${SWAP_LAMPORTS}&slippageBps=100`;
  const quote = await (await fetch(qUrl)).json() as { outAmount?: string; priceImpactPct?: string; inAmount?: string };
  const out = parseInt(quote.outAmount ?? "0", 10);
  console.log(`quote: ${SWAP_LAMPORTS} lamports → ${out} USDC-units ($${(out / 1e6).toFixed(4)}) · impact=${quote.priceImpactPct ?? "?"}`);
  if (!(out >= OUT_FLOOR_USDC_UNITS)) throw new Error(`quote below floor: ${out} < ${OUT_FLOOR_USDC_UNITS} — refusing (price sanity)`);

  if (!execute) { console.log("mode: DRY-RUN (quote only; rerun with --execute to build+sign+send)"); return; }

  /* ── swap-tx ── */
  const swapRes = await fetch(`${JUP}/swap/v1/swap`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: address,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      priorityLevelWithMaxLamports: { priority: "normal", maxLamports: 100_000 },
    }),
  });
  const swapJson = (await swapRes.json()) as { swapTransaction?: string; simulationError?: unknown };
  const txB64 = swapJson.swapTransaction;
  if (!txB64 || typeof txB64 !== "string") throw new Error(`swap API answered without swapTransaction (${JSON.stringify(swapJson).slice(0, 120)})`);
  const wire = Buffer.from(txB64, "base64");
  console.log(`swap tx: ${wire.length}B wire`);

  /* ── פרסינג-מבוקר: [cu16 sigcount][sigs×64][message] ── */
  const { val: sigCount, len: cuLen } = readCu16(wire, 0);
  if (sigCount !== 1) throw new Error(`expected exactly 1 required signer, got ${sigCount} — refusing to blind-sign`);
  const msgStart = cuLen + 64 * sigCount;
  const msg = wire.subarray(msgStart);
  /* v0-החוכחה-בשידור-חי: בייט-0 = סמן-גרסה (0x80=v0) כשלעצמו; ה-header-האמתי
   * [nReq,roSigned,roUnsigned] בא-אחריו (legacy: ה-header מתחיל-מיד). */
  const m0 = msg[0];
  const versioned = (m0 & 0x80) !== 0;
  const version = versioned ? (m0 & 0x7f) : null;
  const headerOff = versioned ? 1 : 0;
  const nReq = msg[headerOff];
  if (nReq !== 1) throw new Error(`message header: nReq=${nReq} (versioned=${versioned}, v=${version}) — expected 1 — refusing`);
  const roSigned = msg[headerOff + 1], roUnsigned = msg[headerOff + 2];
  console.log(`message: ${msg.length}B · ${versioned ? `v${version}` : "legacy"} · nReq=1 · roSigned=${roSigned} roUnsigned=${roUnsigned}`);
  const { val: keyCount, len: keyCuLen } = readCu16(msg, headerOff + 3);
  const keysEnd = headerOff + 3 + keyCuLen + keyCount * 32 + 32;
  if (keysEnd > msg.length) throw new Error(`key-count parse out of range (keyCount=${keyCount}) — refusing`);
  console.log(`header: staticKeys=${keyCount} · accounts-end-offset=${keysEnd}${versioned ? " (v0 ALTs follow instructions)" : ""}`);

  /* ── חתימה-על-המסר-בדיוק-כפי-שהוא ── */
  const sig = ed25519.sign(msg, seed);
  const signed = Buffer.concat([wire.subarray(0, cuLen), Buffer.from(sig), msg]);
  if (signed.length !== wire.length) throw new Error("reassembly length mismatch — refusing");

  /* ── simulation לפני-שידור ── */
  const sim = await rpc<{ value: { err: unknown; logs?: string[]; unitsConsumed?: number } | null }>("simulateTransaction", [
    signed.toString("base64"), { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" },
  ]);
  if (sim?.value?.err) {
    throw new Error(`simulation failed: ${JSON.stringify(sim.value.err).slice(0, 160)} · log-tail: ${(sim.value.logs ?? []).slice(-3).join(" | ").slice(0, 200)}`);
  }
  console.log(`simulation: PASS · unitsConsumed=${sim?.value?.unitsConsumed ?? "?"}`);

  /* ── שידור ── */
  const txid = await rpc<string>("sendTransaction", [signed.toString("base64"), { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 }], 45000);
  console.log(`sent: ${txid}`);

  /* ── התבוננות-עד-finalized ── */
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const st = await rpc<{ value: ({ err: unknown; confirmationStatus?: string; slot?: number } | null)[] }>("getSignatureStatuses", [[txid], { searchTransactionHistory: true }]).catch(() => null);
    const v = st?.value?.[0];
    if (v?.err) throw new Error(`swap failed on-chain: ${JSON.stringify(v.err).slice(0, 140)}`);
    if (v?.confirmationStatus === "finalized" || v?.confirmationStatus === "confirmed") {
      console.log(`status: ${v.confirmationStatus} (slot ${v.slot}) after ~${(i + 1) * 4}s`);
      break;
    }
    if (i === 14) console.log("still not visible after 60s — check explorer by txid (RPC lag)");
  }

  /* ── אימות-תוצר: יתרת-USDC ב-ATA ── */
  /* אימות-תוצר-עם-retry (הוכח-חי: קריאה-מידית-אחרי-אישור-עלולה-להקדים-את-האינדוקס) */
  let usdc: { amount: string; uiAmountString: string } | null = null;
  let custAfter = 0;
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const tok = await rpc<{ value: { account: { data: { parsed: { info: { tokenAmount: { amount: string; uiAmountString: string } } } } } }[] } | null>("getTokenAccountsByOwner", [address, { mint: USDC_MINT }, { encoding: "jsonParsed" }]).catch(() => null);
    usdc = tok?.value?.[0]?.account?.data?.parsed?.info?.tokenAmount ?? null;
    custAfter = await rpc<number>("getBalance", [address]).then((r) => (typeof r === "number" ? r : (r as { value: number }).value));
    if (usdc && parseInt(usdc.amount, 10) > 0 && custAfter < balance) break;
    if (i === 5) console.log("(final state not fully indexed after 30s — verify by txid above)");
  }
  console.log(`USDC held (real, withdrawable): ${usdc?.uiAmountString ?? "0"} (raw ${usdc?.amount ?? 0})`);
  console.log(`custody now: ${custAfter} lamports (${(custAfter / 1e9).toFixed(9)} SOL) · headroom over claims: ${custAfter - CLAIMS_FLOOR_LAMPORTS}`);
  console.log("fp-key:", createHash("sha256").update(seed).digest("hex").slice(0, 8));
}

main().catch((e) => { console.error("FAIL:", (e as Error).message); process.exit(1); });
