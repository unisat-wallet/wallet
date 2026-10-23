import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorCodes, ErrorMessages, WalletError } from '../src/errors'

describe('WalletError', () => {
  it('uses JSON-RPC-compatible numeric codes for wallet errors', () => {
    const implementationCodes = [
      ErrorCodes.INSUFFICIENT_BTC_UTXO,
      ErrorCodes.INSUFFICIENT_ASSET_UTXO,
      ErrorCodes.NOT_SAFE_UTXOS,
      ErrorCodes.ASSET_MAYBE_LOST,
      ErrorCodes.INSUFFICIENT_FEE_UTXO,
      ErrorCodes.NO_ACCOUNT,
      ErrorCodes.RGB_NOT_ENABLED,
      ErrorCodes.RGB_ASSET_NOT_FOUND,
    ]

    expect(implementationCodes.every(code => code >= -32099 && code <= -32000)).toBe(true)
    expect(ErrorCodes.UNKNOWN).toBe(ErrorCodes.INTERNAL_ERROR)
  })

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('uses translated default message when message is not provided', () => {
    const err = new WalletError(ErrorCodes.INSUFFICIENT_BTC_UTXO)

    expect(err.code).toBe(ErrorCodes.INSUFFICIENT_BTC_UTXO)
    expect(err.message).toBe(ErrorMessages[ErrorCodes.INSUFFICIENT_BTC_UTXO])
  })

  it('uses explicit message when provided', () => {
    const err = new WalletError(ErrorCodes.RGB_NOT_ENABLED, 'manual message')

    expect(err.code).toBe(ErrorCodes.RGB_NOT_ENABLED)
    expect(err.message).toBe('manual message')
  })

  it('uses a distinct code for missing wallet accounts', () => {
    const err = new WalletError(ErrorCodes.NO_ACCOUNT, 'wallet must has at least one account')

    expect(err.code).toBe(ErrorCodes.NO_ACCOUNT)
    expect(err.code).not.toBe(ErrorCodes.UserCancel)
    expect(err.message).toBe('wallet must has at least one account')
  })

  it('falls back to generic unknown string when mapping is missing', () => {
    const customCode = 99999 as ErrorCodes
    const err = new WalletError(customCode)

    expect(err.message).toBe('Unknown error')
  })
})
