import { ECPairInterface, bitcoin, eccManager } from '../bitcoin-core'

const MAGIC_BYTES = Buffer.from('Bitcoin Signed Message:\n')

function varintBufNum(n: number) {
  let buf
  if (n < 253) {
    buf = Buffer.alloc(1)
    buf.writeUInt8(n, 0)
  } else if (n < 0x10000) {
    buf = Buffer.alloc(1 + 2)
    buf.writeUInt8(253, 0)
    buf.writeUInt16LE(n, 1)
  } else if (n < 0x100000000) {
    buf = Buffer.alloc(1 + 4)
    buf.writeUInt8(254, 0)
    buf.writeUInt32LE(n, 1)
  } else {
    buf = Buffer.alloc(1 + 8)
    buf.writeUInt8(255, 0)
    buf.writeInt32LE(n & -1, 1)
    buf.writeUInt32LE(Math.floor(n / 0x100000000), 5)
  }
  return buf
}

function magicHash(message: string) {
  const prefix1 = varintBufNum(MAGIC_BYTES.length)
  const messageBuffer = Buffer.from(message)
  const prefix2 = varintBufNum(messageBuffer.length)
  const buf = Buffer.concat([prefix1, MAGIC_BYTES, prefix2, messageBuffer] as any)
  return bitcoin.crypto.hash256(buf)
}

export function signMessageOfECDSA(privateKey: ECPairInterface, text: string) {
  // Use deterministic ECDSA for now - can be enhanced later
  const hash = magicHash(text)
  const signature = privateKey.sign(hash)
  return signature.toString('hex')
}

export function verifyMessageOfECDSA(publicKey: string, text: string, sig: string) {
  try {
    const hash = magicHash(text)
    const pubKeyBuffer = Buffer.from(publicKey, 'hex')

    // The signature from deterministic-ecdsa is in base64 format
    const sigBuffer = Buffer.from(sig, 'base64')

    if (sigBuffer.length !== 65) {
      return false
    }

    // The first byte is the recovery flag and is not needed for verification.
    const signature = sigBuffer.slice(1)

    // Verify the signature using ECPair
    const keyPair = eccManager.eccPair.fromPublicKey(pubKeyBuffer)
    return keyPair.verify(hash, signature)
  } catch (error) {
    return false
  }
}
