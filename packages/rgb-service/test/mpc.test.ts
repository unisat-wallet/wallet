import { describe, expect, it } from 'vitest'
import { commitMpc, serializeMpcMerkleProof, verifyMpcMerkleProof } from '../src'

const hex = (value: string) =>
  Uint8Array.from(value.match(/../g)!.map(byte => Number.parseInt(byte, 16)))
const toHex = (value: Uint8Array) =>
  [...value].map(byte => byte.toString(16).padStart(2, '0')).join('')

describe('commitMpc', () => {
  it('matches the MPC commitment inserted into rgb-lib Opret PSBT output', () => {
    const result = commitMpc(
      [
        {
          protocolId: hex('11'.repeat(32)),
          message: hex('b8a17ad2032106ab4d28707fcd04b5fa2601b408649647bb713b3e3be64d0dd1'),
        },
      ],
      0x0102_0304_0506_0708n
    )
    expect(result.depth).toBe(3)
    expect(result.cofactor).toBe(0)
    expect(result.positions.get('11'.repeat(32))).toBe(1)
    expect(toHex(result.merkleRoot)).toBe(
      'f6549134e5602a689930f3469bb121355195e0bbbeba46fb4c5c3664808d31ac'
    )
    expect(toHex(result.commitment)).toBe(
      '2b415eaeceafdacb0487441ef1740b72a82aa1a89423fc865110d9e6c66eecd3'
    )
  })
})

it('matches rgb-lib MerkleProof strict encoding for an Opret anchor', () => {
  const protocolId = hex('11'.repeat(32))
  const proof = serializeMpcMerkleProof(
    [{ protocolId, message: hex('22'.repeat(32)) }],
    0x0102_0304_0506_0708n,
    protocolId
  )

  expect(toHex(proof)).toBe(
    '01000000000003c186e0a821a869af6d88db9bd8cdb5bd151f80b4b2f6c8b518d5b59a42282e9d2b371e82e82ce6036a13a7a2fcb1064c4b53e46e61196fbe5c710e74d94a858e5d31c7c51533f4cee2ccb6ed789221e8ec7433693dc917bf9ee8770389bab556'
  )
})

it('rebuilds an MPC commitment from its strict MerkleProof', () => {
  const protocolId = hex('11'.repeat(32))
  const message = hex('22'.repeat(32))
  const entropy = 0x0102_0304_0506_0708n
  const proof = serializeMpcMerkleProof([{ protocolId, message }], entropy, protocolId)
  expect(toHex(verifyMpcMerkleProof({ protocolId, message, proof }))).toBe(
    toHex(commitMpc([{ protocolId, message }], entropy).commitment)
  )
})
