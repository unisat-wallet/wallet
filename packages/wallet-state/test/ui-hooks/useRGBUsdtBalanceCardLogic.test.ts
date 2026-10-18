import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { settingsActions } from '../../src/reducers/settings'
import { useRGBUsdtBalanceCardLogic } from '../../src/ui-hooks/useRGBUsdtBalanceCardLogic'
import { createHookTestHarness } from './testHelpers'

describe('useRGBUsdtBalanceCardLogic', () => {
  it('uses only the configured asset ID when another asset has the USDT name', () => {
    const { store, wrapper } = createHookTestHarness()
    store.dispatch(settingsActions.updateSettings({
      walletConfig: { ...store.getState().settings.walletConfig, rgbUsdtAssetId: 'rgb:official' },
    }))

    const { result } = renderHook(() => useRGBUsdtBalanceCardLogic({
      items: [
        { assetId: 'rgb:other', ticker: 'USDT', name: 'USDT', spendable: '999' },
        { assetId: 'official', ticker: 'Tether', spendable: '42' },
      ],
      onRefresh: vi.fn(),
    }), { wrapper })

    expect(result.current.usdtToken?.assetId).toBe('official')
    expect(result.current.balanceAmount).toBe('42')
  })

  it('does not select a same-name asset without an official asset ID', () => {
    const { wrapper } = createHookTestHarness()
    const { result } = renderHook(() => useRGBUsdtBalanceCardLogic({
      items: [{ assetId: 'rgb:other', ticker: 'USDT', name: 'USDT', spendable: '999' }],
      onRefresh: vi.fn(),
    }), { wrapper })

    expect(result.current.usdtToken).toBeUndefined()
    expect(result.current.balanceAmount).toBe('0')
  })
})
