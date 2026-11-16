import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  blockedHostnames: ['evil.example'],
  service: {
    getBlockedHostnames: vi.fn(() => mocks.blockedHostnames),
    checkPhishing: vi.fn(() => ({ isPhishing: true })),
    addToWhitelist: vi.fn(() => {
      mocks.blockedHostnames = []
    }),
    removeFromTemporaryWhitelist: vi.fn(),
    forceUpdate: vi.fn(),
    getConfig: vi.fn(() => ({ blacklist: ['evil.example'], whitelist: [] })),
  },
}))

vi.mock('../src/services', () => ({ phishingDetectService: mocks.service }))

import phishingController from '../src/controllers/phishing'

describe('PhishingController hardening', () => {
  const getDynamicRules = vi.fn()
  const updateDynamicRules = vi.fn()
  const tabsGet = vi.fn()
  const tabsUpdate = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.blockedHostnames = ['evil.example']
    getDynamicRules.mockResolvedValue([{ id: 99 }])
    updateDynamicRules.mockResolvedValue(undefined)
    tabsGet.mockResolvedValue({ url: 'https://evil.example/login' })
    tabsUpdate.mockResolvedValue(undefined)
    vi.stubGlobal('chrome', {
      runtime: {
        getURL: (path = '') => `chrome-extension://wallet-id/${path}`,
        onMessage: { addListener: vi.fn() },
      },
      tabs: { get: tabsGet, update: tabsUpdate },
      declarativeNetRequest: {
        getDynamicRules,
        updateDynamicRules,
        RuleActionType: { REDIRECT: 'redirect' },
        ResourceType: { MAIN_FRAME: 'main_frame' },
      },
    })
  })

  it('validates domains and replaces DNR rules in one atomic call', async () => {
    mocks.blockedHostnames = ['evil.example', '*.invalid.example', 'evil.example/path']

    await phishingController.updateDeclarativeRules()

    expect(updateDynamicRules).toHaveBeenCalledOnce()
    expect(updateDynamicRules).toHaveBeenCalledWith({
      removeRuleIds: [99],
      addRules: [
        expect.objectContaining({
          id: 1,
          condition: expect.objectContaining({ urlFilter: '||evil.example/' }),
          action: expect.objectContaining({
            redirect: expect.objectContaining({
              url: expect.stringContaining(`href=${encodeURIComponent('https://evil.example/')}`),
            }),
          }),
        }),
      ],
    })
  })

  it('does not let a subframe redirect the top-level tab', () => {
    const sendResponse = vi.fn()

    const keepChannelOpen = (phishingController as any).handleMessage(
      {
        type: 'REDIRECT_TO_PHISHING_PAGE',
        hostname: 'evil.example',
        url: 'https://evil.example/frame',
      },
      {
        frameId: 2,
        url: 'https://evil.example/frame',
        tab: { id: 7 },
      },
      sendResponse
    )

    expect(keepChannelOpen).toBe(false)
    expect(sendResponse).toHaveBeenCalledWith({ error: 'Invalid parameters or sender' })
    expect(tabsUpdate).not.toHaveBeenCalled()
  })

  it('derives the skip target from the warning page and removes its DNR rule', async () => {
    const href = 'https://evil.example/login?next=%2Fwallet'
    const senderUrl = `chrome-extension://wallet-id/phishing.html#/phishing?href=${encodeURIComponent(href)}`

    const response = await new Promise<any>(resolve => {
      const keepChannelOpen = (phishingController as any).handleMessage(
        { type: 'SKIP_PHISHING_PROTECTION', href },
        { frameId: 0, url: senderUrl, tab: { id: 7 } },
        resolve
      )
      expect(keepChannelOpen).toBe(true)
    })

    expect(mocks.service.addToWhitelist).toHaveBeenCalledWith('evil.example')
    expect(updateDynamicRules).toHaveBeenCalledWith({ removeRuleIds: [99], addRules: [] })
    expect(response).toEqual({ success: true, href, hostname: 'evil.example' })
  })

  it('rolls back the temporary bypass when DNR cannot be updated', async () => {
    const href = 'https://evil.example/'
    updateDynamicRules.mockRejectedValueOnce(new Error('DNR update failed'))

    const response = await new Promise<any>(resolve => {
      ;(phishingController as any).handleMessage(
        { type: 'SKIP_PHISHING_PROTECTION', href },
        {
          frameId: 0,
          url: `chrome-extension://wallet-id/phishing.html#/phishing?href=${encodeURIComponent(href)}`,
          tab: { id: 7 },
        },
        resolve
      )
    })

    expect(mocks.service.removeFromTemporaryWhitelist).toHaveBeenCalledWith('evil.example')
    expect(response.error).toContain('DNR update failed')
  })

  it('rejects a proceed message whose target differs from the displayed warning', () => {
    const sendResponse = vi.fn()

    const keepChannelOpen = (phishingController as any).handleMessage(
      { type: 'SKIP_PHISHING_PROTECTION', href: 'https://other.example/' },
      {
        frameId: 0,
        url: `chrome-extension://wallet-id/phishing.html#/phishing?href=${encodeURIComponent('https://evil.example/')}`,
        tab: { id: 7 },
      },
      sendResponse
    )

    expect(keepChannelOpen).toBe(false)
    expect(sendResponse).toHaveBeenCalledWith({ error: 'Invalid warning target' })
    expect(mocks.service.addToWhitelist).not.toHaveBeenCalled()
  })

  it('rejects a proceed message without the exact displayed target', () => {
    const sendResponse = vi.fn()

    const keepChannelOpen = (phishingController as any).handleMessage(
      { type: 'SKIP_PHISHING_PROTECTION' },
      {
        frameId: 0,
        url: `chrome-extension://wallet-id/phishing.html#/phishing?href=${encodeURIComponent('https://evil.example/')}`,
        tab: { id: 7 },
      },
      sendResponse
    )

    expect(keepChannelOpen).toBe(false)
    expect(sendResponse).toHaveBeenCalledWith({ error: 'Invalid warning target' })
    expect(mocks.service.addToWhitelist).not.toHaveBeenCalled()
  })

  it('binds the warning page display and proceed target to the same URL', async () => {
    await phishingController.redirectToPhishingPage(
      7,
      'https://evil.example/login?next=%2Fwallet',
      'evil.example'
    )

    const redirectUrl = new URL(tabsUpdate.mock.calls[0]![1].url)
    const params = new URLSearchParams(redirectUrl.hash.split('?')[1])
    expect(params.get('href')).toBe('https://evil.example/login?next=%2Fwallet')
    expect(params.has('hostname')).toBe(false)
  })
})
