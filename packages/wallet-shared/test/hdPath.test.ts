import { describe, expect, it } from 'vitest'

import { getAccountDerivationPath, isChangeAddressHdPath } from '../src/utils/hdPath'

describe('getAccountDerivationPath', () => {
  it('appends account index in standard mode', () => {
    expect(getAccountDerivationPath("m/84'/0'/0'/0", 2)).toBe("m/84'/0'/0'/0/2")
  })

  it('replaces account segment in account-index derivation mode', () => {
    expect(getAccountDerivationPath("m/84'/0'/0'/0", 2, true)).toBe("m/84'/0'/2'/0/0")
  })

  it('throws when account-index derivation receives invalid path', () => {
    expect(() => getAccountDerivationPath("m/84'/0'", 1, true)).toThrow(
      'Invalid hdPath for account-index derivation'
    )
  })
})

describe('isChangeAddressHdPath', () => {
  it('identifies the BIP44 change branch', () => {
    expect(isChangeAddressHdPath("m/84'/0'/0'/1")).toBe(true)
  })

  it.each([
    "m/84'/0'/0'",
    "m/84'/0'/0'/0",
    "m/84'/0'/0'/11",
    "m/84'/0'/0'/1/0",
    "m/84/0'/0'/1",
    'not-a-path-1',
    undefined,
  ])('rejects non-change path %j', hdPath => {
    expect(isChangeAddressHdPath(hdPath)).toBe(false)
  })
})
