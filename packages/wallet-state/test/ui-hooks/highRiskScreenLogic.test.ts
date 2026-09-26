import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

import { useBRC20InscribeTransferLogicStep1 } from '../../src/ui-hooks/useBRC20InscribeTransferLogic'
import {
  BRC20SendTabKey,
  useBRC20SendScreenLogic,
} from '../../src/ui-hooks/useBRC20SendScreenLogic'
import { useFeeRateBarLogic } from '../../src/ui-hooks/useFeeRateBarLogic'
import { useSendAlkanesNFTScreenLogic } from '../../src/ui-hooks/useSendAlkanesNFTScreenLogic'
import { useSendAlkanesScreenLogic } from '../../src/ui-hooks/useSendAlkanesScreenLogic'
import { useSendOrdinalsInscriptionScreenLogic } from '../../src/ui-hooks/useSendOrdinalsInscriptionScreenLogic'
import { useSendRunesScreenLogic } from '../../src/ui-hooks/useSendRunesScreenLogic'
import { useSplitOrdinalsInscriptionScreenLogic } from '../../src/ui-hooks/useSplitOrdinalsInscriptionScreenLogic'
import { uiActions } from '../../src/reducers/ui'
import { useBRC20SingleStepScreenLogic } from '../../src/ui-hooks/useBRC20SingleStepScreenLogic'
import { useBRC20SendScreenLogicStep2 } from '../../src/ui-hooks/useBRC20SendScreenLogic'
import { useSendRGBScreenLogic } from '../../src/ui-hooks/useSendRGBScreenLogic'
import { createHookTestHarness, testInscription } from './testHelpers'

const tokenBalance = {
  ticker: 'ordi',
  overallBalance: '100',
  transferableBalance: '10',
  availableBalance: '90',
  availableBalanceSafe: '90',
  availableBalanceUnSafe: '0',
}

const tokenInfo = {
  totalSupply: '21000000',
  totalMinted: '100',
  decimal: 18,
  holder: '1',
  inscriptionId: 'token-info-1',
  historyCount: 0,
  holdersCount: 1,
  logo: '',
}

const runeBalance = {
  runeid: '1:1',
  spacedRune: 'TEST',
  amount: '10',
  symbol: 'T',
  divisibility: 0,
}

const runeInfo = {
  runeid: '1:1',
  spacedRune: 'TEST',
  symbol: 'T',
  divisibility: 0,
}

const alkanesTokenBalance = {
  alkaneid: '1:1',
  name: 'ALK',
  symbol: 'ALK',
  amount: '10',
  divisibility: 0,
}

const alkanesTokenInfo = {
  alkaneid: '1:1',
  name: 'ALK',
  symbol: 'ALK',
  divisibility: 0,
}

const alkanesNftInfo = {
  alkaneid: '2:1',
  name: 'NFT',
  symbol: 'NFT',
}

describe('high-risk screen logic effects', () => {
  it('does not refetch fee summary after fee state updates', async () => {
    const { wrapper, wallet } = createHookTestHarness()
    const { result } = renderHook(() => useFeeRateBarLogic({}), { wrapper })

    await waitFor(() => {
      expect(wallet.getFeeSummary).toHaveBeenCalledTimes(1)
      expect(result.current.feeOptions.length).toBeGreaterThan(0)
    })

    await act(async () => {
      await result.current.setFeeOptionIndex(3)
    })

    await waitFor(() => {
      expect(result.current.showCustomInput).toBe(true)
    })

    expect(wallet.getFeeSummary).toHaveBeenCalledTimes(1)
  })

  it('loads BRC20 send RBF setting once across context data updates', async () => {
    const { wrapper, wallet } = createHookTestHarness({
      routeState: {
        tokenBalance,
        tokenInfo,
        selectedInscriptionIds: [],
        selectedAmount: '0',
      },
    })
    const { result } = renderHook(() => useBRC20SendScreenLogic(), { wrapper })

    await waitFor(() => {
      expect(wallet.getEnableRBF).toHaveBeenCalledTimes(1)
    })

    act(() => {
      result.current.updateContextData({ tabKey: BRC20SendTabKey.STEP2 })
    })

    await waitFor(() => {
      expect(result.current.contextData.tabKey).toBe(BRC20SendTabKey.STEP2)
    })

    expect(wallet.getEnableRBF).toHaveBeenCalledTimes(1)
  })

  it('loads BRC20 inscribe transfer RBF setting once across rerenders', async () => {
    const { wrapper, wallet } = createHookTestHarness()
    const updateContextData = vi.fn()
    const contextData = {
      step: 0,
      ticker: 'ordi',
      amount: '',
      isApproval: false,
      enableRBF: true,
      tokenInfo,
    }
    const { rerender } = renderHook(
      () =>
        useBRC20InscribeTransferLogicStep1({ contextData: contextData as any, updateContextData }),
      { wrapper }
    )

    await waitFor(() => {
      expect(wallet.getEnableRBF).toHaveBeenCalledTimes(1)
    })

    rerender()

    expect(wallet.getEnableRBF).toHaveBeenCalledTimes(1)
  })

  it('loads runes send RBF setting once across state updates', async () => {
    const { wrapper, wallet } = createHookTestHarness({
      routeState: { runeBalance, runeInfo },
    })
    wallet.getAssetUtxosRunes.mockResolvedValue([
      {
        runes: [{ runeid: '1:1', amount: '10' }],
      },
    ])
    const { result } = renderHook(() => useSendRunesScreenLogic(), { wrapper })

    await waitFor(() => {
      expect(wallet.getEnableRBF).toHaveBeenCalledTimes(1)
      expect(wallet.getAssetUtxosRunes).toHaveBeenCalledTimes(1)
      expect(result.current.availableBalanceStr).toBe('10')
    })

    act(() => {
      result.current.setInputAmount('1')
    })

    await waitFor(() => {
      expect(result.current.inputAmount).toBe('1')
    })

    expect(wallet.getEnableRBF).toHaveBeenCalledTimes(1)
  })

  it('loads alkanes FT RBF setting once across state updates', async () => {
    const { wrapper, wallet } = createHookTestHarness({
      routeState: { tokenBalance: alkanesTokenBalance, tokenInfo: alkanesTokenInfo },
    })
    wallet.getAddressAlkanesTokenSummary = vi.fn().mockResolvedValue({
      tokenBalance: { available: '10' },
    })
    wallet.createSendAlkanesPsbt = vi.fn()
    const { result } = renderHook(() => useSendAlkanesScreenLogic(), { wrapper })

    await waitFor(() => {
      expect(wallet.getEnableRBF).toHaveBeenCalledTimes(1)
    })

    act(() => {
      result.current.setInputAmount('1')
    })

    await waitFor(() => {
      expect(result.current.inputAmount).toBe('1')
    })

    expect(wallet.getEnableRBF).toHaveBeenCalledTimes(1)
  })

  it('loads alkanes NFT RBF setting once across state updates', async () => {
    const { wrapper, wallet } = createHookTestHarness({
      routeState: { alkanesInfo: alkanesNftInfo },
    })
    wallet.createSendAlkanesPsbt = vi.fn()
    const { result } = renderHook(() => useSendAlkanesNFTScreenLogic(), { wrapper })

    await waitFor(() => {
      expect(wallet.getEnableRBF).toHaveBeenCalledTimes(1)
    })

    act(() => {
      result.current.setToInfo({
        address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        domain: '',
      })
    })

    await waitFor(() => {
      expect(result.current.toInfo.address).toBe('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh')
    })

    expect(wallet.getEnableRBF).toHaveBeenCalledTimes(1)
  })

  it('loads ordinals send RBF setting once across state updates', async () => {
    const { wrapper, wallet } = createHookTestHarness({
      routeState: { inscription: testInscription },
    })
    const { result } = renderHook(() => useSendOrdinalsInscriptionScreenLogic(), { wrapper })

    await waitFor(() => {
      expect(wallet.getEnableRBF).toHaveBeenCalledTimes(1)
      expect(wallet.getInscriptionUtxoDetail).toHaveBeenCalledTimes(1)
    })

    act(() => {
      result.current.setOutputValue(10001)
    })

    await waitFor(() => {
      expect(result.current.outputValue).toBe(10001)
    })

    expect(wallet.getEnableRBF).toHaveBeenCalledTimes(1)
    expect(wallet.getInscriptionUtxoDetail).toHaveBeenCalledTimes(1)
  })

  it('loads split ordinals RBF setting once across state updates', async () => {
    const { wrapper, wallet } = createHookTestHarness({
      routeState: { inscription: testInscription },
    })
    const { result } = renderHook(() => useSplitOrdinalsInscriptionScreenLogic(), { wrapper })

    await waitFor(() => {
      expect(wallet.getEnableRBF).toHaveBeenCalledTimes(1)
      expect(wallet.getInscriptionUtxoDetail).toHaveBeenCalledTimes(1)
    })

    act(() => {
      result.current.onOutputValueChange(10001)
    })

    await waitFor(() => {
      expect(result.current.disabled).toBe(false)
    })

    expect(wallet.getEnableRBF).toHaveBeenCalledTimes(1)
    expect(wallet.getInscriptionUtxoDetail).toHaveBeenCalledTimes(1)
  })
})

const recipient = { address: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT', domain: '' }
const transferContext = {
  step: 0,
  ticker: 'ordi',
  amount: '1',
  isApproval: false,
  enableRBF: true,
  tokenBalance,
  tokenInfo,
  receiver: recipient.address,
  inscriptionIdSet: new Set(['inscription-1']),
}

describe('fee clearing across send screens', () => {
  const cases = [
    {
      name: 'Runes',
      hook: useSendRunesScreenLogic,
      route: { runeBalance, runeInfo },
      fill: (s: any) => {
        s.setToInfo(recipient)
        s.setInputAmount('1')
      },
      submit: 'onClickNext',
    },
    {
      name: 'Alkanes tokens',
      hook: useSendAlkanesScreenLogic,
      route: { tokenBalance: alkanesTokenBalance, tokenInfo: alkanesTokenInfo },
      fill: (s: any) => {
        s.setToInfo(recipient)
        s.setInputAmount('1')
      },
      submit: 'onClickNext',
    },
    {
      name: 'Alkanes NFT',
      hook: useSendAlkanesNFTScreenLogic,
      route: { alkanesInfo: alkanesNftInfo },
      fill: (s: any) => s.setToInfo(recipient),
      submit: 'onCreateTxHandleConfirm',
    },
    {
      name: 'Ordinals send',
      hook: useSendOrdinalsInscriptionScreenLogic,
      route: { inscription: testInscription },
      fill: (s: any) => s.onAddressInputChange(recipient),
      submit: 'onClickNext',
    },
    {
      name: 'Ordinals split',
      hook: useSplitOrdinalsInscriptionScreenLogic,
      route: { inscription: testInscription },
      fill: () => {},
      submit: 'onClickNext',
    },
    {
      name: 'BRC20 single step',
      hook: useBRC20SingleStepScreenLogic,
      route: { tokenBalance, tokenInfo },
      fill: (s: any) => {
        s.setToInfo(recipient)
        s.setInputAmount('1')
      },
      submit: 'onClickConfirmStep1',
    },
    {
      name: 'BRC20 transfer inscription',
      hook: () =>
        useBRC20InscribeTransferLogicStep1({
          contextData: transferContext as any,
          updateContextData: () => {},
        }),
      route: {},
      fill: () => {},
      submit: 'onClickInscribe',
    },
    {
      name: 'BRC20 send',
      hook: () =>
        useBRC20SendScreenLogicStep2({
          contextData: transferContext as any,
          updateContextData: () => {},
        }),
      route: {},
      fill: () => {},
      submit: 'onStep2ClickNext',
    },
    {
      name: 'RGB send',
      hook: useSendRGBScreenLogic,
      route: {
        assetId: 'rgb:test-asset',
        tokenBalance: {
          assetId: 'rgb:test-asset',
          ticker: 'RGB',
          precision: 8,
          spendable: '150000000',
        },
      },
      fill: (s: any) =>
        s.onInvoiceChange('rgb:test-asset/~/~/bc:utxob:test?amount=1&endpoints=rpc://proxy'),
      submit: 'onClickNext',
    },
  ]

  it.each(cases)(
    '$name disables submission for an empty fee and recovers after typing',
    async ({ name, hook, route, fill, submit }) => {
      const harness = createHookTestHarness({ routeState: route })
      const { wallet, wrapper, store, navigation } = harness
      wallet.getAssetUtxosRunes.mockResolvedValue([{ runes: [{ runeid: '1:1', amount: '10' }] }])
      Object.assign(wallet, {
        getAddressAlkanesTokenSummary: vi
          .fn()
          .mockResolvedValue({ tokenBalance: { available: '10' } }),
        createSendAlkanesPsbt: vi.fn(),
        singleStepTransferBRC20Step1: vi.fn(),
        inscribeBRC20Transfer: vi.fn(),
        createRgbSendBegin: vi.fn(),
        createRgbFeePoolTopUpBegin: vi.fn(),
      })
      store.dispatch(
        uiActions.updateFeeRateBar({ feeOptionIndex: 3, feeRateInputVal: '3', feeRate: 3 })
      )
      const { result, unmount } = renderHook(
        () => ({
          fee: useFeeRateBarLogic({ disableLowFeeMode: name === 'RGB send' }),
          screen: hook() as any,
        }),
        { wrapper }
      )
      await waitFor(() => expect(result.current.fee.feeOptionsLoading).toBe(false))
      act(() => fill(result.current.screen))
      await waitFor(() => expect(result.current.screen.disabled).toBe(false))
      act(() => result.current.fee.adjustFeeRateInput(''))
      expect(result.current.fee.feeRateInputVal).toBe('')
      expect(result.current.screen.disabled).toBe(true)
      await act(async () => result.current.screen[submit]())
      for (const method of [
        'createSendRunesPsbt',
        'createSendAlkanesPsbt',
        'createSendInscriptionPsbt',
        'createSendMultipleInscriptionsPsbt',
        'createSplitInscriptionPsbt',
        'singleStepTransferBRC20Step1',
        'inscribeBRC20Transfer',
        'createRgbSendBegin',
        'createRgbFeePoolTopUpBegin',
      ]) {
        expect((wallet as any)[method]).not.toHaveBeenCalled()
      }
      expect(navigation.navigate).not.toHaveBeenCalled()
      act(() => result.current.fee.adjustFeeRateInput('2.5'))
      expect(result.current.screen.disabled).toBe(false)
      expect(store.getState().ui.feeRateBar.feeRate).toBe(2.5)
      unmount()
    }
  )
})
