import { describe, expect, it } from 'vitest'

import {
  arbitrarySignDocToBytesHex,
  directSignDocToBytesHex,
  encodeSecp256k1Pubkey,
  encodeSecp256k1Signature,
  encodeSignature,
  escapeHTML,
  makeADR36AminoSignDoc,
  sortObjectByKey,
  sortedJsonByKeyStringify,
} from '../src/cosmos/utils'

describe('cosmos utils', () => {
  it('sortObjectByKey recursively sorts object keys and keeps array order', () => {
    const input = {
      z: 1,
      a: {
        y: 2,
        b: 3,
      },
      m: [{ d: 4, c: 5 }],
    }

    const output = sortObjectByKey(input)

    expect(Object.keys(output)).toEqual(['a', 'm', 'z'])
    expect(Object.keys(output.a)).toEqual(['b', 'y'])
    expect(Object.keys(output.m[0])).toEqual(['c', 'd'])
  })

  it('sortedJsonByKeyStringify returns stable sorted json string', () => {
    const input = { b: 1, a: { d: 2, c: 3 } }
    expect(sortedJsonByKeyStringify(input)).toBe('{"a":{"c":3,"d":2},"b":1}')
  })

  it('escapeHTML escapes < > & into unicode sequences', () => {
    expect(escapeHTML('<a&b>')).toBe('\\u003ca\\u0026b\\u003e')
  })

  it('makeADR36AminoSignDoc always stores data as base64', () => {
    const signDocFromString = makeADR36AminoSignDoc('bbn1abc', 'hello')
    const signDocFromBytes = makeADR36AminoSignDoc('bbn1abc', new Uint8Array([104, 105]))

    expect(signDocFromString.msgs[0].value.data).toBe('aGVsbG8=')
    expect(signDocFromBytes.msgs[0].value.data).toBe('aGk=')
  })

  it('encodeSecp256k1Pubkey validates compressed public key format', () => {
    const goodPubKey = new Uint8Array(33)
    goodPubKey[0] = 0x02
    const encoded = encodeSecp256k1Pubkey(goodPubKey)

    expect(encoded.type).toBe('tendermint/PubKeySecp256k1')
    expect(typeof encoded.value).toBe('string')

    const badPubKey = new Uint8Array(33)
    badPubKey[0] = 0x04
    expect(() => encodeSecp256k1Pubkey(badPubKey)).toThrow('Public key must be compressed secp256k1')
  })

  it('encodeSecp256k1Signature validates fixed 64-byte signature', () => {
    const pubKey = new Uint8Array(33)
    pubKey[0] = 0x03
    const sig64 = new Uint8Array(64)

    const encoded = encodeSecp256k1Signature(pubKey, sig64)
    expect(encoded.pub_key.type).toBe('tendermint/PubKeySecp256k1')
    expect(typeof encoded.signature).toBe('string')

    expect(() => encodeSecp256k1Signature(pubKey, new Uint8Array(63))).toThrow(
      'Signature must be 64 bytes long'
    )
  })

  it('directSignDocToBytesHex and arbitrarySignDocToBytesHex produce hex output', () => {
    const signDoc = {
      bodyBytes: { 0: 1, 1: 2, 2: 3 },
      authInfoBytes: { 0: 4, 1: 5 },
      chainId: 'bbn-test',
      accountNumber: 7,
    }

    const directHex = directSignDocToBytesHex(signDoc)
    const arbitraryHex = arbitrarySignDocToBytesHex('bbn1abc', 'hello')

    expect(directHex).toMatch(/^[0-9a-f]+$/)
    expect(arbitraryHex).toMatch(/^[0-9a-f]+$/)
    expect(arbitraryHex.length).toBeGreaterThan(0)
  })

  it('encodeSignature composes pubkey and signature from hex', () => {
    const pubKeyHex = '02' + '11'.repeat(32)
    const signatureHex = 'aa'.repeat(64)

    const encoded = encodeSignature(pubKeyHex, signatureHex)

    expect(encoded.pub_key.type).toBe('tendermint/PubKeySecp256k1')
    expect(typeof encoded.signature).toBe('string')
  })
})
