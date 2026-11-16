import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { copyToClipboard } from '../../../apps/extension/src/ui/utils'
import { useExportPrivateKeyScreenLogic } from '../src/ui-hooks/useExportPrivateKeyScreenLogic'
import { createHookTestHarness } from './ui-hooks/testHelpers'

describe('clipboard copies', () => {
  const writeText = vi.fn(async (text: string) => {
    return text
  })
  const readText = vi.fn()

  beforeEach(() => {
    writeText.mockClear()
    readText.mockClear()
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText, writeText },
    })
  })

  it('writes without requesting clipboard read access', async () => {
    await copyToClipboard('private-key')

    expect(readText).not.toHaveBeenCalled()
    expect(writeText).toHaveBeenCalledOnce()
    expect(writeText).toHaveBeenCalledWith('private-key')
  })

  it('clears the clipboard by writing an empty string without reading it', async () => {
    await copyToClipboard('')

    expect(readText).not.toHaveBeenCalled()
    expect(writeText).toHaveBeenCalledOnce()
    expect(writeText).toHaveBeenCalledWith('')
  })
})

describe('private key clipboard policy', () => {
  it('copies exported private keys without scheduling clipboard reads', () => {
    const { wrapper, tools } = createHookTestHarness({ routeState: { account: {} } })
    const { result } = renderHook(() => useExportPrivateKeyScreenLogic(), { wrapper })

    act(() => result.current.copy('private-key'))

    expect(tools.copyToClipboard).toHaveBeenCalledWith('private-key')
  })

  it('exposes a user-initiated clipboard clear action', () => {
    const { wrapper, tools } = createHookTestHarness({ routeState: { account: {} } })
    const { result } = renderHook(() => useExportPrivateKeyScreenLogic(), { wrapper })

    act(() => result.current.clearClipboard())

    expect(tools.clearClipboard).toHaveBeenCalledOnce()
  })
})
