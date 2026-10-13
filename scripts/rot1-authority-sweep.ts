/* rot1-authority-sweep.ts — EXEC-CD-27 · סוויפ-ROT1 מול הסמכויות החיות
 * master = headcorner.txt (WIF→scalar→hex). נגזרות: {steem,hive,blurt}×{headcorner+שני-החיים}×{active,owner,posting,memo}
 * שתי-הצורות: normalized (תקין) + buggy-raw (steem-js ישן k·256+1 — R18).
 * אפס-הדפסת-מפתחות. פלט = בוליאנים + תחיליות.
 */
import crypto from "node:crypto";
import fs from "node:fs";
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
function b58checkEncode(payload: Buffer): string {
  const h = crypto.createHash("sha256").update(crypto.createHash("sha256").update(payload).digest()).digest();
  const buf = Buffer.concat([payload, h.subarray(0, 4)]);
  let num = BigInt(0);
  for (const b of buf) num = num * BigInt(256) + BigInt(b);
  let out = "";
  while (num > BigInt(0)) { out = B58[Number(num % BigInt(58))] + out; num /= BigInt(58); }
  for (const b of buf) { if (b === 0) out = "1" + out; else break; }
  return out;
}
/* keys.ts wifFromRot1Seed — מדויק */
function wifFromRot1Seed(masterHex: string, account: string, chain: string, role: string): string {
  const h = crypto.createHmac("sha256", Buffer.from(masterHex, "hex")).update(`SAOS-ROT1/${account}/${chain}/${role}`).digest();
  const payload = Buffer.concat([Buffer.from([0x80]), h, Buffer.from([0x01])]);
  const check = crypto.createHash("sha256").update(crypto.createHash("sha256").update(payload).digest()).digest().subarray(0, 4);
  return b58checkEncode(Buffer.concat([payload, check]));
}

const raw = fs.readFileSync("/home/z/my-project/upload/headcorner.txt", "utf8");
const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const key = (lines.length > 1 ? lines[1] : lines[0]).replace(/\s+/g, "").replace(/^P(?=[5KL])/, "");
const p = b58checkDecode(key);
if (!p || p[0] !== 0x80 || p.length < 33) { console.log("master not WIF"); process.exit(1); }
const masterHex = Buffer.from(p.subarray(1, 33)).toString("hex");

/* buggy pub: steem-js 0.7.11 על WIF מכווץ K/L → scalar·256+1 mod n (R18) */
const N = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");
function buggyPubFromWif(wif: string): string | null {
  const pp = b58checkDecode(wif);
  if (!pp || pp[0] !== 0x80 || pp.length !== 34 || pp[33] !== 0x01) return null;
  const big = (BigInt("0x" + Buffer.from(pp.subarray(1, 33)).toString("hex")) * 256n + 1n) % N;
  let h = big.toString(16);
  if (h.length % 2) h = "0" + h;
  const full = Buffer.concat([Buffer.from([0x80]), Buffer.from(h.padStart(64, "0"), "hex"), Buffer.from([0x01])]);
  return steemLib.auth.wifToPublic(b58checkEncode(full));
}

const ACCOUNTS = ["headcorner", "cashmachine", "israelnews", "lsa", "wog", "macrame", "tov", "siq", "wic", "woq", "haran"];
const CHAINS = ["steem", "hive", "blurt"];
const ROLES = ["active", "owner", "posting", "memo"];

/* המפה החיה */
async function rpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(20000) });
  const j = await r.json() as { result?: unknown };
  return j.result;
}
const ENDPOINTS: Record<string, string> = { steem: "https://api.steemit.com", hive: "https://api.hive.blog", blurt: "https://rpc.blurt.world" };
const live: Record<string, Record<string, string[]>> = {};
for (const chain of CHAINS) {
  const accts = (await rpc(ENDPOINTS[chain], "condenser_api.get_accounts", [ACCOUNTS]).catch(() => null)) as Array<{ name: string; active: { key_auths: [string, number][] }; owner: { key_auths: [string, number][] }; posting: { key_auths: [string, number][] }; memo_key: string; balance: string }> | null;
  live[chain] = {};
  for (const a of accts ?? []) {
    live[chain][a.name] = {
      active: a.active.key_auths.map(k => k[0]),
      owner: a.owner.key_auths.map(k => k[0]),
      posting: a.posting.key_auths.map(k => k[0]),
      memo: [a.memo_key],
    };
    console.log(`live ${chain}/${a.name}: bal=${a.balance}`);
  }
}

console.log("\n── ROT1 sweep (norm | buggy) ──");
let hits = 0;
for (const account of ACCOUNTS) {
  for (const chain of CHAINS) {
    for (const role of ROLES) {
      const wif = wifFromRot1Seed(masterHex, account, chain, role);
      const pubN = steemLib.auth.wifToPublic(wif);
      const pubB = buggyPubFromWif(wif);
      const pubs = live[chain]?.[account]?.[role] ?? [];
      const mN = pubs.includes(pubN);
      const mB = pubB ? pubs.includes(pubB) : false;
      if (mN || mB) { hits++; console.log(`HIT ${chain}/${account}/${role}: norm=${mN} buggy=${mB} · live=${pubs[0]?.slice(0, 12)}…`); }
    }
  }
}
console.log(`\nROT1 sweep done: ${hits} hits`);
