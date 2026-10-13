import { describe, expect, it } from 'vitest'

import {
  createRgbHdBackupPackage,
  isRgbHdBackupPackage,
  readRgbHdBackupPackage,
} from '../src/rgb/RgbHdBackupPackage'

describe('RGB HD backup package', () => {
  const key = '11'.repeat(32)

  it('authenticates the encrypted account packages and their indexes together', async () => {
    const payload = await createRgbHdBackupPackage(
      'mainnet',
      [
        { index: 0, payload: 'encrypted-account-0' },
        { index: 2, payload: 'encrypted-account-2' },
      ],
      key,
      123
    )
    expect(await readRgbHdBackupPackage(payload, key)).toEqual({
      magic: 'unisat-rgb-hd-backup',
      formatVersion: 1,
      createdAt: 123,
      network: 'mainnet',
      accounts: [
        { index: 0, payload: 'encrypted-account-0' },
        { index: 2, payload: 'encrypted-account-2' },
      ],
    })
    await expect(readRgbHdBackupPackage(payload, '22'.repeat(32))).rejects.toThrow(
      'does not belong to this HD wallet'
    )
  })

  it('leaves legacy single-account packages to the existing reader', () => {
    expect(isRgbHdBackupPackage('{"magic":"unisat-rgb-backup"}')).toBe(false)
  })

  it('rejects duplicate indexes and changed account lists', async () => {
    await expect(
      readRgbHdBackupPackage(
        JSON.stringify({
          magic: 'unisat-rgb-hd-backup',
          formatVersion: 1,
          createdAt: 123,
          network: 'mainnet',
          accounts: [
            { index: 0, payload: 'first' },
            { index: 0, payload: 'second' },
          ],
          authentication: '0'.repeat(64),
        }),
        key
      )
    ).rejects.toThrow('invalid')

    const payload = await createRgbHdBackupPackage('mainnet', [
      { index: 0, payload: 'first' },
      { index: 2, payload: 'second' },
    ], key)
    const changed = JSON.parse(payload)
    changed.accounts.pop()
    await expect(readRgbHdBackupPackage(JSON.stringify(changed), key)).rejects.toThrow('was changed')
  })
})
