// ═══ כספת-הריפו הריבונית (Sovereign Repo-Vault · EXEC-CD-24) ═════════════════
// הוראת-המפעיל: "תקים ארנק ותכניס אותו היטב לכספת בריפו שלא יהיה תלוי בסנדבוקס שנחמק.
// תקים שם כתובת מה שצריך ותשתמש ותשמור את הפרטים ותלמד גם את האוטונומיה לעשות דברים כאלה."
//
// העיקרון הריבוני: כל כספת-הסודות הקיימת (keys/, agent/vault/, .secrets/, ~/.devgate/)
// חיה-רק-בסנדבוקס — מחיקה-אחת והמפתחות מתים (EXEC-CD-22: fleet_keys.enc wiped).
// כספת-זו הפוכה: החומר המוצפן חי-בגיט עצמו (repo-vault/), ושחזור = clone + סקריפט-פתיחה.
//
// ארכיטקטורת-החותם (ה"כספת" עצמה):
//   · seal.a + seal.b — שני-שברי-32-בייט-רנדומליים, שניהם מוטמנים בריפו.
//   · מפתח-AES = sha256(seal.a ⊕ seal.b) — אין-מפתח-עירום-בקובץ, אין-תלות-ב-.env.
//   · wallet.enc.json — AES-256-GCM על מנת-המפתחות המלאה (mnemonic + נגזרות פרטיות).
//   · manifest.json — רישום-ציבורי בלבד: כתובות, נתיבי-נגזרת, טביעות-אצבע, תוצאות-בדיקה-חיה.
//
// יושר-איום (כנות-לפי-חוק): ההצפנה מגינה מפני-חומר-עירום-במנוחה, סריקות-אוטומטיות
// ומפתחות-שדולפים-ללוג/לוג-בטעות — לא מפני-בעל-גישה-לריפו-עצמו. מי שיש לו clone
// יכול לפתוח בכוונה; זה המחיר של עצמאות-מסנדבוקס שהמפעיל הורה-עליה-במפורש.
// חוזה-קוד: המפתח-הפרטי לעולם לא נרשם בלוג, לא נשלח ב-API, לא נכתב בשום-קובץ
// מחוץ-למעטפת-המוצפנת. כל-הפונקציות-הציבוריות מחזירות תצוגת-ציבור בלבד.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import bs58 from 'bs58';
import { HDKey } from '@scure/bip32';
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { keccak_256 } from '@noble/hashes/sha3.js';

// ─── מיקום-הכספת (בגיט! לא ב-gitignore) ────────────────────────────────────
export const REPO_VAULT_DIR = process.env.REPO_VAULT_DIR || path.resolve(process.cwd(), 'repo-vault');
export const SEAL_A = 'seal.a';
export const SEAL_B = 'seal.b';
export const WALLET_ENC = 'wallet.enc.json';
export const MANIFEST = 'manifest.json';
export const ESCALATIONS = 'escalations.json';

const AES_KEY_LABEL = 'sovereign-repo-vault-v1';

// ─── בסיס58check (TRON/WIF) ──────────────────────────────────────────────────
function sha256d(b: Buffer): Buffer {
  return Buffer.from(sha256(sha256(b)));
}
function b58check(payload: Buffer): string {
  return bs58.encode(Buffer.concat([payload, sha256d(payload).subarray(0, 4)]));
}

// ─── EIP-55 checksum ─────────────────────────────────────────────────────────
export function toChecksumAddress(addrLower: string): string {
  const h = Buffer.from(keccak_256(Buffer.from(addrLower.slice(2), 'ascii'))).toString('hex');
  let out = '0x';
  for (let i = 0; i < 40; i++) {
    const ch = addrLower[2 + i];
    const nib = parseInt(h[i], 16);
    out += /[a-f]/.test(ch) && nib >= 8 ? ch.toUpperCase() : ch;
  }
  return out;
}

// ─── bech32 (BIP-173 — P2WPKH bc1q…) ─────────────────────────────────────────
const B32CHARS = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= GEN[i];
  }
  return chk;
}
function hrpExpand(hrp: string): number[] {
  const r: number[] = [];
  for (const ch of hrp) r.push(ch.charCodeAt(0) >> 5);
  r.push(0);
  for (const ch of hrp) r.push(ch.charCodeAt(0) & 31);
  return r;
}
function convertBits(data: number[], from: number, to: number, pad: boolean): number[] {
  let acc = 0, bits = 0;
  const ret: number[] = [];
  const maxv = (1 << to) - 1;
  for (const v of data) {
    acc = (acc << from) | v;
    bits += from;
    while (bits >= to) {
      bits -= to;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits) ret.push((acc << (to - bits)) & maxv);
  } else if (bits >= from || ((acc << (to - bits)) & maxv)) {
    throw new Error('convertBits: invalid padding');
  }
  return ret;
}
function bech32SegwitEncode(hrp: string, witver: number, program: Buffer): string {
  const data = [witver, ...convertBits(Array.from(program), 8, 5, true)];
  const values = [...hrpExpand(hrp), ...data];
  const witConst = witver === 0 ? 1 : 0x2bc830a3; // bech32 vs bech32m (BIP-350)
  const mod = bech32Polymod([...values, 0, 0, 0, 0, 0, 0]) ^ witConst;
  const chk: number[] = [];
  for (let i = 0; i < 6; i++) chk.push((mod >> 5 * (5 - i)) & 31);
  return hrp + '1' + [...data, ...chk].map(d => B32CHARS[d]).join('');
}

// ─── SLIP-0010 ed25519 (Solana — נתיב Phantom/„m/44'/501'/0'/0'") ──────────
function hmac512(key: Buffer, data: Buffer): Buffer {
  return crypto.createHmac('sha512', key).update(data).digest();
}
function slip10Ed25519(seed: Buffer, path: string): Buffer {
  const I = hmac512(Buffer.from('ed25519 seed', 'ascii'), seed);
  let k = Buffer.from(I.subarray(0, 32));
  let c = Buffer.from(I.subarray(32));
  for (const seg of path.split('/').slice(1)) {
    if (!seg.endsWith("'")) throw new Error(`ed25519 SLIP-0010: only hardened segments allowed (${seg})`);
    const idx = parseInt(seg.replace(/['hH]$/, ''), 10);
    if (!Number.isInteger(idx) || idx < 0 || idx >= 0x80000000) throw new Error(`bad index: ${seg}`);
    const data = Buffer.concat([Buffer.from([0]), k, Buffer.from([(idx >> 24) | 0x80, (idx >> 16) & 0xff, (idx >> 8) & 0xff, idx & 0xff])]);
    const CI = hmac512(c, data);
    k = Buffer.from(CI.subarray(0, 32));
    c = Buffer.from(CI.subarray(32));
  }
  return k;
}

// ─── נגזרות-הרשתות ───────────────────────────────────────────────────────────
export type NetworkId = 'evm' | 'tron' | 'bitcoin' | 'solana';

export interface Derivation {
  network: NetworkId;
  path: string;
  privateKey: string; // 0x-hex / base58(64B) / WIF — חומר-סוד: לעולם לא יוצא מהמעטפת
  address: string;
  publicKey: string;
}

export const DERIVATION_SPECS: Array<{ network: NetworkId; path: string; label: string }> = [
  { network: 'evm', path: "m/44'/60'/0'/0/0", label: 'Ethereum וכל-EVM (ETH/POLY/ARB/OP/BASE/BSC…)' },
  { network: 'tron', path: "m/44'/195'/0'/0/0", label: 'TRON (TRX/USDT-TRC20)' },
  { network: 'bitcoin', path: "m/84'/0'/0'/0/0", label: 'Bitcoin (P2WPKH native-segwit)' },
  { network: 'solana', path: "m/44'/501'/0'/0'", label: 'Solana (SOL/SPL)' },
];

export function deriveAll(mnemonic: string): Derivation[] {
  if (!validateMnemonic(mnemonic.trim(), englishWordlist)) {
    throw new Error('mnemonic invalid (BIP-39) — mint aborted');
  }
  const seed = Buffer.from(mnemonicToSeedSync(mnemonic.trim()));
  const out: Derivation[] = [];
  for (const spec of DERIVATION_SPECS) {
    if (spec.network === 'solana') {
      const priv = slip10Ed25519(seed, spec.path);
      const pub = Buffer.from(ed25519.getPublicKey(priv));
      out.push({
        network: spec.network, path: spec.path,
        privateKey: bs58.encode(Buffer.concat([priv, pub])), // 64B keypair form
        publicKey: bs58.encode(pub),
        address: bs58.encode(pub),
      });
      continue;
    }
    const hd = HDKey.fromMasterSeed(seed).derive(spec.path);
    if (!hd.privateKey) throw new Error(`BIP-32 derive failed: ${spec.path}`);
    const priv = Buffer.from(hd.privateKey);
    if (spec.network === 'evm') {
      const pubUn = Buffer.from(secp256k1.getPublicKey(priv, false)); // 65B 0x04…
      const addrBytes = keccak_256(pubUn.subarray(1)).subarray(12); // last 20B
      const lower = '0x' + Buffer.from(addrBytes).toString('hex');
      out.push({ network: spec.network, path: spec.path, privateKey: '0x' + priv.toString('hex'), publicKey: pubUn.toString('hex'), address: toChecksumAddress(lower) });
    } else if (spec.network === 'tron') {
      const pubUn = Buffer.from(secp256k1.getPublicKey(priv, false));
      const body = keccak_256(pubUn.subarray(1)).subarray(12); // 20B
      const tronBytes = Buffer.concat([Buffer.from([0x41]), Buffer.from(body)]);
      out.push({ network: spec.network, path: spec.path, privateKey: '0x' + priv.toString('hex'), publicKey: pubUn.toString('hex'), address: b58check(tronBytes) });
    } else {
      // bitcoin — P2WPKH: hash160(compressed-pub) ב-bech32
      const pubComp = Buffer.from(secp256k1.getPublicKey(priv, true)); // 33B
      const h160 = Buffer.from(ripemd160(sha256(pubComp)));
      out.push({
        network: spec.network, path: spec.path,
        privateKey: b58check(Buffer.concat([Buffer.from([0x80]), priv, Buffer.from([0x01])])), // WIF-compressed
        publicKey: pubComp.toString('hex'),
        address: bech32SegwitEncode('bc', 0, h160),
      });
    }
  }
  return out;
}

// ─── החותם: 2-of-2 XOR shards → AES-256 ──────────────────────────────────────
export function generateSeal(): { a: string; b: string; key: Buffer } {
  const a = crypto.randomBytes(32);
  const b = crypto.randomBytes(32);
  const x = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) x[i] = a[i] ^ b[i];
  const key = Buffer.from(sha256(Buffer.concat([Buffer.from(AES_KEY_LABEL, 'ascii'), x])));
  return { a: a.toString('hex'), b: b.toString('hex'), key };
}
export function sealKeyFromShards(aHex: string, bHex: string): Buffer {
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  if (a.length !== 32 || b.length !== 32) throw new Error('seal shards must be 32 bytes each');
  const x = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) x[i] = a[i] ^ b[i];
  return Buffer.from(sha256(Buffer.concat([Buffer.from(AES_KEY_LABEL, 'ascii'), x])));
}
export function encryptWithKey(plain: string, key: Buffer): { iv: string; ct: string; tag: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return { iv: iv.toString('hex'), ct: ct.toString('hex'), tag: cipher.getAuthTag().toString('hex') };
}
export function decryptWithKey(env: { iv: string; ct: string; tag: string }, key: Buffer): string {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(env.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(env.tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(env.ct, 'hex')), decipher.final()]).toString('utf8');
}

// ─── חומר-הארנק (מוצפן-בתוך-המעטפת בלבד) ────────────────────────────────────
export interface VaultBundle {
  label: string;
  mnemonic: string;
  createdAt: string;
  derivations: Derivation[];
  operatorOrder: string;
  // EXEC-CD-25: סודות-ריבוניים-נוספים-שנבלעו-למעטפת (למשל מפתח-הפינה headcorner)
  // — כך-שגם-זהויות-הדלת-והלגיון-שורדות-מחיקת-סנדבוקס מclone-טרי. אף-ערך-מכאן
  // לעולם-לא-יוצא-החוצה (לוג/API/תצוגה) — רק-שמות-המפתחות-מוצגים.
  absorbed?: Record<string, string>;
}

// ─── תצוגת-ציבור — אפס-חומר-סוד ─────────────────────────────────────────────
export interface PublicDerivation {
  network: NetworkId;
  path: string;
  label: string;
  address: string;
}
export function publicView(bundle: VaultBundle): PublicDerivation[] {
  return bundle.derivations.map(d => ({
    network: d.network,
    path: d.path,
    label: DERIVATION_SPECS.find(s => s.network === d.network)?.label ?? d.network,
    address: d.address,
  }));
}
export function fp(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
}

// ─── בדיקות-חיות על-השרשרת (fail-honest — לעולם לא 0-מזויף) ────────────────
export interface ProbeResult {
  network: NetworkId;
  ok: boolean;
  activated?: boolean;
  balance: string | null; // מידע-אנושי ("0", "0.0137")
  unit: string;
  nonce?: number | null;
  endpoint: string;
  latencyMs: number | null;
  checkedAt: string;
  error?: string;
}
const PROBE_ENDPOINTS: Record<NetworkId, string> = {
  evm: 'https://ethereum-rpc.publicnode.com',
  solana: 'https://api.mainnet-beta.solana.com',
  tron: 'https://api.trongrid.io',
  bitcoin: 'https://blockstream.info/api',
};

function weiToEth(wei: bigint): string {
  const neg = wei < BigInt(0);
  const abs = neg ? -wei : wei;
  const s = abs.toString().padStart(19, '0');
  const int = s.slice(0, s.length - 18).replace(/^0+(?=\d)/, '');
  let frac = s.slice(-18).replace(/0+$/, '');
  if (frac.length > 8) frac = frac.slice(0, 8).replace(/0+$/, '');
  return (neg ? '-' : '') + (int || '0') + (frac ? '.' + frac : '');
}

export async function probeChains(derivations: Derivation[]): Promise<ProbeResult[]> {
  const results = await Promise.all(derivations.map(async d => {
    const t0 = Date.now();
    const ep = PROBE_ENDPOINTS[d.network];
    try {
      if (d.network === 'evm') {
        const r = await fetch(ep, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [d.address, 'latest'] }),
          signal: AbortSignal.timeout(9000),
        });
        const j = await r.json() as { result?: string; error?: unknown };
        if (!j.result) throw new Error(`rpc: ${JSON.stringify(j.error).slice(0, 120)}`);
        const nonce = await fetch(ep, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'eth_getTransactionCount', params: [d.address, 'latest'] }),
          signal: AbortSignal.timeout(9000),
        }).then(x => x.json()).then((x: { result?: string }) => (x.result ? parseInt(x.result, 16) : null)).catch(() => null);
        return {
          network: d.network, ok: true, activated: true,
          balance: weiToEth(BigInt(j.result)), unit: 'ETH', nonce,
          endpoint: ep, latencyMs: Date.now() - t0, checkedAt: new Date().toISOString(),
        } as ProbeResult;
      }
      if (d.network === 'solana') {
        const r = await fetch(ep, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [d.address] }),
          signal: AbortSignal.timeout(9000),
        });
        const j = await r.json() as { result?: { value?: number }; error?: unknown };
        if (!j.result) throw new Error(`rpc: ${JSON.stringify(j.error).slice(0, 120)}`);
        const lam = j.result.value ?? 0;
        return {
          network: d.network, ok: true, activated: true,
          balance: (lam / 1e9).toFixed(9).replace(/0+$/, '').replace(/\.$/, '') || '0', unit: 'SOL',
          endpoint: ep, latencyMs: Date.now() - t0, checkedAt: new Date().toISOString(),
        } as ProbeResult;
      }
      if (d.network === 'tron') {
        const r = await fetch(`${ep}/v1/accounts/${d.address}`, { signal: AbortSignal.timeout(9000) });
        const j = await r.json() as { data?: Array<{ balance?: number }> };
        const acc = j.data?.[0];
        const sun = acc?.balance ?? 0;
        return {
          network: d.network, ok: true, activated: !!acc,
          balance: (sun / 1e6).toFixed(6).replace(/0+$/, '').replace(/\.$/, '') || '0', unit: 'TRX',
          endpoint: `${ep}/v1/accounts/…`, latencyMs: Date.now() - t0, checkedAt: new Date().toISOString(),
        } as ProbeResult;
      }
      // bitcoin
      const r = await fetch(`${ep}/address/${d.address}`, { signal: AbortSignal.timeout(9000) });
      if (!r.ok) throw new Error(`blockstream ${r.status}`);
      const j = await r.json() as { chain_stats: { funded_txo_sum: number; spent_txo_sum: number } };
      const sat = j.chain_stats.funded_txo_sum - j.chain_stats.spent_txo_sum;
      return {
        network: d.network, ok: true, activated: j.chain_stats.funded_txo_sum > 0,
        balance: (sat / 1e8).toFixed(8).replace(/0+$/, '').replace(/\.$/, '') || '0', unit: 'BTC',
        endpoint: `${ep}/address/…`, latencyMs: Date.now() - t0, checkedAt: new Date().toISOString(),
      } as ProbeResult;
    } catch (e) {
      return {
        network: d.network, ok: false, balance: null, unit: '?',
        endpoint: ep, latencyMs: Date.now() - t0, checkedAt: new Date().toISOString(),
        error: e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160),
      } as ProbeResult;
    }
  }));
  return results;
}

// ─── IO על-קבצי-הכספת (מצפין/מפענח בזיכרון-בלבד) ────────────────────────────
export interface VaultEnvelope {
  v: number;
  kind: string;
  algo: string;
  seal: string;
  iv: string;
  ct: string;
  tag: string;
  sealedAt: string;
}
export interface VaultManifest {
  kind: string;
  v: number;
  label: string;
  createdAt: string;
  algo: { cipher: string; seal: string; mnemonicWords: number };
  fingerprints: Record<string, string>;
  networks: Array<PublicDerivation & { probe?: ProbeResult }>;
  recovery: string;
  operatorOrder: string;
}

export function vaultFile(name: string): string {
  return path.join(REPO_VAULT_DIR, name);
}
export function vaultExists(): boolean {
  try {
    return fs.existsSync(vaultFile(WALLET_ENC)) && fs.existsSync(vaultFile(SEAL_A)) && fs.existsSync(vaultFile(SEAL_B));
  } catch {
    return false;
  }
}

/** פתיחה-מלאה: שברים → מפתח → פענוח-GCM. זורק-בכנות אם-משהו-חסר/שבור. */
export function openRepoVault(): { bundle: VaultBundle; envelope: VaultEnvelope; manifest: VaultManifest | null } {
  if (!vaultExists()) throw new Error('repo-vault: missing sealed material (wallet.enc.json / seal.a / seal.b) — clone the repo or run scripts/repo-vault-mint.ts');
  const a = fs.readFileSync(vaultFile(SEAL_A), 'utf8').trim();
  const b = fs.readFileSync(vaultFile(SEAL_B), 'utf8').trim();
  const env = JSON.parse(fs.readFileSync(vaultFile(WALLET_ENC), 'utf8')) as VaultEnvelope;
  const key = sealKeyFromShards(a, b);
  const bundle = JSON.parse(decryptWithKey(env, key)) as VaultBundle;
  let manifest: VaultManifest | null = null;
  try {
    if (fs.existsSync(vaultFile(MANIFEST))) manifest = JSON.parse(fs.readFileSync(vaultFile(MANIFEST), 'utf8')) as VaultManifest;
  } catch { /* manifest corrupted — bundle still opens */ }
  return { bundle, envelope: env, manifest };
}

/** סיבוב-אמת מלא: פתיחה + נגזרה-מחדש-מה-mnemonic + התאמה-ביט-מול-ביט מול-הרישום. */
export function verifyRepoVault(): { opened: boolean; addressesMatch: boolean; mismatches: string[]; view: PublicDerivation[]; label: string } {
  const { bundle } = openRepoVault();
  const fresh = deriveAll(bundle.mnemonic);
  const mismatches: string[] = [];
  for (const d of fresh) {
    const old = bundle.derivations.find(x => x.network === d.network);
    if (!old || old.address !== d.address) mismatches.push(d.network);
  }
  return {
    opened: true,
    addressesMatch: mismatches.length === 0 && fresh.length === bundle.derivations.length,
    mismatches,
    view: publicView(bundle),
    label: bundle.label,
  };
}

/** רישום-ההעברה-למפעיל (מה-שהאוטונומיה לא יכולה לעשות — נרשם-ומועבר). */
export interface EscalationItem {
  id: string;
  title: string;
  titleEn: string;
  why: string;
  what: string;
  priority: 'high' | 'medium' | 'low';
  status: 'pending_operator';
  surfacedAt: string;
}
export function readEscalations(): { updatedAt: string; note: string; items: EscalationItem[] } {
  try {
    return JSON.parse(fs.readFileSync(vaultFile(ESCALATIONS), 'utf8'));
  } catch {
    return { updatedAt: new Date().toISOString(), note: 'רישום-ההעברה חסר (repo-vault/escalations.json)', items: [] };
  }
}
