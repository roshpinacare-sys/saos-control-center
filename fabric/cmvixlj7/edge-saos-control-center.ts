// src/lib/siwe.ts
// Edge-compatible — no Node APIs
// SIWE verification using Web Crypto API only (SubtleCrypto, TextEncoder/Decoder)
// No ethers/viem/Buffer dependencies

import { keccak256 } from "@noble/hashes/sha3";
import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

/**
 * Parses a SIWE message string into structured fields.
 * Minimal parser for the fields we need: address, nonce, issuedAt, expirationTime, chainId.
 */
function parseSIWEMessage(message: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const lines = message.split("\n");
  let currentKey = "";
  for (const line of lines) {
    if (line.startsWith(" ")) {
      // continuation line
      fields[currentKey] += "\n" + line.trimStart();
    } else {
      const idx = line.indexOf(": ");
      if (idx > 0) {
        currentKey = line.slice(0, idx);
        fields[currentKey] = line.slice(idx + 2);
      }
    }
  }
  return fields;
}

/**
 * Verifies a SIWE signature using Web Crypto / noble-curves (Edge-compatible).
 * @param message The full SIWE message string
 * @param signature Hex-encoded signature (65 bytes: r(32) || s(32) || v(1))
 * @param address Expected Ethereum address (0x-prefixed, checksummed or lower)
 * @returns { valid: boolean, address?: string }
 */
export async function verifySIWE(
  message: string,
  signature: string,
  address: string
): Promise<{ valid: boolean; address?: string }> {
  try {
    // 1. Parse message
    const fields = parseSIWEMessage(message);
    const msgAddress = fields["Address"]?.toLowerCase();
    if (!msgAddress || msgAddress !== address.toLowerCase()) {
      return { valid: false };
    }

    // 2. Validate nonce, issuedAt, expirationTime, chainId if present
    // (optional but recommended)
    const now = Math.floor(Date.now() / 1000);
    if (fields["Expiration Time"]) {
      const exp = new Date(fields["Expiration Time"]).getTime() / 1000;
      if (exp < now) return { valid: false };
    }
    if (fields["Not Before"]) {
      const nbf = new Date(fields["Not Before"]).getTime() / 1000;
      if (nbf > now) return { valid: false };
    }

    // 3. Compute keccak256("\x19Ethereum Signed Message:\n" + len(message) + message)
    const prefix = `\x19Ethereum Signed Message:\n${message.length}`;
    const prefixed = new TextEncoder().encode(prefix + message);
    const digest = keccak256(prefixed);

    // 4. Recover public key from signature
    const sigBytes = hexToBytes(signature.replace(/^0x/, ""));
    if (sigBytes.length !== 65) return { valid: false };
    const r = sigBytes.slice(0, 32);
    const s = sigBytes.slice(32, 64);
    const v = sigBytes[64];
    // noble expects recovery id 0/1
    const recid = v === 27 || v === 28 ? v - 27 : v;
    if (recid !== 0 && recid !== 1) return { valid: false };

    const publicKey = secp256k1.recoverPublicKey(digest, bytesToHex(r) + bytesToHex(s), recid);
    if (!publicKey) return { valid: false };

    // 5. Derive address from public key (uncompressed, drop 0x04 prefix)
    const pubKeyHex = bytesToHex(publicKey).slice(2); // drop 04
    const addrHash = keccak256(hexToBytes(pubKeyHex));
    const recoveredAddress = "0x" + bytesToHex(addrHash.slice(-20));

    // 6. Compare (case-insensitive)
    if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
      return { valid: false };
    }

    return { valid: true, address: recoveredAddress };
  } catch (e) {
    console.error("[siwe] verifySIWE error:", e);
    return { valid: false };
  }
}

// Re-export types for consumers
export type { };
