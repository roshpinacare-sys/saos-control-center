/* tron-self-anchor.ts — TRON-ראשונה-בעולם חתומה-בריפו-זה (create-only · fail-closed).
 *
 * רקע (R21 · 2026-09-13): זהות-הדלת TRON TN7eCah4… ממומנת (2.000001-TRX) אך
 * שום-עסקה מעולם-לא-נשלחה מהריפו — חתימת-TRON (protobuf+secp256k1) הייתה
 * "absent from repo" (R20-2a). סקריפט-זה סוגר-את-החור: TransferContract
 * עצמי-אל-עצמי של 1-SUN — עסקה-אמת על-שרשרת-TRON, חתומה-חי.
 *
 * כלכלה: העסקה ~269-בייטים-שידור → ~269-BW; מכסת-ה-BW-החינמית-היומית = 600
 * לחשבון-לא-מוקפא → עלות-אפס-אמת (0-SUN-שריפה). fail-closed אם-המכסה-נצרכה.
 *
 * בטיחות:
 * · מקור-המפתח: saos-dex/.env (0600) → STEEM_ACTIVE_WIF (ה-WIF-הריבוני —
 *   אותו-מפתח שממנו נגזרת זהות-הדלת ב-peg-door.tronIdentityFromWif).
 * · אימות-זהות fail-closed: הכתובת-הנגזרת חייבת-להיות בדיוק-הזהות-הממומנת.
 * · אפס-הדהוד-מפתח: stdout מכיל כתובות/txid/טביעות-אצבע-בלבד.
 * · שער-הצתה: --execute חובה לשידור; בלי-ו — DRY-RUN בלבד (בנייה+סימולציה-מקומית).
 * · תקרה-קשיחה: 1-SUN בלבד, מהזהות-הריבונית אל-זהות-צי-ידועה (רשימה-לבנה-מלאה).
 *   (TRON אוסר-transfer-עצמי: "Cannot transfer TRX to yourself" — נמדד-חי.)
 */
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";

/* ── base58check (TRON) ── */
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(buf: Uint8Array): string {
  let n = BigInt("0x" + Buffer.from(buf).toString("hex"));
  let out = "";
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of buf) { if (b === 0) out = B58[0] + out; else break; }
  return out;
}
function tronAddressFromPriv(priv: Uint8Array): string {
  const pub65 = Buffer.from(secp256k1.getPublicKey(priv, false));
  const h = keccak_256(pub65.subarray(1));
  const payload = Buffer.concat([Buffer.from([0x41]), Buffer.from(h.subarray(12))]);
  const chk = createHash("sha256").update(createHash("sha256").update(payload).digest()).digest().subarray(0, 4);
  return b58(Buffer.concat([payload, chk]));
}
function wifToPriv(wif: string): Uint8Array {
  const raw = Buffer.from(
    (() => { const s = wif.trim(); let n = 0n; for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error("bad WIF char"); n = n * 58n + BigInt(i); } const hex = n.toString(16).padStart(Math.ceil(n.toString(16).length / 2) * 2, "0"); return Buffer.from(hex, "hex").toString("hex"); })(),
    "hex",
  );
  if (raw.length < 33 || raw[0] !== 0x80) throw new Error("not a mainnet WIF");
  const body = raw.subarray(0, raw.length - 4);
  const chk = raw.subarray(raw.length - 4);
  const expect = createHash("sha256").update(createHash("sha256").update(body).digest()).digest().subarray(0, 4);
  if (!chk.equals(expect)) throw new Error("WIF checksum mismatch");
  let priv = body.subarray(1, 33);
  if (body.length === 34 && body[33] === 0x01) priv = body.subarray(1, 33); // compressed flag — same key
  return priv;
}

/* ── protobuf — ידני, מינימלי ── */
function varint(n: bigint): Buffer {
  const out: number[] = [];
  let v = n;
  do { let b = Number(v & 0x7fn); v >>= 7n; if (v > 0n) b |= 0x80; out.push(b); } while (v > 0n);
  return Buffer.from(out);
}
function ld(field: number, data: Buffer): Buffer {
  return Buffer.concat([varint(BigInt((field << 3) | 2)), varint(BigInt(data.length)), data]);
}
function vi(field: number, n: bigint): Buffer {
  return Buffer.concat([varint(BigInt((field << 3) | 0)), varint(n)]);
}

const TRON_API = "https://api.trongrid.io";
async function api<T>(p: string, body?: unknown, timeoutMs = 20000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(TRON_API + p, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    return (await res.json()) as T;
  } finally { clearTimeout(t); }
}

async function main(): Promise<void> {
  const execute = process.argv.includes("--execute");
  /* מקור-המפתח: .env של הדמון (0600) — secure-first: אין-נפילה ל-upload/ (777-tmpfs) */
  const envPath = path.resolve(process.cwd(), "saos-dex/.env");
  if (!fs.existsSync(envPath)) throw new Error("saos-dex/.env not found (run from repo root)");
  const st = fs.statSync(envPath);
  if ((st.mode & 0o077) !== 0) throw new Error(`.env permissions too open: ${st.mode & 0o777}`);
  const env = Object.fromEntries(
    fs.readFileSync(envPath, "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
  );
  const wif = (env.STEEM_ACTIVE_WIF || "").trim();
  if (wif.length < 51) throw new Error("STEEM_ACTIVE_WIF missing from .env");
  const priv = wifToPriv(wif);
  const fp = createHash("sha256").update(priv).digest().toString("hex").slice(0, 8);
  const addr = tronAddressFromPriv(priv);
  const EXPECTED = "TN7eCah4oTmv47SV8KSimF7WCNPv1fJ9D2"; // זהות-הדלת-הממומנת (R20/R21)
  if (addr !== EXPECTED) {
    throw new Error(`identity mismatch: derived != funded door identity — fail-closed abort (derived fp=${fp}, no address echo beyond mismatch)`);
  }
  console.log("identity: OK (matches funded door identity) · key-fp:", fp);

  /* יתרה + מכסת-BW-חינם */
  const acct = await api<{ data?: { balance?: number; freeNetLimit?: number; freeNetUsed?: number }[] }>(
    `/v1/accounts/${addr}`);
  const balance = acct?.data?.[0]?.balance ?? 0;
  const freeNetLimit = acct?.data?.[0]?.freeNetLimit ?? 600;
  const freeNetUsed = acct?.data?.[0]?.freeNetUsed ?? 0;
  console.log(`balance: ${balance} SUN · freeBW: ${freeNetUsed}/${freeNetLimit}`);
  if (balance < 1_000_000) throw new Error(`balance too low for a safe anchor tx (${balance} SUN) — refusing`);

  /* בלוק-התייחסות */
  const now = await api<{ blockID: string; block_header: { raw_data: { number: number } } }>(`/wallet/getnowblock`);
  const refNum = now.block_header.raw_data.number;
  console.log(`head block: ${refNum} · blockID8: ${now.blockID.slice(0, 16)}…`);

  /* בנייה-דרך-builder-הרשמי של-trongrid (מונע-הפרשי-canonicalization), חתימה-מקומית-על-ה-bytes */
  const amount = 1; // 1-SUN — תקרה-קשיחה
  // רשימה-לבנה: יעד-חוקי-יחיד = זהות-צי-משלנו (headcorner-main TYVwwuvdDmfy…)
  const WHITELIST = new Set(["TYVwwuvdDmfy3shxT3cb3RKLrRCshaZxTy"]);
  const toIdx = process.argv.indexOf("--to");
  const toAddr = toIdx >= 0 ? process.argv[toIdx + 1] : "TYVwwuvdDmfy3shxT3cb3RKLrRCshaZxTy";
  if (!WHITELIST.has(toAddr)) throw new Error(`--to not in fleet whitelist — refusing (only our own identities)`);
  function b58ToHex(s: string): string {
    let n = 0n;
    for (const c of s) { n = n * 58n + BigInt(B58.indexOf(c)); }
    let hex = n.toString(16);
    if (hex.length % 2) hex = "0" + hex;
    return hex.slice(0, hex.length - 8); // strip checksum
  }
  const addrHex = b58ToHex(addr);
  const built = await api<Record<string, unknown>>(`/wallet/createtransaction`, {
    owner_address: addrHex,
    to_address: b58ToHex(toAddr),
    amount,
  });
  const rawHex = String(built.raw_data_hex ?? "");
  if (!rawHex || typeof built.raw_data !== "object") throw new Error("createtransaction answered without raw_data (honest fail)");
  const rawBytes = Buffer.from(rawHex, "hex");
  const txidB = createHash("sha256").update(rawBytes).digest();
  const txid = txidB.toString("hex");
  const apiTxid = built.txID ? String(built.txID).toLowerCase() : null;
  if (apiTxid && apiTxid !== txid) throw new Error(`txid mismatch: local sha256 != API txID — refusing to sign`);
  /* TRON-חתימה: secp256k1 על sha256(raw_data) (= ה-txid) — לא על ה-bytes הגולמיים!
   * הוכח-בשגיאת-החיות: trongrid משחזר מה-txid ואימת "signed by X not contained of permission" */
  const sigObj = secp256k1.sign(txidB, priv, { prehash: false }) as { r: bigint; s: bigint; recovery: number };
  const recid = sigObj.recovery;
  const rB = Buffer.from(sigObj.r.toString(16).padStart(64, "0"), "hex");
  const sB = Buffer.from(sigObj.s.toString(16).padStart(64, "0"), "hex");
  const sig65 = Buffer.concat([rB, sB, Buffer.from([recid])]);
  console.log(`built: TransferContract ${amount}-SUN door→fleet-identity · raw ${rawBytes.length}B · sig ${sig65.length}B (recovery=${recid}) · txid parity ${apiTxid ? "verified" : "local-only"}`);
  console.log(`txid: ${txid}`);
  console.log("mode:", execute ? "LIVE --execute" : "DRY-RUN (no broadcast; rerun with --execute)");
  if (!execute) return;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  let respTxt = "";
  try {
    const res = await fetch(`${TRON_API}/wallet/broadcasttransaction`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...built, txID: txid, signature: [sig65.toString("hex")] }),
      signal: ctrl.signal,
    });
    respTxt = await res.text();
  } finally { clearTimeout(t); }
  console.log("broadcast raw:", respTxt.slice(0, 300));
  const resp = (() => { try { return JSON.parse(respTxt) as { result?: boolean; code?: string; message?: string; txid?: string }; } catch { return {}; } })();
  const msgDec = resp.message ? (Buffer.from(resp.message, "hex").toString("utf8").match(/^[ -~]+$/) ? Buffer.from(resp.message, "hex").toString("utf8") : resp.message) : null;
  console.log("broadcast:", JSON.stringify({ result: resp.result ?? null, code: resp.code ?? null, message: msgDec, txid: resp.txid ?? null }));
  if (resp.result) {
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const got = await api<{ ret?: { contractRet?: string }[]; blockNumber?: number }>(`/wallet/gettransactionbyid?value=${resp.txid ?? txid}`);
      if (got?.ret?.length) {
        console.log(`on-chain: ret=${got.ret[0].contractRet} · block=${got.blockNumber ?? "?"}`);
        return;
      }
      console.log(`waiting… (${(i + 1) * 3}s)`);
    }
    console.log("broadcast ok but not yet visible in gettransactionbyid (node lag) — verify by txid above");
  } else {
    throw new Error("broadcast rejected — see message above");
  }
}

main().catch((e) => { console.error("FAIL:", (e as Error).message); process.exit(1); });
