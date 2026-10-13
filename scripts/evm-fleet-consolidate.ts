/**
 * evm-fleet-consolidate.ts — roast-76 · ריכוז-EVM-של-הצי אל זהות-הפקדה של הדלת
 *
 * המשך-ישר מ-roast-75 (שריכז את ה-SOL): הביקורת-החיה מדדה 10-ארנקי-EVM-ממומנים
 * (~0.00186-ETH נייד). roast-75 חשש-שעמלות-הגז-יבלעו ~5% — מדידת-היום (gasPrice
 * 0.056-gwei) מפריכה: עלות-הריכוז-האמת ~0.6% · חלון-הזדמנות-גז-חי.
 *
 * פעולה: מכל-ארנק-ממומן (פרט-לזהות-הפקדה-עצמה) — העברת (יתרה − עמלת-גז-מדודה)
 * wei אל wallet:cashmachine (0x0FB6… — זהות-הפקדה-הריבונית = אותה-זהות של ה-relay).
 * עסקת-legacy EIP-155 מינימלית: build+sign מקומי · 21,000-גז · נונס-חי.
 *
 * בטיחות: DRY-RUN-כברירת-מחדל; --execute בלבד-לשידור. אפס-הדפסות-מפתחות.
 * אימות-כתובת-נגזרת-מול-הכספת-לפני-כל-חתימה (fail-closed) · גז-מנופח ×1.5
 * נגד-זינוק-base-fee בין-המדידה-לשידור · נונס-נמדד-פר-ארנק בכל-ריצה.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
// FIX(3-b · F7b): הייבוא היה מקודד-ל-/home/z/my-project/saos-dex/node_modules —
// תלות-שברירית בעץ של פרויקט אחר. עתה: שמות-חבילות רגילים — @noble/* כבר
 // dependencies בריפו-זה (curves 1.9.7 · hashes 2.4.0) ונפתרים מ-node_modules משלו.
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

const RPC = "https://ethereum-rpc.publicnode.com";
const UA = "SAOS-Sovereign-Audit/1.0 (+sovereign-chain)";
const CHAIN_ID = 1;
// FIX(R16-c·M7): --execute לבד היה מספיק לסריקת-כספות-מלאה (balance−gas — עד-הגרוש)
// מתוך-היסטוריית-פקודות. עתה: נדרשת-גם-אישור-מוקלד עם-התאריך של היום.
const EXECUTE = process.argv.includes("--execute") && process.argv.includes(`--i-understand-${new Date().toISOString().slice(0, 10)}`);
const GAS_LIMIT = 21_000n; // transfer מקורי — לא-טוקן

/* ── FIX(3-b · F7c): מקור-המפתחות = agent/keys/wallets-registry.json (12/12
 * עצמי-עקביים — pk נגזר-את-הכתובת-הנתבעת, נמדד). הכספת-החתומה נשארת fallback
 * פר-שורה בלבד; שורה-חתומה מדלגת-כנה (F7a) במקום-להפיל-את-הריצה-כולה. ── */
// Task 13-c: env override → repo-local convention → the canonical org vault
// (steem/agent/keys, gitignored+0600 — the 12/12 self-consistent registry).
const REGISTRY = process.env.SAOS_KEYS_REGISTRY
  ?? [fileURLToPath(new URL("../agent/keys/wallets-registry.json", import.meta.url)), "/home/z/git-audit/steem/agent/keys/wallets-registry.json"]
    .find((p) => fs.existsSync(p))
  ?? fileURLToPath(new URL("../agent/keys/wallets-registry.json", import.meta.url));
interface RegistryEntry { agent: string; evm?: { pk?: string }; sol?: { pk?: string } }
function registryPk(chain: "evm" | "sol", account: string): string | null {
  try {
    const j = JSON.parse(fs.readFileSync(REGISTRY, "utf8")) as { accounts?: RegistryEntry[] };
    const hit = (j.accounts ?? []).find((a) => a.agent === account || `wallet:${a.agent}` === account);
    return chain === "evm" ? hit?.evm?.pk ?? null : hit?.sol?.pk ?? null;
  } catch { return null; }
}

function evmAddrFromPk(pkHex: string): string | null {
  try {
    const pk = pkHex.startsWith("0x") ? pkHex.slice(2) : pkHex;
    const priv = Buffer.from(pk, "hex");
    if (priv.length !== 32) return null;
    const pub65 = Buffer.from(secp256k1.getPublicKey(priv, false));
    return "0x" + Buffer.from(keccak_256(pub65.subarray(1)).subarray(12)).toString("hex");
  } catch { return null; }
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await r.json()) as { result?: T; error?: { message?: string } };
  if (j.error) throw new Error(`rpc ${method}: ${j.error.message?.slice(0, 120)}`);
  return j.result as T;
}

/* ── RLP קנוני — בדיוק-דפוס relay-eth (long-form נכון) ── */
function rlpScalar(n: bigint): Uint8Array {
  if (n === 0n) return new Uint8Array(0);
  let hex = n.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  return Buffer.from(hex, "hex");
}
function rlpWrap(payload: Uint8Array, offset: number): Uint8Array {
  if (payload.length === 1 && payload[0] < 0x80) return Buffer.from(payload);
  if (payload.length < 56) return Buffer.concat([Buffer.from([offset + payload.length]), payload]);
  const lenBytes = rlpScalar(BigInt(payload.length));
  return Buffer.concat([Buffer.from([offset + 55 + lenBytes.length]), lenBytes, payload]);
}
function rlpStr(b: Uint8Array): Uint8Array { return rlpWrap(Buffer.from(b), 0x80); }
function rlpList(items: Uint8Array[]): Uint8Array {
  return rlpWrap(Buffer.concat(items.map((x) => Buffer.from(x))), 0xc0);
}

/** legacy-EIP-155: [nonce, gasPrice, gas, to, value, data, chainId, 0, 0] */
function signLegacyTransfer(priv: Buffer, nonce: bigint, gasPrice: bigint, to20: Buffer, value: bigint): string {
  const unsigned = rlpList([
    rlpStr(rlpScalar(nonce)), rlpStr(rlpScalar(gasPrice)), rlpStr(rlpScalar(GAS_LIMIT)),
    rlpStr(to20), rlpStr(rlpScalar(value)), rlpStr(new Uint8Array(0)),
    rlpStr(rlpScalar(BigInt(CHAIN_ID))), rlpStr(new Uint8Array(0)), rlpStr(new Uint8Array(0)),
  ]);
  const h = keccak_256(unsigned);
  const sig = secp256k1.sign(h, new Uint8Array(priv), { prehash: false });
  const rec = sig.recovery ?? 0;
  const compact = sig.toCompactRawBytes(); // 64B r||s (low-s — noble מנרמל) — אותו-דפוס relay-eth
  const v = BigInt(CHAIN_ID * 2 + 35 + rec);
  const signed = rlpList([
    rlpStr(rlpScalar(nonce)), rlpStr(rlpScalar(gasPrice)), rlpStr(rlpScalar(GAS_LIMIT)),
    rlpStr(to20), rlpStr(rlpScalar(value)), rlpStr(new Uint8Array(0)),
    rlpStr(rlpScalar(v)), rlpStr(compact.subarray(0, 32)), rlpStr(compact.subarray(32, 64)),
  ]);
  return "0x" + Buffer.from(signed).toString("hex");
}

async function main(): Promise<void> {
  const db = new PrismaClient();
  try {
    const { decryptSecret } = await import("../src/lib/vault");
    const rows = await db.vaultKey.findMany({
      where: { chain: "evm", role: "wallet" },
      select: { account: true, cipher: true, address: true },
    });
    const TARGET_LABEL = "wallet:cashmachine"; // זהות-הפקדה של הדלת (= זהות-ה-relay)
    const target = rows.find((r) => r.account === TARGET_LABEL);
    if (!target?.address) throw new Error("door target (wallet:cashmachine) missing in vault");
    const targetAddr = target.address.toLowerCase();
    console.log(`door-target: ${targetAddr.slice(0, 10)}... (${TARGET_LABEL}) mode=${EXECUTE ? "EXECUTE" : "DRY-RUN"}`);

    const gasNow = BigInt(await rpc<string>("eth_gasPrice", []));
    const gasPrice = (gasNow * 3n) / 2n; // נגד-זינוק-base-fee (×1.5)
    const cost = GAS_LIMIT * gasPrice;
    console.log(`gas: ${Number(gasNow) / 1e9} gwei · signed-at: ${Number(gasPrice) / 1e9} gwei · cost/tx: ${cost} wei`);

    const tBefore = BigInt(await rpc<string>("eth_getBalance", [targetAddr, "latest"]));
    console.log(`target-before: ${tBefore} wei`);

    let totalMoved = 0n;
    let sent = 0;
    const txids: string[] = [];
    for (const r of rows) {
      if (r.account === TARGET_LABEL) continue;
      // FIX(3-b · F7a/c): registry-first; פענוח-כספת רק-כ-fallback — ושורה-חתומה
      // ('cipher-sealed') מדלגת-כנה במקום-להרוג-את-הריצה.
      let pk: string | null = registryPk("evm", r.account);
      if (!pk) {
        try { pk = decryptSecret(r.cipher); } catch { console.log(`  ${r.account}: cipher-sealed — skip`); continue; }
      }
      const derived = evmAddrFromPk(pk);
      if (!derived || !r.address || derived.toLowerCase() !== r.address.toLowerCase()) {
        console.log(`  ${r.account}: self-derive MISMATCH — SKIP (fail-closed)`);
        continue;
      }
      const addr = r.address.toLowerCase();
      let bal = 0n;
      let nonce = 0n;
      try {
        bal = BigInt(await rpc<string>("eth_getBalance", [addr, "latest"]));
        nonce = BigInt(await rpc<string>("eth_getTransactionCount", [addr, "pending"]));
      } catch (e) { console.log(`  ${r.account}: rpc-fail ${String((e as Error).message).slice(0, 60)}`); continue; }
      const value = bal - cost;
      if (bal <= 0n) { console.log(`  ${r.account} ${addr.slice(0, 10)}...: empty — skip`); continue; }
      if (value <= 0n) { console.log(`  ${r.account} ${addr.slice(0, 10)}...: bal=${bal} ≤ gas ${cost} — skip`); continue; }
      if (!EXECUTE) {
        console.log(`  ${r.account} ${addr.slice(0, 10)}... -> ${value} wei (nonce=${nonce}) [dry-run]`);
        totalMoved += value;
        continue;
      }
      try {
        const raw = signLegacyTransfer(Buffer.from(pk.startsWith("0x") ? pk.slice(2) : pk, "hex"), nonce, gasPrice, Buffer.from(targetAddr.slice(2), "hex"), value);
        const txid = await rpc<string>("eth_sendRawTransaction", [raw]);
        txids.push(txid);
        sent++;
        totalMoved += value;
        console.log(`  ${r.account} ${addr.slice(0, 10)}... -> ${value} wei · txid=${txid}`);
      } catch (e) {
        console.log(`  ${r.account} ${addr.slice(0, 10)}... -> FAILED: ${String((e as Error).message).slice(0, 140)}`);
      }
    }
    console.log(`total: ${totalMoved} wei (${Number(totalMoved) / 1e18} ETH) · ${EXECUTE ? `sent=${sent}` : "dry-run"}`);
    if (EXECUTE && sent) {
      await new Promise((res) => setTimeout(res, 40_000)); // מתן-אישור
      const tAfter = BigInt(await rpc<string>("eth_getBalance", [targetAddr, "latest"]));
      console.log(`target-after: ${tAfter} wei (delta=${tAfter - tBefore})`);
      console.log("txids:\n" + txids.join("\n"));
    }
  } finally {
    await db.$disconnect();
  }
}
main().catch((e) => { console.error(`[evm-consolidate] FAILED: ${String((e as Error).message ?? e).slice(0, 300)}`); process.exit(1); });
