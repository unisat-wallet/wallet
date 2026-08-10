import { describe, expect, it } from 'vitest'

import { getVersionInfo } from '../../src/hooks/settings'

describe('getVersionInfo', () => {
  it('reports an update only for a newer, non-skipped version', () => {
    const result = getVersionInfo({
      currentVersion: '1.2.0',
      newVersion: '1.3.0',
      skippedVersion: '',
    })

    expect(result).toMatchObject({
      isVersionCheckAvailable: true,
      isNewest: false,
      skipped: false,
      hasUpdate: true,
      latestVersion: '1.3.0',
    })
  })

  it('marks matching and newer local versions as newest', () => {
    const result = getVersionInfo({
      currentVersion: '1.3.1',
      newVersion: '1.3.0',
      skippedVersion: '',
    })

    expect(result).toMatchObject({
      isNewest: true,
      hasUpdate: false,
      latestVersion: '',
    })
  })

  it('supports all version formats accepted by compare-versions', () => {
    const result = getVersionInfo({
      currentVersion: 'v1.2',
      newVersion: '1.3',
      skippedVersion: '',
    })

    expect(result).toMatchObject({
      isVersionCheckAvailable: true,
      hasUpdate: true,
      latestVersion: '1.3',
    })
  })

  it('suppresses an explicitly skipped update without treating it as newest', () => {
    const result = getVersionInfo({
      currentVersion: '1.2.0',
      newVersion: '1.3.0',
      skippedVersion: '1.3.0',
    })

    expect(result).toMatchObject({
      isNewest: false,
      skipped: true,
      hasUpdate: false,
      latestVersion: '',
    })
  })

  it.each([
    { currentVersion: '1.2.0', newVersion: '' },
    { currentVersion: '0.0.0', newVersion: '1.3.0' },
    { currentVersion: 'invalid', newVersion: '1.3.0' },
  ])('does not show an update when the version pair cannot be compared', input => {
    const result = getVersionInfo({ ...input, skippedVersion: '' })

    expect(result).toMatchObject({
      isVersionCheckAvailable: false,
      isNewest: false,
      hasUpdate: false,
      latestVersion: '',
    })
  })
})
