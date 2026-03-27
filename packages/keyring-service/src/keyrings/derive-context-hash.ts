/**
 * Deterministic context-based key derivation using HKDF (RFC 5869).
 *
 * Derives a 32-byte pseudorandom value from either:
 * - A 64-byte BIP-39 seed (mnemonic-based keyrings), or
 * - A 32-byte private key (imported key keyrings), expanded via HKDF first.
 *
 * ## Derivation scheme
 *
 * ```
 * HKDF-SHA-256(ikm=keyMaterial, salt="derive-context-hash", info=context, length=32)
 * ```
 *
 * Where `keyMaterial` is either the full 64-byte BIP-39 seed or a 32-byte
 * private key. HKDF-Extract produces a pseudorandom key (PRK) from the input,
 * and HKDF-Expand derives the output keyed on the context.
 *
 * ## Security
 *
 * - HKDF is a formally proven extract-then-expand KDF (Krawczyk, Crypto 2010).
 * - The Extract step ensures that even structured input (e.g. secp256k1 keys
 *   constrained to < curve order) produces a uniformly random PRK.
 * - The Expand step is a PRF; revealing outputs for many different contexts
 *   does not leak the PRK, seed, or any BIP-32 private keys.
 * - A fixed salt provides domain separation from BIP-32 and other HMAC uses.
 * - All intermediate key material is zeroed after use.
 * - Safe to reveal up to 2^256 outputs (birthday bound of HMAC-SHA-256).
 *
 * @module derive-context-hash
 */

import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'

const SALT = 'derive-context-hash'
const OUTPUT_LENGTH = 32

/**
 * Convert a Uint8Array to a hex string.
 */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Derive a deterministic 32-byte value from key material and a context.
 *
 * @param ikm     - Input key material: 64-byte BIP-39 seed or 32-byte private key.
 * @param context - Arbitrary context bytes (caller-defined domain separator).
 * @returns Hex-encoded 32-byte derived value.
 */
export function deriveContextHash(ikm: Uint8Array, context: Uint8Array): string {
  if (ikm.length !== 64 && ikm.length !== 32) {
    throw new Error(`Input key material must be 32 or 64 bytes, got ${ikm.length}`)
  }

  const derived = hkdf(sha256, ikm, SALT, context, OUTPUT_LENGTH)
  const result = toHex(derived)

  // Zero intermediate material
  derived.fill(0)

  return result
}

/**
 * Parse a hex-encoded context string into a Uint8Array.
 * Validates that the input is a non-empty, even-length hex string.
 */
export function parseHexContext(context: string): Uint8Array {
  if (!context || context.length === 0) {
    throw new Error('Context must be a non-empty string')
  }
  if (context.length % 2 !== 0) {
    throw new Error('Context must be an even-length hex string')
  }
  if (!/^[0-9a-fA-F]+$/.test(context)) {
    throw new Error('Context must be a valid hex string')
  }
  const bytes = new Uint8Array(context.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(context.substring(i * 2, i * 2 + 2), 16)
  }
  return bytes
}
