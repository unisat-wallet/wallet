/**
 * Lamport one-time signature key derivation.
 *
 * Derives deterministic Lamport keypairs from a BIP-39 seed and an
 * arbitrary context byte string. The context is opaque to this module —
 * callers are responsible for constructing it with whatever
 * domain-specific structure they need.
 *
 * ## Derivation scheme
 *
 * 1. Split the 64-byte seed: `parentKey = seed[0..32)`, `chainCode = seed[32..64)`.
 *
 * 2. Derive a context-specific child key:
 *    ```
 *    hmac = HMAC-SHA-512(chainCode, parentKey || context)
 *    derivedKey       = hmac[0..32)
 *    derivedChainCode = hmac[32..64)
 *    ```
 *
 * 3. Expand into {@link LAMPORT_BITS} (508) bit positions. For each bit `i`:
 *    ```
 *    falseHmac = HMAC-SHA-512(derivedChainCode, derivedKey || 0x00 || BE32(i))
 *    trueHmac  = HMAC-SHA-512(derivedChainCode, derivedKey || 0x01 || BE32(i))
 *
 *    falsePreimage = falseHmac[0..LABEL_SIZE)   // 16 bytes
 *    truePreimage  = trueHmac[0..LABEL_SIZE)
 *
 *    falseHash = Hash160(falsePreimage)          // 20 bytes
 *    trueHash  = Hash160(truePreimage)
 *    ```
 *
 * 4. All intermediate key material is zeroed after use.
 *
 * ## Security
 *
 * - HMAC-SHA-512 is a PRF; revealing preimages does not leak the seed
 *   or any BIP-32 private keys.
 * - Lamport signatures are one-time: signing the same context twice with
 *   different proof bits reveals both preimages for some bit positions,
 *   breaking that keypair. Callers must enforce single-use externally.
 *
 * @module lamport
 */

import { hmac } from '@noble/hashes/hmac'
import { ripemd160 } from '@noble/hashes/ripemd160'
import { sha256 } from '@noble/hashes/sha256'
import { sha512 } from '@noble/hashes/sha512'

/** Number of bit positions in the Lamport keypair. */
export const LAMPORT_BITS = 508

/** Size in bytes of each preimage (garbled-circuit label size). */
const LABEL_SIZE = 16

/** Size in bytes of a half-seed or derived key. */
const KEY_SIZE = 32

/** Size in bytes of the full BIP-39 seed / HMAC-SHA-512 output. */
const SEED_SIZE = 64

/** 1 byte bit-flag + 4 byte big-endian index. */
const INDEX_BUFFER_SIZE = 5

/**
 * A Lamport keypair with preimages (private) and their Hash160 digests (public)
 * for both the false and true branch of each bit position.
 *
 * All arrays have length {@link LAMPORT_BITS}.
 */
export interface LamportKeypair {
  falsePreimages: Uint8Array[]
  truePreimages: Uint8Array[]
  falseHashes: Uint8Array[]
  trueHashes: Uint8Array[]
}

/**
 * Serialised Lamport public key — two arrays of hex-encoded Hash160 hashes.
 */
export interface LamportPublicKey {
  falseHashes: string[]
  trueHashes: string[]
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}

function hmacSha512(key: Uint8Array, data: Uint8Array): Uint8Array {
  return hmac(sha512, key, data)
}

function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data))
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derive a deterministic Lamport keypair from a BIP-39 seed and a context.
 *
 * @param seed    - 64-byte BIP-39 seed.
 * @param context - Arbitrary context bytes (caller-defined domain separator).
 * @returns A {@link LamportKeypair} with 508 preimage/hash pairs per branch.
 */
export function deriveLamportKeypair(seed: Uint8Array, context: Uint8Array): LamportKeypair {
  if (seed.length !== SEED_SIZE) {
    throw new Error(`Seed must be ${SEED_SIZE} bytes, got ${seed.length}`)
  }

  const parentKey = seed.slice(0, KEY_SIZE)
  const chainCode = seed.slice(KEY_SIZE, SEED_SIZE)

  const parentData = concatBytes(parentKey, context)
  const hmacResult = hmacSha512(chainCode, parentData)
  parentData.fill(0)
  const derivedKey = hmacResult.slice(0, KEY_SIZE)
  const derivedChainCode = hmacResult.slice(KEY_SIZE, SEED_SIZE)

  const falsePreimages: Uint8Array[] = []
  const truePreimages: Uint8Array[] = []
  const falseHashes: Uint8Array[] = []
  const trueHashes: Uint8Array[] = []

  // Pre-allocate reusable HMAC data buffers: derivedKey (32) + index (5) = 37 bytes
  const falseData = new Uint8Array(KEY_SIZE + INDEX_BUFFER_SIZE)
  const trueData = new Uint8Array(KEY_SIZE + INDEX_BUFFER_SIZE)
  falseData.set(derivedKey, 0)
  falseData[KEY_SIZE] = 0 // false branch flag
  trueData.set(derivedKey, 0)
  trueData[KEY_SIZE] = 1 // true branch flag
  const falseView = new DataView(falseData.buffer, falseData.byteOffset, falseData.byteLength)
  const trueView = new DataView(trueData.buffer, trueData.byteOffset, trueData.byteLength)

  for (let bit = 0; bit < LAMPORT_BITS; bit++) {
    falseView.setUint32(KEY_SIZE + 1, bit, false)
    trueView.setUint32(KEY_SIZE + 1, bit, false)

    const falseHmac = hmacSha512(derivedChainCode, falseData)
    const trueHmac = hmacSha512(derivedChainCode, trueData)

    const falsePreimage = falseHmac.slice(0, LABEL_SIZE)
    const truePreimage = trueHmac.slice(0, LABEL_SIZE)

    falsePreimages.push(falsePreimage)
    truePreimages.push(truePreimage)
    falseHashes.push(hash160(falsePreimage))
    trueHashes.push(hash160(truePreimage))

    falseHmac.fill(0)
    trueHmac.fill(0)
  }

  // Zero intermediate key material
  parentKey.fill(0)
  chainCode.fill(0)
  hmacResult.fill(0)
  derivedKey.fill(0)
  derivedChainCode.fill(0)
  falseData.fill(0)
  trueData.fill(0)

  return { falsePreimages, truePreimages, falseHashes, trueHashes }
}

/**
 * Extract the public key (Hash160 hashes) from a keypair, hex-encoded.
 */
export function lamportPublicKey(keypair: LamportKeypair): LamportPublicKey {
  return {
    falseHashes: keypair.falseHashes.map(toHex),
    trueHashes: keypair.trueHashes.map(toHex),
  }
}

/**
 * Sign with a Lamport keypair: given 508 proof bits, return the matching
 * preimages as hex strings.
 *
 * @param seed      - 64-byte BIP-39 seed.
 * @param context   - Same context used to derive the keypair.
 * @param proofBits - Array of 508 values, each 0 or 1.
 * @returns Array of 508 hex-encoded preimages (16 bytes / 32 hex chars each).
 */
export function lamportSign(seed: Uint8Array, context: Uint8Array, proofBits: number[]): string[] {
  if (proofBits.length !== LAMPORT_BITS) {
    throw new Error(`proofBits must have ${LAMPORT_BITS} elements, got ${proofBits.length}`)
  }

  const keypair = deriveLamportKeypair(seed, context)
  const preimages: string[] = []

  for (let i = 0; i < LAMPORT_BITS; i++) {
    const bit = proofBits[i]
    if (bit !== 0 && bit !== 1) {
      throw new Error(`proofBits[${i}] must be 0 or 1, got ${bit}`)
    }
    preimages.push(toHex(bit === 0 ? keypair.falsePreimages[i]! : keypair.truePreimages[i]!))
  }

  // Zero all preimages that were not selected
  for (let i = 0; i < LAMPORT_BITS; i++) {
    keypair.falsePreimages[i]!.fill(0)
    keypair.truePreimages[i]!.fill(0)
  }

  return preimages
}
