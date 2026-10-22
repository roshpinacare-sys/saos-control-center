// lib/auth/siwe.ts
import { encodeAbiParameters, keccak256, toHex, hexToBytes } from 'viem';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex, hexToBytes as nobleHexToBytes } from '@noble/hashes/utils';

// SIWE message structure
interface SiweMessage {
  domain: string;
  address: string;
  statement?: string;
  uri: string;
  version: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
  expirationTime?: string;
  notBefore?: string;
  requestId?: string;
  resources?: string[];
}

// Parse SIWE message from string
function parseSiweMessage(message: string): SiweMessage {
  const lines = message.split('\n');
  const domain = lines[0].split(' ')[0];
  
  const fields: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const [key, ...valueParts] = line.split(': ');
    if (key && valueParts.length > 0) {
      fields[key.toLowerCase()] = valueParts.join(': ');
    }
  }

  return {
    domain,
    address: fields['address'] || '',
    statement: fields['statement'],
    uri: fields['uri'] || '',
    version: fields['version'] || '1',
    chainId: parseInt(fields['chainid'] || '1', 10),
    nonce: fields['nonce'] || '',
    issuedAt: fields['issuedat'] || '',
    expirationTime: fields['expirationtime'],
    notBefore: fields['notbefore'],
    requestId: fields['requestid'],
    resources: fields['resources'] ? fields['resources'].split(', ') : undefined,
  };
}

// Create SIWE message from fields
function createSiweMessage(fields: SiweMessage): string {
  let message = `${fields.domain} wants you to sign in with your Ethereum account:\n`;
  message += `${fields.address}\n\n`;
  
  if (fields.statement) {
    message += `${fields.statement}\n\n`;
  }
  
  message += `URI: ${fields.uri}\n`;
  message += `Version: ${fields.version}\n`;
  message += `Chain ID: ${fields.chainId}\n`;
  message += `Nonce: ${fields.nonce}\n`;
  message += `Issued At: ${fields.issuedAt}\n`;
  
  if (fields.expirationTime) {
    message += `Expiration Time: ${fields.expirationTime}\n`;
  }
  if (fields.notBefore) {
    message += `Not Before: ${fields.notBefore}\n`;
  }
  if (fields.requestId) {
    message += `Request ID: ${fields.requestId}\n`;
  }
  if (fields.resources && fields.resources.length > 0) {
    message += `Resources:\n`;
    for (const resource of fields.resources) {
      message += `- ${resource}\n`;
    }
  }
  
  return message;
}

// Sign SIWE message using Web Crypto API (secp256k1 via @noble/curves)
export async function signSiweMessage(
  message: string,
  privateKeyHex: string
): Promise<string> {
  try {
    // Remove 0x prefix if present
    const privateKey = privateKeyHex.startsWith('0x') 
      ? privateKeyHex.slice(2) 
      : privateKeyHex;
    
    // Hash the message (EIP-191 personal_sign)
    const messageBytes = new TextEncoder().encode(message);
    const prefix = `\x19Ethereum Signed Message:\n${messageBytes.length}`;
    const prefixBytes = new TextEncoder().encode(prefix);
    const prefixedMessage = new Uint8Array(prefixBytes.length + messageBytes.length);
    prefixedMessage.set(prefixBytes);
    prefixedMessage.set(messageBytes, prefixBytes.length);
    
    // Hash with keccak256
    const hash = keccak256(prefixedMessage);
    const hashBytes = hexToBytes(hash);
    
    // Sign with secp256k1
    const privateKeyBytes = nobleHexToBytes(privateKey);
    const signature = secp256k1.sign(hashBytes, privateKeyBytes, { canonical: true });
    
    // Convert to Ethereum signature format (r, s, v)
    const r = bytesToHex(signature.r.toBytes(32));
    const s = bytesToHex(signature.s.toBytes(32));
    const v = signature.recovery + 27; // Ethereum uses 27/28
    
    return `0x${r}${s}${v.toString(16).padStart(2, '0')}`;
  } catch (error) {
    throw new Error(`SIWE signing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Verify SIWE signature using Web Crypto API
export async function verifySiweSignature(
  message: string,
  signature: string,
  expectedAddress: string
): Promise<boolean> {
  try {
    // Remove 0x prefix from signature
    const sig = signature.startsWith('0x') ? signature.slice(2) : signature;
    if (sig.length !== 130) {
      throw new Error('Invalid signature length');
    }
    
    const r = `0x${sig.slice(0, 64)}`;
    const s = `0x${sig.slice(64, 128)}`;
    const v = parseInt(sig.slice(128, 130), 16);
    
    if (v !== 27 && v !== 28) {
      throw new Error('Invalid recovery ID');
    }
    
    // Hash the message (EIP-191 personal_sign)
    const messageBytes = new TextEncoder().encode(message);
    const prefix = `\x19Ethereum Signed Message:\n${messageBytes.length}`;
    const prefixBytes = new TextEncoder().encode(prefix);
    const prefixedMessage = new Uint8Array(prefixBytes.length + messageBytes.length);
    prefixedMessage.set(prefixBytes);
    prefixedMessage.set(messageBytes, prefixBytes.length);
    
    // Hash with keccak256
    const hash = keccak256(prefixedMessage);
    const hashBytes = hexToBytes(hash);
    
    // Recover public key from signature
    const signatureObj = secp256k1.Signature.fromCompact(hexToBytes(`${r.slice(2)}${s.slice(2)}`));
    signatureObj = signatureObj.addRecoveryBit(v - 27);
    
    const publicKey = signatureObj.recoverPublicKey(hashBytes);
    const publicKeyBytes = publicKey.toRawBytes(false).slice(1); // Remove 0x04 prefix
    
    // Derive Ethereum address from public key (last 20 bytes of keccak256)
    const pubKeyHash = keccak256(publicKeyBytes);
    const recoveredAddress = `0x${pubKeyHash.slice(-40)}`;
    
    return recoveredAddress.toLowerCase() === expectedAddress.toLowerCase();
  } catch (error) {
    console.error('SIWE verification failed:', error);
    return false;
  }
}

// Generate nonce for SIWE
export function generateNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Validate SIWE message structure
export function validateSiweMessage(message: string): { valid: boolean; error?: string; parsed?: SiweMessage } {
  try {
    const parsed = parseSiweMessage(message);
    
    if (!parsed.domain) {
      return { valid: false, error: 'Missing domain' };
    }
    if (!parsed.address || !/^0x[a-fA-F0-9]{40}$/.test(parsed.address)) {
      return { valid: false, error: 'Invalid address' };
    }
    if (!parsed.uri) {
      return { valid: false, error: 'Missing URI' };
    }
    if (!parsed.nonce) {
      return { valid: false, error: 'Missing nonce' };
    }
    if (!parsed.issuedAt) {
      return { valid: false, error: 'Missing issuedAt' };
    }
    
    // Check expiration
    if (parsed.expirationTime) {
      const expTime = new Date(parsed.expirationTime).getTime();
      if (Date.now() > expTime) {
        return { valid: false, error: 'Message expired' };
      }
    }
    
    // Check notBefore
    if (parsed.notBefore) {
      const notBeforeTime = new Date(parsed.notBefore).getTime();
      if (Date.now() < notBeforeTime) {
        return { valid: false, error: 'Message not yet valid' };
      }
    }
    
    return { valid: true, parsed };
  } catch (error) {
    return { valid: false, error: `Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}

export { parseSiweMessage, createSiweMessage };
export type { SiweMessage };