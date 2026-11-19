import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useBalanceCardLogic } from '../../src/ui-hooks/useBalanceCardLogic'
import { createHookTestHarness } from './testHelpers'

afterEach(() => {
  vi.useRealTimers()
})

describe('useBalanceCardLogic refresh lifecycle', () => {
  it('cancels a delayed manual refresh after unmount', () => {
    vi.useFakeTimers()
    const harness = createHookTestHarness()
    harness.wallet.getAddressSummary = vi.fn().mockResolvedValue({})
    const hook = renderHook(() => useBalanceCardLogic(), { wrapper: harness.wrapper })

    act(() => hook.result.current.refreshBalance())
    hook.unmount()
    act(() => vi.advanceTimersByTime(1000))

    expect(harness.wallet.getAddressSummary).not.toHaveBeenCalled()
  })

  it('shows a manual refresh error after the debounce expires', async () => {
    vi.useFakeTimers()
    const harness = createHookTestHarness()
    harness.wallet.getAddressSummary = vi.fn().mockRejectedValue(new Error('balance unavailable'))
    const hook = renderHook(() => useBalanceCardLogic(), { wrapper: harness.wrapper })

    act(() => hook.result.current.refreshBalance())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    await waitFor(() => expect(harness.tools.toastError).toHaveBeenCalledWith('balance unavailable'))
  })
})
