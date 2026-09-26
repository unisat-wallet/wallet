import { describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

import { useTxCreateScreenLogic } from '../../src/ui-hooks/useTxCreateScreenLogic'
import { useFeeRateBarLogic } from '../../src/ui-hooks/useFeeRateBarLogic'
import { uiActions } from '../../src/reducers/ui'
import { createHookTestHarness } from './testHelpers'

describe('TxCreateScreen state hooks', () => {
  it.each([false, true])(
    'blocks Next after clearing the fee and enables it after replacement (disableLowFeeMode=%s)',
    async disableLowFeeMode => {
      const { wrapper, store, wallet, navigation } = createHookTestHarness()
      store.dispatch(
        uiActions.updateFeeRateBar({ feeOptionIndex: 3, feeRateInputVal: '3', feeRate: 3 })
      )
      const { result } = renderHook(
        () => ({
          fee: useFeeRateBarLogic({ disableLowFeeMode }),
          send: useTxCreateScreenLogic(),
        }),
        { wrapper }
      )
      await waitFor(() => expect(result.current.fee.feeOptionsLoading).toBe(false))
      act(() => {
        result.current.send.onAddressInputChange({ address: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT' })
        result.current.send.onAmountInputChange('0.0001')
      })
      expect(result.current.send.disabled).toBe(false)

      act(() => result.current.fee.adjustFeeRateInput(''))
      expect(result.current.fee.feeRateInputVal).toBe('')
      expect(store.getState().ui.feeRateBar.feeRate).toBe(0)
      expect(result.current.send.disabled).toBe(true)
      act(() => result.current.send.onClickNext())
      expect(wallet.createSendBTCPsbt).not.toHaveBeenCalled()
      expect(navigation.navigate).not.toHaveBeenCalled()

      act(() => result.current.fee.adjustFeeRateInput('2.5'))
      expect(store.getState().ui.feeRateBar.feeRate).toBe(2.5)
      expect(result.current.send.disabled).toBe(false)
    }
  )

  it('loads the persisted RBF setting once instead of on every state update', async () => {
    const { wrapper, wallet } = createHookTestHarness()
    const { result } = renderHook(() => useTxCreateScreenLogic(), { wrapper })

    await waitFor(() => {
      expect(wallet.getEnableRBF).toHaveBeenCalledTimes(1)
    })

    act(() => {
      result.current.onAmountInputChange('0.0001')
    })

    await waitFor(() => {
      expect(result.current.inputAmount).toBe('0.0001')
    })

    expect(wallet.getEnableRBF).toHaveBeenCalledTimes(1)
  })
})
