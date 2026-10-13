import fs from "fs"; import crypto from "crypto";
import { hmac } from "@noble/hashes/hmac";
import { sha512 } from "@noble/hashes/sha2";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";

const raw = fs.readFileSync("/home/z/my-project/agent/keys/fleet_keys.enc", "utf8");
const meta = JSON.parse(fs.readFileSync("/home/z/my-project/agent/keys/fleet_keys.meta.json", "utf8"));
const payload = Buffer.from(raw.replace(/^SAOS-FLEET-VAULT-1/, "").replace(/\s+/g, ""), "hex");
const key = crypto.scryptSync(meta.pass, payload.subarray(0, 16), 32);
const d = crypto.createDecipheriv("aes-256-gcm", key, payload.subarray(16, 28));
d.setAuthTag(payload.subarray(28, 44));
const fj = JSON.parse(Buffer.concat([d.update(payload.subarray(44)), d.final()]).toString("utf8"));
const ws = JSON.parse(fj.files["keys/wallets-seed.json"]);
const seedStr = String(ws.seed ?? "");
const isHex = /^[0-9a-f]+$/.test(seedStr);
const words = seedStr.split(/\s+/).length;
console.log("seed fmt: len", seedStr.length, isHex ? "hex" : (words >= 12 ? `mnemonic(${words} words)` : "other"));

let masterSeed: Buffer;
if (isHex) masterSeed = Buffer.from(seedStr, "hex");
else {
  const salt = "mnemonic" + String(ws.passphrase ?? "");
  masterSeed = Buffer.from(crypto.pbkdf2Sync(seedStr, salt, 2048, 64, "sha512"));
}
console.log("masterSeed bytes:", masterSeed.length);

function slip10Ed25519(seed: Buffer, path: number[]): { kL: Buffer; cC: Buffer } {
  let I = hmac(sha512, Buffer.from("ed25519 seed"), seed);
  let kL = Buffer.from(I.slice(0, 32));
  let cC = Buffer.from(I.slice(32, 64));
  for (const idx of path) {
    const hi = (idx + 0x80000000) >>> 0;
    const data = Buffer.concat([Buffer.from([0]), kL, Buffer.from([(hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff])]);
    I = hmac(sha512, cC, data);
    kL = Buffer.from(I.slice(0, 32));
    cC = Buffer.from(I.slice(32, 64));
  }
  return { kL, cC };
}

// registry EVM wallets were m/44'/60'/0'/0/idx — verify our seed reproduces headcorner EVM address (idx=2)
const secp = await import("@noble/curves/secp256k1");
function evmAddrFromSeed(seed: Buffer, path: number[]): string {
  let I = hmac(sha512, Buffer.from("Bitcoin seed"), seed);
  let kL = Buffer.from(I.slice(0, 32)); let cC = Buffer.from(I.slice(32, 64));
  for (const idx of path) {
    const hard = idx >= 0x80000000;
    const data = hard
      ? Buffer.concat([Buffer.from([0]), kL, Buffer.from([idx >>> 24 & 0xff, idx >>> 16 & 0xff, idx >>> 8 & 0xff, idx & 0xff])])
      : Buffer.concat([Buffer.from(secp.secp256k1.getPublicKey(new Uint8Array(kL), true)), Buffer.from([idx >>> 24 & 0xff, idx >>> 16 & 0xff, idx >>> 8 & 0xff, idx & 0xff])]);
    I = hmac(sha512, cC, data);
    kL = Buffer.from(I.slice(0, 32)); cC = Buffer.from(I.slice(32, 64));
  }
  const pub = secp.secp256k1.getPublicKey(new Uint8Array(kL), false);
  const hash = crypto.createHash("keccak256").update(Buffer.from(pub).subarray(1)).digest();
  return "0x" + hash.subarray(12).toString("hex");
}

const wr = JSON.parse(fj.files["keys/wallets-registry.json"]);
const hc = (wr.accounts ?? []).find((a: { agent: string }) => a.agent === "headcorner");
const expectedEvm = hc?.evm?.address;
const ethPk = hc?.evm?.pk ? String(hc.evm.pk).replace(/^0x/, "") : null;
console.log("registry headcorner evm address:", expectedEvm);
if (ethPk) {
  const pub = secp.secp256k1.getPublicKey(new Uint8Array(Buffer.from(ethPk, "hex")), false);
  const hash = crypto.createHash("keccak256").update(Buffer.from(pub).subarray(1)).digest();
  const addr = "0x" + hash.subarray(12).toString("hex");
  console.log("derived-from-pk address:", addr, "MATCH:", addr.toLowerCase() === String(expectedEvm).toLowerCase());
}

// SOL via SLIP-0010 m/44'/501'/0'/0'/2'
const sol = slip10Ed25519(masterSeed, [44, 501, 0, 0, 2]);
const solAddr = bs58.encode(new Uint8Array(ed25519.getPublicKey(new Uint8Array(sol.kL))));
console.log("SOL-DERIVED headcorner(2'): address:", solAddr);

// write keys into saos-dex/.env without printing them
const envPath = "/home/z/my-project/saos-dex/.env";
let envTxt = fs.readFileSync(envPath, "utf8");
const setEnv = (txt: string, k: string, v: string): string => {
  const re = new RegExp(`^${k}=.*$`, "m");
  if (re.test(txt)) return txt.replace(re, `${k}=${v}`);
  return txt.trimEnd() + "\n" + `${k}=${v}\n`;
};
if (ethPk) envTxt = setEnv(envTxt, "ETH_PRIVATE_KEY", "0x" + ethPk);
if (expectedEvm) envTxt = setEnv(envTxt, "ETH_EXPECTED_ADDRESS", String(expectedEvm));
envTxt = setEnv(envTxt, "SOL_PRIVATE_KEY", Buffer.from(sol.kL).toString("hex"));
envTxt = setEnv(envTxt, "SOL_EXPECTED_ADDRESS", solAddr);
fs.writeFileSync(envPath, envTxt, { mode: 0o600 });
console.log("ENV-UPDATED: ETH/SOL key slots written to saos-dex/.env (no values printed)");
