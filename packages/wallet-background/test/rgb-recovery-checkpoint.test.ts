import { describe, expect, it } from 'vitest'

import {
  decryptRgbRecoveryCheckpoint,
  encryptRgbRecoveryCheckpoint,
  RGB_RECOVERY_MAX_PLAINTEXT_BYTES,
} from '../src/rgb/RgbRecoveryCheckpoint'

describe('RGB recovery checkpoint', () => {
  const key = '11'.repeat(32)

  it('round-trips local recovery state and rejects a different wallet key', async () => {
    const state = { version: 1, contracts: { 'rgb:asset': { consignment: 'payload' } } }
    const payload = await encryptRgbRecoveryCheckpoint(state, key)

    await expect(decryptRgbRecoveryCheckpoint(payload, key)).resolves.toEqual(state)
    await expect(decryptRgbRecoveryCheckpoint(payload, '22'.repeat(32))).rejects.toThrow()
  })

  it('rejects a recovery state beyond the encrypted upload budget', async () => {
    await expect(
      encryptRgbRecoveryCheckpoint({ payload: 'x'.repeat(RGB_RECOVERY_MAX_PLAINTEXT_BYTES) }, key)
    ).rejects.toThrow('too large')
  })
})
