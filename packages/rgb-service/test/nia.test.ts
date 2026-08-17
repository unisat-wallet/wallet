import { describe, expect, it } from 'vitest'
import { encodeNiaTransition, niaInputFromAllocation } from '../src'

function toHex(bytes: Uint8Array) {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

describe('encodeNiaTransition', () => {
  it('requires indexed parent operation data', () => {
    expect(() =>
      niaInputFromAllocation({ assetId: 'rgb:asset', amount: '1', settled: true, spendable: true })
    ).toThrow('parent operation output')
  })

  it('matches rgb-lib strict transition and OpId vectors', () => {
    const encoded = encodeNiaTransition({
      contractId: '11'.repeat(32),
      nonce: 0x0102_0304_0506_0708n,
      inputs: [{ opId: '22'.repeat(32), assignmentIndex: 0 }],
      assignments: [
        {
          amount: 400n,
          seal: { txid: null, vout: 1, blinding: 0x0102_0304_0506_0708n },
        },
        {
          amount: 600n,
          seal: { txid: '33'.repeat(32), vout: 2, blinding: 0x1112_1314_1516_1718n },
        },
      ],
    })

    expect(toHex(encoded.strict)).toBe(
      '0000111111111111111111111111111111111111111111111111111111111111111108070605040302011027000001002222222222222222222222222222222222222222222222222222222222222222a00f00000100a00f01020000000100000008070605040302010890010000000000000001333333333333333333333333333333333333333333333333333333333333333302000000181716151413121108580200000000000000'
    )
    expect(toHex(encoded.opCommitment)).toBe(
      '000008070605040302010111111111111111111111111111111111111111111111111111111111111111111027bd1380e8912f273087938a93b9ed8f497b5358187cb1b36d7f6f332015dd53535442b1a1ae7badee5391857589104a594e466ffc6fd6484d2890b466537f7f7a6ac04dafdf6a265595f93711f28f64a425d28495095df5f8353f45c3ff4325e1b6ccd46e291b6f403ca87eb66deca4ef4f0916695612aa7c85ec5fabfa987c50'
    )
    expect(toHex(encoded.opId)).toBe(
      '58b132e5ee94893730f33cc7d1d979b84f4a7e6017447efb6440b6031fac736c'
    )
  })

  it('serializes revealed seal transaction IDs in Bitcoin wire order', () => {
    const txid = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
    const encoded = encodeNiaTransition({
      contractId: '11'.repeat(32),
      nonce: 1n,
      inputs: [{ opId: '22'.repeat(32), assignmentIndex: 0 }],
      assignments: [{ amount: 1n, seal: { txid, vout: 0, blinding: 1n } }],
    })

    const wireTxid = [...Buffer.from(txid, 'hex')]
      .reverse()
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('')
    expect(toHex(encoded.strict)).toContain(wireTxid)
  })
})
