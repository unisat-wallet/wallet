import 'reflect-metadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@unisat/babylon-service', () => ({
  arbitrarySignDocToBytesHex: vi.fn(),
  directSignDocToBytesHex: vi.fn(),
  encodeSignature: vi.fn(),
}))

vi.mock('../src/services', () => ({
  permissionService: { hasPermission: vi.fn() },
  sessionService: { broadcastEvent: vi.fn() },
  walletApiService: {},
}))

vi.mock('../src/controllers/wallet', () => ({
  default: {
    isUnlocked: vi.fn(),
    getCurrentAccount: vi.fn(),
  },
}))

import providerController from '../src/controllers/provider/controller'
import wallet from '../src/controllers/wallet'
import { permissionService } from '../src/services'

describe('provider locked read policy', () => {
  const origin = 'https://dapp.example'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(permissionService.hasPermission).mockReturnValue(true)
    vi.mocked(wallet.isUnlocked).mockResolvedValue(true)
    vi.mocked(wallet.getCurrentAccount).mockResolvedValue({
      address: 'bc1qconnected',
      pubkey: '02'.padEnd(66, '1'),
    } as any)
  })

  it('requires unlock for account data while keeping getAccounts passively callable', () => {
    expect(Reflect.getMetadata('SAFE', providerController, 'getAccounts')).toBe(true)
    for (const method of [
      'getPublicKey',
      'getBalance',
      'getBalanceV2',
      'getBitcoinUtxos',
      'getInscriptions',
    ]) {
      expect(Reflect.getMetadata('SAFE', providerController, method), method).not.toBe(true)
    }
  })

  it('returns no accounts to a connected site while the wallet is locked', async () => {
    vi.mocked(wallet.isUnlocked).mockResolvedValue(false)

    await expect(providerController.getAccounts({ session: { origin } } as any)).resolves.toEqual([])

    expect(permissionService.hasPermission).toHaveBeenCalledWith(origin)
    expect(wallet.getCurrentAccount).not.toHaveBeenCalled()
  })

  it('returns the account to a connected site only while unlocked', async () => {
    await expect(providerController.getAccounts({ session: { origin } } as any)).resolves.toEqual([
      'bc1qconnected',
    ])
  })

  it('returns no accounts to an unauthorized site without reading lock state', async () => {
    vi.mocked(permissionService.hasPermission).mockReturnValue(false)

    await expect(providerController.getAccounts({ session: { origin } } as any)).resolves.toEqual([])

    expect(wallet.isUnlocked).not.toHaveBeenCalled()
    expect(wallet.getCurrentAccount).not.toHaveBeenCalled()
  })
})
