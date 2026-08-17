import { describe, expect, it } from 'vitest'
import { transitionBundleId } from '../src'

describe('transitionBundleId', () => {
  it('matches the RGB consensus commitment for the sorted input map', () => {
    const bundleId = transitionBundleId([
      {
        opId: '11'.repeat(32),
        assignmentType: 4000,
        assignmentIndex: 3,
        transitionId: Uint8Array.from(Buffer.from('22'.repeat(32), 'hex')),
      },
    ])

    expect(Buffer.from(bundleId).toString('hex')).toBe(
      '6af4199715534a7fea4e252a2a6a2d5e251249b82c34160d85371d211cea077a'
    )
  })
})
