import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { uiActions } from '../../src/reducers/ui'
import { useFeeRateBarLogic } from '../../src/ui-hooks/useFeeRateBarLogic'
import { createHookTestHarness } from './testHelpers'

async function setup(disableLowFeeMode: boolean) {
  const harness = createHookTestHarness()
  harness.store.dispatch(
    uiActions.updateFeeRateBar({
      feeOptionIndex: 3,
      feeRateInputVal: '2',
      feeRate: 2,
    })
  )
  const hook = renderHook(() => useFeeRateBarLogic({ disableLowFeeMode }), {
    wrapper: harness.wrapper,
  })
  await waitFor(() => expect(hook.result.current.feeOptionsLoading).toBe(false))
  const input = (value: string) => act(() => hook.result.current.adjustFeeRateInput(value))
  const feeRate = () => harness.store.getState().ui.feeRateBar.feeRate
  return { ...hook, ...harness, input, feeRate }
}

describe('useFeeRateBarLogic editing', () => {
  it.each([false, true])(
    'allows clearing and replacing a fee (disableLowFeeMode=%s)',
    async disabled => {
      const { result, input, feeRate } = await setup(disabled)
      input('')
      expect(result.current.feeRateInputVal).toBe('')
      expect(feeRate()).toBe(0)
      input('5')
      expect(result.current.feeRateInputVal).toBe('5')
      expect(feeRate()).toBe(5)
    }
  )

  it('allows typing a decimal fee when low-fee mode is disabled', async () => {
    const { result, input, feeRate } = await setup(true)
    for (const value of ['2.', '2.5', '2.55']) {
      input(value)
      expect(result.current.feeRateInputVal).toBe(value)
      expect(feeRate()).toBe(Number(value))
    }
  })

  it('marks zero and decimal intermediate input as an unfinished fee', async () => {
    const { result, input, feeRate } = await setup(true)
    for (const value of ['0', '0.']) {
      input(value)
      expect(result.current.feeRateInputVal).toBe(value)
      expect(feeRate()).toBe(0)
    }
    input('0.5')
    expect(result.current.feeRateInputVal).toBe('1')
    expect(feeRate()).toBe(1)
  })

  it('allows entering a supported sub-1 fee one character at a time', async () => {
    const { result, input, feeRate } = await setup(false)
    for (const value of ['', '0', '0.', '0.1', '0.15']) {
      input(value)
      expect(result.current.feeRateInputVal).toBe(value)
      expect(feeRate()).toBe(parseFloat(value) || 0)
    }
    expect(feeRate()).toBe(0.15)
  })

  it('still clamps completed values to the fee limits', async () => {
    const { result, input, feeRate } = await setup(true)
    input('0.5')
    expect(result.current.feeRateInputVal).toBe('1')
    expect(feeRate()).toBe(1)
    input('10001')
    expect(result.current.feeRateInputVal).toBe('10000')
    expect(feeRate()).toBe(10000)
  })
})
