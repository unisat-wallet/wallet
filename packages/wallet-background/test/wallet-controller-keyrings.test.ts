import { beforeEach, describe, expect, it, vi } from 'vitest'

import { KeyringType } from '@unisat/keyring-service/types'
import { RgbTransferAwaitingAckError, RgbTransferRejectedError } from '@unisat/rgb-service'
import * as txHelpers from '@unisat/tx-helpers'
import { bitcoin, scriptPkToAddress } from '@unisat/wallet-bitcoin'
import { AddressType, ChainType, NetworkType } from '@unisat/wallet-types'
import log from 'loglevel'
import {
  WalletController,
  canDeriveAddressFromPublicKey,
  chainTypeToRgbNetwork,
  toPublicRgbPendingReceiveInvoice,
} from '../src/controllers/wallet'
import { keyringService, preferenceService, walletApiService } from '../src/services'

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
    getKeyringForAccount: vi.fn(),
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
    bitcoin: {
      getAvailableUtxos: vi.fn().mockResolvedValue([]),
      getBTCUtxos: vi.fn().mockResolvedValue([]),
    },
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

describe('RGB wallet references', () => {
  it('shares one local RGB service initialization for concurrent first requests', async () => {
    const wallet = new WalletController()
    let resolveStorage: ((value: undefined) => void) | undefined
    let signalStorageStarted: (() => void) | undefined
    const storageStarted = new Promise<void>(resolve => (signalStorageStarted = resolve))
    const getEncryptedStorageItem = vi.fn(
      () => {
        signalStorageStarted!()
        return new Promise<undefined>(resolve => (resolveStorage = resolve))
      }
    )
    ;(keyringService as any).getEncryptedStorageItem = getEncryptedStorageItem
    ;(keyringService as any).setEncryptedStorageItem = vi.fn().mockResolvedValue(undefined)
    ;(keyringService as any).removeEncryptedStorageItem = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(wallet, 'getCurrentRgbWalletRef').mockResolvedValue({
      walletId: 'rgb-wallet',
      network: 'mainnet',
      fundingAddress: 'bc1p-rgb-funding',
    })

    const first = (wallet as any).getLocalRgbService()
    const second = (wallet as any).getLocalRgbService()
    await storageStarted
    expect(getEncryptedStorageItem).toHaveBeenCalledTimes(1)
    resolveStorage!(undefined)
    const [firstContext, secondContext] = await Promise.all([first, second])

    expect(firstContext.service).toBe(secondContext.service)
    expect(getEncryptedStorageItem).toHaveBeenCalledTimes(1)
  })

  it('does not expose local blind-seal bigint values through wallet responses', () => {
    const result = toPublicRgbPendingReceiveInvoice(
      {
        invoice: 'rgb:invoice',
        recipientId: 'recipient-id',
        assetId: 'rgb:asset',
        amount: '42',
        seal: {
          txid: '11'.repeat(32),
          vout: 0,
          blinding: 1n,
        },
      },
      0
    )

    expect(JSON.stringify(result)).toContain('rgb:invoice')
    expect(result).not.toHaveProperty('seal')
    expect(result).toMatchObject({
      batchTransferIdx: 0,
      kind: 'ReceiveBlind',
      status: 'WaitingCounterparty',
    })
  })

  it('marks invoices backed by unconfirmed funding UTXOs as waiting for confirmation', () => {
    const result = toPublicRgbPendingReceiveInvoice(
      {
        invoice: 'rgb:invoice',
        recipientId: 'recipient-id',
        seal: {
          txid: '11'.repeat(32),
          vout: 0,
          blinding: 1n,
        },
      },
      0,
      'WaitingConfirmations'
    )

    expect(result).toMatchObject({ status: 'WaitingConfirmations', batchTransferIdx: 0 })
  })

  it('derives an isolated RGB wallet for each selected HD account index', async () => {
    const wallet = new WalletController()
    const account = {
      type: KeyringType.HdKeyring,
      pubkey: validCompressedPubkey,
      address: 'bc1qexample',
      key: 'account-7',
      flag: 0,
      index: 7,
    }
    const keyring = {
      getRgbWalletContext: vi.fn().mockResolvedValue({
        xpubVan: 'xpub-vanilla',
        xpubCol: 'xpub-rgb',
        masterFingerprint: 'a1b2c3d4',
        vanillaKeychain: 0,
      }),
      getRgbFundingAccount: vi.fn().mockImplementation((_, accountIndex = 0) => ({
        address: `bc1p${accountIndex}rgbfundingaddress`,
        publicKey: validCompressedPubkey,
        derivationPath: `m/86'/827166'/${accountIndex}'/0/0`,
        masterFingerprint: 'a1b2c3d4',
      })),
    }

    vi.mocked(preferenceService.getCurrentAccount).mockReturnValue(account as any)
    vi.mocked(keyringService.getKeyringForAccount).mockResolvedValue(keyring as any)

    const firstRef = await wallet.getCurrentRgbWalletRef()

    vi.mocked(preferenceService.getCurrentAccount).mockReturnValue({ ...account, index: 2 } as any)
    const secondRef = await wallet.getCurrentRgbWalletRef()

    expect(firstRef).toMatchObject({
      walletId: 'unisat-a1b2c3d4-7',
      fundingAddress: 'bc1p7rgbfundingaddress',
      network: 'mainnet',
    })
    expect(secondRef.walletId).toBe('unisat-a1b2c3d4-2')
    expect(secondRef.fundingAddress).toBe('bc1p2rgbfundingaddress')
    expect(keyring.getRgbFundingAccount).toHaveBeenCalledWith(NetworkType.MAINNET, 7)
    expect(keyring.getRgbFundingAccount).toHaveBeenCalledWith(NetworkType.MAINNET, 2)
    expect(firstRef).not.toHaveProperty('xpubVan')
    expect(firstRef).not.toHaveProperty('xpubCol')
  })

  it('constructs RGB funding UTXO PSBTs locally', async () => {
    const wallet = new WalletController()
    const account = {
      type: KeyringType.HdKeyring,
      pubkey: validCompressedPubkey,
      address: 'bc1qexample',
      key: 'account-0',
      flag: 0,
      index: 0,
    }
    const keyring = {
      getRgbFundingAccount: vi.fn().mockReturnValue({
        address: 'bc1p0rgbfundingaddress',
        publicKey: validCompressedPubkey,
        derivationPath: "m/86'/827166'/0'/0/0",
      }),
    }
    const psbt = { toHex: () => '70736274ff' }

    vi.mocked(preferenceService.getCurrentAccount).mockReturnValue(account as any)
    vi.mocked(keyringService.getKeyringForAccount).mockResolvedValue(keyring as any)
    vi.spyOn(wallet, 'getBTCUtxos').mockResolvedValue([
      {
        txid: '00'.repeat(32),
        vout: 0,
        satoshis: 10_000,
        scriptPk: '0014' + '00'.repeat(20),
        pubkey: validCompressedPubkey,
        addressType: AddressType.P2WPKH,
        inscriptions: [],
      },
    ] as any)
    vi.spyOn(wallet, 'getToSignData').mockResolvedValue({ psbtHex: '70736274ff' } as any)
    const sendSpy = vi.spyOn(txHelpers, 'sendBTC').mockResolvedValue({
      psbt: psbt as any,
      toSignInputs: [{ index: 0, publicKey: validCompressedPubkey }],
    })

    const result = await wallet.createRgbUtxosBegin({ num: 2, feeRate: 3 })

    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        changeAddress: account.address,
        feeRate: 3,
        tos: [
          { address: 'bc1p0rgbfundingaddress', satoshis: 330 },
          { address: 'bc1p0rgbfundingaddress', satoshis: 330 },
        ],
      })
    )
    expect(result).toMatchObject({ local: true, psbtHex: '70736274ff' })
  })

  it('includes available BTC UTXOs when confirmed btc-utxo outputs cannot fund RGB', async () => {
    const wallet = new WalletController()
    const account = {
      type: KeyringType.HdKeyring,
      pubkey: validCompressedPubkey,
      address: 'bc1qexample',
      key: 'account-0',
      flag: 0,
      index: 0,
    }
    const keyring = {
      getRgbFundingAccount: vi.fn().mockReturnValue({
        address: 'bc1p0rgbfundingaddress',
        publicKey: validCompressedPubkey,
        derivationPath: "m/86'/827166'/0'/0/0",
      }),
    }
    const psbt = { toHex: () => '70736274ff' }
    const availableUtxo = {
      txid: '11'.repeat(32),
      vout: 1,
      satoshis: 20_000,
      scriptPk: '0014' + '11'.repeat(20),
      addressType: AddressType.P2WPKH,
      inscriptions: [],
    }

    vi.mocked(preferenceService.getCurrentAccount).mockReturnValue(account as any)
    vi.mocked(keyringService.getKeyringForAccount).mockResolvedValue(keyring as any)
    vi.mocked(walletApiService.bitcoin.getAvailableUtxos).mockResolvedValue([availableUtxo] as any)
    vi.spyOn(wallet, 'getBTCUtxos').mockResolvedValue([
      {
        txid: '00'.repeat(32),
        vout: 0,
        satoshis: 200,
        scriptPk: '0014' + '00'.repeat(20),
        pubkey: validCompressedPubkey,
        addressType: AddressType.P2WPKH,
        inscriptions: [],
      },
    ] as any)
    vi.spyOn(wallet, 'getToSignData').mockResolvedValue({ psbtHex: '70736274ff' } as any)
    const sendSpy = vi.spyOn(txHelpers, 'sendBTC').mockResolvedValue({
      psbt: psbt as any,
      toSignInputs: [{ index: 0, publicKey: validCompressedPubkey }],
    })

    await wallet.createRgbUtxosBegin({ num: 1, feeRate: 1 })

    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        btcUtxos: expect.arrayContaining([
          expect.objectContaining({ satoshis: 200 }),
          expect.objectContaining({ satoshis: 20_000, txid: availableUtxo.txid }),
        ]),
      })
    )
  })

  it('persists broadcast RGB funding UTXOs before retrying indexer synchronization', async () => {
    const wallet = new WalletController()
    const fundingAddress = bitcoin.payments.p2wpkh({
      hash: Buffer.alloc(20, 1),
      network: bitcoin.networks.bitcoin,
    }).address!
    const signedPsbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin })
      .addInput({
        hash: 'a'.repeat(64),
        index: 0,
        witnessUtxo: {
          script: bitcoin.address.toOutputScript(fundingAddress, bitcoin.networks.bitcoin),
          value: 1_000,
        },
      })
      .addOutput({ address: fundingAddress, value: 330 })
    signedPsbt.updateInput(0, {
      finalScriptWitness: Buffer.concat([
        Buffer.from([2, 1, 0, 33]),
        Buffer.from(validCompressedPubkey, 'hex'),
      ]),
    })
    const service = { queueUtxoSync: vi.fn().mockResolvedValue(undefined) }
    const localWallet = { fundingAddress, network: 'mainnet', walletId: 'rgb-wallet' }
    const syncOutbox = vi.spyOn(wallet as any, 'syncRgbIndexerOutbox').mockResolvedValue(false)
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({ service, wallet: localWallet })
    vi.spyOn(wallet as any, 'getCurrentRgbFundingAccount').mockResolvedValue({
      address: fundingAddress,
      publicKey: validCompressedPubkey,
    })
    vi.spyOn(wallet, 'pushTx').mockResolvedValue('e'.repeat(64))

    await expect(wallet.createRgbUtxosEnd({ signedPsbt: signedPsbt.toBase64() })).resolves.toMatchObject({
      txid: 'e'.repeat(64),
      outpoints: [expect.objectContaining({ vout: 0, satoshis: 330 })],
    })

    expect(service.queueUtxoSync).toHaveBeenCalledWith({
      txid: 'e'.repeat(64),
      outpoints: [
        expect.objectContaining({
          outpoint: { txid: 'e'.repeat(64), vout: 0 },
          chainStatus: 'mempool',
          satoshis: 330,
          allocations: [],
        }),
      ],
    })
    expect(syncOutbox).toHaveBeenCalledWith(service, localWallet)
    expect(service.queueUtxoSync.mock.invocationCallOrder[0]).toBeLessThan(
      syncOutbox.mock.invocationCallOrder[0]
    )
  })

  it('completes the sole persisted RGB transfer after a background restart', async () => {
    const wallet = new WalletController()
    const service = { getPendingTransfers: vi.fn(() => [{ id: 'persisted-rgb-transfer' }]), completeSend: vi.fn().mockResolvedValue({ txid: 'aa'.repeat(32) }) }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({ service, wallet: { fundingAddress: 'bc1p-rgb-funding' } })

    const signedPsbt = new bitcoin.Psbt().toBase64()
    await expect(wallet.createRgbSendEnd({ signedPsbt })).resolves.toEqual({ txid: 'aa'.repeat(32) })
    expect(service.completeSend).toHaveBeenCalledWith('persisted-rgb-transfer', signedPsbt)
  })

  it('returns a pending transfer result while waiting for a proxy acknowledgement', async () => {
    const wallet = new WalletController()
    const service = {
      getPendingTransfers: vi.fn(() => [
        {
          id: 'pending-rgb-transfer',
          delivery: { completed: { txid: 'bb'.repeat(32) } },
        },
      ]),
      completeSend: vi
        .fn()
        .mockRejectedValue(new RgbTransferAwaitingAckError('pending-rgb-transfer')),
    }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({
      service,
      wallet: { fundingAddress: 'bc1p-rgb-funding' },
    })

    const signedPsbt = new bitcoin.Psbt().toBase64()
    await expect(
      wallet.createRgbSendEnd({ signedPsbt, transferId: 'pending-rgb-transfer' })
    ).resolves.toEqual({
      transferId: 'pending-rgb-transfer',
      txid: 'bb'.repeat(32),
      status: 'waiting_ack',
    })
  })

  it('formats atomic RGB amounts for the signing action', async () => {
    const wallet = new WalletController()
    const service = {
      sync: vi.fn(),
      prepareSend: vi.fn().mockResolvedValue({
        id: 'rgb-transfer',
        psbt: 'cHNidP8=',
        toSignInputs: [],
      }),
    }
    const getRgbToSignData = vi
      .spyOn(wallet, 'getRgbToSignData')
      .mockResolvedValue({ psbtHex: '00', toSignInputs: [] } as any)
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({
      service,
      wallet: { fundingAddress: 'bc1p-rgb-funding' },
    })

    await wallet.createRgbSendBegin({
      invoice: 'rgb:asset/schema/~/bc:utxob:recipient?amount=8888888888&endpoints=rpc://proxy',
      assetId: 'rgb:asset',
      amount: '8888888888',
      ticker: 'RGB',
      precision: 8,
      feeRate: 2,
    })

    expect(getRgbToSignData).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({
          details: [expect.objectContaining({ label: 'Amount', value: '88.88888888 RGB' })],
        }),
      })
    )
  })

  it('returns a rejected transfer result without retaining a pending send', async () => {
    const wallet = new WalletController()
    const pending = [
      {
        id: 'rejected-rgb-transfer',
        delivery: { completed: { txid: 'cc'.repeat(32) } },
      },
    ]
    const service = {
      getPendingTransfers: vi.fn(() => pending),
      completeSend: vi.fn(async () => {
        pending.splice(0)
        throw new RgbTransferRejectedError('rejected-rgb-transfer', 'cc'.repeat(32))
      }),
    }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({
      service,
      wallet: { fundingAddress: 'bc1p-rgb-funding' },
    })

    const signedPsbt = new bitcoin.Psbt().toBase64()
    await expect(
      wallet.createRgbSendEnd({ signedPsbt, transferId: 'rejected-rgb-transfer' })
    ).resolves.toEqual({
      transferId: 'rejected-rgb-transfer',
      txid: 'cc'.repeat(32),
      status: 'rejected',
    })
    expect(service.getPendingTransfers()).toEqual([])
  })

  it('retries a locally persisted RGB broadcast failure without preparing a new transfer', async () => {
    const wallet = new WalletController()
    const pending = [
      {
        id: 'pending-rgb-transfer',
        delivery: { broadcastError: 'broadcast unavailable' },
      },
    ]
    const service = {
      getPendingTransfers: vi.fn(() => pending),
      sync: vi.fn(async () => {
        pending.splice(0)
      }),
    }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({
      service,
      wallet: { fundingAddress: 'bc1p-rgb-funding' },
    })

    await expect(wallet.retryRgbBroadcast({ transferId: 'pending-rgb-transfer' })).resolves.toEqual({
      broadcast: true,
      status: 'confirming',
    })
    expect(service.sync).toHaveBeenCalledTimes(1)
  })

  it('does not poll RGB receive infrastructure when there are no pending invoices', async () => {
    const wallet = new WalletController()
    const calls: string[] = []
    const service = { sync: vi.fn(async () => void calls.push('sync')), claimPendingReceives: vi.fn(async () => void calls.push('claim')), processClaimedReceives: vi.fn(async () => ({ received: 0 })), getPendingReceives: vi.fn(() => []) }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({ service, wallet: { fundingAddress: 'bc1p-rgb-funding' } })

    await wallet.getRgbPendingReceiveInvoices()
    expect(calls).toEqual([])
  })

  it('refreshes the funding UTXO snapshot before reporting a pending invoice status', async () => {
    const wallet = new WalletController()
    const pendingReceive = {
      invoice: 'rgb:invoice',
      recipientId: 'recipient-id',
      seal: { txid: '11'.repeat(32), vout: 0, blinding: 1n },
    }
    const service = {
      sync: vi.fn().mockResolvedValue(undefined),
      getPendingReceives: vi.fn(() => [pendingReceive]),
      getSnapshot: vi.fn(() => ({
        utxos: [
          {
            outpoint: { txid: pendingReceive.seal.txid, vout: pendingReceive.seal.vout },
            chainStatus: 'confirmed',
          },
        ],
      })),
      processClaimedReceives: vi.fn(async () => ({ received: 0 })),
    }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({
      service,
      wallet: { fundingAddress: 'bc1p-rgb-funding', network: 'mainnet' },
    })

    await expect(wallet.getRgbPendingReceiveInvoices()).resolves.toMatchObject({
      list: [{ invoice: 'rgb:invoice', status: 'WaitingCounterparty' }],
    })
    expect(service.sync).toHaveBeenCalledTimes(1)
  })

  it('does not sync the RGB snapshot for a skip-sync allocation summary', async () => {
    const wallet = new WalletController()
    const service = {
      sync: vi.fn(),
      getAvailableReceiveUtxos: vi.fn(() => []),
      getPendingConfirmationReceiveUtxos: vi.fn(() => []),
    }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({
      service,
      wallet: { fundingAddress: 'bc1p-rgb-funding' },
    })

    await wallet.getRgbAllocationSummary({ skipSync: true })

    expect(service.sync).not.toHaveBeenCalled()
  })

  it('counts mempool RGB funding UTXOs as pending allocations', async () => {
    const wallet = new WalletController()
    const service = {
      sync: vi.fn(),
      getAvailableReceiveUtxos: vi.fn(() => []),
      getPendingConfirmationReceiveUtxos: vi.fn(() => [{ outpoint: { txid: 'aa', vout: 0 } }]),
    }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({
      service,
      wallet: { fundingAddress: 'bc1p-rgb-funding' },
    })

    await expect(wallet.getRgbAllocationSummary({ skipSync: true })).resolves.toMatchObject({
      available: false,
      availableAllocationCount: 0,
      pendingConfirmation: true,
      pendingAllocationCount: 1,
    })
  })

  it('does not trigger an additional receive sync after acceptance', async () => {
    const wallet = new WalletController()
    const service = {
      acceptReceive: vi.fn().mockResolvedValue({ accepted: true, status: 'accepted' }),
    }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({
      service,
      wallet: { fundingAddress: 'bc1p-rgb-funding' },
    })
    const syncRgbReceivedAllocations = vi.spyOn(wallet as any, 'syncRgbReceivedAllocations')

    await expect(wallet.acceptRgbReceive({ recipientId: 'recipient-id' })).resolves.toEqual({
      accepted: true,
      status: 'accepted',
    })

    expect(service.acceptReceive).toHaveBeenCalledWith('recipient-id')
    expect(syncRgbReceivedAllocations).not.toHaveBeenCalled()
  })

  it('syncs confirmed receive history before removing it from the local outbox', async () => {
    const wallet = new WalletController()
    const syncRgbReceiveTransfer = vi.fn().mockResolvedValue(undefined)
    const senderScript = '0014' + '11'.repeat(20)
    const senderAddress = scriptPkToAddress(senderScript, NetworkType.MAINNET)
    ;(walletApiService as any).rgb = { syncRgbReceiveTransfer }
    const service = {
      getPendingReceiveHistory: vi.fn(() => [
        {
          transferId: 'receive:invoice-1',
          assetId: 'rgb:' + 'ab'.repeat(32),
          amount: '2',
          txid: 'c'.repeat(64),
          createdAt: 1_786_688_361_585,
          counterpartyScriptPubKeys: [senderScript],
        },
      ]),
      markReceiveHistorySynced: vi.fn().mockResolvedValue(undefined),
    }
    const walletRef = { fundingAddress: 'bc1p-rgb-funding' }

    await (wallet as any).syncRgbReceiveHistory(service, walletRef)

    expect(syncRgbReceiveTransfer).toHaveBeenCalledWith({
      wallet: walletRef,
      transferId: 'receive:invoice-1',
      assetId: 'rgb:' + 'ab'.repeat(32),
      amount: '2',
      txid: 'c'.repeat(64),
      createdAt: 1_786_688_361_585,
      from: senderAddress,
    })
    expect(service.markReceiveHistorySynced).toHaveBeenCalledWith('receive:invoice-1')
  })

  it('retries a durable received-allocation UTXO replacement after a backend failure', async () => {
    const wallet = new WalletController()
    let pendingUtxoSync: any = {
      txid: 'd'.repeat(64),
      outpoints: [
        {
          outpoint: { txid: 'd'.repeat(64), vout: 0 },
          satoshis: 330,
          scriptPubKey: '5120' + '11'.repeat(32),
          publicKey: validCompressedPubkey,
          allocations: [{ assetId: 'rgb:asset', amount: '1', settled: true, spendable: true }],
        },
      ],
    }
    const replaceRgbUtxos = vi.fn().mockRejectedValueOnce(new Error('temporarily unavailable'))
    replaceRgbUtxos.mockResolvedValueOnce(undefined)
    ;(walletApiService as any).rgb = { replaceRgbUtxos }
    const service = {
      getPendingIssues: vi.fn(() => []),
      getPendingUtxoSync: vi.fn(() => pendingUtxoSync),
      markUtxoSyncCompleted: vi.fn(async () => {
        pendingUtxoSync = undefined
      }),
    }
    const walletRef = { fundingAddress: 'bc1p-rgb-funding' }

    await expect((wallet as any).syncRgbIndexerOutbox(service, walletRef)).resolves.toBe(false)
    expect(pendingUtxoSync).toBeDefined()
    await expect((wallet as any).syncRgbIndexerOutbox(service, walletRef)).resolves.toBe(true)

    expect(replaceRgbUtxos).toHaveBeenCalledTimes(2)
    expect(service.markUtxoSyncCompleted).toHaveBeenCalledWith('d'.repeat(64))
    expect(pendingUtxoSync).toBeUndefined()
  })

  it('retries a pending issuance after a metadata synchronization failure', async () => {
    const wallet = new WalletController()
    const pendingIssues: any[] = [
      {
        assetId: 'rgb:issued',
        asset: { ticker: 'ISS', name: 'Issued', precision: 0, schema: 'NIA', issuedSupply: '1' },
        utxoSync: {
          txid: 'e'.repeat(64),
          outpoints: [
            {
              outpoint: { txid: 'e'.repeat(64), vout: 0 },
              satoshis: 330,
              scriptPubKey: '5120' + '22'.repeat(32),
              publicKey: validCompressedPubkey,
              allocations: [{ assetId: 'rgb:issued', amount: '1', settled: true, spendable: true }],
            },
          ],
        },
      },
    ]
    const syncRgbAssetMetadata = vi.fn().mockRejectedValueOnce(new Error('temporarily unavailable'))
    syncRgbAssetMetadata.mockResolvedValueOnce(undefined)
    const syncRgbUtxos = vi.fn().mockResolvedValue(undefined)
    ;(walletApiService as any).rgb = { syncRgbAssetMetadata, syncRgbUtxos }
    const service = {
      getPendingIssues: vi.fn(() => pendingIssues),
      markIssueSynced: vi.fn(async () => pendingIssues.splice(0)),
      getPendingUtxoSync: vi.fn(() => undefined),
    }
    const walletRef = { fundingAddress: 'bc1p-rgb-funding' }

    await expect((wallet as any).syncRgbIndexerOutbox(service, walletRef)).resolves.toBe(false)
    expect(pendingIssues).toHaveLength(1)
    await expect((wallet as any).syncRgbIndexerOutbox(service, walletRef)).resolves.toBe(true)

    expect(syncRgbAssetMetadata).toHaveBeenCalledTimes(2)
    expect(syncRgbUtxos).toHaveBeenCalledTimes(1)
    expect(service.markIssueSynced).toHaveBeenCalledWith('rgb:issued')
  })

  it('does not poll receive consignments while loading the RGB asset list', async () => {
    const wallet = new WalletController()
    const calls: string[] = []
    const service = {
      sync: vi.fn(async () => void calls.push('sync')),
      claimPendingReceives: vi.fn(async () => void calls.push('claim')),
      processClaimedReceives: vi.fn(async () => {
        calls.push('process')
        return { received: 0 }
      }),
      getPendingTransfers: vi.fn(() => []),
      getSnapshot: vi.fn(() => ({ utxos: [] })),
    }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({
      service,
      wallet: { fundingAddress: 'bc1p-rgb-funding' },
    })
    vi.spyOn(wallet, 'getRgbFundingAddress').mockResolvedValue({ address: 'bc1p-rgb-funding' })
    const getAssetList = vi
      .spyOn(wallet, 'getRgbAssetList')
      .mockResolvedValue({ currentPage: 1, pageSize: 20, total: 0, list: [] })

    await wallet.getRGBList('', 1, 20)

    expect(calls).toEqual([])
    expect(getAssetList).toHaveBeenCalledWith('bc1p-rgb-funding', 1, 20)
  })

  it('skips RGB allocation sync when loading the asset list for the Bitcoin home view', async () => {
    const wallet = new WalletController()
    const service = {
      sync: vi.fn(),
      claimPendingReceives: vi.fn(),
      processClaimedReceives: vi.fn(),
    }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({
      service,
      wallet: { fundingAddress: 'bc1p-rgb-funding' },
    })
    vi.spyOn(wallet, 'getRgbFundingAddress').mockResolvedValue({ address: 'bc1p-rgb-funding' })
    const getAssetList = vi
      .spyOn(wallet, 'getRgbAssetList')
      .mockResolvedValue({ currentPage: 1, pageSize: 20, total: 0, list: [] })

    await wallet.getRGBList('', 1, 20, { skipSync: true })

    expect(service.sync).not.toHaveBeenCalled()
    expect(service.claimPendingReceives).not.toHaveBeenCalled()
    expect(getAssetList).toHaveBeenCalledWith('bc1p-rgb-funding', 1, 20)
  })

  it('refreshes colored UTXO state once before loading the RGB asset list', async () => {
    const wallet = new WalletController()
    const service = {
      sync: vi.fn().mockResolvedValue(undefined),
      getPendingTransfers: vi.fn(() => []),
      getSnapshot: vi.fn(() => ({ utxos: [{ allocations: [{ assetId: 'rgb:asset' }] }] })),
    }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({
      service,
      wallet: { network: 'mainnet', fundingAddress: 'bc1p-rgb-funding' },
    })
    vi.spyOn(wallet, 'getRgbFundingAddress').mockResolvedValue({ address: 'bc1p-rgb-funding' })
    vi.spyOn(wallet, 'getRgbAssetList').mockResolvedValue({ currentPage: 1, pageSize: 20, total: 0, list: [] })

    await Promise.all([wallet.getRGBList('', 1, 20), wallet.getRGBList('', 1, 20)])

    expect(service.sync).toHaveBeenCalledTimes(1)
  })

  it('shares a snapshot refresh across sequential RGB list and receive polling', async () => {
    const wallet = new WalletController()
    const service = {
      sync: vi.fn().mockResolvedValue(undefined),
      processClaimedReceives: vi.fn().mockResolvedValue({ received: 0 }),
      getPendingTransfers: vi.fn(() => []),
      getSnapshot: vi.fn(() => ({ utxos: [{ allocations: [{ assetId: 'rgb:asset' }] }] })),
    }
    const walletRef = {
      walletId: 'rgb-wallet',
      network: 'mainnet',
      fundingAddress: 'bc1p-rgb-funding',
    }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({ service, wallet: walletRef })
    vi.spyOn(wallet, 'getRgbFundingAddress').mockResolvedValue({ address: walletRef.fundingAddress })
    vi.spyOn(wallet, 'getRgbAssetList').mockResolvedValue({ currentPage: 1, pageSize: 20, total: 0, list: [] })

    await wallet.getRGBList('', 1, 20)
    await (wallet as any).syncRgbReceivedAllocations()
    await (wallet as any).syncRgbReceivedAllocations()

    expect(service.sync).toHaveBeenCalledTimes(1)
    expect(service.processClaimedReceives).toHaveBeenCalledWith({
      includeClaimed: false,
      deferConfirmedSettlement: true,
    })
  })

  it('refreshes the RGB snapshot before and after receive confirmation is detected', async () => {
    const wallet = new WalletController()
    const service = {
      sync: vi.fn().mockResolvedValue(undefined),
      processClaimedReceives: vi
        .fn()
        .mockResolvedValueOnce({ received: 0, snapshotRequired: true })
        .mockResolvedValueOnce({ received: 0, snapshotRequired: false }),
      getSnapshot: vi.fn(() => ({ utxos: [] })),
    }
    const walletRef = {
      walletId: 'rgb-wallet',
      network: 'mainnet',
      fundingAddress: 'bc1p-rgb-funding',
    }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({ service, wallet: walletRef })

    await (wallet as any).syncRgbReceivedAllocations()

    expect(service.sync).toHaveBeenCalledTimes(2)
    expect(service.processClaimedReceives).toHaveBeenNthCalledWith(1, {
      includeClaimed: false,
      deferConfirmedSettlement: true,
    })
    expect(service.processClaimedReceives).toHaveBeenNthCalledWith(2, { includeClaimed: false })
  })

  it('lists local RGB transfers awaiting receiver acknowledgement before remote activity', async () => {
    const wallet = new WalletController()
    const service = {
      sync: vi.fn().mockResolvedValue(undefined),
      syncPendingTransfers: vi.fn().mockResolvedValue(undefined),
      getPendingTransfers: vi.fn(() => [
        {
          id: 'local-transfer',
          createdAt: 100,
          request: { assetId: 'rgb:asset', amount: '10' },
          delivery: { completed: { txid: 'a'.repeat(64) } },
        },
      ]),
      getPendingReceives: vi.fn(() => []),
    }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({
      service,
      wallet: { fundingAddress: 'bc1p-rgb-funding' },
    })
    vi.spyOn(wallet, 'getAddressRgbActivity').mockResolvedValue({
      currentPage: 1,
      pageSize: 20,
      total: 1,
      list: [
        {
          id: 'remote-transfer',
          assetId: 'rgb:asset',
          type: 'receive',
          amount: null,
          txid: 'b'.repeat(64),
          createdAt: 50,
          status: 'settled',
        },
      ],
    })

    const result = await wallet.getRgbTransfers(1, 20)

    expect(service.syncPendingTransfers).toHaveBeenCalledTimes(1)
    expect(service.sync).not.toHaveBeenCalled()
    expect(result.list).toMatchObject([
      { id: 'local-send:local-transfer', status: 'waiting_ack', amount: '10', local: true },
      { id: 'remote-transfer', status: 'settled', amount: undefined, timestamp: 50 },
    ])
  })

  it('can list RGB transfers without waiting for pending-transfer sync', async () => {
    const wallet = new WalletController()
    const service = {
      sync: vi.fn().mockResolvedValue(undefined),
      syncPendingTransfers: vi.fn().mockResolvedValue(undefined),
      getPendingTransfers: vi.fn(() => [
        {
          id: 'local-transfer',
          createdAt: 100,
          request: { assetId: 'rgb:asset', amount: '10' },
          delivery: { completed: { txid: 'a'.repeat(64) } },
        },
      ]),
      getPendingReceives: vi.fn(() => []),
    }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({
      service,
      wallet: { fundingAddress: 'bc1p-rgb-funding' },
    })
    vi.spyOn(wallet, 'getAddressRgbActivity').mockResolvedValue({
      currentPage: 1,
      pageSize: 20,
      total: 0,
      list: [],
    })

    const result = await wallet.getRgbTransfers(1, 20, { skipSync: true })

    expect(service.syncPendingTransfers).not.toHaveBeenCalled()
    expect(result.list).toMatchObject([
      { id: 'local-send:local-transfer', status: 'waiting_ack', amount: '10', local: true },
    ])
  })

  it('does not repeat local RGB transfers on subsequent history pages', async () => {
    const wallet = new WalletController()
    const service = {
      getPendingTransfers: vi.fn(() => [
        {
          id: 'local-transfer',
          createdAt: 100,
          request: { assetId: 'rgb:asset', amount: '10' },
        },
      ]),
      syncPendingTransfers: vi.fn().mockResolvedValue(undefined),
      getPendingReceives: vi.fn(() => []),
    }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({
      service,
      wallet: { fundingAddress: 'bc1p-rgb-funding' },
    })
    vi.spyOn(wallet, 'getAddressRgbActivity').mockResolvedValue({
      currentPage: 2,
      pageSize: 20,
      total: 21,
      list: [
        {
          id: 'remote-page-two',
          assetId: 'rgb:asset',
          type: 'receive',
          amount: '1',
          txid: 'b'.repeat(64),
          createdAt: 50,
          status: 'settled',
        },
      ],
    })

    const result = await wallet.getRgbTransfers(2, 20)

    expect(result).toMatchObject({ currentPage: 2, total: 21 })
    expect(result.list).toEqual([expect.objectContaining({ id: 'remote-page-two' })])
  })

  it('excludes locally locked RGB UTXOs from the asset list spendable balance', async () => {
    const wallet = new WalletController()
    const service = {
      getPendingTransfers: vi.fn(() => [
        {
          broadcast: undefined,
          request: { assetId: 'rgb:asset', amount: '2' },
          prepared: { lockedOutpoints: [{ txid: 'a'.repeat(64), vout: 0 }] },
        },
      ]),
      getSnapshot: vi.fn(() => ({
        utxos: [
          {
            outpoint: { txid: 'a'.repeat(64), vout: 0 },
            allocations: [
              { assetId: 'rgb:asset', amount: '10', settled: true, spendable: true },
            ],
          },
        ],
      })),
    }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({ service })
    vi.spyOn(wallet, 'getRgbFundingAddress').mockResolvedValue({ address: 'bc1p-rgb-funding' })
    vi.spyOn(wallet, 'getRgbAssetList').mockResolvedValue({
      currentPage: 1,
      pageSize: 20,
      total: 1,
      list: [{ assetId: 'rgb:asset', spendable: '10' }],
    })

    const result = await wallet.getRGBList('', 1, 20, { skipSync: true })

    expect(result.list).toEqual([{ assetId: 'rgb:asset', spendable: '0', lockedAmount: '10' }])
  })

  it('does not count a broadcasted local send twice when its backend activity already exists', async () => {
    const wallet = new WalletController()
    const transferId = 'broadcasted-transfer'
    const txid = 'a'.repeat(64)
    const service = {
      getPendingTransfers: vi.fn(() => []),
      getPendingReceives: vi.fn(() => []),
      getPendingSendHistory: vi.fn(() => [
        {
          transferId,
          assetId: 'rgb:asset',
          amount: '1',
          txid,
          createdAt: 100,
          status: 'broadcasted',
        },
      ]),
    }
    const walletRef = { fundingAddress: 'bc1p-rgb-funding' }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({ service, wallet: walletRef })
    vi.spyOn(wallet, 'getAddressRgbActivity').mockResolvedValue({
      currentPage: 1,
      pageSize: 20,
      total: 1,
      list: [
        {
          id: transferId,
          assetId: 'rgb:asset',
          type: 'send',
          amount: '1',
          txid,
          createdAt: 100,
        },
      ],
    })

    const result = await wallet.getRgbTransfers(1, 20)

    expect(result).toMatchObject({
      total: 1,
      list: [{ id: `local-send:${transferId}`, txid, status: 'broadcasted' }],
    })
  })

  it('uses the confirmed backend activity instead of a local broadcast history', async () => {
    const wallet = new WalletController()
    const transferId = 'confirmed-transfer'
    const txid = 'b'.repeat(64)
    const service = {
      getPendingTransfers: vi.fn(() => []),
      getPendingReceives: vi.fn(() => []),
      getPendingSendHistory: vi.fn(() => [
        {
          transferId,
          assetId: 'rgb:asset',
          amount: '1',
          txid,
          createdAt: 100,
          status: 'broadcasted',
        },
      ]),
      markSendHistoryConfirmed: vi.fn().mockResolvedValue(undefined),
    }
    const walletRef = { fundingAddress: 'bc1p-rgb-funding' }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({ service, wallet: walletRef })
    vi.spyOn(wallet, 'getAddressRgbActivity').mockResolvedValue({
      currentPage: 1,
      pageSize: 20,
      total: 1,
      list: [
        {
          id: transferId,
          assetId: 'rgb:asset',
          type: 'send',
          amount: '1',
          txid,
          createdAt: 100,
          status: 'confirmed',
        },
      ],
    })

    const result = await wallet.getRgbTransfers(1, 20)

    expect(result).toMatchObject({
      total: 1,
      list: [{ id: transferId, txid, status: 'confirmed' }],
    })
    expect(result.list[0]).not.toHaveProperty('local')
    expect(service.markSendHistoryConfirmed).toHaveBeenCalledWith(transferId)
  })

  it('does not list a receive invoice until its consignment has been acknowledged', async () => {
    const wallet = new WalletController()
    const service = {
      getPendingTransfers: vi.fn(() => []),
      getPendingReceives: vi.fn(() => [
        {
          recipientId: 'invoice-only',
          assetId: 'rgb:asset',
          amount: '2',
          createdAt: 100,
        },
        {
          recipientId: 'pending-accept',
          assetId: 'rgb:asset',
          amount: '5',
          createdAt: 95,
          pendingAccept: {
            payload: 'consignment',
            txid: 'd'.repeat(64),
            assetId: 'rgb:asset',
            amount: '5',
            discoveredAt: 96,
          },
        },
        {
          recipientId: 'received-consignment',
          assetId: 'rgb:asset',
          amount: '3',
          createdAt: 90,
          receivedConsignment: {
            txid: 'c'.repeat(64),
            receivedAt: 110,
            accepted: true,
            broadcastDetectedAt: 111,
          },
        },
        {
          recipientId: 'accepted-unbroadcast',
          assetId: 'rgb:asset',
          amount: '4',
          createdAt: 85,
          receivedConsignment: {
            txid: 'e'.repeat(64),
            receivedAt: 86,
            accepted: true,
          },
        },
        {
          recipientId: 'legacy-auto-accepted',
          assetId: 'rgb:asset',
          amount: '7',
          createdAt: 80,
          receivedConsignment: {
            txid: 'f'.repeat(64),
            receivedAt: 81,
          },
        },
      ]),
    }
    const walletRef = { fundingAddress: 'bc1p-rgb-funding' }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({ service, wallet: walletRef })
    vi.spyOn(wallet as any, 'syncRgbReceivedAllocations').mockResolvedValue({ service, wallet: walletRef })
    vi.spyOn(wallet, 'getAddressRgbActivity').mockResolvedValue({
      currentPage: 1,
      pageSize: 20,
      total: 0,
      list: [],
    })

    const result = await wallet.getRgbTransfers(1, 20)

    expect(result.list).toEqual([
      expect.objectContaining({
        id: 'local-receive:received-consignment',
        status: 'confirming',
        amount: '3',
      }),
      expect.objectContaining({
        id: 'local-receive:pending-accept',
        status: 'pending_accept',
        amount: '5',
      }),
      expect.objectContaining({
        id: 'local-receive:accepted-unbroadcast',
        status: 'confirming',
        amount: '4',
      }),
      expect.objectContaining({
        id: 'local-receive:legacy-auto-accepted',
        status: 'pending_accept',
        amount: '7',
      }),
    ])
  })

  it('issues an RGB asset on a mempool funding UTXO as non-spendable', async () => {
    const wallet = new WalletController()
    const snapshot = {
      syncedAt: 1,
      utxos: [
        {
          outpoint: { txid: '11'.repeat(32), vout: 0 },
          satoshis: 330,
          scriptPubKey: '5120' + '11'.repeat(32),
          publicKey: validCompressedPubkey,
          chainStatus: 'mempool',
          allocations: [],
        },
      ],
    }
    const pendingIssues: any[] = []
    const service = {
      sync: vi.fn(),
      getSnapshot: vi.fn(() => snapshot),
      queueIssue: vi.fn(async (issue: any) => pendingIssues.push(issue)),
      getPendingIssues: vi.fn(() => pendingIssues),
      markIssueSynced: vi.fn(async (assetId: string) => {
        const index = pendingIssues.findIndex(issue => issue.assetId === assetId)
        if (index >= 0) pendingIssues.splice(index, 1)
      }),
      getPendingUtxoSync: vi.fn(() => undefined),
    }
    const syncRgbAssetMetadata = vi.fn()
    const syncRgbUtxos = vi.fn()
    ;(walletApiService as any).rgb = { syncRgbAssetMetadata, syncRgbUtxos }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({
      service,
      wallet: { fundingAddress: 'bc1p-rgb-funding', network: 'mainnet' },
    })

    const result = await wallet.createRgbIssueNia({
      ticker: 'RGB',
      name: 'Pending RGB',
      precision: 0,
      amounts: ['1'],
    })

    expect(result).toMatchObject({ pendingConfirmation: true })
    expect(syncRgbUtxos).toHaveBeenCalledWith(
      expect.objectContaining({
        outpoints: [
          expect.objectContaining({
            allocations: [expect.objectContaining({ settled: false, spendable: false })],
          }),
        ],
      })
    )
  })
})
