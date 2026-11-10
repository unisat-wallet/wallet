import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useTxSuccessScreenLogic } from '../../src/ui-hooks/useTxSuccessScreenLogic'
import { createHookTestHarness } from './testHelpers'

describe('useTxSuccessScreenLogic', () => {
  it('returns asset sends to the Assets tab', () => {
    const { wrapper, navigation } = createHookTestHarness({
      routeState: { txid: 'txid', returnTo: 'assets' },
    })
    const { result } = renderHook(() => useTxSuccessScreenLogic(), { wrapper })

    act(() => result.current.onClickDone())

    expect(navigation.navigate).toHaveBeenCalledWith('AssetsTabScreen')
  })

  it('keeps Home as the default for generic Bitcoin transactions', () => {
    const { wrapper, navigation } = createHookTestHarness({
      routeState: { txid: 'txid' },
    })
    const { result } = renderHook(() => useTxSuccessScreenLogic(), { wrapper })

    act(() => result.current.onClickDone())

    expect(navigation.navigate).toHaveBeenCalledWith('MainScreen')
  })
})
