import { beforeEach, describe, expect, it, vi } from 'vitest'

import { KeyringType } from '@unisat/keyring-service/types'
import { AddressType, ChainType, NetworkType } from '@unisat/wallet-types'
import log from 'loglevel'
import {
  WalletController,
  canDeriveAddressFromPublicKey,
  chainTypeToRgbNetwork,
} from '../src/controllers/wallet'
import { keyringService, preferenceService } from '../src/services'

vi.mock('@unisat/babylon-service', () => ({
  COSMOS_CHAINS_MAP: {},
  directSignDocToBytesHex: vi.fn(),
  arbitrarySignDocToBytesHex: vi.fn(),
  encodeSignature: vi.fn(),
  getDelegationsV2: vi.fn(),
  CosmosKeyring: vi.fn(),
}))

vi.mock('../src/services', () => ({
  keyringService: {
    getAllDisplayedKeyrings: vi.fn(),
    createTmpKeyring: vi.fn(),
    displayForKeyring: vi.fn(),
    importPublicKeyOnly: vi.fn(),
    keyrings: [],
  },
  preferenceService: {
    getCurrentKeyringIndex: vi.fn(),
    getChainType: vi.fn(() => ChainType.BITCOIN_MAINNET),
    setCurrentKeyringIndex: vi.fn(),
    setCurrentAccount: vi.fn(),
    getCurrentAccount: vi.fn(),
    getKeyringAlianName: vi.fn((_: string, defaultName: string) => defaultName),
    getAccountAlianName: vi.fn((_: string, defaultName: string) => defaultName),
    getAddressFlag: vi.fn(() => 0),
    setShowSafeNotice: vi.fn(),
  },
  walletApiService: {
    setClientAddress: vi.fn(),
  },
  sessionService: {
    broadcastEvent: vi.fn(),
  },
  contactBookService: {},
  notificationService: {},
  permissionService: {},
}))

vi.mock('../src/services/approval', () => ({
  default: {},
}))

const validCompressedPubkey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
const invalidPubkey = 'aa'.repeat(32)

function createDisplayedKeyring({
  index,
  pubkey,
  type = KeyringType.ReadonlyKeyring,
}: {
  index: number
  pubkey: string
  type?: string
}) {
  return {
    type,
    accounts: [{ pubkey, brandName: type }],
    keyring: {},
    addressType: AddressType.P2WPKH,
    index,
  }
}

describe('WalletController keyring recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(log, 'warn').mockImplementation(() => {})
  })

  it('detects public keys that cannot derive an address', () => {
    expect(
      canDeriveAddressFromPublicKey(validCompressedPubkey, AddressType.P2WPKH, NetworkType.MAINNET)
    ).toBe(true)
    expect(canDeriveAddressFromPublicKey(invalidPubkey, AddressType.P2WPKH, NetworkType.MAINNET)).toBe(
      false
    )
  })

  it('returns invalid readonly keyrings as corrupted when listing keyrings', async () => {
    const wallet = new WalletController()
    vi.mocked(keyringService.getAllDisplayedKeyrings).mockResolvedValue([
      createDisplayedKeyring({ index: 0, pubkey: invalidPubkey }),
      createDisplayedKeyring({ index: 1, pubkey: validCompressedPubkey }),
    ] as any)

    const keyrings = await wallet.getKeyrings()

    expect(keyrings).toHaveLength(2)
    expect(keyrings[0]).toMatchObject({
      index: 0,
      isCorrupted: true,
      corruptedReason: 'Invalid Public Key',
    })
    expect(keyrings[0]!.accounts).toEqual([])
    expect(keyrings[1]!.index).toBe(1)
    expect(keyrings[1]!.accounts[0]!.pubkey).toBe(validCompressedPubkey)
  })

  it('falls back to the first valid keyring when the current keyring is invalid', async () => {
    const wallet = new WalletController()
    vi.mocked(preferenceService.getCurrentKeyringIndex).mockReturnValue(0)
    vi.mocked(keyringService.getAllDisplayedKeyrings).mockResolvedValue([
      createDisplayedKeyring({ index: 0, pubkey: invalidPubkey }),
      createDisplayedKeyring({ index: 1, pubkey: validCompressedPubkey }),
    ] as any)

    const currentKeyring = await wallet.getCurrentKeyring()

    expect(currentKeyring?.index).toBe(1)
    expect(preferenceService.setCurrentKeyringIndex).toHaveBeenCalledWith(1)
    expect(preferenceService.setCurrentAccount).toHaveBeenCalledWith(currentKeyring!.accounts[0])
  })

  it('rejects invalid public keys before creating a readonly keyring', async () => {
    const wallet = new WalletController()

    await expect(wallet.createKeyringWithPublicKey(invalidPubkey, AddressType.P2WPKH)).rejects.toThrow(
      'Invalid Public Key'
    )

    expect(keyringService.importPublicKeyOnly).not.toHaveBeenCalled()
  })

  it('prevents switching to corrupted keyrings', async () => {
    const wallet = new WalletController()
    const corruptedKeyring = {
      key: 'keyring_0',
      index: 0,
      type: KeyringType.ReadonlyKeyring,
      addressType: AddressType.P2WPKH,
      accounts: [],
      alianName: 'Readonly #1',
      hdPath: '',
      isCorrupted: true,
      corruptedReason: 'Invalid Public Key',
    }

    await expect(wallet.changeKeyring(corruptedKeyring as any)).rejects.toThrow('Keyring is corrupted')

    expect(preferenceService.setCurrentKeyringIndex).not.toHaveBeenCalled()
    expect(preferenceService.setCurrentAccount).not.toHaveBeenCalled()
  })
})

describe('chainTypeToRgbNetwork', () => {
  it('keeps testnet4 distinct from testnet for RGB resolvers', () => {
    expect(chainTypeToRgbNetwork(ChainType.BITCOIN_MAINNET)).toBe('mainnet')
    expect(chainTypeToRgbNetwork(ChainType.BITCOIN_TESTNET)).toBe('testnet')
    expect(chainTypeToRgbNetwork(ChainType.BITCOIN_TESTNET4)).toBe('testnet4')
    expect(chainTypeToRgbNetwork(ChainType.BITCOIN_SIGNET)).toBe('signet')
  })

  it('rejects non-Bitcoin chains for RGB wallet refs', () => {
    expect(() => chainTypeToRgbNetwork(ChainType.FRACTAL_BITCOIN_MAINNET)).toThrow(
      'not supported by RGB'
    )
  })
})
