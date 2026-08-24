import { describe, expect, it } from 'vitest'

import {
  decryptRgbRecoveryCheckpoint,
  encryptRgbRecoveryCheckpoint,
} from '../src/rgb/RgbRecoveryCheckpoint'

describe('RGB recovery checkpoint', () => {
  const key = '11'.repeat(32)

  it('round-trips local recovery state and rejects a different wallet key', async () => {
    const state = { version: 1, contracts: { 'rgb:asset': { consignment: 'payload' } } }
    const payload = await encryptRgbRecoveryCheckpoint(state, key)

    await expect(decryptRgbRecoveryCheckpoint(payload, key)).resolves.toEqual(state)
    await expect(decryptRgbRecoveryCheckpoint(payload, '22'.repeat(32))).rejects.toThrow()
  })
})
