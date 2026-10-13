/* tron-unfreeze-energy.ts — UnfreezeBalanceV2 חתום-מהריפו (R22 · create-only · fail-closed).
 *
 * רקע: פורנזיקת-R21 מצאה 10-TRX מוקפאים-ENERGY על זהות headcorner-legacy
 * (konami-0 · TMXHfFQdG6BB8kwVfbMYuiXWqr9P5S4VAU) — FreezeBalanceV2 חתום-בחוץ
 * (09-12 21:40). התפוקה-החיה: ~95-energy בלבד מול ~65K-להעברת-USDT → חסר-ערך
 * כלכלי. UnfreezeBalanceV2 מתחיל-שעון-14-ימים להחזרת-ה-10-TRX ליתרה (אחר-כך
 * WithdrawBalance). אחרי-ההפשרה: UnfrozenV2 עם expire_time — מדווח-כאן.
 *
 * בטיחות (חוזה-קשיח):
 * · מקור-מפתח secure-first: ~/.devgate/secrets/saos-keys/קונמי.txt (0600) דרך
 *   secureMaterialPath — אף-נפילה ל-upload/ 777 אלא עם-אזהרה; אין-מקור → fail-closed.
 * · validateMnemonic (F8) לפני-גזירה; נגזרת TRON m/44'/195'/0'/0/0.
 * · אימות-זהות fail-closed: הכתובת-הנגזרת חייבת-להיות בדיוק הזהות-המוקפאת.
 * · UnfreezeBalanceV2 היא פעולת-עצמי (owner==owner) — אפס-נמענים, אפס-סיכון-צד-שני.
 * · תקרה-קשיחה: הכמות-המוקפאת-הנמדדת-בלבד (cap 10,000,000-SUN), resource=ENERGY.
 * · חתימה על sha256(raw_data)=txid בדיוק-כמו-tron-self-anchor (הוכח-חי R21).
 * · אפס-הדהוד-מפתח/מנטרה: stdout כתובות/txid/טביעות-בלבד.
 * · שער-הצתה: --execute חובה לשידור; בלי-ו — DRY-RUN (בנייה+parity בלבד).
 */
process.env.NODE_ENV ||= 'development';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english.js';
import { createHash } from 'crypto';
import fs from 'fs';
import { secureMaterialPath } from '../src/lib/secure-material';

/* ── base58check (TRON) — אותם-פרימיטיבים מוכחים מ-tron-self-anchor ── */
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58(buf: Uint8Array): string {
  let n = BigInt('0x' + Buffer.from(buf).toString('hex'));
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of buf) { if (b === 0) out = B58[0] + out; else break; }
  return out;
}
function tronAddressFromPriv(priv: Uint8Array): string {
  const pub65 = Buffer.from(secp256k1.getPublicKey(priv, false));
  const h = keccak_256(pub65.subarray(1));
  const payload = Buffer.concat([Buffer.from([0x41]), Buffer.from(h.subarray(12))]);
  const chk = createHash('sha256').update(createHash('sha256').update(payload).digest()).digest().subarray(0, 4);
  return b58(Buffer.concat([payload, chk]));
}

const TRON_API = 'https://api.trongrid.io';
async function api<T>(p: string, body?: unknown, timeoutMs = 20000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(TRON_API + p, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const txt = await res.text(); // honest-fail: לעולם לא JSON.parse עיוור — גוף-גולם בשגיאה
    try { return JSON.parse(txt) as T; }
    catch { throw new Error(`non-JSON from ${p} (status=${res.status}): ${txt.slice(0, 200)}`); }
  } finally { clearTimeout(t); }
}

/* תקרה-קשיחה: הכמות-המוקפאת-שנמדדה-חי ב-R21/R22 (10-TRX). לא-יותר מ-זה. */
const CAP_SUN = 10_000_000;
const EXPECTED = 'TMXHfFQdG6BB8kwVfbMYuiXWqr9P5S4VAU'; // זהות-המוקפאת (konami-0 · R21 פורנזיקה)

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');

  /* 1) מקור-המנטרה secure-first (0600) */
  const FILE = secureMaterialPath('קונמי.txt', ['../upload']);
  if (!FILE) { console.error('konami material missing (secure+legacy) — fail-closed, nothing done'); process.exit(1); }
  if (FILE.legacy) console.warn('[secure-material] ⚠ LEGACY fallback in use (777-tmpfs) — ההעתק-המוגן צריך להיות ב-saos-keys');
  const words = fs.readFileSync(FILE.path, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0].split(/[\s,]+/).filter(Boolean);
  console.log(`mnemonic-structure: ${words.length} words (no content echo) · source=${FILE.legacy ? 'legacy-upload (WARN)' : 'secure-material'}`);
  if (words.length !== 24) { console.error('not a 24-word first line — fail-closed'); process.exit(1); }
  const phrase = words.join(' ');
  if (!validateMnemonic(phrase, englishWordlist)) { console.error('mnemonic failed BIP-39 validation — fail-closed'); process.exit(1); }

  /* 2) גזירה TRON konami-0 + אימות-זהות fail-closed */
  const seed = mnemonicToSeedSync(phrase, '');
  const d = HDKey.fromMasterSeed(seed).derive("m/44'/195'/0'/0/0");
  if (!d.privateKey) { console.error('no private key at path — fail-closed'); process.exit(1); }
  const priv = Buffer.from(d.privateKey);
  const fp = createHash('sha256').update(priv).digest().toString('hex').slice(0, 8);
  const addr = tronAddressFromPriv(priv);
  if (addr !== EXPECTED) {
    throw new Error(`identity mismatch: derived != frozen identity — fail-closed abort (derived fp=${fp})`);
  }
  console.log('identity: OK (matches frozen ENERGY identity) · key-fp:', fp);

  /* 3) מצב-חשבון חי: יתרה, frozenV2, BW */
  const acct = await api<{ data?: Array<{ balance?: number; frozenV2?: Array<{ amount?: number; type?: string }>; freeNetUsed?: number; freeNetLimit?: number; unfrozenV2?: Array<{ amount?: number; type?: string; expire_time?: number }> }> }>(`/v1/accounts/${addr}`);
  const a0 = acct?.data?.[0];
  const balance = a0?.balance ?? 0;
  const energyFrozen = (a0?.frozenV2 ?? []).find((f) => f.type === 'ENERGY')?.amount ?? 0;
  const otherFrozen = (a0?.frozenV2 ?? []).filter((f) => f.type !== 'ENERGY' && (f.amount ?? 0) > 0);
  const freeNetUsed = a0?.freeNetUsed ?? 0;
  const freeNetLimit = a0?.freeNetLimit ?? 600;
  console.log(`balance: ${balance} SUN (${(balance / 1e6).toFixed(6)} TRX) · frozenV2-ENERGY: ${energyFrozen} SUN · other-frozen: ${otherFrozen.length} · freeBW: ${freeNetUsed}/${freeNetLimit}`);
  if (energyFrozen <= 0) { console.error('no frozen ENERGY to unfreeze — nothing to do (honest no-op)'); return; }
  const amount = Math.min(energyFrozen, CAP_SUN);
  console.log(`unfreeze target: ${amount} SUN (cap ${CAP_SUN} · measured ${energyFrozen})`);

  /* 4) בנייה דרך builder רשמי + parity */
  const built = await api<{ raw_data?: { contract?: Array<{ type?: string }> }; raw_data_hex?: string; txID?: string }>(`/wallet/unfreezebalancev2`, {
    owner_address: addr,
    unfreeze_balance: amount,
    resource: 'ENERGY',
    visible: true,
  });
  const rawHex = String(built.raw_data_hex ?? '');
  const txType = built.raw_data?.contract?.[0]?.type ?? '(missing)';
  if (!rawHex || typeof built.raw_data !== 'object') throw new Error('createunfreezebalancev2 answered without raw_data (honest fail)');
  if (txType !== 'UnfreezeBalanceV2Contract') throw new Error(`unexpected contract type: ${txType} — refusing to sign`);
  const rawBytes = Buffer.from(rawHex, 'hex');
  const txidB = createHash('sha256').update(rawBytes).digest();
  const txid = txidB.toString('hex');
  const apiTxid = built.txID ? String(built.txID).toLowerCase() : null;
  if (apiTxid && apiTxid !== txid) throw new Error('txid mismatch: local sha256 != API txID — refusing to sign');
  console.log(`built: UnfreezeBalanceV2Contract ${amount}-SUN-ENERGY · raw ${rawBytes.length}B · txid parity ${apiTxid ? 'verified' : 'local-only'}`);
  console.log(`txid: ${txid}`);

  /* 5) חתימה על ה-txid (המסלול-המוכח R21) */
  const sigObj = secp256k1.sign(txidB, priv, { prehash: false }) as { r: bigint; s: bigint; recovery: number };
  const sig65 = Buffer.concat([
    Buffer.from(sigObj.r.toString(16).padStart(64, '0'), 'hex'),
    Buffer.from(sigObj.s.toString(16).padStart(64, '0'), 'hex'),
    Buffer.from([sigObj.recovery]),
  ]);
  console.log(`sig: ${sig65.length}B (recovery=${sigObj.recovery})`);
  console.log('mode:', execute ? 'LIVE --execute' : 'DRY-RUN (no broadcast; rerun with --execute)');
  if (!execute) return;

  /* 6) שידור + אימות-שרשרת */
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  let respTxt = '';
  try {
    const res = await fetch(`${TRON_API}/wallet/broadcasttransaction`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...built, txID: txid, signature: [sig65.toString('hex')] }),
      signal: ctrl.signal,
    });
    respTxt = await res.text();
  } finally { clearTimeout(t); }
  const resp = (() => { try { return JSON.parse(respTxt) as { result?: boolean; code?: string; message?: string; txid?: string }; } catch { return {}; } })();
  const msgDec = resp.message ? (Buffer.from(resp.message, 'hex').toString('utf8').match(/^[ -~]+$/) ? Buffer.from(resp.message, 'hex').toString('utf8') : resp.message) : null;
  console.log('broadcast:', JSON.stringify({ result: resp.result ?? null, code: resp.code ?? null, message: msgDec, txid: resp.txid ?? null }));
  if (!resp.result) throw new Error('broadcast rejected — see message above');

  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const got = await api<{ ret?: { contractRet?: string }[]; blockNumber?: number }>(`/wallet/gettransactionbyid?value=${resp.txid ?? txid}`);
    if (got?.ret?.length) {
      console.log(`on-chain: ret=${got.ret[0].contractRet} · block=${got.blockNumber ?? '?'}`);
      break;
    }
    console.log(`waiting… (${(i + 1) * 3}s)`);
  }

  /* 7) חלון-ההחזר: UnfrozenV2 expire_time (14-ימים מהעכשיו) */
  await new Promise((r) => setTimeout(r, 3000));
  const after = await api<{ data?: Array<{ unfrozenV2?: Array<{ amount?: number; type?: string; expire_time?: number }> }> }>(`/v1/accounts/${addr}`);
  const unf = (after?.data?.[0]?.unfrozenV2 ?? []).filter((u) => (u.amount ?? 0) > 0);
  for (const u of unf) {
    const eta = u.expire_time ? new Date(u.expire_time).toISOString() : '?';
    console.log(`withdraw-window: ${u.amount} SUN · type=${u.type ?? '?'} · withdrawable-after: ${eta}`);
  }
  console.log('NOTE: after the 14-day window, WithdrawBalance moves the amount to balance (second signed step from repo).');
}

main().catch((e) => { console.error('FAIL:', e instanceof Error ? e.message : e); process.exit(1); });
