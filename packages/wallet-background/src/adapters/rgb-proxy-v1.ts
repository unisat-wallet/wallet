import { ed25519, edwardsToMontgomeryPriv, edwardsToMontgomeryPub, x25519 } from '@noble/curves/ed25519'
import { xchacha20poly1305 } from '@noble/ciphers/chacha'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'

const encoder = new TextEncoder()
export const RGB_PROXY_MAX_POW_DIFFICULTY = 18
export const RGB_PROXY_MAX_POW_ATTEMPTS = 1_048_576

/** Untrusted proxy work requests must never be retried by background polling. */
export class RgbProxyProofOfWorkError extends Error {
  readonly automaticRetry = false

  constructor(message: string) {
    super(message)
    this.name = 'RgbProxyProofOfWorkError'
  }
}

function bytes(value: string) {
  return encoder.encode(value)
}

function hex(value: Uint8Array) {
  return Buffer.from(value).toString('hex')
}

function concat(...parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

export function proxyV1Hash(value: Uint8Array) {
  return hex(sha256(value))
}

export function proxyV1HashText(value: string) {
  return proxyV1Hash(bytes(value))
}

export function proxyV1PublicKey(privateKey: string) {
  return hex(ed25519.getPublicKey(Buffer.from(privateKey, 'hex')))
}

export function proxyV1TransferId(invoiceId: string, senderPublicKey: string) {
  return proxyV1HashText('rgb-proxy-server/transfer/v1' + invoiceId + senderPublicKey)
}

export function proxyV1Sign(privateKey: string, message: string) {
  return hex(ed25519.sign(sha256(bytes(message)), Buffer.from(privateKey, 'hex')))
}

export function proxyV1Verify(publicKey: string, signature: string, message: string) {
  try {
    return ed25519.verify(
      Buffer.from(signature, 'hex'),
      sha256(bytes(message)),
      Buffer.from(publicKey, 'hex')
    )
  } catch {
    return false
  }
}

const CHUNK_SIZE = 65_536
const TAG_SIZE = 16

function sharedKey(privateKey: string, peerPublicKey: string) {
  const shared = x25519.getSharedSecret(
    edwardsToMontgomeryPriv(Buffer.from(privateKey, 'hex')),
    edwardsToMontgomeryPub(Buffer.from(peerPublicKey, 'hex'))
  )
  return hkdf(sha256, shared, undefined, bytes('rgb-proxy-server/enc/v1'), 32)
}

function chunkNonce(plaintextHash: Uint8Array, counter: number, isFinal: boolean) {
  const nonce = new Uint8Array(24)
  nonce.set(plaintextHash.subarray(13), 0)
  new DataView(nonce.buffer).setUint32(19, counter, false)
  nonce[23] = Number(isFinal)
  return nonce
}

/** Proxy v1 encrypts the file; its declared hash always identifies the plaintext. */
export function proxyV1EncryptBlob(plaintext: Uint8Array, privateKey: string, peerPublicKey: string) {
  const plaintextHash = sha256(plaintext)
  const key = sharedKey(privateKey, peerPublicKey)
  const parts: Uint8Array[] = [Uint8Array.from([1])]
  for (let offset = 0, counter = 0; ; offset += CHUNK_SIZE, counter++) {
    const chunk = plaintext.subarray(offset, offset + CHUNK_SIZE)
    const isFinal = offset + CHUNK_SIZE >= plaintext.length
    parts.push(xchacha20poly1305(key, chunkNonce(plaintextHash, counter, isFinal)).encrypt(chunk))
    if (isFinal) break
  }
  return concat(...parts)
}

export function proxyV1DecryptBlob(blob: Uint8Array, privateKey: string, peerPublicKey: string, plaintextHashHex: string) {
  if (!/^[0-9a-f]{64}$/i.test(plaintextHashHex) || blob[0] !== 1 || blob.length < 1 + TAG_SIZE) {
    throw new Error('RGB proxy encrypted blob is invalid')
  }
  const plaintextHash = Buffer.from(plaintextHashHex, 'hex')
  const key = sharedKey(privateKey, peerPublicKey)
  const parts: Uint8Array[] = []
  for (let offset = 1, counter = 0; offset < blob.length; offset += CHUNK_SIZE + TAG_SIZE, counter++) {
    const end = Math.min(offset + CHUNK_SIZE + TAG_SIZE, blob.length)
    const isFinal = end === blob.length
    if (end - offset < TAG_SIZE) throw new Error('RGB proxy encrypted blob is truncated')
    parts.push(xchacha20poly1305(key, chunkNonce(plaintextHash, counter, isFinal)).decrypt(blob.subarray(offset, end)))
  }
  const plaintext = concat(...parts)
  if (proxyV1Hash(plaintext) !== plaintextHashHex.toLowerCase()) {
    throw new Error('RGB proxy returned a consignment with an invalid hash')
  }
  return plaintext
}

/** Stable ciphertext makes an idempotent ack.prepare retry byte-for-byte identical. */
export async function proxyV1EncryptSignedTx(rawTx: string, senderPrivateKey: string, recipientPublicKey: string) {
  if (!/^(?:[0-9a-f]{2})+$/i.test(rawTx)) throw new Error('RGB signed transaction is invalid')
  return Buffer.from(proxyV1EncryptBlob(Buffer.from(rawTx, 'hex'), senderPrivateKey, recipientPublicKey)).toString('base64')
}

export async function proxyV1DecryptSignedTx(encrypted: string, recipientPrivateKey: string, senderPublicKey: string, signedTxHash: string) {
  return hex(proxyV1DecryptBlob(Buffer.from(encrypted, 'base64'), recipientPrivateKey, senderPublicKey, signedTxHash))
}

export async function proxyV1Pow(transferId: string, difficulty: number, timestamp: string) {
  if (
    !Number.isInteger(difficulty) ||
    difficulty < 0 ||
    difficulty > RGB_PROXY_MAX_POW_DIFFICULTY
  ) {
    throw new RgbProxyProofOfWorkError('RGB proxy proof-of-work difficulty exceeds the local safety limit')
  }
  if (difficulty === 0) return '0'
  for (let nonce = 0; nonce < RGB_PROXY_MAX_POW_ATTEMPTS; nonce++) {
    const value = sha256(bytes(transferId + timestamp + String(nonce)))
    let zeroBits = 0
    for (const byte of value) {
      if (byte === 0) { zeroBits += 8; continue }
      zeroBits += Math.clz32(byte) - 24
      break
    }
    if (zeroBits >= difficulty) return String(nonce)
    if (nonce % 4096 === 0) await new Promise(resolve => setTimeout(resolve, 0))
  }
  throw new RgbProxyProofOfWorkError('RGB proxy proof of work exceeded the local work budget')
}
