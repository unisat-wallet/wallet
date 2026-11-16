import { describe, expect, it } from 'vitest'

import { ChainType } from '@unisat/wallet-types'
import { getBabylonConfig, getVersionInfo } from '../../src/hooks/settings'

describe('getBabylonConfig', () => {
  it('maps only the explicitly supported Bitcoin networks', () => {
    expect(getBabylonConfig(ChainType.BITCOIN_MAINNET)?.chainId).toBe('bbn-1')
    expect(getBabylonConfig(ChainType.BITCOIN_SIGNET)?.chainId).toBe('bbn-test-6')
  })

  it.each([
    ChainType.BITCOIN_TESTNET,
    ChainType.BITCOIN_TESTNET4,
    ChainType.FRACTAL_BITCOIN_MAINNET,
    ChainType.FRACTAL_BITCOIN_TESTNET,
  ])('does not fall back to Babylon mainnet for unsupported chain %s', chainType => {
    expect(getBabylonConfig(chainType)).toBeUndefined()
  })
})

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
