import { describe, expect, it } from 'vitest'
import {
  isAllowedUiControllerMethod,
  isValidUiDevelopmentRequest,
  isValidUiMessageParams,
} from '../src/utils/ui-message-policy'

describe('UI message policy', () => {
  it('allows UI methods and rejects controller internals or prototype members', () => {
    expect(isAllowedUiControllerMethod('getCurrentAccount')).toBe(true)
    expect(isAllowedUiControllerMethod('getRgbFeatureStatus')).toBe(true)
    expect(isAllowedUiControllerMethod('signPsbtV2')).toBe(true)
    expect(isAllowedUiControllerMethod('resetAllData')).toBe(false)
    expect(isAllowedUiControllerMethod('_signPsbt')).toBe(false)
    expect(isAllowedUiControllerMethod('constructor')).toBe(false)
    expect(isAllowedUiControllerMethod('__proto__')).toBe(false)
  })

  it('accepts safe params and rejects malformed or dangerous values', () => {
    expect(isValidUiMessageParams([{ address: 'bc1qexample', indexes: [0, 1] }])).toBe(true)
    expect(isValidUiMessageParams({ address: 'bc1qexample' })).toBe(false)
    expect(isValidUiMessageParams(new Array(11).fill(null))).toBe(false)
    expect(isValidUiMessageParams([Number.POSITIVE_INFINITY])).toBe(false)
    expect(isValidUiMessageParams([() => undefined])).toBe(false)

    const dangerous = JSON.parse('{"constructor":{"prototype":{"polluted":true}}}')
    expect(isValidUiMessageParams([dangerous])).toBe(false)

    const cyclic: Record<string, unknown> = {}
    cyclic['self'] = cyclic
    expect(isValidUiMessageParams([cyclic])).toBe(false)
  })

  it('validates development provider requests separately', () => {
    expect(
      isValidUiDevelopmentRequest({
        data: { method: 'getAccounts', params: {} },
        session: { origin: 'https://example.com' },
      })
    ).toBe(true)
    expect(isValidUiDevelopmentRequest({ method: 'getAccounts', params: [] })).toBe(false)
    expect(isValidUiDevelopmentRequest({ data: { params: [] } })).toBe(false)
  })
})
