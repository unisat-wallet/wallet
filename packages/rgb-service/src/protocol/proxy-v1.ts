import { edwardsToMontgomeryPriv, edwardsToMontgomeryPub, x25519 } from '@noble/curves/ed25519'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import { RgbServiceError } from '../errors'

const SEAL_BLINDING_INFO = new TextEncoder().encode(
  'rgb-proxy-server/enc/v1/seal-blinding'
)

function keyBytes(value: string, name: string) {
  if (!/^[0-9a-f]{64}$/i.test(value))
    throw new RgbServiceError(`${name} must be a 32-byte hexadecimal value`)
  return Uint8Array.from(Buffer.from(value, 'hex'))
}

/** Derive the Proxy v1 witness-seal blinding specified by A.11. */
export function deriveProxyV1SealBlinding(
  privateKey: string,
  peerPublicKey: string
): bigint {
  let shared: Uint8Array
  try {
    shared = x25519.getSharedSecret(
      edwardsToMontgomeryPriv(keyBytes(privateKey, 'RGB proxy private key')),
      edwardsToMontgomeryPub(keyBytes(peerPublicKey, 'RGB proxy public key'))
    )
  } catch (error) {
    if (error instanceof RgbServiceError) throw error
    throw new RgbServiceError('RGB proxy public key is invalid')
  }
  const bytes = hkdf(sha256, shared, undefined, SEAL_BLINDING_INFO, 8)
  return bytes.reduce(
    (value, byte, index) => value | (BigInt(byte) << BigInt(index * 8)),
    0n
  )
}
