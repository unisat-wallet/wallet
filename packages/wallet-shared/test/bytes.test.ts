import { describe, expect, it } from 'vitest'

import { objToUint8Array } from '../src/utils/bytes'

describe('objToUint8Array', () => {
  it('converts dense byte-indexed objects', () => {
    expect(objToUint8Array({ 2: 3, 0: 1, 1: 2 })).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('rejects sparse or non-canonical indexes without allocating from the index', () => {
    expect(() => objToUint8Array({ 1000000000: 1 })).toThrow('Invalid byte array index')
    expect(() => objToUint8Array({ '01': 1 })).toThrow('Invalid byte array index')
  })

  it('rejects values outside the byte range', () => {
    expect(() => objToUint8Array({ 0: 256 })).toThrow('Invalid byte array value')
  })
})
