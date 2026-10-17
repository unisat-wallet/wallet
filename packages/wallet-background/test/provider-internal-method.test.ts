import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/services', () => ({
  keyringService: {
    memStore: {
      getState: vi.fn(),
    },
  },
  permissionService: {
    hasPermission: vi.fn(),
  },
}))

vi.mock('../src/controllers/wallet', () => ({
  default: {
    getCurrentAccount: vi.fn(),
    getLegacyNetworkName: vi.fn(),
  },
}))

import internalMethod from '../src/controllers/provider/internalMethod'
import { keyringService, permissionService } from '../src/services'
import wallet from '../src/controllers/wallet'

describe('provider internal methods', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(keyringService.memStore.getState).mockReturnValue({ isUnlocked: true } as any)
    vi.mocked(wallet.getLegacyNetworkName).mockReturnValue('livenet')
  })

  it('binds a tab check-in to the sending document instead of the current tab URL', () => {
    const session = { origin: '', setProp: vi.fn() }

    internalMethod.tabCheckin({
      data: { params: { name: 'Example', icon: 'https://example.com/icon.png' } },
      session,
      port: {
        sender: {
          url: 'https://example.com/connect',
          tab: { url: 'chrome://newtab/' },
        },
      },
    })

    expect(session.setProp).toHaveBeenCalledWith({
      origin: 'https://example.com',
      name: 'Example',
      icon: 'https://example.com/icon.png',
    })
  })

  it('rejects non-web provider origins', () => {
    expect(() =>
      internalMethod.tabCheckin({
        data: { params: { name: 'New tab', icon: '' } },
        session: { origin: '', setProp: vi.fn() },
        port: { sender: { url: 'chrome://newtab/' } },
      })
    ).toThrow('Unsupported request origin')
  })

  it('does not let a check-in replace the origin bound to its port session', () => {
    expect(() =>
      internalMethod.tabCheckin({
        data: { params: { name: 'Other', icon: '' } },
        session: { origin: 'https://example.com', setProp: vi.fn() },
        port: { sender: { url: 'https://other.example/' } },
      })
    ).toThrow('Request origin changed')
  })

  it('does not disclose accounts to an unconnected origin', async () => {
    vi.mocked(permissionService.hasPermission).mockReturnValue(false)
    vi.mocked(wallet.getCurrentAccount).mockResolvedValue({ address: 'bc1qunconnected' } as any)

    const state = await internalMethod.getProviderState({
      session: { origin: 'https://unconnected.example' },
    })

    expect(state).toEqual({ network: 'livenet', isUnlocked: true, accounts: [] })
    expect(wallet.getCurrentAccount).not.toHaveBeenCalled()
  })

  it('returns the current account to a connected origin', async () => {
    vi.mocked(permissionService.hasPermission).mockReturnValue(true)
    vi.mocked(wallet.getCurrentAccount).mockResolvedValue({ address: 'bc1qconnected' } as any)

    const state = await internalMethod.getProviderState({
      session: { origin: 'https://connected.example' },
    })

    expect(permissionService.hasPermission).toHaveBeenCalledWith('https://connected.example')
    expect(state).toEqual({ network: 'livenet', isUnlocked: true, accounts: ['bc1qconnected'] })
  })
})
