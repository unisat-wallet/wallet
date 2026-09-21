import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useInfiniteList } from '../../src/ui-hooks/useInfiniteList'

describe('useInfiniteList', () => {
  it('keeps the initial load complete while refreshing an empty list', async () => {
    let resolveRefresh!: (value: { list: string[]; total: number }) => void
    const refreshRequest = new Promise<{ list: string[]; total: number }>((resolve) => {
      resolveRefresh = resolve
    })
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ list: [], total: 0 })
      .mockImplementationOnce(() => refreshRequest)

    const { result } = renderHook(() => useInfiniteList({ fetcher }))

    await waitFor(() => expect(result.current.hasLoaded).toBe(true))

    act(() => result.current.onRefresh())

    await waitFor(() => expect(result.current.loading).toBe(true))
    expect(result.current.hasLoaded).toBe(true)
    expect(result.current.data).toEqual([])

    await act(async () => {
      resolveRefresh({ list: [], total: 0 })
    })
  })

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
