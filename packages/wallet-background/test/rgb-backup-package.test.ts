import { describe, expect, it } from 'vitest'

import { createRgbBackupPackage, readRgbBackupPackage } from '../src/rgb/RgbBackupPackage'

describe('RGB backup package', () => {
  const key = '11'.repeat(32)

  it('round-trips a portable state only with the wallet that created it', async () => {
    const state = { version: 1, wallet: { network: 'mainnet' }, contracts: { 'rgb:asset': {} } }
    const payload = await createRgbBackupPackage(state, key, 123)

    await expect(readRgbBackupPackage(payload, key)).resolves.toEqual({
      formatVersion: 1,
      createdAt: 123,
      state,
    })
    await expect(readRgbBackupPackage(payload, '22'.repeat(32))).rejects.toThrow(
      'cannot be decrypted by this wallet'
    )
  })

  it('rejects ciphertext that is not an RGB export package', async () => {
    await expect(readRgbBackupPackage('{"version":1}', key)).rejects.toThrow(
      'RGB backup package is invalid'
    )
  })
})
