import { act, renderHook, waitFor } from '@testing-library/react'
import { SignMessageType } from '@unisat/wallet-shared'
import logger from 'loglevel'
import { describe, expect, it, vi } from 'vitest'

import { useSignMessageLogic } from '../../src/ui-hooks/useSignMessageLogic'
import { initTxInfo, useSignPsbtLogic } from '../../src/ui-hooks/useSignPsbtLogic'
import { createHookTestHarness, createWalletMock } from './testHelpers'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const session = {
  origin: 'https://dapp.example',
  icon: '',
  name: 'Test dApp',
}

describe('signing origin gate', () => {
  it('does not sign a message before the origin check succeeds', async () => {
    const websiteCheck = deferred<{
      isScammer: boolean
      warning: string
      allowQuickMultiSign: boolean
    }>()
    const wallet = createWalletMock() as any
    wallet.checkWebsite = vi.fn(() => websiteCheck.promise)
    wallet.getConnectedSites = vi.fn().mockResolvedValue([])
    wallet.signMessage = vi.fn().mockResolvedValue({ signature: 'signed' })
    const { wrapper } = createHookTestHarness({ wallet })

    const { result } = renderHook(
      () =>
        useSignMessageLogic({
          params: {
            data: {
              toSignMessages: [{ text: 'Sign in', type: SignMessageType.BIP322_SIMPLE }],
            },
            session,
          },
        }),
      { wrapper }
    )

    expect(result.current.loading).toBe(true)
    expect(result.current.canSign).toBe(false)

    act(() => result.current.onClickSign())
    await act(async () => result.current.onTryMultiSign())
    await act(async () => result.current.onQuickMultiSign())
    expect(result.current.disclaimerVisible).toBe(false)
    expect(wallet.signMessage).not.toHaveBeenCalled()

    await act(async () => {
      websiteCheck.resolve({ isScammer: false, warning: '', allowQuickMultiSign: false })
      await websiteCheck.promise
    })
    await waitFor(() => expect(result.current.canSign).toBe(true))

    act(() => result.current.onClickSign())
    await waitFor(() => {
      expect(wallet.signMessage).toHaveBeenCalledTimes(1)
      expect(result.current.isAllSigned).toBe(true)
    })
  })

  it('keeps message signing closed when the origin check fails', async () => {
    const logError = vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const websiteCheck = deferred<any>()
    const wallet = createWalletMock() as any
    wallet.checkWebsite = vi.fn(() => websiteCheck.promise)
    wallet.getConnectedSites = vi.fn().mockResolvedValue([])
    wallet.signMessage = vi.fn()
    const { wrapper } = createHookTestHarness({ wallet })

    const { result } = renderHook(
      () =>
        useSignMessageLogic({
          params: {
            data: { toSignMessages: [{ text: 'Sign in', type: SignMessageType.ECDSA }] },
            session,
          },
        }),
      { wrapper }
    )

    await act(async () => {
      websiteCheck.reject(new Error('network unavailable'))
      await websiteCheck.promise.catch(() => undefined)
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.canSign).toBe(false)
    act(() => result.current.onClickSign())
    expect(wallet.signMessage).not.toHaveBeenCalled()
    expect(logError).toHaveBeenCalled()
    logError.mockRestore()
  })

  it('does not sign a decoded PSBT before the origin check succeeds', async () => {
    const websiteCheck = deferred<{
      isScammer: boolean
      warning: string
      allowQuickMultiSign: boolean
    }>()
    const wallet = createWalletMock() as any
    wallet.checkWebsite = vi.fn(() => websiteCheck.promise)
    wallet.getConnectedSites = vi.fn().mockResolvedValue([])
    wallet.decodePsbt = vi.fn().mockResolvedValue({
      ...initTxInfo.decodedPsbt,
      inputInfos: [{}],
    })
    wallet.signPsbtV2 = vi.fn().mockResolvedValue({ psbtHex: 'signed' })
    const { wrapper } = createHookTestHarness({ wallet })

    const { result } = renderHook(
      () =>
        useSignPsbtLogic({
          params: {
            data: { toSignDatas: [{ psbtHex: '70736274ff', toSignInputs: [] }] },
            session,
          },
        } as any),
      { wrapper }
    )

    await waitFor(() => expect(result.current.isValid).toBe(true))
    expect(result.current.canSign).toBe(false)
    expect(result.current.showLoading).toBe(true)

    act(() => result.current.onClickSign())
    await act(async () => result.current.onTryMultiSign())
    await act(async () => result.current.onQuickMultiSign())
    expect(result.current.disclaimerVisible).toBe(false)
    expect(wallet.signPsbtV2).not.toHaveBeenCalled()

    await act(async () => {
      websiteCheck.resolve({ isScammer: false, warning: '', allowQuickMultiSign: false })
      await websiteCheck.promise
    })
    await waitFor(() => {
      expect(result.current.canSign).toBe(true)
      expect(result.current.showLoading).toBe(false)
    })

    act(() => result.current.onClickSign())
    await waitFor(() => {
      expect(wallet.signPsbtV2).toHaveBeenCalledTimes(1)
      expect(result.current.isAllSigned).toBe(true)
    })
  })
})
