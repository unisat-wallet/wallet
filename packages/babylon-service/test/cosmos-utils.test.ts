import { describe, expect, it } from 'vitest'
import { encodePubkey, makeAuthInfoBytes } from '@cosmjs/proto-signing'
import { MsgSend } from 'cosmjs-types/cosmos/bank/v1beta1/tx.js'
import { TxBody } from 'cosmjs-types/cosmos/tx/v1beta1/tx.js'

import {
  assertValidCosmosMemo,
  arbitrarySignDocToBytesHex,
  directSignDocToBytesHex,
  encodeSecp256k1Pubkey,
  encodeSecp256k1Signature,
  encodeSignature,
  escapeHTML,
  makeADR36AminoSignDoc,
  objToUint8Array,
  sortObjectByKey,
  sortedJsonByKeyStringify,
  validateCosmosDirectSignDoc,
} from '../src/cosmos/utils'

const publicKey = new Uint8Array([0x02, ...new Uint8Array(32).fill(0x11)])
const signerAddress = 'bbn1signer'

function validDirectSignDoc() {
  const message = MsgSend.fromPartial({
    fromAddress: signerAddress,
    toAddress: 'bbn1recipient',
    amount: [{ denom: 'ubbn', amount: '123' }],
  })
  const bodyBytes = TxBody.encode(
    TxBody.fromPartial({
      messages: [
        {
          typeUrl: '/cosmos.bank.v1beta1.MsgSend',
          value: MsgSend.encode(message).finish(),
        },
      ],
      memo: 'test transfer',
    })
  ).finish()
  const pubkey = encodePubkey(encodeSecp256k1Pubkey(publicKey))
  const authInfoBytes = makeAuthInfoBytes(
    [{ pubkey, sequence: 8 }],
    [{ denom: 'ubbn', amount: '2' }],
    200000
  )
  return { bodyBytes, authInfoBytes, chainId: 'bbn-1', accountNumber: '7' }
}

describe('cosmos utils', () => {
  it('limits Cosmos memos to 256 Unicode characters', () => {
    expect(() => assertValidCosmosMemo('a'.repeat(256))).not.toThrow()
    expect(() => assertValidCosmosMemo('😀'.repeat(256))).not.toThrow()
    expect(() => assertValidCosmosMemo('a'.repeat(257))).toThrow(
      'Cosmos memo must not exceed 256 characters'
    )
    expect(() => assertValidCosmosMemo([])).toThrow('Invalid Cosmos memo')
  })

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
    expect(() => encodeSecp256k1Pubkey(badPubKey)).toThrow(
      'Public key must be compressed secp256k1'
    )
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
    const signDoc = validDirectSignDoc()

    const directHex = directSignDocToBytesHex(signDoc)
    const arbitraryHex = arbitrarySignDocToBytesHex('bbn1abc', 'hello')

    expect(directHex).toMatch(/^[0-9a-f]+$/)
    expect(arbitraryHex).toMatch(/^[0-9a-f]+$/)
    expect(arbitraryHex.length).toBeGreaterThan(0)
  })

  it('decodes and validates a Direct SignDoc against the active Cosmos account', () => {
    const result = validateCosmosDirectSignDoc(validDirectSignDoc(), {
      chainId: 'bbn-1',
      signerAddress,
      publicKeyHex: Buffer.from(publicKey).toString('hex'),
      accountNumber: 7,
      sequence: 8,
    })

    expect(result.summary).toMatchObject({
      chainId: 'bbn-1',
      accountNumber: '7',
      sequence: '8',
      memo: 'test transfer',
      messages: [
        {
          type: '/cosmos.bank.v1beta1.MsgSend',
          signer: signerAddress,
          recipient: 'bbn1recipient',
          amounts: [{ denom: 'ubbn', amount: '123' }],
        },
      ],
      fee: { amounts: [{ denom: 'ubbn', amount: '2' }], gasLimit: '200000' },
    })
  })

  it('rejects degenerate, mismatched, or cross-account Direct SignDocs', () => {
    expect(() =>
      validateCosmosDirectSignDoc({
        bodyBytes: new Uint8Array(32),
        authInfoBytes: new Uint8Array([0]),
        chainId: 'bbn-1',
        accountNumber: '7',
      })
    ).toThrow()
    expect(() =>
      validateCosmosDirectSignDoc(validDirectSignDoc(), { chainId: 'bbn-test-6' })
    ).toThrow('chainId')
    expect(() =>
      validateCosmosDirectSignDoc(validDirectSignDoc(), { signerAddress: 'bbn1attacker' })
    ).toThrow('message signer')
    expect(() =>
      validateCosmosDirectSignDoc(validDirectSignDoc(), { publicKeyHex: `03${'22'.repeat(32)}` })
    ).toThrow('public key')
    expect(() =>
      validateCosmosDirectSignDoc(validDirectSignDoc(), { accountNumber: 9 })
    ).toThrow('accountNumber')
    expect(() => validateCosmosDirectSignDoc(validDirectSignDoc(), { sequence: 9 })).toThrow(
      'sequence'
    )
  })

  it('rejects known Cosmos messages with missing required signing fields', () => {
    const signDoc = validDirectSignDoc()
    const invalidMessage = MsgSend.fromPartial({
      toAddress: 'bbn1recipient',
      amount: [{ denom: 'ubbn', amount: '1' }],
    })
    signDoc.bodyBytes = TxBody.encode(
      TxBody.fromPartial({
        messages: [
          {
            typeUrl: '/cosmos.bank.v1beta1.MsgSend',
            value: MsgSend.encode(invalidMessage).finish(),
          },
        ],
      })
    ).finish()

    expect(() => validateCosmosDirectSignDoc(signDoc)).toThrow('Invalid Cosmos message')
  })

  it('converts only dense byte-indexed objects without sparse allocation', () => {
    expect(objToUint8Array({ 2: 3, 0: 1, 1: 2 })).toEqual(new Uint8Array([1, 2, 3]))
    expect(() => objToUint8Array({ 1000000000: 1 })).toThrow('Invalid byte array index')
    expect(() => objToUint8Array({ 0: 256 })).toThrow('Invalid byte array value')
    expect(() => objToUint8Array({ '01': 1 })).toThrow('Invalid byte array index')
  })

  it('encodeSignature composes pubkey and signature from hex', () => {
    const pubKeyHex = '02' + '11'.repeat(32)
    const signatureHex = 'aa'.repeat(64)

    const encoded = encodeSignature(pubKeyHex, signatureHex)

    expect(encoded.pub_key.type).toBe('tendermint/PubKeySecp256k1')
    expect(typeof encoded.signature).toBe('string')
  })
})
