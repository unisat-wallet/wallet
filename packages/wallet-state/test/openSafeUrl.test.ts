import { afterEach, describe, expect, it, vi } from 'vitest'

import { openSafeUrl, resolveSafeOpenUrl } from '../../../apps/extension/src/ui/utils/openSafeUrl'

describe('openSafeUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens HTTPS URLs without exposing window.opener', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)

    expect(openSafeUrl('https://example.com/path')).toBe(true)
    expect(open).toHaveBeenCalledWith('https://example.com/path', '_blank', 'noopener,noreferrer')
  })

  it.each([
    'http://example.com',
    'javascript:alert(1)',
    'data:text/html,<h1>fake wallet</h1>',
    'file:///tmp/wallet',
    'bitcoin:bc1qexample',
    '//example.com/path',
    '/\\evil.example/path',
    'not a url',
    '',
  ])('rejects unsafe or malformed URL %s', url => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)

    expect(openSafeUrl(url)).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })

  it.each(['#/account/create-keystone-wallet', '/settings', './index.html', '../index.html'])(
    'allows extension-internal URL %s',
    url => {
      const open = vi.spyOn(window, 'open').mockImplementation(() => null)

      expect(openSafeUrl(url)).toBe(true)
      expect(open).toHaveBeenCalledWith(
        new URL(url, window.location.href).href,
        '_blank',
        'noopener,noreferrer'
      )
    }
  )

  it('trims and normalizes an HTTPS URL before opening it', () => {
    expect(resolveSafeOpenUrl('  HTTPS://EXAMPLE.COM/path  ')).toBe('https://example.com/path')
  })
})
