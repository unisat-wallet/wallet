import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useInfiniteList } from '../../src/ui-hooks/useInfiniteList'

describe('useInfiniteList', () => {
  it('uses the latest fetcher for a queued refresh after dependencies change', async () => {
    let resolveFirstRequest!: (value: { list: string[]; total: number }) => void
    const firstRequest = new Promise<{ list: string[]; total: number }>((resolve) => {
      resolveFirstRequest = resolve
    })
    const oldFetcher = vi.fn(() => firstRequest)
    const newFetcher = vi.fn().mockResolvedValue({ list: ['new-account'], total: 1 })

    const { result, rerender } = renderHook(
      ({ account }) =>
        useInfiniteList({
          fetcher: account === 'old' ? oldFetcher : newFetcher,
          dependencies: [account],
        }),
      { initialProps: { account: 'old' } }
    )

    await waitFor(() => expect(oldFetcher).toHaveBeenCalledTimes(1))

    act(() => result.current.onRefresh())
    rerender({ account: 'new' })

    await act(async () => {
      resolveFirstRequest({ list: ['old-account'], total: 1 })
    })

    await waitFor(() => {
      expect(newFetcher).toHaveBeenCalledTimes(1)
      expect(result.current.data).toEqual(['new-account'])
    })

    expect(oldFetcher).toHaveBeenCalledTimes(1)
  })
})
