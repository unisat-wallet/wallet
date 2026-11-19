import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useAlkanesTokenScreenLogic } from '../../src/ui-hooks/useAlkanesTokenScreenLogic'
import { createHookTestHarness } from './testHelpers'

function createTokenSummary({ alkaneid = '2:0', mintUrl = '' } = {}) {
  return {
    tokenBalance: {
      alkaneid,
      name: 'Test Alkane',
      amount: '1',
      symbol: 'TA',
      divisibility: 0,
      available: '1',
    },
    tokenInfo: {
      alkaneid,
      name: 'Test Alkane',
      symbol: 'TA',
      totalSupply: '100',
      maxSupply: '1000',
      cap: 10,
      mintable: true,
      perMint: '10',
      minted: 10,
      holders: 1,
      aligned: true,
      nftData: { collectionId: '' },
      logo: '',
    },
    tradeUrl: '',
    mintUrl,
  }
}

describe('useAlkanesTokenScreenLogic', () => {
  it('opens the mint page for the selected alkane when no custom URL is configured', async () => {
    const alkaneid = '2:0'
    const { wrapper, wallet, navigation } = createHookTestHarness({ routeState: { alkaneid } })
    wallet.getAddressAlkanesTokenSummary.mockResolvedValue(createTokenSummary({ alkaneid }))

    const { result } = renderHook(() => useAlkanesTokenScreenLogic(), { wrapper })
    await waitFor(() => expect(result.current.enableMint).toBe(true))

    act(() => result.current.onClickMint())

    expect(navigation.navToUrl).toHaveBeenCalledWith(
      'https://link.unisat.space/btc/alkanes/inscribe?tab=mint&alkaneid=2%3A0'
    )
  })

  it('keeps using a custom mint URL returned by the service', async () => {
    const alkaneid = '2:0'
    const mintUrl = 'https://example.com/custom-mint'
    const { wrapper, wallet, navigation } = createHookTestHarness({ routeState: { alkaneid } })
    wallet.getAddressAlkanesTokenSummary.mockResolvedValue(createTokenSummary({ alkaneid, mintUrl }))

    const { result } = renderHook(() => useAlkanesTokenScreenLogic(), { wrapper })
    await waitFor(() => expect(result.current.enableMint).toBe(true))

    act(() => result.current.onClickMint())

    expect(navigation.navToUrl).toHaveBeenCalledWith(mintUrl)
  })
})
