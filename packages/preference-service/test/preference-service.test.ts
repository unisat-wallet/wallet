import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AddressFlagType } from '@unisat/wallet-shared'
import { ChainType, NetworkType } from '@unisat/wallet-types'
import { PreferenceService } from '../src/preference-service'

const createStorage = () => ({
  createPersistentProxy: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
})

describe('PreferenceService', () => {
  let storage: ReturnType<typeof createStorage>
  let service: PreferenceService

  beforeEach(() => {
    vi.clearAllMocks()
    storage = createStorage()
    service = new PreferenceService()
  })

  it('initializes store and repairs invalid/missing defaults', async () => {
    const rawStore: any = {
      locale: 'unknown-locale',
      currency: '',
      externalLinkAck: 'x',
      showSafeNotice: undefined,
      balanceMap: null,
      historyMap: null,
      walletSavedList: null,
      keyringAlianNames: null,
      accountAlianNames: null,
      addressFlags: null,
      uiCachedData: null,
      appTab: null,
      currentAccount: { address: 'bc1qabc' },
      rateUsStatus: null,
    }

    storage.createPersistentProxy.mockResolvedValue(rawStore)

    await service.init({
      storage: storage as any,
      logger: { debug: vi.fn(), error: vi.fn() },
    })

    expect(storage.createPersistentProxy).toHaveBeenCalledWith(
      'preference',
      expect.objectContaining({
        locale: 'en',
        chainType: ChainType.BITCOIN_MAINNET,
        networkType: NetworkType.MAINNET,
      })
    )

    expect(service.getLocale()).toBe('en')
    expect(service.getCurrency()).toBe('USD')
    expect(service.getExternalLinkAck()).toBe(false)
    expect(service.getShowSafeNotice()).toBe(true)
    expect(service.getCurrentAccount()).toBeNull()
    expect(service.getWalletSavedList()).toEqual([])
    expect(service.getAddressBalance('bc1qnone')).toBeNull()
    expect(service.getAddressHistory('bc1qnone')).toEqual([])

    expect(service.getRateUsStatus()).toEqual({
      hasRated: false,
      ratePromptDismissedAt: null,
      hasShownSecondPrompt: false,
    })
  })

  it('updates and removes address balance/history maps', async () => {
    storage.createPersistentProxy.mockResolvedValue({
      locale: 'en',
      currency: 'USD',
      externalLinkAck: false,
      showSafeNotice: true,
      currentAccount: null,
      currentKeyringIndex: 0,
      editingKeyringIndex: 0,
      editingAccount: null,
      balanceMap: {},
      historyMap: {},
      watchAddressPreference: {},
      walletSavedList: [],
      alianNames: {},
      initAlianNames: false,
      currentVersion: '0',
      firstOpen: false,
      addressType: 0,
      networkType: NetworkType.MAINNET,
      chainType: ChainType.BITCOIN_MAINNET,
      keyringAlianNames: {},
      accountAlianNames: {},
      uiCachedData: {},
      skippedVersion: '',
      appTab: { summary: { apps: [] }, readAppTime: {}, readTabTime: 1 },
      addressFlags: {},
      autoLockTimeId: 2,
      openInSidePanel: false,
      developerMode: false,
      rateUsStatus: { hasRated: false, ratePromptDismissedAt: 0, hasShownSecondPrompt: false },
      acceptLowFeeMode: false,
    })

    await service.init({ storage: storage as any, logger: { debug: vi.fn(), error: vi.fn() } })

    const balance = {
      amount: '1',
      confirm_amount: '1',
      pending_amount: '0',
      btc_amount: '1',
      confirm_btc_amount: '1',
      pending_btc_amount: '0',
      inscription_amount: '0',
      confirm_inscription_amount: '0',
      pending_inscription_amount: '0',
      usd_value: '100000',
    }

    service.updateAddressBalance('bc1q1', balance as any)
    expect(service.getAddressBalance('bc1q1')).toEqual(balance)

    service.removeAddressBalance('bc1q1')
    expect(service.getAddressBalance('bc1q1')).toBeNull()

    service.updateAddressHistory('bc1q1', [{ txid: 'tx1' } as any])
    expect(service.getAddressHistory('bc1q1')).toEqual([{ txid: 'tx1' }])

    service.removeAddressHistory('bc1q1')
    expect(service.getAddressHistory('bc1q1')).toEqual([])
  })

  it('supports address flag bit operations', async () => {
    storage.createPersistentProxy.mockResolvedValue({
      locale: 'en',
      currency: 'USD',
      externalLinkAck: false,
      showSafeNotice: true,
      currentAccount: null,
      currentKeyringIndex: 0,
      editingKeyringIndex: 0,
      editingAccount: null,
      balanceMap: {},
      historyMap: {},
      watchAddressPreference: {},
      walletSavedList: [],
      alianNames: {},
      initAlianNames: false,
      currentVersion: '0',
      firstOpen: false,
      addressType: 0,
      networkType: NetworkType.MAINNET,
      chainType: ChainType.BITCOIN_MAINNET,
      keyringAlianNames: {},
      accountAlianNames: {},
      uiCachedData: {},
      skippedVersion: '',
      appTab: { summary: { apps: [] }, readAppTime: {}, readTabTime: 1 },
      addressFlags: {},
      autoLockTimeId: 2,
      openInSidePanel: false,
      developerMode: false,
      rateUsStatus: { hasRated: false, ratePromptDismissedAt: 0, hasShownSecondPrompt: false },
      acceptLowFeeMode: false,
    })

    await service.init({ storage: storage as any, logger: { debug: vi.fn(), error: vi.fn() } })

    expect(service.getAddressFlag('bc1q1')).toBe(0)

    const add1 = service.addAddressFlag('bc1q1', AddressFlagType.CONFIRMED_UTXO_MODE)
    expect(add1).toBe(AddressFlagType.CONFIRMED_UTXO_MODE)

    const add2 = service.addAddressFlag('bc1q1', AddressFlagType.DISABLE_ARC20)
    expect(add2).toBe(AddressFlagType.CONFIRMED_UTXO_MODE | AddressFlagType.DISABLE_ARC20)

    const removed = service.removeAddressFlag('bc1q1', AddressFlagType.CONFIRMED_UTXO_MODE)
    expect(removed).toBe(AddressFlagType.DISABLE_ARC20)
    expect(service.getAddressFlag('bc1q1')).toBe(AddressFlagType.DISABLE_ARC20)
  })

  it('updates and resets rate-us status fields', async () => {
    storage.createPersistentProxy.mockResolvedValue({
      locale: 'en',
      currency: 'USD',
      externalLinkAck: false,
      showSafeNotice: true,
      currentAccount: null,
      currentKeyringIndex: 0,
      editingKeyringIndex: 0,
      editingAccount: null,
      balanceMap: {},
      historyMap: {},
      watchAddressPreference: {},
      walletSavedList: [],
      alianNames: {},
      initAlianNames: false,
      currentVersion: '0',
      firstOpen: false,
      addressType: 0,
      networkType: NetworkType.MAINNET,
      chainType: ChainType.BITCOIN_MAINNET,
      keyringAlianNames: {},
      accountAlianNames: {},
      uiCachedData: {},
      skippedVersion: '',
      appTab: { summary: { apps: [] }, readAppTime: {}, readTabTime: 1 },
      addressFlags: {},
      autoLockTimeId: 2,
      openInSidePanel: false,
      developerMode: false,
      rateUsStatus: { hasRated: false, ratePromptDismissedAt: 0, hasShownSecondPrompt: false },
      acceptLowFeeMode: false,
    })

    await service.init({ storage: storage as any, logger: { debug: vi.fn(), error: vi.fn() } })

    service.setHasRated(true)
    service.setRatePromptDismissedAt(123)
    service.setHasShownSecondPrompt(true)

    expect(service.getRateUsStatus()).toEqual({
      hasRated: true,
      ratePromptDismissedAt: 123,
      hasShownSecondPrompt: true,
    })

    service.resetRateUsStatus()
    expect(service.getRateUsStatus()).toEqual({
      hasRated: false,
      ratePromptDismissedAt: null,
      hasShownSecondPrompt: false,
    })
  })

  it('resetAllData clears storage and recreates store', async () => {
    const firstStore = {
      locale: 'en',
      currency: 'USD',
      externalLinkAck: false,
      showSafeNotice: true,
      currentAccount: null,
      currentKeyringIndex: 0,
      editingKeyringIndex: 0,
      editingAccount: null,
      balanceMap: {},
      historyMap: {},
      watchAddressPreference: {},
      walletSavedList: [],
      alianNames: {},
      initAlianNames: false,
      currentVersion: '0',
      firstOpen: false,
      addressType: 0,
      networkType: NetworkType.MAINNET,
      chainType: ChainType.BITCOIN_MAINNET,
      keyringAlianNames: {},
      accountAlianNames: {},
      uiCachedData: {},
      skippedVersion: '',
      appTab: { summary: { apps: [] }, readAppTime: {}, readTabTime: 1 },
      addressFlags: {},
      autoLockTimeId: 2,
      openInSidePanel: false,
      developerMode: false,
      rateUsStatus: { hasRated: false, ratePromptDismissedAt: 0, hasShownSecondPrompt: false },
      acceptLowFeeMode: false,
    }

    const secondStore = { ...firstStore }

    storage.createPersistentProxy
      .mockResolvedValueOnce(firstStore as any)
      .mockResolvedValueOnce(secondStore as any)
    storage.set.mockResolvedValue(undefined)

    await service.init({ storage: storage as any, logger: { debug: vi.fn(), error: vi.fn() } })
    await service.resetAllData()

    expect(storage.set).toHaveBeenCalledWith('preference', null)
    expect(storage.createPersistentProxy).toHaveBeenCalledTimes(2)
  })
})
