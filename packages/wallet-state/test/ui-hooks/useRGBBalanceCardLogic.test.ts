import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useRGBBalanceCardLogic } from '../../src/ui-hooks/useRGBBalanceCardLogic'
import { createHookTestHarness } from './testHelpers'

describe('useRGBBalanceCardLogic', () => {
  it('formats pending RGB balances separately from settled balances', () => {
    const { wrapper } = createHookTestHarness()
    const { result } = renderHook(
      () =>
        useRGBBalanceCardLogic({
          tokenBalance: {
            assetId: 'rgb:asset',
            ticker: 'SR',
            balance: '0',
            spendable: '0',
            pending: '987',
          },
        }),
      { wrapper }
    )

    expect(result.current.balanceStr).toBe('0')
    expect(result.current.pendingBalanceStr).toBe('987')
  })

  it('formats atomic balances according to the asset precision', () => {
    const { wrapper } = createHookTestHarness()
    const { result } = renderHook(
      () =>
        useRGBBalanceCardLogic({
          tokenBalance: {
            assetId: 'rgb:asset',
            ticker: 'V2',
            precision: 2,
            balance: '950',
            spendable: '950',
            pending: '50',
          },
        }),
      { wrapper }
    )

    expect(result.current.balanceStr).toBe('9.5')
    expect(result.current.pendingBalanceStr).toBe('0.5')
  })

  it('keeps a locally locked RGB balance distinct from pending balance', () => {
    const { wrapper } = createHookTestHarness()
    const { result } = renderHook(
      () =>
        useRGBBalanceCardLogic({
          tokenBalance: {
            assetId: 'rgb:asset',
            ticker: 'V2',
            precision: 2,
            balance: '1000',
            spendable: '0',
            pending: '50',
            lockedAmount: '1000',
          },
        }),
      { wrapper }
    )

    expect(result.current.balanceStr).toBe('0')
    expect(result.current.pendingBalanceStr).toBe('0.5')
    expect(result.current.lockedBalanceStr).toBe('10')
  })

  it('uses the asset name for placeholder icon initials instead of the ticker', () => {
    const { wrapper } = createHookTestHarness()
    const { result } = renderHook(
      () =>
        useRGBBalanceCardLogic({
          tokenBalance: {
            assetId: 'rgb:asset',
            name: 'RGBRGB',
            ticker: '*',
            balance: '0',
            spendable: '0',
          },
        }),
      { wrapper }
    )

    expect(result.current.iconInfo.iconShortName).toBe('RG')
  })
})
