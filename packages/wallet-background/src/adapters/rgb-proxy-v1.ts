import { ed25519, edwardsToMontgomeryPriv, edwardsToMontgomeryPub, x25519 } from '@noble/curves/ed25519'
import { sha256 } from '@noble/hashes/sha256'

const encoder = new TextEncoder()

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

async function aesKey(privateKey: string, peerPublicKey: string, transferId: string) {
  const shared = x25519.getSharedSecret(
    edwardsToMontgomeryPriv(Buffer.from(privateKey, 'hex')),
    edwardsToMontgomeryPub(Buffer.from(peerPublicKey, 'hex'))
  )
  const key = sha256(concat(bytes('rgb-proxy-server/signed-tx/v1'), shared, bytes(transferId)))
  return globalThis.crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

/** Stable ciphertext makes an idempotent ack.prepare retry byte-for-byte identical. */
export async function proxyV1EncryptSignedTx(
  rawTx: string,
  senderPrivateKey: string,
  recipientPublicKey: string,
  transferId: string
) {
  if (!/^(?:[0-9a-f]{2})+$/i.test(rawTx)) throw new Error('RGB signed transaction is invalid')
  const iv = sha256(concat(
    bytes('rgb-proxy-server/signed-tx-iv/v1'),
    Buffer.from(senderPrivateKey, 'hex'),
    bytes(transferId),
    Buffer.from(rawTx, 'hex')
  )).slice(0, 12)
  const key = await aesKey(senderPrivateKey, recipientPublicKey, transferId)
  const ciphertext = new Uint8Array(await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: bytes(transferId) },
    key,
    Buffer.from(rawTx, 'hex')
  ))
  return Buffer.from(concat(Uint8Array.from([1]), iv, ciphertext)).toString('base64')
}

export async function proxyV1DecryptSignedTx(
  encrypted: string,
  recipientPrivateKey: string,
  senderPublicKey: string,
  transferId: string
) {
  const payload = Buffer.from(encrypted, 'base64')
  if (payload.length < 30 || payload[0] !== 1) throw new Error('RGB proxy signed transaction is invalid')
  const key = await aesKey(recipientPrivateKey, senderPublicKey, transferId)
  const plaintext = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: payload.subarray(1, 13), additionalData: bytes(transferId) },
    key,
    payload.subarray(13)
  )
  return hex(new Uint8Array(plaintext))
}

export async function proxyV1Pow(transferId: string, difficulty: number, timestamp: string) {
  if (!Number.isInteger(difficulty) || difficulty < 0 || difficulty > 24) {
    throw new Error('RGB proxy proof-of-work difficulty is invalid')
  }
  if (difficulty === 0) return '0'
  for (let nonce = 0; nonce < 1 << 28; nonce++) {
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
  throw new Error('RGB proxy proof of work could not be completed')
}
