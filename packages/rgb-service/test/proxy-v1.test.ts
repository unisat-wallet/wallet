import { ed25519 } from '@noble/curves/ed25519'
import { describe, expect, it } from 'vitest'
import { deriveProxyV1SealBlinding } from '../src/protocol/proxy-v1'

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
})
