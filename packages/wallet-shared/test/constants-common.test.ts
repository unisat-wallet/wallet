import { describe, expect, it } from 'vitest'

import {
  BROWSER_TO_APP_LOCALE_MAP,
  CHAIN_GROUPS,
  CHAINS,
  CHAINS_MAP,
  DEFAULT_I18N_CONFIG,
  DEFAULT_LOCKTIME_ID,
  FALLBACK_LOCALE,
  LOCALE_NAMES,
  NETWORK_TYPES,
  SUPPORTED_LOCALES,
  getAutoLockTimes,
  getLockTimeInfo,
  isSupportedChainType,
} from '../src/constants/common'
import { ChainType, NetworkType } from '@unisat/wallet-types'

describe('common constants', () => {
  it('getAutoLockTimes builds translated labels', () => {
    const t = (key: string) => `_${key}_`
    const times = getAutoLockTimes(t)

    expect(times).toHaveLength(8)
    expect(times[0]).toEqual({ id: 0, time: 30000, label: '30_seconds_' })
    expect(times[6]).toEqual({ id: 6, time: 3600000, label: '1_hour_' })
  })

  it('getLockTimeInfo returns exact entry or default fallback', () => {
    const found = getLockTimeInfo(4)
    expect(found.id).toBe(4)
    expect(found.time).toBe(600000)

    const fallback = getLockTimeInfo(999)
    expect(fallback.id).toBe(DEFAULT_LOCKTIME_ID)
  })

  it('chain map and chain list are consistent', () => {
    expect(CHAINS).toEqual(Object.values(CHAINS_MAP))
    for (const [chainType, chain] of Object.entries(CHAINS_MAP)) {
      expect(chain.enum).toBe(chainType)
    }
    const groupedChains = CHAIN_GROUPS.flatMap(group =>
      group.type === 'single' ? [group.chain] : group.items || []
    )
    expect(groupedChains.every(chain => chain && CHAINS.includes(chain))).toBe(true)
    expect(CHAIN_GROUPS.length).toBeGreaterThan(0)
  })

  it.each(['constructor', 'toString', 'valueOf', '__proto__'])(
    'does not accept inherited object key %s as a chain',
    chainType => {
      expect(isSupportedChainType(chainType)).toBe(false)
      expect(CHAINS_MAP[chainType]).toBeUndefined()
    }
  )

  it('i18n locale constants are internally consistent', () => {
    expect(FALLBACK_LOCALE).toBe('en')
    expect(DEFAULT_I18N_CONFIG.fallbackLocale).toBe(FALLBACK_LOCALE)
    expect(DEFAULT_I18N_CONFIG.supportedLocales).toEqual(SUPPORTED_LOCALES)

    expect(BROWSER_TO_APP_LOCALE_MAP['zh-CN']).toBe('zh_TW')
    expect(SUPPORTED_LOCALES.includes('zh_TW')).toBe(true)
    expect(LOCALE_NAMES.zh_TW).toBe('中文(繁體)')
  })

  it('network type descriptors include expected aliases', () => {
    expect(NETWORK_TYPES[0]).toMatchObject({
      value: NetworkType.MAINNET,
      label: 'LIVENET',
      name: 'livenet',
    })
    expect(NETWORK_TYPES[0]?.validNames).toContain('mainnet')
    expect(NETWORK_TYPES[1]).toMatchObject({
      value: NetworkType.TESTNET,
      label: 'TESTNET',
      name: 'testnet',
    })
  })
})
