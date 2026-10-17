import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { copyToClipboard } from '../../../apps/extension/src/ui/utils'
import { useExportPrivateKeyScreenLogic } from '../src/ui-hooks/useExportPrivateKeyScreenLogic'
import { createHookTestHarness } from './ui-hooks/testHelpers'

describe('expiring clipboard copies', () => {
  let clipboardText = ''
  const writeText = vi.fn(async (text: string) => {
    clipboardText = text
  })
  const readText = vi.fn(async () => clipboardText)

  beforeEach(() => {
    vi.useFakeTimers()
    clipboardText = ''
    writeText.mockClear()
    readText.mockClear()
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText, writeText },
    })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('clears an expiring copy when the clipboard still contains the secret', async () => {
    await copyToClipboard('private-key', { clearAfterMs: 60_000 })

    await vi.advanceTimersByTimeAsync(60_000)

    expect(readText).toHaveBeenCalledOnce()
    expect(writeText).toHaveBeenNthCalledWith(1, 'private-key')
    expect(writeText).toHaveBeenNthCalledWith(2, '')
  })

  it('preserves clipboard content copied after the private key', async () => {
    await copyToClipboard('private-key', { clearAfterMs: 60_000 })
    clipboardText = 'new clipboard value'

    await vi.advanceTimersByTimeAsync(60_000)

    expect(readText).toHaveBeenCalledOnce()
    expect(writeText).toHaveBeenCalledOnce()
    expect(clipboardText).toBe('new clipboard value')
  })

  it('does not expire ordinary clipboard copies', async () => {
    await copyToClipboard('address')

    await vi.advanceTimersByTimeAsync(60_000)

    expect(readText).not.toHaveBeenCalled()
    expect(clipboardText).toBe('address')
  })
})

describe('private key clipboard policy', () => {
  it('marks exported private keys for clearing after 60 seconds', () => {
    const { wrapper, tools } = createHookTestHarness({ routeState: { account: {} } })
    const { result } = renderHook(() => useExportPrivateKeyScreenLogic(), { wrapper })

    act(() => result.current.copy('private-key'))

    expect(tools.copyToClipboard).toHaveBeenCalledWith('private-key', { clearAfterMs: 60_000 })
  })
})
