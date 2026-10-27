// Key material handling — Steem/Hive/Blurt WIF tools + SAOS-ROT1 deterministic derivation.
// Convention (learned the hard way 2026-09-08): NEVER verify a key by searching the
// WIF string in account history — WIFs are never broadcast. Derive the public key
// and compare against the on-chain authorities.
import steem from 'steem';
import crypto from 'crypto';

export type Chain = 'steem' | 'hive' | 'blurt';
export type Role = 'owner' | 'active' | 'posting' | 'memo';

// PROVEN LIVE (task 59, 2026-09-09, full-hex diff vs blurt-rpc): the base58 envelope
// body is IDENTICAL across Steem/Hive/Blurt — base58(pub33 + ripemd160(pub33)[0..4]);
// only the literal prefix differs (STM / Hive-STM / BLT). steem-js already emits
// exactly that body, so a literal prefix swap is the correct BLURT derivation.
// (An earlier "different envelope per fork" theory was disproven by hex comparison.)
// Blurt wallet UI additionally displays private keys with a leading "P" — normalized.

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function wifLooksValid(wif: string): boolean {
  // Accepts 5J/5H/K/L WIFs and the Blurt-wallet P-prefixed display form (P5KQ…).
  return /^([5KL]|[5KL]P|P[5KL])[1-9A-HJ-NP-Za-km-z]{50,51}$/.test(wif.trim());
}

// FIX(R14-a · wif-forms-parity, twin of saos-dex relay.ts normalizeWif):
// steem-js 0.7.11 decodes a COMPRESSED K/L WIF into the WRONG scalar silently
// (it feeds all 33 key bytes — incl. the 0x01 compression flag — into
// BigInteger, producing scalar k·256+1 → a valid-looking but wrong pub).
// A legitimately-registered compressed key therefore FAILED vault login with
// "authority mismatch" even though the key was correct. Fix: normalize to the
// canonical uncompressed 5K envelope (strip the 0x01 flag) BEFORE steem-js.
function b58checkDecode(wif: string): Buffer | null {
  let num = BigInt(0);
  for (const ch of wif) {
    const idx = B58.indexOf(ch);
    if (idx < 0) return null;
    num = num * BigInt(58) + BigInt(idx);
  }
  let hex = num.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  let bytes = Buffer.from(hex, 'hex');
  let pad = 0;
  while (wif[pad] === '1') pad++;
  if (pad > 0) bytes = Buffer.concat([Buffer.alloc(pad), bytes]);
  if (bytes.length < 5) return null;
  const payload = bytes.subarray(0, bytes.length - 4);
  const check = bytes.subarray(bytes.length - 4);
  const h = crypto.createHash('sha256').update(crypto.createHash('sha256').update(payload).digest()).digest();
  return h.subarray(0, 4).equals(check) ? payload : null;
}

function b58checkEncode(payload: Buffer): string {
  const h = crypto.createHash('sha256').update(crypto.createHash('sha256').update(payload).digest()).digest();
  const buf = Buffer.concat([payload, h.subarray(0, 4)]);
  let num = BigInt(0);
  for (const b of buf) num = num * BigInt(256) + BigInt(b);
  let out = '';
  while (num > BigInt(0)) { out = B58[Number(num % BigInt(58))] + out; num /= BigInt(58); }
  let pad = 0;
  while (buf[pad] === 0) { out = '1' + out; pad++; }
  return out;
}

/** K/L compressed (52ch) → canonical 5K uncompressed (51ch). Legacy 5J/5H unchanged. */
export function normalizeWif(wif: string): string {
  let w = wif.trim();
  if (w.length === 52 && w.startsWith('P') && /^[5KL]/.test(w[1] ?? '')) w = w.slice(1);
  if (!/^[KL]/.test(w)) return w;
  const payload = b58checkDecode(w);
  if (!payload || payload.length !== 34 || payload[0] !== 0x80 || payload[33] !== 0x01) return w;
  return b58checkEncode(payload.subarray(0, 33));
}

export function wifToPublic(wif: string, prefix: 'STM' | 'BLT' = 'STM'): string {
  // FIX(R14-a): normalize the Blurt display prefix AND the compressed form before
  // steem-js — wifToPublic must always reflect the CORRECT scalar math.
  const w = normalizeWif(wif);
  const pub = steem.auth.wifToPublic(w);
  return prefix === 'STM' ? pub : prefix + pub.replace(/^STM/, '');
}

// FIX(R18 · dual-form key reality): steem-js 0.7.11 historically decoded a
// compressed K/L WIF into scalar k·256+1 (flag byte fed into BigInteger). A
// meaningful set of REAL keys was REGISTERED on-chain under exactly that
// buggy-scalar pub (proven live 2026-09-13: headcorner/hive owner+active+
// posting+memo all match the RAW form). wifToPublic (normalized) can NEVER
// reach those pubs — verification must try the raw decode too, and signing
// must use the raw WIF for such keys. This helper is the raw mirror of
// wifToPublic: NO normalization — steem-js sees the original bytes.
export function wifToPublicRaw(wif: string, prefix: 'STM' | 'BLT' = 'STM'): string {
  const pub = steem.auth.wifToPublic(wif.trim());
  return prefix === 'STM' ? pub : prefix + pub.replace(/^STM/, '');
}

// SAOS-ROT1 derivation — reproduces every rotated key from the master seed.
export function wifFromRot1Seed(masterHex: string, account: string, chain: string, role: string): string {
  const h = crypto.createHmac('sha256', Buffer.from(masterHex, 'hex')).update(`SAOS-ROT1/${account}/${chain}/${role}`).digest();
  const payload = Buffer.concat([Buffer.from([0x80]), h, Buffer.from([0x01])]);
  const check = crypto.createHash('sha256').update(crypto.createHash('sha256').update(payload).digest()).digest().subarray(0, 4);
  const buf = Buffer.concat([payload, check]);
  let num = BigInt('0x' + buf.toString('hex'));
  let out = '';
  const ZERO = BigInt(0), B58N = BigInt(58); // FIX(Roast-63 · H8): literals-0n/58n-דרשו-target>=ES2020 (tsc-נכשל; SWC-סלחן)
  while (num > ZERO) { out = B58[Number(num % B58N)] + out; num /= B58N; }
  let pad = 0; while (buf[pad] === 0) { out = '1' + out; pad++; }
  return out;
}

// The fleet census registry (G78-a all-soldier mesh): the 13 army bodies from
// army-keys.json + the fleet master (headcorner) + the G77-a provisioned vault
// body (saos-0004). Names only — this registry never carries key material.
// MUST stay in sync with SOLDIER_ROSTER (src/lib/soldier-activation.ts),
// ROT1_ACCOUNTS (src/app/api/saos/soldiers/route.ts) and DEFAULT_ROSTER
// (mini-services/rc-rebalance/index.ts) — the registry-equality test pins it.
export const ROT1_ACCOUNTS = [
  'headcorner',
  'cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq',
  'hcsoldier4', 'hcsoldier5', 'hcsoldier6', // G78-a: army census completion
  'saos-0004', // G77-a fuel-mesh wire-in (vault-provisioned body)
];
export const ROT1_CHAINS: Chain[] = ['steem', 'hive', 'blurt'];
export const ROT1_ROLES: Role[] = ['owner', 'active', 'posting', 'memo'];
