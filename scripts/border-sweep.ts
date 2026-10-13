// ═══ CROSS-THE-BORDER · המעבר-האמיתי: סוויפ-כספים-חיים-אל-כספת-הריבונות ═══
// EXEC-CD-29 — הוראת-המפעיל: "בצע דחוף... תראה איך עוברים את הגבול... יש לך הכל".
//
// מה שמבוצע כאן (הכל-חי, על-שרשרות-אמיתיות, חתום-מהכספת-המפוענחת-בזיכרון):
//  1. SOL: HBBdhpbp (דלת-SOL, 0.0605 SOL) + 9knfnFML (headcorner, 0.0010) → hYWKEi (כספת)
//  2. TRON: TYVwwuvd + TN7eCah4 + TAzZZkrw + TG6Srs → TPFmkf (כספת)
//  3. HIVE: headcorner → cashmachine (סמכות-active חיה — העברה-אמת)
//
// בטיחות: יעדים-לבנים-בלבד (כספת + חייל-שלנו) · אימות-זהות fail-closed לכל-מקור ·
// אבק-מינימלי-נשאר · --execute חייב --i-understand-<היום> · אפס-הדהוד-סודות.
//
// הרצה: bun scripts/border-sweep.ts [--execute --i-understand-YYYY-MM-DD]
import crypto from 'crypto';
import fs from 'fs';
import { openRepoVault } from '../src/lib/repo-vault';
import { decodeFleetEnc } from '../src/lib/fleet-keys-decode';
import { Connection, Keypair, SystemProgram, Transaction, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction } from '@solana/web3.js';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3.js';
import bs58 from 'bs58';
import steem from 'steem';

const MAGIC = 'SAOS-FLEET-VAULT-1';
const EXECUTE = process.argv.includes('--execute') && process.argv.includes(`--i-understand-${new Date().toISOString().slice(0, 10)}`);
const SOL_VAULT = 'hYWKEiQb5VV9HjQWiNMakJFZBm2UkuRZLrkDqrCLqDj';
const TRON_VAULT = 'TPFmkfW6CbnPTSMaMkSS6xPgh7aRDE4zjH';
const DEST_WHITELIST = new Set([SOL_VAULT, TRON_VAULT, 'hcsoldier4', 'cashmachine']);
const TRON_API = 'https://api.trongrid.io';

function shortLog(s: string): string { return s.length > 46 ? s.slice(0, 14) + '…' + s.slice(-8) : s; }

// ── open the vault ──
const { bundle } = openRepoVault();
const ab = bundle.absorbed ?? {};
// T-64: פענוח-סובלני (base64-עטוף וגם-ישיר) — התיקון-מהביקורת-באפס-אמון (payload=0→INVALID-IV)
const payload = decodeFleetEnc(String(ab['fleet-keys-enc'] ?? ab['fleet-keys-enc-a'] ?? ''));
const meta = JSON.parse(ab['fleet-keys-meta']) as { pass: string };
const fkey = crypto.scryptSync(meta.pass, payload.subarray(0, 16), 32);
const d = crypto.createDecipheriv('aes-256-gcm', fkey, payload.subarray(16, 28));
d.setAuthTag(payload.subarray(28, 44));
const fleet = JSON.parse(Buffer.concat([d.update(payload.subarray(44)), d.final()]).toString('utf8')) as { files: Record<string, string> };

// ── key sources (in-memory only) ──
const reg = JSON.parse(ab['wallets-registry']) as { accounts: Array<{ agent?: string; sol?: { address?: string; pk?: string }; tron?: { address?: string; pk?: string } }> };
const regBy = new Map(reg.accounts.map(a => [a.agent ?? '', a]));
// TRON TYVwwuvd key: hex64 inside vault.json text
function findHexPrivFor(target: string, texts: Array<[string, string]>): Uint8Array | null {
  for (const [, txt] of texts) {
    for (const h of txt.match(/\b[a-fA-F0-9]{64}\b/g) ?? []) {
      try {
        const priv = Buffer.from(h, 'hex');
        const pub65 = Buffer.from(secp256k1.getPublicKey(priv, false));
        const h2 = keccak_256(pub65.subarray(1));
        const p2 = Buffer.concat([Buffer.from([0x41]), Buffer.from(h2.subarray(12))]);
        const chk = crypto.createHash('sha256').update(crypto.createHash('sha256').update(p2).digest()).digest().subarray(0, 4);
        if (bs58.encode(Buffer.concat([p2, chk])) === target) return priv;
      } catch { /* skip */ }
    }
  }
  return null;
}
function findWifPrivFor(target: string, texts: Array<[string, string]>): Uint8Array | null {
  for (const [, txt] of texts) {
    for (const w of txt.match(/\b[15KL][1-9A-HJ-NP-Za-km-z]{50,51}\b/g) ?? []) {
      try {
        const rawB = bs58.decode(w.trim());
        const priv = rawB.subarray(1, 33);
        const pub65 = Buffer.from(secp256k1.getPublicKey(priv, false));
        const h2 = keccak_256(pub65.subarray(1));
        const p2 = Buffer.concat([Buffer.from([0x41]), Buffer.from(h2.subarray(12))]);
        const chk = crypto.createHash('sha256').update(crypto.createHash('sha256').update(p2).digest()).digest().subarray(0, 4);
        if (bs58.encode(Buffer.concat([p2, chk])) === target) return priv;
      } catch { /* skip */ }
    }
  }
  return null;
}
function tronFromPriv(priv: Uint8Array): string {
  const pub65 = Buffer.from(secp256k1.getPublicKey(priv, false));
  const h2 = keccak_256(pub65.subarray(1));
  const p2 = Buffer.concat([Buffer.from([0x41]), Buffer.from(h2.subarray(12))]);
  const chk = crypto.createHash('sha256').update(crypto.createHash('sha256').update(p2).digest()).digest().subarray(0, 4);
  return bs58.encode(Buffer.concat([p2, chk]));
}
function b58ToHex(s: string): string {
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt('123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'.indexOf(c));
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  return hex.slice(0, hex.length - 8);
}

// ══════════ 1) SOL sweeps ══════════
console.log('═══ 1) SOL → כספת hYWKEi ═══');
const conn = new Connection('https://api.mainnet-beta.solana.com', { commitment: 'confirmed' });
const vaultPub = new PublicKey(SOL_VAULT);
if (!DEST_WHITELIST.has(SOL_VAULT)) throw new Error('vault not whitelisted');
for (const agent of ['cashmachine', 'headcorner']) {
  try {
  const a = regBy.get(agent);
  const seedHex = a?.sol?.pk?.replace(/^0x/, '') ?? '';
  if (seedHex.length !== 64) { console.log(`[SOL] ${agent}: no pk — skip`); continue; }
  const kp = Keypair.fromSeed(Buffer.from(seedHex, 'hex'));
  if (kp.publicKey.toBase58() !== a?.sol?.address) throw new Error(`SOL identity mismatch for ${agent} — fail-closed`);
  const bal = await conn.getBalance(kp.publicKey);
  const fee = 5000;
  const sendLamports = bal - fee;
  if (sendLamports <= 0) { console.log(`[SOL] ${agent}: balance ${bal} too low — skip`); continue; }
  console.log(`[SOL] ${agent} ${shortLog(kp.publicKey.toBase58())} → vault · send ${sendLamports} lamports (${(sendLamports / LAMPORTS_PER_SOL).toFixed(9)} SOL) of ${bal}`);
  if (!EXECUTE) { console.log('[SOL]   DRY-RUN — בנוי ולא נשלח. הרץ עם --execute --i-understand-<היום>'); continue; }
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: vaultPub, lamports: sendLamports }));
  const sig = await sendAndConfirmTransaction(conn, tx, [kp], { commitment: 'confirmed', maxRetries: 5 });
  const st = await conn.getSignatureStatus(sig);
  console.log(`[SOL] ✓✓ ON-CHAIN tx: https://solscan.io/tx/${sig} · status=${st.value?.[0]?.confirmationStatus ?? 'pending'}`);
  } catch (e) { console.log(`[SOL] ${agent}: ${String(e).slice(0, 110)} — continuing`); }
}

// ══════════ 2) TRON sweeps ══════════
console.log('═══ 2) TRON → כספת TPFmkf ═══');
async function tronSweep(name: string, priv: Uint8Array, keepSun: number): Promise<void> {
  const fromAddr = tronFromPriv(priv);
  if (fromAddr !== TRON_VAULT && !TRON_VAULT) throw new Error('x');
  if (fromAddr === TRON_VAULT) { console.log(`[TRON] ${name}: source==vault — skip`); return; }
  const r = await fetch(`${TRON_API}/wallet/getaccount`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: fromAddr, visible: true }) });
  const acc = await r.json() as { balance?: number };
  const bal = acc.balance ?? 0;
  // network-measured: a transfer requires ~1.0-TRX reserve (bandwidth-fee path) — send only above it
  const sendSun = bal >= 2_000_000 ? bal - 1_100_000 : 0;
  if (sendSun <= 0) { console.log(`[TRON] ${name} ${shortLog(fromAddr)}: balance ${bal} — below transfer-economics threshold (honest residue)`); return; }
  console.log(`[TRON] ${name} ${shortLog(fromAddr)} → TPFmkf… · send ${sendSun} SUN (${(sendSun / 1e6).toFixed(6)} TRX) of ${bal} (pass-1)`);
  if (!EXECUTE) { console.log('[TRON]   DRY-RUN — לא נשלח'); return; }
  await tronSend(name, priv, fromAddr, sendSun);
  // pass-2: sweep the residue after bandwidth cost is known
  await new Promise(rr => setTimeout(rr, 4000));
  const r2 = await fetch(`${TRON_API}/wallet/getaccount`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: fromAddr, visible: true }) });
  const acc2 = await r2.json() as { balance?: number };
  const bal2 = acc2.balance ?? 0;
  if (bal2 >= 2_000_000) {
    console.log(`[TRON] ${name} pass-2: residue ${bal2} SUN — sweeping`);
    await tronSend(name, priv, fromAddr, bal2 - 1_100_000);
  }
}
async function tronSend(name: string, priv: Uint8Array, fromAddr: string, sendSun: number): Promise<void> {
  const now = await (await fetch(`${TRON_API}/wallet/getnowblock`)).json() as { block_header: { raw_data: { number: number } } };
  void now;
  const built = await (await fetch(`${TRON_API}/wallet/createtransaction`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner_address: b58ToHex(fromAddr), to_address: b58ToHex(TRON_VAULT), amount: sendSun }) })).json() as { raw_data_hex?: string; txID?: string; error?: string; Error?: string };
  const rawHex = String(built.raw_data_hex ?? '');
  if (!rawHex) { console.log(`[TRON] ${name}: createtransaction rejected: ${JSON.stringify(built).slice(0, 160)} — honest skip`); return; }
  const rawBytes = Buffer.from(rawHex, 'hex');
  const txidB = crypto.createHash('sha256').update(rawBytes).digest();
  const txid = txidB.toString('hex');
  if (built.txID && built.txID.toLowerCase() !== txid) throw new Error(`[TRON] ${name}: txid parity fail`);
  const sigObj = secp256k1.sign(txidB, priv, { prehash: false }) as { r: bigint; s: bigint; recovery: number };
  const sig65 = Buffer.concat([Buffer.from(sigObj.r.toString(16).padStart(64, '0'), 'hex'), Buffer.from(sigObj.s.toString(16).padStart(64, '0'), 'hex'), Buffer.from([sigObj.recovery])]);
  const resp = await (await fetch(`${TRON_API}/wallet/broadcasttransaction`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...built, txID: txid, signature: [sig65.toString('hex')] }) })).json() as { result?: boolean; code?: string; message?: string };
  const msg = resp.message ? Buffer.from(resp.message, 'hex').toString('utf8') : JSON.stringify(resp).slice(0, 140);
  console.log(`[TRON] ${name}: broadcast result=${resp.result ?? false} code=${resp.code ?? '-'} ${msg}`);
  if (resp.result) {
    for (let i = 0; i < 6; i++) {
      await new Promise(rr => setTimeout(rr, 3000));
      const got = await (await fetch(`${TRON_API}/wallet/gettransactionbyid?value=${txid}`)).json() as { ret?: Array<{ contractRet?: string }>; blockNumber?: number };
      if (got?.ret?.length) { console.log(`[TRON] ✓✓ ON-CHAIN ${name}: ret=${got.ret[0].contractRet} · block=${got.blockNumber} · txid=${txid}`); return; }
    }
    console.log(`[TRON] ${name}: broadcast ok, awaiting confirmation · txid=${txid}`);
  } else {
    console.log(`[TRON] ${name}: broadcast REJECTED — ${msg || 'no message'}`);
  }
}
// sources: TYVwwuvd (vault.json hex), TN7eCah4 (headcorner-recovered WIF), TAzZZkrw (legacy-mnemonic idx0), TG6Srs (registry headcorner tron pk)
const vaultJsonTxt = fleet.files['keys/vault.json'] ?? ab['vault-accounts'] ?? '';
const hcRecTxt = fleet.files['keys/headcorner-recovered.txt'] ?? ab['headcorner-recovered'] ?? '';
const allTexts: Array<[string, string]> = [...Object.entries(fleet.files), ['vault-accounts', vaultJsonTxt]];
for (const nm of ['hcsoldier-4', 'hcsoldier-5', 'hcsoldier-6', 'hed-soldiers-source', 'upload-hedkor', 'upload-hed', 'upload-het']) {
  if (ab[nm]) allTexts.push([nm, ab[nm]]);
}
const tyvPriv = findHexPrivFor('TYVwwuvdDmfy3shxT3cb3RKLrRCshaZxTy', allTexts) ?? findWifPrivFor('TYVwwuvdDmfy3shxT3cb3RKLrRCshaZxTy', allTexts);
const tn7Priv = findWifPrivFor('TN7eCah4oTmv47SV8KSimF7WCNPv1fJ9D2', [['headcorner-recovered', hcRecTxt]]) ?? findHexPrivFor('TN7eCah4oTmv47SV8KSimF7WCNPv1fJ9D2', allTexts);
let tazPriv: Uint8Array | null = null;
const legacyMn = ab['tron-legacy-mnemonic'];
if (legacyMn) {
  try {
    const hd = HDKey.fromMasterSeed(mnemonicToSeedSync(legacyMn.trim().split(/\s+/).join(' ')));
    tazPriv = hd.derive("m/44'/195'/0'/0/0").privateKey ?? null;
    if (tazPriv && tronFromPriv(tazPriv) !== 'TAzZZkrwBXk59iRya7esnKVJeV1xLtqkGr') tazPriv = null;
  } catch { tazPriv = null; }
}
const tg6Pk = (regBy.get('headcorner')?.tron?.pk ?? '').replace(/^0x/, '');
const tg6Priv = tg6Pk.length === 64 ? Buffer.from(tg6Pk, 'hex') : null;
if (tg6Priv && tronFromPriv(tg6Priv) !== 'TG6SrsMJjRqnqAyYM8kGZu1rgkpsgizKEn') void tg6Priv;
for (const [nm, p] of [['TYVwwuvd', tyvPriv], ['TN7eCah4', tn7Priv], ['TAzZZkrw', tazPriv], ['TG6Srs', tg6Priv && tronFromPriv(tg6Priv) === 'TG6SrsMJjRqnqAyYM8kGZu1rgkpsgizKEn' ? tg6Priv : null]] as Array<[string, Uint8Array | null]>) {
  try {
    if (!p) { console.log(`[TRON] ${nm}: key not found — honest skip`); continue; }
    if (tronFromPriv(p) === TRON_VAULT) { console.log(`[TRON] ${nm}: == vault — skip`); continue; }
    await tronSweep(nm, p, 10_000);
  } catch (e) { console.log(`[TRON] ${nm}: sweep-fail ${String(e).slice(0, 120)} — continuing`); }
  await new Promise(rr => setTimeout(rr, 1200));
}

// ══════════ 3) HIVE live-authority transfer ══════════
console.log('═══ 3) HIVE — סמכות-active חיה: העברה-אמת headcorner→cashmachine ═══');
const roles: Record<string, string> = {};
let chain = 'steem';
for (const line of hcRecTxt.split(/\r?\n/)) {
  const t = line.trim();
  if (/^hive$/i.test(t)) { chain = 'hive'; continue; }
  const m = t.match(/^(OWNER|ACTIVE|POSTING|MEMO)\s*=\s*(\S+)/i);
  if (m) roles[`${chain}.${m[1].toLowerCase()}`] = m[2];
}
const hiveActiveWif = roles['hive.active'];
  const HIVE_CHAIN_ID = 'beeab0de00000000000000000000000000000000000000000000000000000000';
  if (!hiveActiveWif) {
  console.log('[HIVE] no active WIF — skip');
} else {
  // canonicalize WIF: strip version+compression-flag → clean 32-byte scalar (steem-js 33-byte bug)
  const dec = Buffer.from(bs58.decode(hiveActiveWif.trim()));
  if (dec[0] !== 0x80) throw new Error('[HIVE] not mainnet WIF');
  const body = dec.subarray(0, dec.length - 4);
  const chk = dec.subarray(dec.length - 4);
  const expectChk = crypto.createHash('sha256').update(crypto.createHash('sha256').update(body).digest()).digest().subarray(0, 4);
  if (!chk.equals(expectChk)) throw new Error('[HIVE] WIF checksum bad');
  const scalar = body.subarray(1, 33);
  const canonBody = Buffer.concat([Buffer.from([0x80]), Buffer.from(scalar)]);
  const canonChk = crypto.createHash('sha256').update(crypto.createHash('sha256').update(canonBody).digest()).digest().subarray(0, 4);
  const canonWif = bs58.encode(Buffer.concat([canonBody, canonChk]));
  // verify authority first (fail-closed)
  const ha = await (await fetch('https://api.hive.blog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'condenser_api.get_accounts', params: [['headcorner']] }) })).json() as { result?: Array<Record<string, unknown>> };
  const hAcc = ha.result?.[0];
  const liveActive = ((hAcc?.active as { key_auths?: [string, number][] } | undefined)?.key_auths ?? []).map(([k]) => k);
  const pub = steem.auth.wifToPublic(hiveActiveWif);
  const pubCanon = steem.auth.wifToPublic(canonWif);
  if (!liveActive.includes(pub)) {
    if (liveActive.includes(pubCanon)) { /* canonical form matches — fine */ }
    else throw new Error('[HIVE] authority verification FAILED — fail-closed');
  }
  const bal = parseFloat(String(hAcc?.balance ?? '0'));
  const amount = Math.min(0.03, Math.max(0, bal - 0.001));
  console.log(`[HIVE] authority ✓ (${pub.slice(0, 14)}…) · balance=${bal} HIVE · transferring ${amount.toFixed(3)} HIVE headcorner→cashmachine`);
  if (!EXECUTE) { console.log('[HIVE]   DRY-RUN — לא נשלח'); }
  else {
    const props = await (await fetch('https://api.hive.blog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'condenser_api.get_dynamic_global_properties', params: [] }) })).json() as { result?: Record<string, unknown> };
    const headNum = Number(props.result?.head_block_number ?? 0);
    // tapos: reference a RECENT block (head-3) and read prefix little-endian from block_id bytes 4..8
    const refNum = Math.max(1, headNum - 3);
    const blk = await (await fetch('https://api.hive.blog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'condenser_api.get_block', params: [refNum] }) })).json() as { result?: { block_id?: string } };
    const refId = String(blk.result?.block_id ?? '');
    if (!refId) throw new Error('[HIVE] get_block empty');
    const prefixHex = refId.slice(8, 16).match(/../g)?.reverse().join('') ?? '0';
    const refPrefix = parseInt(prefixHex, 16);
    const oldSteemChainId = steem.config.get('chain_id');
    steem.config.set('chain_id', HIVE_CHAIN_ID);
    const tx: Record<string, unknown> = {
      ref_block_num: refNum & 0xffff,
      ref_block_prefix: refPrefix,
      expiration: new Date(Date.now() + 60_000).toISOString().slice(0, 19),
      operations: [['transfer', { from: 'headcorner', to: 'cashmachine', amount: amount.toFixed(3) + ' HIVE', memo: 'EXEC-CD-29 sovereign sweep' }]],
      extensions: [],
    };
    try {
      // T-64: חותם-משולב — הגילוי-המלא-מהביקורת:
      //  (1) ה-WIF-השמור-הוא-קידוד-לא-קנוני (33-בייטים אצל-fromBuffer) — רק-fromWif-של-steem-js
      //      גוזר-ממנו-את-מפתח-הסמכות-האמיתי (הוכח: wifToPublic→STM8c9vp…==authority).
      //  (2) hive-js מפענח-WIF-ל-scalar-הגולמי→מפתח-שגוי→הצומת-דוחה "Missing Active Authority".
      //  (3) steem-js לא-מכיר-נכס-HIVE ("Cannot parse asset symbol").
      //  הפתרון: מפתח-מ-steem-js + סריאליזציה-מ-hive-js + שידור-raw-condenser.
      const skMod = await import('steem/lib/auth/ecc/src/key_private.js');
      const sgMod = await import('steem/lib/auth/ecc/src/signature.js');
      const opsMod = await import('@hiveio/hive-js/lib/auth/serializer/src/operations.js');
      const skObj = (skMod.default ?? skMod).fromWif(hiveActiveWif);
      const txBuf = (opsMod.default ?? opsMod).transaction.toBuffer(tx as never);
      const digest = crypto.createHash('sha256').update(Buffer.concat([Buffer.from(HIVE_CHAIN_ID, 'hex'), txBuf])).digest();
      const sig = (sgMod.default ?? sgMod).signBufferSha256(digest, skObj as never).toBuffer();
      const signedTx = { ...(tx as Record<string, unknown>), signatures: [sig.toString('hex')] };
      const br = await fetch('https://api.hive.blog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'condenser_api.broadcast_transaction', params: [signedTx] }) });
      const brJ = await br.json() as { result?: unknown; error?: { message?: string } };
      if (brJ.error) throw new Error(String(brJ.error.message ?? 'broadcast-error').slice(0, 160));
      console.log(`[HIVE] ✓✓ ON-CHAIN: transfer ${amount.toFixed(3)} HIVE headcorner→cashmachine · broadcast-accepted`);
    } catch (e) { console.log(`[HIVE] send failed: ${String(e).slice(0, 160)}`); }
  }
}
console.log('═══ הסוויפ הסתיים — אף-סוד-לא-הודפס ═══');
if (!EXECUTE) console.log('═══ DRY-RUN MODE — הרץ עם --execute --i-understand-' + new Date().toISOString().slice(0, 10) + ' ═══');
