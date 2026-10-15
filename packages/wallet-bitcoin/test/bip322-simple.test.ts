import { describe, expect, it } from 'vitest'
import { NetworkType } from '@unisat/wallet-types'
import { bitcoin, eccManager } from '../src/bitcoin-core'
import {
  genPsbtOfBIP322Simple,
  getSignatureFromPsbtOfBIP322Simple,
  verifyMessageOfBIP322Simple,
} from '../src/message/bip322-simple'

describe('BIP322 simple P2WPKH verification', () => {
  it('accepts a signature from the address owner', () => {
    const signer = eccManager.eccPair.fromPrivateKey(Buffer.alloc(32, 1))
    const address = bitcoin.payments.p2wpkh({ pubkey: signer.publicKey }).address!
    const message = 'BIP322 address ownership test'
    const psbt = genPsbtOfBIP322Simple({ message, address, networkType: NetworkType.MAINNET })

    psbt.signAllInputs(signer)
    psbt.finalizeAllInputs()
    const signature = getSignatureFromPsbtOfBIP322Simple(psbt)

    expect(verifyMessageOfBIP322Simple(address, message, signature)).toBe(true)
    expect(verifyMessageOfBIP322Simple(address, 'different message', signature)).toBe(false)
  })

  it('rejects a valid signature from an unrelated public key', () => {
    const victimAddress = 'bc1ql3e9pgs3mmwuwrh95fecme0s0qtn2880lsvsd5'
    const message = 'app.example wants you to sign in with your Bitcoin account\nnonce: 7c1d9a'
    const forgedSignature =
      'AkgwRQIhAPrdudbcbKyZGFZqUT1MLOWoInftOLRe418PlBZwVXAPAiAvliraTKJf9nfMTubO1IsD/LrskxCkhWIDheniZ1YIBgEhA48Z7nZ3cTgGxmIHip8rLHuTA3bSLy1he85QteREg5p8'

    expect(verifyMessageOfBIP322Simple(victimAddress, message, forgedSignature)).toBe(false)
  })
})
