/* door-key-forensics.ts — EXEC-CD-27 · פורנזיקת-זהות-הדלת (אפס-הדפסות-סודות)
 *
 * שאלה: האם מפתח-SOL של זהות-הדלת HBBdhpbp… נגזר מה-master (headcorner.txt)
 * באחת-מהנגזרות-המוכרות? ה-registry (wallets-registry.json) אבד-במחיקת-סנדבוקס —
 * אם-מועמד-נגזר-תואם-את-הכתובת-הציבורית-הידועה → המפתח לא-אבד-לעולם.
 *
 * בטיחות: החומר-הפרטי לעולם לא נדפס. פלט = בוליאנים/כתובות-ציבוריות/קידומות.
 * כל-הגזירות מקומיות; כל-בדיקות-היתרה מול-RPC ציבורי (קריאה-בלבד).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import bs58 from "bs58";
import steemLibRaw from "steem";

interface SteemAuth { auth: { wifToPublic(wif: string): string } }
const steemLib = steemLibRaw as unknown as SteemAuth;

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58checkDecode(wif: string): Buffer | null {
  let num = BigInt(0);
  for (const ch of wif) { const i = B58.indexOf(ch); if (i < 0) return null; num = num * BigInt(58) + BigInt(i); }
  let hex = num.toString(16); if (hex.length % 2) hex = "0" + hex;
  const bytes = Buffer.from(hex, "hex");
  const payload = bytes.subarray(0, bytes.length - 4);
  const check = bytes.subarray(bytes.length - 4);
  const h = crypto.createHash("sha256").update(crypto.createHash("sha256").update(payload).digest()).digest();
  return h.subarray(0, 4).equals(check) ? payload : null;
}
function evmAddr(scalar: Buffer): string {
  const pub = secp256k1.getPublicKey(scalar, false).slice(1);
  const raw = keccak_256(pub).subarray(-20);
  const hex = Buffer.from(raw).toString("hex");
  const h2 = keccak_256(Buffer.from(hex));
  let out = "0x";
  for (let i = 0; i < 40; i++) {
    const nib = i % 2 === 0 ? h2[i >> 1] >> 4 : h2[i >> 1] & 0x0f;
    const c = hex[i];
    out += nib >= 8 ? c.toUpperCase() : c;
  }
  return out;
}
function tronAddr(scalar: Buffer): string {
  const pub = secp256k1.getPublicKey(scalar, false).slice(1);
  const h = keccak_256(pub);
  const body = Buffer.concat([Buffer.from([0x41]), h.subarray(-20)]);
  const chk = crypto.createHash("sha256").update(crypto.createHash("sha256").update(body).digest()).digest().subarray(0, 4);
  return bs58.encode(Buffer.concat([body, chk]));
}
function solAddr(seed: Uint8Array): string {
  return bs58.encode(Buffer.from(ed25519.getPublicKey(seed)));
}

/* ── קריאת-ה-master (לעולם לא נדפס) ── */
const raw = fs.readFileSync("/home/z/my-project/upload/headcorner.txt", "utf8");
const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const label = lines.length > 1 ? lines[0] : "headcorner";
const keyLine = lines.length > 1 ? lines[1] : lines[0];
const keyNorm = keyLine.replace(/\s+/g, "").replace(/^P(?=[5KL])/, "");
console.log(`master: label=${label} · keylen=${keyNorm.length} · shape=${/^[0-9a-fA-F]+$/.test(keyNorm) ? "hex" : /^[1-9A-HJ-NP-Za-km-z]+$/.test(keyNorm) ? "base58" : "mixed"}`);

/* ── סקלר מה-WIF ── */
let scalar: Buffer | null = null;
let stmPub: string | null = null;
try {
  const payload = b58checkDecode(keyNorm);
  if (payload && payload[0] === 0x80 && payload.length >= 33) {
    scalar = Buffer.from(payload.subarray(1, 33));
    stmPub = steemLib.auth.wifToPublic(keyNorm);
    console.log(`wif-decode: OK · scalar 32B · stmPub=${stmPub.slice(0, 10)}…`);
  } else if (/^[0-9a-fA-F]{64}$/.test(keyNorm)) {
    scalar = Buffer.from(keyNorm, "hex");
    console.log("wif-decode: hex-64 → scalar 32B (not a WIF envelope)");
  }
} catch (e) { console.log("wif-decode: FAILED"); }
if (!scalar) { console.log("no scalar — abort"); process.exit(1); }

/* ── סמכויות-Steem חיות ── */
const STEEM_RPC = "https://api.steemit.com";
async function steemRpc<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch(STEEM_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(20000) });
  const j = (await r.json()) as { result?: T };
  return j.result as T;
}
const acct = await steemRpc<{ name: string; balance: string; sbd_balance: string; vesting_shares: string; active: { key_auths: [string, number][]; posting: { key_auths: [string, number][] } } }>("condenser_api.get_accounts", [["headcorner"]]).then(r => r?.[0] as never).catch(() => null as never);
if (acct) {
  const a = acct as unknown as { balance: string; sbd_balance: string; vesting_shares: string; active: { key_auths: [string, number][] } };
  const activePubs = a.active?.key_auths?.map(k => k[0]) ?? [];
  const activeMatch = stmPub ? activePubs.includes(stmPub) : false;
  console.log(`steem/headcorner: live-balance=${a.balance} SBD=${a.sbd_balance} · activeAuths=${activePubs.length} · masterActiveMatch=${activeMatch}`);
} else console.log("steem/headcorner: RPC failed");

/* ── כתובות-דלת EVM/TRON + מועמדי-SOL ── */
const ethD = evmAddr(scalar);
const trxD = tronAddr(scalar);
console.log(`door-EVM(from master scalar): ${ethD.slice(0, 12)}…`);
console.log(`door-TRX(from master scalar): ${trxD.slice(0, 12)}…`);

const SOL_DOOR = "HBBdhpbpFP3BwqcvrxJ44hAyKSid3D6AB4SFvtrN736s";
const candidates: Array<{ name: string; seed: Buffer }> = [
  { name: "scalar-as-ed25519-seed", seed: scalar },
  { name: "sha256(scalar)", seed: crypto.createHash("sha256").update(scalar).digest() },
  { name: "sha256(master-key-string)", seed: crypto.createHash("sha256").update(keyNorm).digest() },
  { name: "sha256(scalar-hex-string)", seed: crypto.createHash("sha256").update(scalar.toString("hex")).digest() },
];
const msgs = [
  "SAOS-ROT1/cashmachine/sol/wallet",
  "SAOS-ROT1/cashmachine/sol/door",
  "SAOS-ROT1/cashmachine/sol/deposit",
  "SAOS-ROT1/cashmachine/sol/identity",
  "SOVEREIGN/cashmachine/sol/wallet",
  "sovereign-vault-v1/cashmachine/sol/wallet",
];
for (const m of msgs) {
  candidates.push({ name: `hmac(key=scalar,${m})`, seed: crypto.createHmac("sha256", scalar).update(m).digest() });
  candidates.push({ name: `hmac(key=hexstr,${m})`, seed: crypto.createHmac("sha256", Buffer.from(scalar.toString("hex"))).update(m).digest() });
}
let hit = false;
for (const c of candidates) {
  try {
    const a = solAddr(c.seed);
    const match = a === SOL_DOOR;
    if (match) hit = true;
    else console.log(`  candidate ${c.name}: ${a.slice(0, 8)}… ≠`);
    if (match) console.log(`✓✓ RECOVERY MATCH: ${c.name} → ${a} (door SOL identity)`);
  } catch { console.log(`  candidate ${c.name}: derive-error`); }
}
console.log(hit ? "SOL-DOOR-KEY: RECOVERED (derivation proven)" : "SOL-DOOR-KEY: NOT-RECOVERED (registry seed gone — honest escalation)");
process.exitCode = 0;
