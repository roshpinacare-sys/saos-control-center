// .tmp-tools/extract-wif.mjs — stdin = secret file content; argv[2] = TARGET PUBLIC KEY.
// Emits to stdout ONLY the WIF whose derived public key === target. Nothing else. Never prints the WIF to stderr.
import crypto from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire("/home/z/my-project/package.json");
const steemLib = require("steem");
const TARGET = process.argv[2] || "";

const raw = await new Promise((res) => { let d = ""; process.stdin.on("data", (c) => (d += c)); process.stdin.on("end", () => res(d)); });
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58checkEncode(payload) {
  const h = crypto.createHash("sha256").update(crypto.createHash("sha256").update(payload).digest()).digest();
  const buf = Buffer.concat([payload, h.subarray(0, 4)]);
  let num = BigInt(0);
  for (const b of buf) num = num * BigInt(256) + BigInt(b);
  let out = "";
  while (num > BigInt(0)) { out = B58[Number(num % BigInt(58))] + out; num /= BigInt(58); }
  return out;
}
function normalize(wif) { let k = wif.trim(); if (k.length >= 2 && k[0] === "P" && /^[5KL]/.test(k[1])) k = k.slice(1); return k; }
function buggyScalarWif(wif) {
  let num = BigInt(0);
  for (const ch of wif) { const i = B58.indexOf(ch); if (i < 0) return null; num = num * BigInt(58) + BigInt(i); }
  let hex = num.toString(16); if (hex.length % 2) hex = "0" + hex;
  const bytes = Buffer.from(hex, "hex");
  const payload = bytes.subarray(0, bytes.length - 4);
  if (!payload || payload[0] !== 0x80 || payload.length !== 34 || payload[33] !== 0x01) return null;
  const scalar = payload.subarray(1, 33);
  const big = BigInt("0x" + scalar.toString("hex")) * 256n + 1n;
  let h = big.toString(16); if (h.length % 2) h = "0" + h;
  return b58checkEncode(Buffer.concat([Buffer.from([0x80]), Buffer.from(h, "hex"), Buffer.from([0x01])]));
}
const seen = new Set();
for (const m of raw.matchAll(/[5KLP][1-9A-HJ-NP-Za-km-z]{49,54}/g)) {
  const k = normalize(m[0]);
  if (seen.has(k) || !/^[5KL][1-9A-HJ-NP-Za-km-z]{50,52}$/.test(k)) continue;
  seen.add(k);
  const cands = [k, buggyScalarWif(k)].filter(Boolean);
  for (const c of cands) {
    let pub = null;
    // steem 0.7.10 prints "WARN: Expecting 32 bytes…" via console.log to STDOUT — silence during derivation
    const origLog = console.log, origWarn = console.warn;
    console.log = () => {}; console.warn = () => {};
    try { pub = steemLib.auth.wifToPublic(c); } catch { pub = null; } finally { console.log = origLog; console.warn = origWarn; }
    if (pub && pub === TARGET) { process.stdout.write(c + "\n"); process.exit(0); }
  }
}
console.error("extract-wif: NO-MATCH for target");
process.exit(3);
