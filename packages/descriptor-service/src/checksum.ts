/**
 * BIP-380 descriptor checksum (reference algorithm from the BIP).
 * Uses BigInt because JS bitwise operators are 32-bit; polymod needs ~40 bits.
 * @see https://github.com/bitcoin/bips/blob/master/bip-0380.mediawiki
 */

const INPUT_CHARSET =
  "0123456789()[],'/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH`#\"\\ "
const CHECKSUM_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const GENERATOR = [
  0xf5dee51989n,
  0xa9fdca3312n,
  0x1bab10e32dn,
  0x3706b1677an,
  0x644d626ffdn
]
const MASK_35 = 0x7ffffffffn

function polyMod(symbols: number[]): bigint {
  let chk = 1n
  for (const value of symbols) {
    const top = chk >> 35n
    chk = ((chk & MASK_35) << 5n) ^ BigInt(value)
    for (let i = 0; i < 5; i++) {
      if ((top >> BigInt(i)) & 1n) chk ^= GENERATOR[i]
    }
  }
  return chk
}

function expand(s: string): number[] | null {
  const groups: number[] = []
  const symbols: number[] = []
  for (const c of s) {
    const v = INPUT_CHARSET.indexOf(c)
    if (v === -1) return null
    symbols.push(v & 31)
    groups.push(v >> 5)
    if (groups.length === 3) {
      symbols.push(groups[0] * 9 + groups[1] * 3 + groups[2])
      groups.length = 0
    }
  }
  if (groups.length === 1) {
    symbols.push(groups[0])
  } else if (groups.length === 2) {
    symbols.push(groups[0] * 3 + groups[1])
  }
  return symbols
}

/** Return 8-character checksum for descriptor body (no '#'). */
export function descriptorChecksum(body: string): string {
  const expanded = expand(body)
  if (!expanded) {
    throw new Error('Invalid descriptor character set')
  }
  const symbols = expanded.concat([0, 0, 0, 0, 0, 0, 0, 0])
  const checksum = polyMod(symbols) ^ 1n
  let out = ''
  for (let i = 0; i < 8; i++) {
    out += CHECKSUM_CHARSET[Number((checksum >> BigInt(5 * (7 - i))) & 31n)]
  }
  return out
}

export function verifyDescriptorChecksum(raw: string): boolean {
  if (raw.length < 10 || raw[raw.length - 9] !== '#') return false
  const checksum = raw.slice(-8)
  if (![...checksum].every((c) => CHECKSUM_CHARSET.includes(c))) return false
  const body = raw.slice(0, -9)
  const expanded = expand(body)
  if (!expanded) return false
  const symbols = expanded.concat(
    [...checksum].map((c) => CHECKSUM_CHARSET.indexOf(c))
  )
  return polyMod(symbols) === 1n
}
