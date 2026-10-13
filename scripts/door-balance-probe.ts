/* door-balance-probe.ts — EXEC-CD-27 · בדיקת-יתרות זהויות-הדלת (קריאה-בלבד)
 * מקור-מפתח: saos-dex/.env (ETH_PRIVATE_KEY/TRON_PRIVATE_KEY) — לעולם לא נדפס.
 * פלט: כתובות ציבוריות + יתרות חיות מול-RPC ציבורי.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import bs58 from "bs58";

const env = Object.fromEntries(
  fs.readFileSync("/home/z/my-project/saos-dex/.env", "utf8").split(/\r?\n/).filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

function evmAddr(pkHex: string): string {
  const scalar = Buffer.from(pkHex.replace(/^0x/, "").slice(0, 64), "hex");
  const pub = secp256k1.getPublicKey(scalar, false).slice(1);
  const raw = keccak_256(pub).subarray(-20);
  const hex = Buffer.from(raw).toString("hex");
  const h2 = keccak_256(Buffer.from(hex));
  let out = "0x";
  for (let i = 0; i < 40; i++) {
    const nib = i % 2 === 0 ? h2[i >> 1] >> 4 : h2[i >> 1] & 0x0f;
    out += nib >= 8 ? hex[i].toUpperCase() : hex[i];
  }
  return out;
}
function tronAddr(pkHex: string): string {
  const scalar = Buffer.from(pkHex.replace(/^0x/, "").slice(0, 64), "hex");
  const pub = secp256k1.getPublicKey(scalar, false).slice(1);
  const body = Buffer.concat([Buffer.from([0x41]), keccak_256(pub).subarray(-20)]);
  const chk = crypto.createHash("sha256").update(crypto.createHash("sha256").update(body).digest()).digest().subarray(0, 4);
  return bs58.encode(Buffer.concat([body, chk]));
}

const ethPk = (env.ETH_PRIVATE_KEY || "").replace(/^0x/, "");
const tronPk = (env.TRON_PRIVATE_KEY || "").replace(/^0x/, "");
if (ethPk.length !== 64 || tronPk.length !== 64) { console.log("key shapes bad:", ethPk.length, tronPk.length); process.exit(1); }

const eth = evmAddr(ethPk);
const trx = tronAddr(tronPk);
console.log("door-EVM:", eth);
console.log("door-TRX:", trx);

/* EVM: יתרת-native + טוקנים-נפוצים דרך בלוקספלורר API ציבורי (קריאה-בלבד) */
async function evmProbe(): Promise<void> {
  const r = await fetch("https://ethereum-rpc.publicnode.com", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [eth, "latest"] }), signal: AbortSignal.timeout(20000) });
  const j = await r.json() as { result?: string };
  console.log("door-EVM native:", j.result ? (parseInt(j.result, 16) / 1e18).toString() + " ETH" : "rpc-fail");
  // ERC20 balanceOf for USDC/USDT/DAI/WETH (eth_call)
  const tokens: Array<[string, string, number]> = [
    ["USDC", "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", 6],
    ["USDT", "dac17f958d2ee523a2206206994597c13d831ec7", 6],
    ["DAI", "6b175474e89094c44da98b954eedeac495271d0f", 18],
    ["WETH", "c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", 18],
  ];
  const data = "70a08231" + eth.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  for (const [name, addr, dec] of tokens) {
    const rr = await fetch("https://ethereum-rpc.publicnode.com", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: "0x" + addr, data: "0x" + data }, "latest"] }), signal: AbortSignal.timeout(20000) }).catch(() => null);
    if (!rr) { console.log(`door-EVM ${name}: rpc-fail`); continue; }
    const jj = await rr.json() as { result?: string };
    const v = jj.result && jj.result !== "0x" ? BigInt(jj.result) : 0n;
    console.log(`door-EVM ${name}: ${Number(v) / 10 ** dec}`);
  }
}

/* TRON: יתרה + TRC20 USDT */
async function tronProbe(): Promise<void> {
  const r = await fetch(`https://api.trongrid.io/v1/accounts/${trx}`, { signal: AbortSignal.timeout(20000) }).catch(() => null);
  if (!r) { console.log("door-TRX: rpc-fail"); return; }
  const j = await r.json() as { data?: Array<{ balance?: number; trc20?: Array<Record<string, string>> }> };
  const acc = j.data?.[0];
  console.log(`door-TRX native: ${acc ? (acc.balance ?? 0) / 1e6 : 0} TRX`);
  const trc20 = acc?.trc20?.[0];
  if (trc20) for (const [k, v] of Object.entries(trc20)) console.log(`door-TRX trc20 ${k.slice(0, 10)}…: ${Number(v) / 1e6}`);
}

await evmProbe();
await tronProbe();
