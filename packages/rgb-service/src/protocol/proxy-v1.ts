import { ed25519, edwardsToMontgomeryPriv, edwardsToMontgomeryPub, x25519 } from '@noble/curves/ed25519'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import { RgbServiceError } from '../errors'

const SEAL_BLINDING_INFO = new TextEncoder().encode(
  'rgb-proxy-server/enc/v1/seal-blinding'
)
const textEncoder = new TextEncoder()

function keyBytes(value: string, name: string) {
  if (!/^[0-9a-f]{64}$/i.test(value))
    throw new RgbServiceError(`${name} must be a 32-byte hexadecimal value`)
  return Uint8Array.from(Buffer.from(value, 'hex'))
}

function hex(value: Uint8Array) {
  return Buffer.from(value).toString('hex')
}

/** Public identity for one locally held Proxy v1 sender key. */
export function proxyV1SenderPublicKey(privateKey: string) {
  return hex(ed25519.getPublicKey(keyBytes(privateKey, 'RGB proxy private key')))
}

/** Immutable Proxy v1 operation ID derived from the invoice and sender identity. */
export function proxyV1SenderTransferId(invoiceId: string, senderPublicKey: string) {
  if (!/^[0-9a-f]{64}$/i.test(invoiceId))
    throw new RgbServiceError('RGB proxy invoice ID must be a 32-byte hexadecimal value')
  keyBytes(senderPublicKey, 'RGB proxy public key')
  return hex(sha256(textEncoder.encode(
    'rgb-proxy-server/transfer/v1' + invoiceId.toLowerCase() + senderPublicKey.toLowerCase()
  )))
}

/** Sign a fixed-domain Proxy v1 message without exposing the ephemeral sender key. */
export function signProxyV1SenderMessage(privateKey: string, message: string) {
  return hex(ed25519.sign(
    sha256(textEncoder.encode(message)),
    keyBytes(privateKey, 'RGB proxy private key')
  ))
}

/** Canonical cross-wallet commitment signed before a buy-swap receiver ACK. */
export function rgbBuySwapCommitMessage(input: {
  proxyTransferId: string
  txid: string
  buyerSignedPsbtHash: string
}) {
  return `rgb-buy-swap/commit/v1:${input.proxyTransferId}:${input.txid}:${input.buyerSignedPsbtHash}`
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
