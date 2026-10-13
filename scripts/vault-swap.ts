/* vault-swap.ts — EXEC-CD-27 · מנוע-ההמרה-הריבוני-מהכספת (ready-to-fire)
 *
 * הרעיון: כסף שנוחת על כתובת-כספת-הריפו (צופה-האוצר רואה אותו — EXEC-CD-26)
 * יכול-להיות-מומר עכשיו ע"י-הריבונות עצמה, מהמעטפת-המוצפנת-שבגיט — בלי-שום
 * תלות-בסנדבוקס/registry/.env. זה-הצד-שני-של-המשוואה שהציטוטים-האוניברסליים
 * (EXEC-CD-23) הוכיחו: ציטוט-חי ✓ ← עתה גם ביצוע-חי-מהכספת.
 *
 * נתיבים (שניהם הוכחו-חי בעבר בעץ-זה):
 *  · solana: Jupiter lite-api — quote → swapTransaction → פרסינג-מבוקר-MessageV0
 *    → חתימת-ed25519 (SLIP-0010 מהכספת) → simulateTransaction → send → אימות-תוצר.
 *  · evm: ParaSwap (native-ETH→ERC20 = עסקה-אחת, אין-אישור) → בניית-EIP-1559
 *    (RLP קנוני — אותו-דפוס-מוכח מrelay-eth) → חתימת-secp256k1 → sim אמת
 *    (eth_call) → send → אימות-קבלה. ERC20→* דורש approve — נתיב-נפרד מוסדר.
 *
 * כללי-בטיחות (fail-closed, הוכחו-בריצות-קודמות):
 *  · DRY-RUN כברירת-מחדל — quote+הקרנה-בלבד. --execute בלבד-שידור.
 *  · --execute דורש --i-understand-<היום> (הסכמה-מתוארכת — דפוס-sol-fleet-consolidate).
 *  · תקרות-קשיחות: SOL 0.1/עסקה · EVM 0.05-ETH/עסקה (התעלות = סירוב).
 *  · רצפות: יתרה ≥ כמות+דלק-שמור+מרווח; אאוט-פלור מול-quote; slippage 100bps.
 *  · אפס-סודות בפלט: כתובות/txid/כמויות-בלבד.
 *
 * שימוש:
 *   bun scripts/vault-swap.ts --chain solana --to USDC --amount-lamports 3000000
 *   bun scripts/vault-swap.ts --chain solana --to USDC --max --execute --i-understand-2026-10-07
 *   bun scripts/vault-swap.ts --chain evm --to USDC --max --execute --i-understand-2026-10-07
 *   bun scripts/vault-swap.ts --status   (מלאי-חי: יתרות-כספת + זמינות-המנוע)
 */
import crypto from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import bs58 from "bs58";
import { openRepoVault, verifyRepoVault } from "../src/lib/repo-vault";

/* ── קבועים-קשיחים ── */
const HARD_CAP_SOL_LAMPORTS = 100_000_000n;          // 0.1-SOL/עסקה
const HARD_CAP_EVM_WEI = 50_000_000_000_000_000n;    // 0.05-ETH/עסקה
const SOL_FEE_RESERVE = 1_500_000;                   // עמלות+compute+rent-מרווח
const EVM_GAS_RESERVE_WEI = 300_000_000_000_000n;    // ~0.0003-ETH לדלק
const SLIPPAGE_BPS = 100;
const JUP = "https://lite-api.jup.ag";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_SOL = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const SOL_RPC = "https://api.mainnet-beta.solana.com";
const ETH_RPC = "https://ethereum-rpc.publicnode.com";
const PARASWAP = "https://api.paraswap.io";
const AUGUSTUS = "0xdef1c0ded9bec7f1a1670819833240f027b25eff";
const USDC_ETH = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const USDT_ETH = "0xdac17f958d2ee523a2206206994597c13d831ec7";
const TOKENS: Record<string, Record<string, string>> = {
  solana: { USDC: USDC_SOL, USDT: USDT_SOL },
  evm: { USDC: USDC_ETH, USDT: USDT_ETH },
};
const UA = "SAOS-VaultSwap/1.0 (+sovereign-chain)";

/* ── ארגומנטים ── */
const argv = process.argv.slice(2);
const today = new Date().toISOString().slice(0, 10);
const EXECUTE = argv.includes("--execute") && argv.includes(`--i-understand-${today}`);
const STATUS = argv.includes("--status");
function argOf(flag: string): string | null {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}
const chain = argOf("--chain") as "solana" | "evm" | null;
const toSym = (argOf("--to") || "USDC").toUpperCase();
const isMax = argv.includes("--max");
const amountStr = argOf("--amount-lamports") ?? argOf("--amount-wei");

/* ── פתיחת-הכספת ── */
const t0 = Date.now();
const { bundle } = openRepoVault();
const v = verifyRepoVault();
if (!v.addressesMatch) { console.error("✖ כספת-לא-עקבית — abort"); process.exit(2); }
const der = (network: string) => {
  const d = bundle.derivations.find(x => x.network === network);
  if (!d) throw new Error(`derivation missing: ${network}`);
  return d;
};
console.log(`[vault-swap] ✓ כספת נפתחה (${Date.now() - t0}ms) · label=${v.label} · נגזרות=${bundle.derivations.length} · בלועים=${Object.keys(bundle.absorbed ?? {}).length}`);

/* ── RPC-עזרים ── */
async function jpost<T>(method: string, params: unknown[], timeoutMs = 30000): Promise<T> {
  const r = await fetch(SOL_RPC, { method: "POST", headers: { "content-type": "application/json", "user-agent": UA }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(timeoutMs) });
  const j = (await r.json()) as { result?: T; error?: { message?: string } };
  if (j.error) throw new Error(`sol-rpc ${method}: ${j.error.message?.slice(0, 120)}`);
  return j.result as T;
}
async function epost<T>(method: string, params: unknown[], timeoutMs = 25000): Promise<T> {
  const r = await fetch(ETH_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(timeoutMs) });
  const j = (await r.json()) as { result?: T; error?: { message?: string } };
  if (j.error) throw new Error(`eth-rpc ${method}: ${JSON.stringify(j.error).slice(0, 140)}`);
  return j.result as T;
}

/* ── cu16 ── */
function readCu16(b: Buffer, off: number): { val: number; len: number } {
  let val = 0, shift = 0, len = 0, byte: number;
  do { byte = b[off + len++]; val |= (byte & 0x7f) << shift; shift += 7; } while (byte & 0x80);
  return { val, len };
}

/* ── RLP קנוני (EIP-1559 — דפוס relay-eth המוכח) ── */
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
const rlpStr = (b: Uint8Array): Uint8Array => rlpWrap(Buffer.from(b), 0x80);
const rlpList = (items: Uint8Array[]): Uint8Array => rlpWrap(Buffer.concat(items.map(x => Buffer.from(x))), 0xc0);

/* ══ STATUS ══ */
if (STATUS) {
  console.log("── מלאי-חי של כספת-הריפו (קריאה-בלבד) ──");
  const solAddr = der("solana").address;
  const evmAddr = der("evm").address;
  const solBal = await jpost<number>("getBalance", [solAddr]).then(r => (typeof r === "number" ? r : (r as { value: number }).value)).catch(() => -1);
  console.log(`solana  ${solAddr}  ·  ${solBal >= 0 ? (solBal / 1e9).toFixed(9) + " SOL" : "rpc-fail"}`);
  const ethBal = await epost<string>("eth_getBalance", [evmAddr, "latest"]).then(h => BigInt(h)).catch(() => -1n);
  console.log(`evm     ${evmAddr}  ·  ${ethBal >= 0n ? (Number(ethBal) / 1e18).toFixed(9) + " ETH" : "rpc-fail"}`);
  const solReady = solBal > SOL_FEE_RESERVE + 1_000_000;
  const evmReady = ethBal > EVM_GAS_RESERVE_WEI + 1_000_000_000_000_000n;
  console.log(`engine: solana ${solReady ? "READY" : "needs-funding"} · evm ${evmReady ? "READY" : "needs-funding"}`);
  console.log("recipe: הזרימו-סכום-קטן (למשל 0.01-SOL או 0.005-ETH) אל-הכתובת-שלמעלה — צופה-האוצר יזהה-תוך-15-דק׳ והמנוע-יהיה-מוכן-לבצע-המרה-אמת.");
  process.exit(0);
}

if (!chain) { console.error("שימוש: --chain solana|evm [--to USDC] [--amount-lamports N | --amount-wei N | --max] [--status]"); process.exit(1); }

/* ══ SOLANA ══ */
async function swapSolana(): Promise<void> {
  const d = der("solana");
  if (d.privateKey.length !== 88 && !d.privateKey.includes(",")) { /* 64B base58 form */ }
  const kp = Buffer.from(bs58.decode(d.privateKey));
  if (kp.length !== 64) throw new Error("sol key form unexpected — abort");
  const seed = kp.subarray(0, 32);
  const addr = bs58.encode(Buffer.from(ed25519.getPublicKey(seed)));
  const balance = await jpost<number>("getBalance", [addr, { commitment: "confirmed" }]).then(r => (typeof r === "number" ? r : (r as { value: number }).value));
  console.log(`[sol] identity=${addr} · custody=${balance} lamports (${(balance / 1e9).toFixed(9)} SOL)`);
  const outMint = TOKENS.solana[toSym];
  if (!outMint) throw new Error(`unsupported target ${toSym} on solana (USDC/USDT only in v1)`);
  const quoteOnly = argv.includes("--quote-only");
  const inLamports = quoteOnly && amountStr ? parseInt(amountStr, 10) : isMax ? balance - SOL_FEE_RESERVE : parseInt(amountStr ?? "0", 10);
  if (!(inLamports > 0)) {
    if (isMax && balance <= SOL_FEE_RESERVE) throw new Error(`needs-funding: custody ${balance} ≤ fee-reserve ${SOL_FEE_RESERVE} — fund the vault address first (see --status)`);
    throw new Error("amount invalid (use --amount-lamports N or --max)");
  }
  if (inLamports + SOL_FEE_RESERVE > balance && !quoteOnly) throw new Error(`insufficient: ${inLamports}+reserve=${inLamports + SOL_FEE_RESERVE} > ${balance} — fund the vault address first (see --status)`);
  if (inLamports > HARD_CAP_SOL_LAMPORTS) throw new Error(`hard-cap: ${inLamports} > ${HARD_CAP_SOL_LAMPORTS} — refusing`);
  console.log(`[sol] plan: ${inLamports} lamports (${(inLamports / 1e9).toFixed(9)} SOL) → ${toSym} · slippage=${SLIPPAGE_BPS}bps · post-reserve=${balance - inLamports}`);

  const qUrl = `${JUP}/swap/v1/quote?inputMint=${SOL_MINT}&outputMint=${outMint}&amount=${inLamports}&slippageBps=${SLIPPAGE_BPS}`;
  const quote = await (await fetch(qUrl, { headers: { "user-agent": UA } })).json() as { outAmount?: string; priceImpactPct?: string };
  const out = parseInt(quote.outAmount ?? "0", 10);
  if (!(out > 0)) throw new Error("quote answered 0 — refusing");
  console.log(`[sol] quote: ${inLamports} → ${out} units ${toSym} ($${(out / 1e6).toFixed(4)}) · impact=${quote.priceImpactPct ?? "?"}`);
  if (Math.abs(parseFloat(quote.priceImpactPct ?? "0")) > 0.02) throw new Error(`price impact ${(parseFloat(quote.priceImpactPct ?? "0") * 100).toFixed(2)}% > 2% — refusing (thin pool)`);
  if (quoteOnly || !EXECUTE) { console.log(quoteOnly ? "[sol] mode: QUOTE-ONLY" : "[sol] mode: DRY-RUN (quote+projection only — rerun with --execute --i-understand-" + today + ")"); return; }

  const swapRes = await fetch(`${JUP}/swap/v1/swap`, {
    method: "POST", headers: { "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify({ quoteResponse: quote, userPublicKey: addr, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, priorityLevelWithMaxLamports: { priority: "normal", maxLamports: 200_000 } }),
  });
  const swapJson = (await swapRes.json()) as { swapTransaction?: string };
  const txB64 = swapJson.swapTransaction;
  if (!txB64) throw new Error("swap API answered without swapTransaction");
  const wire = Buffer.from(txB64, "base64");
  const { val: sigCount, len: cuLen } = readCu16(wire, 0);
  if (sigCount !== 1) throw new Error(`expected 1 required signer, got ${sigCount} — refusing to blind-sign`);
  const msg = wire.subarray(cuLen + 64 * sigCount);
  const versioned = (msg[0] & 0x80) !== 0;
  const headerOff = versioned ? 1 : 0;
  if (msg[headerOff] !== 1) throw new Error(`message nReq=${msg[headerOff]} — refusing`);
  console.log(`[sol] tx: ${wire.length}B wire · ${versioned ? "v" + (msg[0] & 0x7f) : "legacy"} · nReq=1`);
  const sig = ed25519.sign(msg, seed);
  const signed = Buffer.concat([wire.subarray(0, cuLen), Buffer.from(sig), msg]);
  if (signed.length !== wire.length) throw new Error("reassembly mismatch — refusing");
  const sim = await jpost<{ value: { err: unknown; unitsConsumed?: number; logs?: string[] } | null }>("simulateTransaction", [signed.toString("base64"), { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }]);
  if (sim?.value?.err) throw new Error(`simulation failed: ${JSON.stringify(sim.value.err).slice(0, 160)} · tail: ${(sim.value.logs ?? []).slice(-3).join(" | ").slice(0, 200)}`);
  console.log(`[sol] simulation: PASS · units=${sim?.value?.unitsConsumed ?? "?"}`);
  const txid = await jpost<string>("sendTransaction", [signed.toString("base64"), { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 }], 45000);
  console.log(`[sol] sent: ${txid}`);
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 4000));
    const st = await jpost<{ value: ({ err: unknown; confirmationStatus?: string; slot?: number } | null)[] }>("getSignatureStatuses", [[txid], { searchTransactionHistory: true }]).catch(() => null);
    const vv = st?.value?.[0];
    if (vv?.err) throw new Error(`swap failed on-chain: ${JSON.stringify(vv.err).slice(0, 140)}`);
    if (vv?.confirmationStatus === "finalized" || vv?.confirmationStatus === "confirmed") { console.log(`[sol] status: ${vv.confirmationStatus} (slot ${vv.slot})`); break; }
    if (i === 14) console.log("[sol] not visible after 60s — check explorer by txid");
  }
  let tok: { amount: string; uiAmountString: string } | null = null;
  for (let i = 0; i < 6; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const t = await jpost<{ value: { account: { data: { parsed: { info: { tokenAmount: { amount: string; uiAmountString: string } } } } } }[] | null }>("getTokenAccountsByOwner", [addr, { mint: outMint }, { encoding: "jsonParsed" }]).catch(() => null);
    tok = t?.value?.[0]?.account?.data?.parsed?.info?.tokenAmount ?? null;
    if (tok && parseInt(tok.amount, 10) > 0) break;
  }
  console.log(`[sol] RESULT: ${tok?.uiAmountString ?? "0"} ${toSym} held on vault identity (real, withdrawable) · txid=${txid}`);
}

/* ══ EVM ══ */
async function swapEvm(): Promise<void> {
  const d = der("evm");
  const priv = Buffer.from(d.privateKey.replace(/^0x/, ""), "hex");
  if (priv.length !== 32) throw new Error("evm key form unexpected — abort");
  const addr = d.address;
  const balHex = await epost<string>("eth_getBalance", [addr, "latest"]);
  const balance = BigInt(balHex);
  const nonce = BigInt(await epost<string>("eth_getTransactionCount", [addr, "pending"]));
  const gasPrice = BigInt(await epost<string>("eth_gasPrice", []));
  console.log(`[evm] identity=${addr} · balance=${Number(balance) / 1e18} ETH · nonce=${nonce} · gas=${Number(gasPrice / 10n ** 9n)}gwei`);
  const outToken = TOKENS.evm[toSym];
  if (!outToken) throw new Error(`unsupported target ${toSym} on evm (USDC/USDT only in v1)`);
  if (gasPrice > 2_000_000_000n) throw new Error(`gas ${Number(gasPrice / 10n ** 9n)}gwei > 2gwei ceiling — economic hold`);
  const quoteOnly = argv.includes("--quote-only");
  const amount = quoteOnly && amountStr ? BigInt(amountStr) : isMax ? balance - EVM_GAS_RESERVE_WEI : BigInt(amountStr ?? "0");
  if (amount <= 0n) {
    if (isMax && balance <= EVM_GAS_RESERVE_WEI) throw new Error(`needs-funding: balance ${balance} wei ≤ gas-reserve ${EVM_GAS_RESERVE_WEI} — fund the vault address first (see --status)`);
    throw new Error("amount invalid (use --amount-wei N or --max)");
  }
  if (amount + EVM_GAS_RESERVE_WEI > balance && !quoteOnly) throw new Error(`insufficient: amount+reserve > ${Number(balance) / 1e18} ETH — fund the vault address first (see --status)`);
  if (amount > HARD_CAP_EVM_WEI) throw new Error(`hard-cap: ${Number(amount) / 1e18} ETH > 0.05 — refusing`);
  console.log(`[evm] plan: ${Number(amount) / 1e18} ETH → ${toSym} · slippage=${SLIPPAGE_BPS}bps`);

  const srcToken = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"; // native ETH in ParaSwap
  /* דפוס-מוכח מ-universal.ts: GET /prices → POST /transactions/{network} */
  const q = new URLSearchParams({ srcToken, destToken: outToken, amount: amount.toString(), side: "SELL", network: "1", partner: "saos-dex" });
  const pj = await (await fetch(`${PARASWAP}/prices?${q}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000) })).json() as { priceRoute?: { destAmount?: string; srcAmount?: string; priceAmount?: string }; error?: string };
  const priceRoute = pj.priceRoute;
  if (!priceRoute?.destAmount) throw new Error(`paraswap quote failed: ${JSON.stringify(pj).slice(0, 140)}`);
  const destAmount = priceRoute.destAmount;
  console.log(`[evm] quote: ${Number(amount) / 1e18} ETH → ${Number(destAmount) / 1e6} ${toSym} (routes from ParaSwap best-route)`);
  if (quoteOnly || !EXECUTE) { console.log(quoteOnly ? "[evm] mode: QUOTE-ONLY" : "[evm] mode: DRY-RUN (quote+projection only — rerun with --execute --i-understand-" + today + ")"); return; }

  const built = await (await fetch(`${PARASWAP}/transactions/1?ignoreChecks=true`, {
    method: "POST", headers: { "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify({
      srcToken: priceRoute.srcToken, destToken: priceRoute.destToken, srcAmount: priceRoute.srcAmount,
      slippage: SLIPPAGE_BPS / 10000, priceRoute, userAddress: addr, partner: "saos-dex", ignoreChecks: true,
    }),
    signal: AbortSignal.timeout(20000),
  })).json() as { to?: string; data?: string; value?: string; gas?: string; gasPrice?: string; from?: string; error?: string };
  if (!built.to || !built.data) throw new Error(`paraswap build failed: ${JSON.stringify(built).slice(0, 140)}`);
  if (built.to.toLowerCase() !== AUGUSTUS) throw new Error(`router mismatch: ${built.to} — refusing (known-router-only policy)`);
  console.log(`[evm] tx built: router=${built.to} · data=${(built.data.length - 2) / 2}B · value=${built.value ?? "0"}`);
  if (built.value && BigInt(built.value) !== amount) throw new Error(`value mismatch: built=${built.value} vs plan=${amount} — refusing`);

  const toBytes = Buffer.from(built.to.replace(/^0x/, ""), "hex");
  const dataBytes = Buffer.from(built.data.replace(/^0x/, ""), "hex");
  const maxPriority = 1_000_000_000n;
  const maxFee = maxPriority + gasPrice * 2n;
  const gasLimit = BigInt(built.gas ?? "350000");
  const txFields = [
    rlpStr(rlpScalar(1n)), // chainId 1
    rlpStr(rlpScalar(nonce)),
    rlpStr(rlpScalar(maxPriority)),
    rlpStr(rlpScalar(maxFee)),
    rlpStr(rlpScalar(gasLimit)),
    rlpStr(toBytes),
    rlpStr(rlpScalar(BigInt(built.value ?? "0"))),
    rlpStr(dataBytes),
    rlpList([]),
  ];
  const preSign = Buffer.concat([Buffer.from([0x02]), rlpList(txFields)]);
  const sig = secp256k1.sign(keccak_256(preSign), priv, { prehash: false });
  const compact = sig.toCompactRawBytes();
  const signed = rlpList([...txFields,
    rlpStr(rlpScalar(BigInt(sig.recovery ?? 0))),
    rlpStr(rlpScalar(BigInt("0x" + Buffer.from(compact.subarray(0, 32)).toString("hex")))),
    rlpStr(rlpScalar(BigInt("0x" + Buffer.from(compact.subarray(32, 64)).toString("hex")))),
  ]);
  const raw = "0x02" + Buffer.from(signed).toString("hex");
  /* sim אמת: eth_call מאותו-חשבון (קריאה-בלבד — מדמה-את-העסקה) */
  const simErr = await epost<string | null>("eth_call", [{ from: addr, to: built.to, data: built.data, value: "0x" + BigInt(built.value ?? "0").toString(16), gas: "0x" + gasLimit.toString(16) }, "latest"], 40000);
  if (typeof simErr === "string" && simErr !== "0x") throw new Error(`eth_call sim failed: ${simErr.slice(0, 140)}`);
  console.log("[evm] eth_call simulation: PASS");
  const txid = await epost<string>("eth_sendRawTransaction", [raw], 45000);
  if (!/^0x[0-9a-f]{64}$/.test(txid)) throw new Error("broadcast answered without valid hash");
  console.log(`[evm] sent: ${txid}`);
  let receipt: { status?: string; blockNumber?: string } | null = null;
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 5000));
    receipt = await epost<{ status?: string; blockNumber?: string } | null>("eth_getTransactionReceipt", [txid]).catch(() => null);
    if (receipt?.status) break;
    if (i === 11) console.log("[evm] no receipt after 60s — check explorer");
  }
  if (receipt?.status === "0x0") throw new Error("swap reverted on-chain (honest)");
  console.log(`[evm] RESULT: ${receipt?.status === "0x1" ? "SUCCESS" : "?"} block=${receipt?.blockNumber ?? "?"} · ${Number(amount) / 1e18} ETH → ~${Number(destAmount) / 1e6} ${toSym} · verify balance via --status · txid=${txid}`);
}

try {
  if (chain === "solana") await swapSolana();
  else if (chain === "evm") await swapEvm();
  else throw new Error(`unknown chain ${chain}`);
  console.log("[vault-swap] ✓ done");
} catch (e) {
  console.error("[vault-swap] FAIL:", (e as Error).message?.slice(0, 300));
  process.exit(1);
}
