// .tmp-tools/steem-posting-test.mjs — read-only authority test. stdin = secret file content.
// Prints ONLY booleans + pub-key prefixes. No broadcast. No secret output. No disk writes.
import crypto from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire("/home/z/my-project/package.json");
const steemLib = require("steem");

const raw = await new Promise((res) => {
  let d = "";
  process.stdin.on("data", (c) => (d += c));
  process.stdin.on("end", () => res(d));
});
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function rawB58Decode(wif) {
  let num = BigInt(0);
  for (const ch of wif) { const i = B58.indexOf(ch); if (i < 0) return null; num = num * BigInt(58) + BigInt(i); }
  let hex = num.toString(16); if (hex.length % 2) hex = "0" + hex;
  const bytes = Buffer.from(hex, "hex");
  const payload = bytes.subarray(0, bytes.length - 4);
  const check = bytes.subarray(bytes.length - 4);
  const h = crypto.createHash("sha256").update(crypto.createHash("sha256").update(payload).digest()).digest();
  return h.subarray(0, 4).equals(check) ? payload : null;
}
function b58checkEncode(payload) {
  const h = crypto.createHash("sha256").update(crypto.createHash("sha256").update(payload).digest()).digest();
  const buf = Buffer.concat([payload, h.subarray(0, 4)]);
  let num = BigInt(0);
  for (const b of buf) num = num * BigInt(256) + BigInt(b);
  let out = "";
  while (num > BigInt(0)) { out = B58[Number(num % BigInt(58))] + out; num /= BigInt(58); }
  return out;
}
function buggyScalarWif(wif) {
  const p = rawB58Decode(wif);
  if (!p || p[0] !== 0x80 || p.length !== 34 || p[33] !== 0x01) return null;
  const scalar = p.subarray(1, 33);
  const big = BigInt("0x" + scalar.toString("hex")) * 256n + 1n;
  let h = big.toString(16);
  if (h.length % 2) h = "0" + h;
  return b58checkEncode(Buffer.concat([Buffer.from([0x80]), Buffer.from(h, "hex"), Buffer.from([0x01])]));
}
function normalize(wif) {
  let k = wif.trim();
  if (k.length >= 2 && k[0] === "P" && /^[5KL]/.test(k[1])) k = k.slice(1);
  return k;
}
function wifPub(wif) { try { return steemLib.auth.wifToPublic(wif); } catch { return null; } }

// global WIF scan (handles text or JSON formats)
const seen = new Set();
const candidates = [];
const re = /[5KLP][1-9A-HJ-NP-Za-km-z]{49,54}/g;
for (const m of raw.matchAll(re)) {
  const k = normalize(m[0]);
  if (seen.has(k)) continue;
  seen.add(k);
  if (!/^[5KL][1-9A-HJ-NP-Za-km-z]{50,52}$/.test(k)) continue;
  candidates.push({ src: "scan", wif: k });
  const bg = buggyScalarWif(k);
  if (bg) candidates.push({ src: "buggy-scalar", wif: bg });
}
console.error(`wif-candidates=${candidates.length}`);

async function rpc(url, method, params) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(25000) });
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 120));
  return j.result;
}

const ACC = "headcorner";
async function testChain(url, label) {
  const accts = await rpc(url, "condenser_api.get_accounts", [[ACC]]);
  const a = accts && accts[0];
  if (!a) { console.log(`${label}: NO-ACCOUNT`); return; }
  const auth = {
    posting: new Set(a.posting.key_auths.map((x) => x[0])),
    active: new Set(a.active.key_auths.map((x) => x[0])),
    owner: new Set(a.owner.key_auths.map((x) => x[0])),
  };
  console.error(`${label} ${ACC}: posting=${auth.posting.size} active=${auth.active.size} owner=${auth.owner.size} bal=${a.balance}/${a.sbd_balance}`);
  let any = false;
  for (let i = 0; i < candidates.length; i++) {
    const pub = wifPub(candidates[i].wif);
    if (!pub) continue;
    const hits = [];
    if (auth.posting.has(pub)) hits.push("POSTING");
    if (auth.active.has(pub)) hits.push("ACTIVE");
    if (auth.owner.has(pub)) hits.push("OWNER");
    if (pub === a.memo_key) hits.push("MEMO");
    if (hits.length) { any = true; console.log(`MATCH ${label} [${candidates[i].src}#${i}] -> ${hits.join("+")} pub=${pub.slice(0, 12)}…`); }
  }
  if (!any) console.log(`NO-${label}-MATCH`);
}
await testChain("https://api.steemit.com", "steem").catch((e) => console.log(`steem-test-error: ${String(e).slice(0, 120)}`));
await testChain("https://api.hive.blog", "hive").catch((e) => console.log(`hive-test-error: ${String(e).slice(0, 120)}`));
console.log("TEST-DONE");
