// src/lib/unified-key-auth.ts
import { createHash } from 'crypto';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bs58 } from 'bs58';

// ─── Types ────────────────────────────────────────────────────────────────
export type Chain = 'steem' | 'hive' | 'blurt';
export type KeyType = 'active' | 'posting';
export type KeyRole = 'active' | 'posting' | 'owner' | 'memo';

// ─── Constants ────────────────────────────────────────────────────────────
const CHAIN_PREFIX: Record<Chain, string> = {
  steem: 'STM',
  hive: 'STM', // Hive uses same prefix as Steem for legacy compatibility
  blurt: 'BLT',
};

const KEY_ROLE_PREFIX: Record<KeyRole, string> = {
  active: 'a',
  posting: 'p',
  owner: 'o',
  memo: 'm',
};

// ─── Errors ───────────────────────────────────────────────────────────────
export class KeyAuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'KeyAuthError';
  }
}

// ─── WIF Parsing & Validation ─────────────────────────────────────────────
interface ParsedWif {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  chain: Chain;
  keyType: KeyType;
  address: string;
}

function parseWif(wif: string): { version: number; payload: Uint8Array; checksum: Uint8Array } {
  const decoded = bs58.decode(wif);
  if (decoded.length !== 37) {
    throw new KeyAuthError('INVALID_WIF_LENGTH', 'WIF must be 37 bytes after base58 decode');
  }
  return {
    version: decoded[0],
    payload: decoded.slice(1, 33),
    checksum: decoded.slice(33),
  };
}

function validateWifChecksum(wif: string): void {
  const { version, payload, checksum } = parseWif(wif);
  const hash1 = createHash('sha256').update(Buffer.from([version, ...payload])).digest();
  const hash2 = createHash('sha256').update(hash1).digest();
  if (!Buffer.from(checksum).equals(Buffer.from(hash2.slice(0, 4)))) {
    throw new KeyAuthError('INVALID_WIF_CHECKSUM', 'WIF checksum validation failed');
  }
}

function derivePublicKey(privateKey: Uint8Array): Uint8Array {
  return secp256k1.getPublicKey(privateKey, false); // uncompressed 65 bytes
}

function publicKeyToAddress(publicKey: Uint8Array, chain: Chain): string {
  const hash = createHash('sha256').update(publicKey.slice(1)).digest(); // skip 0x04 prefix
  const ripemd = createHash('ripemd160').update(hash).digest();
  const prefix = CHAIN_PREFIX[chain];
  const checksum = createHash('sha256')
    .update(createHash('sha256').update(Buffer.from([...Buffer.from(prefix), ...ripemd])).digest())
    .digest()
    .slice(0, 4);
  return bs58.encode(Buffer.concat([Buffer.from(prefix), ripemd, checksum]));
}

function parseWifFull(wif: string, expectedChain: Chain, expectedKeyType: KeyType): ParsedWif {
  validateWifChecksum(wif);
  const { version, payload } = parseWif(wif);
  
  // Version byte: 0x80 for mainnet private keys
  if (version !== 0x80) {
    throw new KeyAuthError('INVALID_WIF_VERSION', `Unexpected WIF version byte: 0x${version.toString(16)}`);
  }
  
  const privateKey = payload;
  const publicKey = derivePublicKey(privateKey);
  const address = publicKeyToAddress(publicKey, expectedChain);
  
  // The WIF itself doesn't encode chain or key type — we validate against expected
  return { privateKey, publicKey, chain: expectedChain, keyType: expectedKeyType, address };
}

// ─── Environment Resolution ───────────────────────────────────────────────
function getEnvWif(chain: Chain, keyType: KeyType): string {
  const envMap: Record<Chain, Record<KeyType, string>> = {
    steem: {
      active: process.env.STEEM_ACTIVE_WIF || '',
      posting: process.env.STEEM_POSTING_WIF || '',
    },
    hive: {
      active: process.env.HIVE_ACTIVE_WIF || '',
      posting: process.env.HIVE_POSTING_WIF || '',
    },
    blurt: {
      active: process.env.BLURT_ACTIVE_WIF || '',
      posting: '', // Blurt posting not configured in env
    },
  };
  
  const wif = envMap[chain]?.[keyType];
  if (!wif) {
    throw new KeyAuthError(
      'MISSING_ENV_WIF',
      `Environment variable for ${chain.toUpperCase()}_${keyType.toUpperCase()}_WIF not set`
    );
  }
  return wif;
}

// ─── Core Verification ────────────────────────────────────────────────────
export interface VerifyOptions {
  chain: Chain;
  requiredKeyType: KeyType;
  message: string | Uint8Array;
  signature: string; // hex or base64
  providedKeyType?: KeyType; // what the caller claims to use
}

export interface VerifyResult {
  valid: boolean;
  signerAddress: string;
  usedKeyType: KeyType;
  chain: Chain;
}

export function verifySignature(opts: VerifyOptions): VerifyResult {
  const { chain, requiredKeyType, message, signature, providedKeyType } = opts;
  
  // 1. Enforce key type separation — reject posting key for active operations
  if (providedKeyType && providedKeyType !== requiredKeyType) {
    if (providedKeyType === 'posting' && requiredKeyType === 'active') {
      throw new KeyAuthError(
        'KEY_TYPE_MISMATCH',
        'Posting key cannot be used for active-authority operations',
        { required: requiredKeyType, provided: providedKeyType }
      );
    }
    // Active key for posting is allowed (higher privilege can do lower)
  }
  
  // 2. Resolve the expected WIF from environment
  const envWif = getEnvWif(chain, requiredKeyType);
  const parsed = parseWifFull(envWif, chain, requiredKeyType);
  
  // 3. Verify signature
  const msgBytes = typeof message === 'string' ? new TextEncoder().encode(message) : message;
  const msgHash = createHash('sha256').update(msgBytes).digest();
  
  let sigBytes: Uint8Array;
  try {
    // Try hex first
    sigBytes = Buffer.from(signature, 'hex');
  } catch {
    try {
      sigBytes = Buffer.from(signature, 'base64');
    } catch {
      throw new KeyAuthError('INVALID_SIGNATURE_FORMAT', 'Signature must be hex or base64 encoded');
    }
  }
  
  // secp256k1 expects 64-byte compact signature (r || s)
  if (sigBytes.length !== 64) {
    throw new KeyAuthError('INVALID_SIGNATURE_LENGTH', 'Signature must be 64 bytes (compact r||s)');
  }
  
  const isValid = secp256k1.verify(sigBytes, msgHash, parsed.publicKey);
  
  if (!isValid) {
    throw new KeyAuthError('SIGNATURE_VERIFICATION_FAILED', 'Signature does not match message and public key');
  }
  
  return {
    valid: true,
    signerAddress: parsed.address,
    usedKeyType: requiredKeyType,
    chain,
  };
}

// ─── High-level API for route handlers ────────────────────────────────────
export interface AuthContext {
  chain: Chain;
  requiredKeyType: KeyType;
}

export function createKeyAuth(context: AuthContext) {
  return {
    verify: (message: string | Uint8Array, signature: string, providedKeyType?: KeyType) =>
      verifySignature({ ...context, message, signature, providedKeyType }),
    
    getExpectedAddress: () => {
      const wif = getEnvWif(context.chain, context.requiredKeyType);
      const parsed = parseWifFull(wif, context.chain, context.requiredKeyType);
      return parsed.address;
    },
    
    getExpectedKeyType: () => context.requiredKeyType,
    getChain: () => context.chain,
  };
}

// ─── Pre-configured auth contexts for common operations ───────────────────
export const activeAuth = {
  steem: createKeyAuth({ chain: 'steem', requiredKeyType: 'active' }),
  hive: createKeyAuth({ chain: 'hive', requiredKeyType: 'active' }),
  blurt: createKeyAuth({ chain: 'blurt', requiredKeyType: 'active' }),
};

export const postingAuth = {
  steem: createKeyAuth({ chain: 'steem', requiredKeyType: 'posting' }),
  hive: createKeyAuth({ chain: 'hive', requiredKeyType: 'posting' }),
  blurt: createKeyAuth({ chain: 'blurt', requiredKeyType: 'posting' }),
};
