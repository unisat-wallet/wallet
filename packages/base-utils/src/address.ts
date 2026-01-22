const BASE58_REGEX = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/

const BECH32_REGEX = /^[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+$/

/**
 * Validate if a Bitcoin address is likely valid.
 * This is a lightweight check, NOT a full validation with checksum.
 *
 * Length ranges:
 * - P2PKH/P2SH (Base58): 26-35 chars
 * - P2WPKH (bc1q/tb1q): 42 chars (20-byte witness)
 * - P2TR (bc1p/tb1p): 62 chars (32-byte witness with bech32m)
 *
 * @param address - Bitcoin address to validate
 * @returns true if address format looks valid, false otherwise
 */
export function isAddressLikelyValid(address: string): boolean {
  if (!address) return false

  const first = address[0]

  // ---- P2PKH (1, m, n) ----
  if (first === '1' || first === 'm' || first === 'n') {
    if (address.length < 26 || address.length > 35) return false
    return BASE58_REGEX.test(address)
  }

  // ---- P2SH (3, 2) ----
  if (first === '3' || first === '2') {
    if (address.length < 26 || address.length > 35) return false
    return BASE58_REGEX.test(address)
  }

  // ---- Bech32/Bech32m family: must not mix case ----
  if (address !== address.toLowerCase() && address !== address.toUpperCase()) {
    return false
  }

  const lower = address.toLowerCase()

  // ---- Witness v0 (bc1q / tb1q): P2WPKH (42)  ----
  if (lower.startsWith('bc1q') || lower.startsWith('tb1q')) {
    // P2WPKH: 42 char
    if (lower.length < 42 || lower.length > 63) return false
    return BECH32_REGEX.test(lower.slice(4))
  }

  // ---- Witness v1 (bc1p / tb1p): P2TR (Taproot) ----
  if (lower.startsWith('bc1p') || lower.startsWith('tb1p')) {
    // P2TR uses bech32m, always 62 chars
    if (lower.length !== 62) return false
    return BECH32_REGEX.test(lower.slice(4))
  }

  return false
}

export const addressUtils = {
  isAddressLikelyValid,
}
