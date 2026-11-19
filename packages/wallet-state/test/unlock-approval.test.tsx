import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useUnlockCallback } from '../src/hooks/global'
import { createHookTestHarness, createWalletMock } from './ui-hooks/testHelpers'

describe('approval unlock continuation', () => {
  it.each([true, false])(
    'returns whether the background consumed a dedicated unlock approval: %s',
    async backgroundWillContinue => {
      const wallet = {
        ...createWalletMock(),
        unlock: vi.fn().mockResolvedValue(undefined),
        resolveUnlockApproval: vi.fn().mockResolvedValue(backgroundWillContinue),
      }
      const { wrapper, store } = createHookTestHarness({ wallet })
      const { result } = renderHook(() => useUnlockCallback(), { wrapper })

      let continuation: boolean | undefined
      await act(async () => {
        continuation = await result.current('password')
      })

      expect(wallet.unlock).toHaveBeenCalledWith('password')
      expect(wallet.resolveUnlockApproval).toHaveBeenCalledOnce()
      expect(continuation).toBe(backgroundWillContinue)
      expect(store.getState().global.isUnlocked).toBe(true)
    }
  )
})
