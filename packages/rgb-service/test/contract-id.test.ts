import { describe, expect, it } from 'vitest'
import {
  decodeRgbContractId,
  encodeRgbContractId,
  normalizeRgbAssetId,
  rgbContractIdHex,
} from '../src'

const hexId = '072cd658eb21c9683a226d0507ca2e9a995fe5bbfba2625380196c67f0a6719f'
const baid64Id = 'ByzWWOsh-yWg6Im0-FB8oump-lf5bv7o-mJTgBls-Z~CmcZ8'

describe('RGB ContractId encoding', () => {
  it('treats the official BAID64 ID and legacy hex ID as the same contract', () => {
    expect(normalizeRgbAssetId(`rgb:${hexId}`)).toBe(`rgb:${baid64Id}`)
    expect(normalizeRgbAssetId(`rgb:${baid64Id}`)).toBe(`rgb:${baid64Id}`)
    expect(rgbContractIdHex(`rgb:${baid64Id}`)).toBe(hexId)
    expect(encodeRgbContractId(decodeRgbContractId(`rgb:${hexId}`))).toBe(`rgb:${baid64Id}`)
  })

  it.each(['rgb:asset/~/~/recipient', 'rgb:asset?assetId=other', 'rgb:asset'])(
    'rejects a non-ContractId asset ID: %s',
    assetId => {
      expect(() => normalizeRgbAssetId(assetId)).toThrow('BAID64 encoding is invalid')
    }
  )
})
