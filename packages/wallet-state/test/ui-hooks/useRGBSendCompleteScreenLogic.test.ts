import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useRGBSendCompleteScreenLogic } from '../../src/ui-hooks/useRGBSendCompleteScreenLogic'
import { createHookTestHarness } from './testHelpers'

describe('useRGBSendCompleteScreenLogic', () => {
  it('returns to the main screen when done is clicked', () => {
    const { wrapper, navigation } = createHookTestHarness({
      routeState: {
        assetId: 'rgb:test-asset',
        tokenBalance: { assetId: 'rgb:test-asset', ticker: 'RGB' },
        txid: 'txid',
      },
    })

    const { result } = renderHook(() => useRGBSendCompleteScreenLogic(), { wrapper })

    act(() => {
      result.current.onClickDone()
    })

    expect(navigation.navigate).toHaveBeenCalledWith('MainScreen')
    expect(navigation.navToTab).not.toHaveBeenCalled()
  })
})
