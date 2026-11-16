import { ed25519 } from '@noble/curves/ed25519'
import { sha256 } from '@noble/hashes/sha256'
import { describe, expect, it } from 'vitest'
import {
  deriveProxyV1SealBlinding,
  proxyV1SenderPublicKey,
  proxyV1SenderTransferId,
  signProxyV1SenderMessage,
} from '../src/protocol/proxy-v1'

describe('Proxy v1 key derivation', () => {
  it('derives the specification witness blinding symmetrically', () => {
    const senderPrivateKey = '11'.repeat(32)
    const recipientPrivateKey = '22'.repeat(32)
    const senderPublicKey = Buffer.from(
      ed25519.getPublicKey(Buffer.from(senderPrivateKey, 'hex'))
    ).toString('hex')
    const recipientPublicKey = Buffer.from(
      ed25519.getPublicKey(Buffer.from(recipientPrivateKey, 'hex'))
    ).toString('hex')

    const sender = deriveProxyV1SealBlinding(senderPrivateKey, recipientPublicKey)
    const recipient = deriveProxyV1SealBlinding(recipientPrivateKey, senderPublicKey)

    expect(sender).toBe(17_833_752_353_557_286_196n)
    expect(recipient).toBe(sender)
  })

  it('rejects malformed operation keys', () => {
    expect(() => deriveProxyV1SealBlinding('00', '11'.repeat(32)))
      .toThrow('RGB proxy private key must be a 32-byte hexadecimal value')
  })

  it('matches the Proxy v1 transfer ID and message signature rules', () => {
    const privateKey = '11'.repeat(32)
    const invoiceId = '22'.repeat(32)
    const publicKey = proxyV1SenderPublicKey(privateKey)
    const transferSource =
      'rgb-proxy-server/transfer/v1' + invoiceId + publicKey
    const transferId = proxyV1SenderTransferId(invoiceId, publicKey)
    expect(transferId).toBe(Buffer.from(
      sha256(new TextEncoder().encode(transferSource))
    ).toString('hex'))

    const message = `rgb-buy-swap/commit/v1:${transferId}:${'33'.repeat(32)}:${'44'.repeat(32)}`
    const signature = signProxyV1SenderMessage(privateKey, message)
    expect(ed25519.verify(
      Buffer.from(signature, 'hex'),
      sha256(new TextEncoder().encode(message)),
      Buffer.from(publicKey, 'hex')
    )).toBe(true)
  })
})
