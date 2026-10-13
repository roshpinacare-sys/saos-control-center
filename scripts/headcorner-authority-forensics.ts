/* headcorner-authority-forensics.ts — EXEC-CD-27 · שתי-צורות-המפתח מול הסמכויות החיות
 * קלט: upload/headcorner.txt (לעולם לא נדפס). פלט: בוליאנים + תחיליות-pub.
 */
import fs from "node:fs";
import crypto from "node:crypto";
import steemLibRaw from "steem";

interface SteemAuth { auth: { wifToPublic(wif: string): string } }
const steemLib = steemLibRaw as unknown as SteemAuth;

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function wifPubRaw(wif: string): string { return steemLib.auth.wifToPublic(wif.trim()); }
function normalize(wif: string): string {
  let k = wif.trim();
  if (k.length >= 2 && k[0] === "P" && /^[5KL]/.test(k[1])) k = k.slice(1);
  return k;
}

/* raw-form derivation: strip compression flag then re-derive (mirror of keys.ts) */
function rawB58Decode(wif: string): Buffer | null {
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
  let pad = 0; const bs = buf.toString("hex");
  for (const b of buf) { if (b === 0) { pad++; out = "1" + out; } else break; }
  void bs;
  return out;
}

const raw = fs.readFileSync("/home/z/my-project/upload/headcorner.txt", "utf8");
const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const key = normalize(lines.length > 1 ? lines[1] : lines[0]);

/* שתי הצורות: normalized (מדעת) ו-raw (k·256+1 — steem-js ישן) */
const pubNormalized = wifPubRaw(key); // steem-js מייצר compressed — הצורה התקנית
/* צורת-raw: אם ה-WIF מתחיל ב-K/L (מכווץ) — steem-js ישן הזין את כל-33 הבייטים */
let pubRaw: string | null = null;
const payload = rawB58Decode(key);
if (payload && payload[0] === 0x80 && payload.length === 34 && payload[33] === 0x01) {
  const buggy = Buffer.concat([payload.subarray(0, 33)]); // כולל דגל-המיצוק
  const buggyWif = b58checkEncode(Buffer.concat([Buffer.from([0x80]), buggy.subarray(1).length === 32 ? buggy.subarray(1) : buggy.subarray(1)]));
  void buggyWif;
  try { pubRaw = steemLib.auth.wifToPublic(key); } catch { pubRaw = null; }
}
/* הצורה-הגולמית-באמת: k·256+1 כסקלר — בונים WIF-חדש עם הסקלר-המורחב */
function buggyScalarWif(wif: string): string | null {
  const p = rawB58Decode(wif);
  if (!p || p[0] !== 0x80 || p.length !== 34 || p[33] !== 0x01) return null;
  const scalar = p.subarray(1, 33);
  const big = BigInt("0x" + scalar.toString("hex")) * 256n + 1n;
  let h = big.toString(16);
  if (h.length % 2) h = "0" + h;
  const full = Buffer.concat([Buffer.from([0x80]), Buffer.from(h, "hex"), Buffer.from([0x01])]);
  return b58checkEncode(full);
}
const buggyWif = buggyScalarWif(key);
const pubBuggy = buggyWif ? wifPubRaw(buggyWif) : null;

console.log(`pubNormalized=${pubNormalized.slice(0, 10)}… pubBuggy=${pubBuggy ? pubBuggy.slice(0, 10) + "…" : "n/a"}`);

async function rpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(20000) });
  const j = await r.json() as { result?: unknown };
  return j.result;
}
interface AcctShape { active: { key_auths: [string, number][] }; owner: { key_auths: [string, number][] }; posting: { key_auths: [string, number][] }; memo_key: string; balance: string; sbd_balance: string }

const steemAccts = (await rpc("https://api.steemit.com", "condenser_api.get_accounts", [["headcorner"]])) as AcctShape[] | null;
if (steemAccts?.[0]) {
  const a = steemAccts[0];
  for (const [role, pubs] of [["active", a.active.key_auths.map(k => k[0])], ["owner", a.owner.key_auths.map(k => k[0])], ["posting", a.posting.key_auths.map(k => k[0])], ["memo", [a.memo_key]]] as const) {
    const mN = pubNormalized ? pubs.includes(pubNormalized) : false;
    const mB = pubBuggy ? pubs.includes(pubBuggy) : false;
    console.log(`STEEM headcorner/${role}: normMatch=${mN} buggyMatch=${mB} · live=${pubs[0]?.slice(0, 10) ?? "?"}…`);
  }
  console.log(`STEEM headcorner: balance=${a.balance} sbd=${a.sbd_balance}`);
}
const hiveAccts = (await rpc("https://api.hive.blog", "condenser_api.get_accounts", [["headcorner"]])) as AcctShape[] | null;
if (hiveAccts?.[0]) {
  const a = hiveAccts[0];
  for (const [role, pubs] of [["active", a.active.key_auths.map(k => k[0])], ["owner", a.owner.key_auths.map(k => k[0])], ["posting", a.posting.key_auths.map(k => k[0])], ["memo", [a.memo_key]]] as const) {
    const mN = pubNormalized ? pubs.includes(pubNormalized) : false;
    const mB = pubBuggy ? pubs.includes(pubBuggy) : false;
    console.log(`HIVE headcorner/${role}: normMatch=${mN} buggyMatch=${mB}`);
  }
  console.log(`HIVE headcorner: balance=${a.balance} hbd=${a.sbd_balance}`);
}
const blurtAccts = (await rpc("https://rpc.blurt.world", "condenser_api.get_accounts", [["headcorner"]]).catch(() => null)) as AcctShape[] | null;
if (blurtAccts?.[0]) {
  const a = blurtAccts[0];
  const pubsA = a.active.key_auths.map(k => k[0]);
  const mN = pubNormalized ? pubsA.includes(pubNormalized) : false;
  const mB = pubBuggy ? pubsA.includes(pubBuggy) : false;
  console.log(`BLURT headcorner/active: normMatch=${mN} buggyMatch=${mB} · balance=${a.balance}`);
}
