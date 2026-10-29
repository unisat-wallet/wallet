import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { publicKeyHexToAddress } from '@unisat/babylon-service'
import { KeyringType } from '@unisat/keyring-service/types'
import { RgbTransferAwaitingAckError, RgbTransferRejectedError } from '@unisat/rgb-service'
import * as txHelpers from '@unisat/tx-helpers'
import { bitcoin } from '@unisat/wallet-bitcoin'
import { BUS_EVENTS, BUS_METHODS, CHAINS_MAP, ErrorCodes, toRgbDisplayAmount } from '@unisat/wallet-shared'
import { AddressType, ChainType, NetworkType } from '@unisat/wallet-types'
import log from 'loglevel'
import {
  WalletController,
  canDeriveAddressFromPublicKey,
  chainTypeToRgbNetwork,
  planRgbFeePoolTopUp,
  toPublicRgbPendingReceiveInvoice,
} from '../src/controllers/wallet'
import { keyringService, preferenceService, walletApiService } from '../src/services'
import { bgEventBus } from '../src/utils/eventBus'
import { encryptRgbRecoveryCheckpoint } from '../src/rgb/RgbRecoveryCheckpoint'
import { createRgbBackupPackage, readRgbBackupPackage } from '../src/rgb/RgbBackupPackage'
import { createRgbHdBackupPackage, readRgbHdBackupPackage } from '../src/rgb/RgbHdBackupPackage'

vi.mock('@unisat/babylon-service', () => ({
  COSMOS_CHAINS_MAP: {},
  directSignDocToBytesHex: vi.fn(),
  arbitrarySignDocToBytesHex: vi.fn(),
  encodeSignature: vi.fn(),
  assertValidCosmosMemo: vi.fn((memo: unknown) => {
    if (typeof memo !== 'string') throw new Error('Invalid Cosmos memo')
    if (Array.from(memo).length > 256) {
      throw new Error('Cosmos memo must not exceed 256 characters')
    }
  }),
  getDelegationsV2: vi.fn(),
  publicKeyHexToAddress: vi.fn(),
  CosmosKeyring: vi.fn(),
}))

vi.mock('../src/services', () => ({
  keyringService: {
    getAllDisplayedKeyrings: vi.fn(),
    getKeyringForAccount: vi.fn(),
    createTmpKeyring: vi.fn(),
    displayForKeyring: vi.fn(),
    addNewAccount: vi.fn(),
    importPublicKeyOnly: vi.fn(),
    getEncryptedStorageItem: vi.fn(),
    setEncryptedStorageItem: vi.fn(),
    memStore: {
      getState: vi.fn(() => ({ isUnlocked: true })),
    },
    keyrings: [],
  },
  preferenceService: {
    getCurrentKeyringIndex: vi.fn(),
    getChainType: vi.fn(() => ChainType.BITCOIN_MAINNET),
    setChainType: vi.fn(),
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
    setEndpoint: vi.fn(),
    bitcoin: {
      getBTCUtxos: vi.fn().mockResolvedValue([]),
      getAllBTCUtxos: vi.fn().mockResolvedValue([]),
      getAddressAssetOverview: vi.fn(),
      getFeeSummary: vi.fn(),
      getUtxoAssetsByOutpoints: vi.fn(),
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

describe('PSBT signing input selection', () => {
  function createWalletAndUnrelatedPsbt() {
    const wallet = new WalletController()
    const ownerPubkey = Buffer.from(validCompressedPubkey, 'hex')
    const ownerAddress = bitcoin.payments.p2wpkh({
      pubkey: ownerPubkey,
      network: bitcoin.networks.bitcoin,
    }).address!
    const unrelatedScript = bitcoin.payments.p2wpkh({
      hash: Buffer.alloc(20, 2),
      network: bitcoin.networks.bitcoin,
    }).output!
    const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin })
      .addInput({
        hash: '11'.repeat(32),
        index: 0,
        witnessUtxo: { script: unrelatedScript, value: 10_000 },
      })
      .addOutput({ script: Buffer.from('6a', 'hex'), value: 0 })

    vi.spyOn(wallet, 'getCurrentAccount').mockResolvedValue({
      address: ownerAddress,
      pubkey: validCompressedPubkey,
      type: KeyringType.HdKeyring,
    } as any)
    vi.spyOn(wallet, 'getNetworkType').mockReturnValue(NetworkType.MAINNET)

    return { wallet, psbt }
  }

  it('rejects automatic signing when no input belongs to the current account', async () => {
    const { wallet, psbt } = createWalletAndUnrelatedPsbt()

    await expect(wallet.formatOptionsToSignInputs(psbt)).rejects.toThrow(
      'no signable inputs for current account'
    )
  })

  it('keeps explicitly selected specialized inputs available for approval', async () => {
    const { wallet, psbt } = createWalletAndUnrelatedPsbt()

    await expect(
      wallet.formatOptionsToSignInputs(psbt, {
        toSignInputs: [{ index: 0, publicKey: validCompressedPubkey }],
      })
    ).resolves.toEqual([{ index: 0, publicKey: validCompressedPubkey }])
  })
})

describe('batch PSBT asset analysis', () => {
  afterEach(() => vi.restoreAllMocks())

  it('queries UTXO assets in batches of at most 100 outpoints', async () => {
    const wallet = new WalletController()
    const inputInfos = Array.from({ length: 201 }, (_, index) => ({
      txid: index.toString(16).padStart(64, '0'),
      vout: index,
      value: 10_000,
    }))
    vi.spyOn(txHelpers.PsbtDecoder.prototype, 'decode').mockResolvedValue({
      inputInfos,
      outputInfos: [],
      feeRate: '-',
      fee: 0,
      isCompleted: false,
      risks: [],
      recommendedFeeRate: 1,
      shouldWarnFeeRate: false,
    } as any)
    vi.mocked(walletApiService.bitcoin.getFeeSummary).mockResolvedValue({ list: [] } as any)
    vi.mocked(walletApiService.bitcoin.getUtxoAssetsByOutpoints).mockImplementation(
      async outpoints =>
        outpoints.map(outpoint => ({
          txid: outpoint.slice(0, 64),
          vout: Number(outpoint.slice(65)),
          inscriptions:
            outpoint === `${inputInfos[200]!.txid}:${inputInfos[200]!.vout}`
              ? [{ inscriptionId: 'asset', inscriptionNumber: 1, offset: 0 }]
              : [],
          runes: [],
          alkanes: [],
        }))
    )

    const summary = await wallet.analyzeLocalPsbts([
      { psbtHex: new bitcoin.Psbt().toHex(), toSignInputs: [], autoFinalized: false },
    ])

    expect(walletApiService.bitcoin.getUtxoAssetsByOutpoints).toHaveBeenCalledTimes(3)
    expect(
      vi.mocked(walletApiService.bitcoin.getUtxoAssetsByOutpoints).mock.calls.map(([outpoints]) =>
        outpoints.length
      )
    ).toEqual([100, 100, 1])
    expect(summary.hasAssets).toBe(true)
  })
})

describe('chain type validation', () => {
  it.each(['constructor', 'toString', 'valueOf', '__proto__'])(
    'rejects inherited object key %s before persistence',
    async chainType => {
      const wallet = new WalletController()

      await expect(wallet.setChainType(chainType as ChainType)).rejects.toThrow(
        'Unsupported chain type'
      )
      expect(preferenceService.setChainType).not.toHaveBeenCalled()
      expect(walletApiService.setEndpoint).not.toHaveBeenCalled()

      await expect(wallet.getCosmosKeyring(chainType)).rejects.toThrow('Not supported chainId')
    }
  )
})

describe('Babylon address derivation', () => {
  it('derives the address locally without creating an RPC-backed Cosmos keyring', async () => {
    const wallet = new WalletController()
    wallet.cosmosChainInfoMap['bbn-1'] = {
      bech32Config: { bech32PrefixAccAddr: 'bbn' },
    } as any
    vi.spyOn(wallet, 'getCurrentAccount').mockResolvedValue({
      pubkey: validCompressedPubkey,
      type: KeyringType.HdKeyring,
    } as any)
    const getCosmosKeyring = vi.spyOn(wallet, 'getCosmosKeyring')
    vi.mocked(publicKeyHexToAddress).mockReturnValue('bbn1locallyderived')

    await expect(wallet.getBabylonAddress('bbn-1')).resolves.toBe('bbn1locallyderived')

    expect(publicKeyHexToAddress).toHaveBeenCalledWith(validCompressedPubkey, 'bbn')
    expect(getCosmosKeyring).not.toHaveBeenCalled()
    expect(keyringService.getKeyringForAccount).not.toHaveBeenCalled()
  })
})

describe('Cosmos memo validation', () => {
  it.each(['createSendTokenStep1', 'simulateBabylonGas'] as const)(
    'rejects oversized memos before resolving the keyring in %s',
    async method => {
      const wallet = new WalletController()
      const getCosmosKeyring = vi.spyOn(wallet, 'getCosmosKeyring')

      if (method === 'createSendTokenStep1') {
        await expect(
          wallet.createSendTokenStep1(
            'bbn-1',
            { denom: 'ubbn', amount: '1' },
            'bbn1recipient',
            'a'.repeat(257),
            { gasLimit: 100_000, gasPrice: '0.01', gasAdjustment: 1 }
          )
        ).rejects.toThrow('Cosmos memo must not exceed 256 characters')
      } else {
        await expect(
          wallet.simulateBabylonGas(
            'bbn-1',
            'bbn1recipient',
            { denom: 'ubbn', amount: '1' },
            'a'.repeat(257)
          )
        ).rejects.toThrow('Cosmos memo must not exceed 256 characters')
      }

      expect(getCosmosKeyring).not.toHaveBeenCalled()
    }
  )
})

describe('Runes amount validation', () => {
  it.each(['0', '00', '0x0', '0X0', '-0', ' 0', 'abc'])(
    'rejects invalid amount %j before selecting UTXOs',
    async runeAmount => {
      const wallet = new WalletController()
      const getAssetUtxos = vi.spyOn(wallet, 'getAssetUtxosRunes')

      await expect(
        wallet.createSendRunesPsbt({
          to: 'bc1pdestination',
          runeid: '1:0',
          runeAmount,
          feeRate: 1,
        })
      ).rejects.toThrow()
      expect(getAssetUtxos).not.toHaveBeenCalled()
    }
  )
})

describe('RGB server clock', () => {
  it('keeps protocol time moving from the calibrated server time', () => {
    const now = vi.spyOn(performance, 'now')
      .mockReturnValueOnce(500)
      .mockReturnValueOnce(1_750)
    const wallet = new WalletController()

    ;(wallet as any).calibrateRgbClock(1_000)

    expect((wallet as any).getRgbNow()).toBe(1_001_250)
    now.mockRestore()
  })
})

describe('RGB seller swap sighash validation', () => {
  function createPreparedPsbt() {
    return new bitcoin.Psbt()
      .addInput({
        hash: '11'.repeat(32),
        index: 0,
        witnessUtxo: {
          script: Buffer.from(`5120${'22'.repeat(32)}`, 'hex'),
          value: 1_000,
        },
      })
      .addOutput({ script: Buffer.from('6a', 'hex'), value: 0 })
  }

  function mockPreparedSwap(wallet: WalletController, preparedPsbt: bitcoin.Psbt) {
    const toSignInputs = [
      {
        index: 0,
        publicKey: validCompressedPubkey.slice(2),
      },
    ]
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({
      service: {
        getPendingTransfers: () => [
          {
            id: 'swap-1',
            prepared: { psbt: preparedPsbt.toHex(), toSignInputs },
          },
        ],
      },
    })
    return vi.spyOn(wallet, 'getRgbToSignData').mockImplementation(async input => input as any)
  }

  it('rejects SIGHASH_NONE added by the swap counterparty', async () => {
    const wallet = new WalletController()
    const preparedPsbt = createPreparedPsbt()
    mockPreparedSwap(wallet, preparedPsbt)
    const candidate = bitcoin.Psbt.fromHex(preparedPsbt.toHex())
    candidate.data.inputs[0]!.sighashType = bitcoin.Transaction.SIGHASH_NONE

    await expect(
      wallet.getRgbPaymentSigningData({ transferId: 'swap-1', psbt: candidate.toHex() })
    ).rejects.toThrow('RGB swap PSBT must use SIGHASH_ALL')
  })

  it.each([undefined, bitcoin.Transaction.SIGHASH_DEFAULT, bitcoin.Transaction.SIGHASH_ALL])(
    'forces an allowed counterparty sighash %s to SIGHASH_ALL for wallet inputs',
    async sighashType => {
      const wallet = new WalletController()
      const preparedPsbt = createPreparedPsbt()
      const getToSignData = mockPreparedSwap(wallet, preparedPsbt)
      const candidate = bitcoin.Psbt.fromHex(preparedPsbt.toHex())
      if (sighashType !== undefined) candidate.data.inputs[0]!.sighashType = sighashType

      await wallet.getRgbPaymentSigningData({ transferId: 'swap-1', psbt: candidate.toHex() })

      expect(getToSignData).toHaveBeenCalledWith(
        expect.objectContaining({
          toSignInputs: [
            expect.objectContaining({
              index: 0,
              sighashTypes: [bitcoin.Transaction.SIGHASH_ALL],
            }),
          ],
        })
      )
      const signingPsbt = bitcoin.Psbt.fromHex(getToSignData.mock.calls[0]![0].psbt)
      expect(signingPsbt.data.inputs[0]?.sighashType).toBe(bitcoin.Transaction.SIGHASH_ALL)
    }
  )
})

describe('address asset overview', () => {
  beforeEach(() => vi.clearAllMocks())

  it('includes the current wallet RGB balance in display units without duplicating remote assets', async () => {
    const wallet = new WalletController()
    vi.mocked(preferenceService.getCurrentAccount).mockReturnValue({ address: 'current' } as any)
    vi.mocked(walletApiService.bitcoin.getAddressAssetOverview).mockResolvedValue({
      list: [{ kind: 'rgb', tokenId: 'existing', name: 'Existing', symbol: 'EX', logo: '', divisibility: 0, balance: '1' }],
    })
    vi.spyOn(wallet, 'getRGBList').mockResolvedValue({
      currentPage: 1,
      pageSize: Number.MAX_SAFE_INTEGER,
      total: 2,
      list: [
        { assetId: 'existing', name: 'Existing', ticker: 'EX', precision: 0, balance: '1', spendable: '1' },
        { assetId: 'new', name: 'New', ticker: 'NEW', precision: 2, balance: '1234', spendable: '950' },
      ],
    } as any)

    const result = await wallet.getAddressAssetOverview('current')

    expect(result.list).toHaveLength(2)
    expect(result.list[1]).toMatchObject({ kind: 'rgb', tokenId: 'new', balance: '9.5', divisibility: 2 })
  })

  it('does not expose local RGB assets for another address', async () => {
    const wallet = new WalletController()
    vi.mocked(preferenceService.getCurrentAccount).mockReturnValue({ address: 'current' } as any)
    vi.mocked(walletApiService.bitcoin.getAddressAssetOverview).mockResolvedValue({ list: [] })
    const getRgbList = vi.spyOn(wallet, 'getRGBList')

    expect(await wallet.getAddressAssetOverview('other')).toEqual({ list: [] })
    expect(getRgbList).not.toHaveBeenCalled()
  })

  it('keeps the remote overview when local RGB assets are unavailable', async () => {
    const wallet = new WalletController()
    vi.mocked(preferenceService.getCurrentAccount).mockReturnValue({ address: 'current' } as any)
    const remote = { list: [{ kind: 'domain' as const, category: '.btc', count: 1 }] }
    vi.mocked(walletApiService.bitcoin.getAddressAssetOverview).mockResolvedValue(remote)
    vi.spyOn(wallet, 'getRGBList').mockRejectedValue(new Error('RGB inactive'))
    vi.spyOn(log, 'debug').mockImplementation(() => {})

    expect(await wallet.getAddressAssetOverview('current')).toEqual(remote)
  })
})

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

describe('RGB HD backup orchestration', () => {
  const accounts = [
    { index: 0, key: 'keyring_0#0' },
    { index: 2, key: 'keyring_0#2' },
  ]

  beforeEach(() => vi.clearAllMocks())

  it('exports a verified checkpoint without acquiring a write lease', async () => {
    const controller = new WalletController()
    const state = { wallet: { walletId: 'wallet-0', network: 'mainnet', fundingAddress: 'funding-0' } }
    const status = { dirty: false, verified: true }
    const service = {
      getRecoveryCheckpointStatus: vi.fn(() => status),
      retryRecoveryCheckpoint: vi.fn(),
      exportRecoveryState: vi.fn(() => state),
    }
    const context = { wallet: state.wallet, service }
    const lease = vi.spyOn(controller as any, 'ensureRgbWriteLease').mockRejectedValue(
      new Error('RGB write lease is held by another device')
    )
    vi.spyOn(controller as any, 'rgbBackupKey').mockResolvedValue('11'.repeat(32))

    const payload = await (controller as any).exportRgbBackupForContext(context)
    expect((await readRgbBackupPackage(payload, '11'.repeat(32))).state).toEqual(state)
    expect(lease).not.toHaveBeenCalled()
    expect(service.retryRecoveryCheckpoint).not.toHaveBeenCalled()

    status.dirty = true
    await expect((controller as any).exportRgbBackupForContext(context)).rejects.toThrow(
      'RGB write lease is held by another device'
    )
    expect(service.retryRecoveryCheckpoint).not.toHaveBeenCalled()
  })

  it('takes over the writer lease only after a backup replacement is approved', async () => {
    const controller = new WalletController()
    const state = { walletId: 'wallet-0' }
    const wallet = { walletId: 'wallet-0', network: 'mainnet', fundingAddress: 'funding-0' }
    const service = {
      canRestoreRecoveryState: vi.fn(() => true),
      restoreRecoveryState: vi.fn().mockResolvedValue(true),
      retryRecoveryCheckpoint: vi.fn().mockResolvedValue(true),
    }
    const context = { wallet, service }
    const lease = vi.spyOn(controller as any, 'ensureRgbWriteLease').mockResolvedValue(undefined)
    vi.spyOn(controller as any, 'rgbBackupKey').mockResolvedValue('11'.repeat(32))
    vi.spyOn(controller as any, 'getLocalRgbService').mockResolvedValue(context)
    const payload = await createRgbBackupPackage(state, '11'.repeat(32), 123)

    await expect(controller.restoreRgbBackup({ payload, replaceRemote: false })).rejects.toThrow(
      'explicit replacement confirmation'
    )
    expect(lease).not.toHaveBeenCalled()
    await expect(controller.restoreRgbBackup({ payload, replaceRemote: true })).resolves.toEqual({
      restored: true,
      createdAt: 123,
    })
    expect(lease).toHaveBeenCalledWith(context, { forceRenew: true, takeover: true })
    expect(service.restoreRecoveryState).toHaveBeenCalledWith(state)
    expect(service.retryRecoveryCheckpoint).toHaveBeenCalledWith('replacement', true)
    expect(lease.mock.invocationCallOrder[0]).toBeLessThan(service.restoreRecoveryState.mock.invocationCallOrder[0]!)
  })

  it('exports both created accounts without switching the selected account', async () => {
    const controller = new WalletController()
    vi.spyOn(controller as any, 'rgbHdBackupKey').mockResolvedValue('11'.repeat(32))
    vi.spyOn(controller as any, 'getRgbHdBackupAccounts').mockResolvedValue(accounts)
    vi.spyOn(controller as any, 'getCurrentLocalRgbWallet').mockResolvedValue({
      walletId: 'wallet-0',
      network: 'mainnet',
    })
    vi.spyOn(controller as any, 'getRgbWalletRefForAccount').mockImplementation(async (account: any) => ({
      walletId: `wallet-${account.index}`,
      network: 'mainnet',
      fundingAddress: `funding-${account.index}`,
    }))
    vi.spyOn(controller as any, 'getLocalRgbServiceForWallet').mockImplementation(async (wallet: any) => ({
      service: { walletId: wallet.walletId },
      wallet,
    }))
    vi.spyOn(controller as any, 'exportRgbBackupForContext').mockImplementation(async (context: any) =>
      `encrypted-${context.wallet.walletId}`
    )

    const plan = await controller.getRgbHdBackupPlan()
    expect(plan).toEqual({ network: 'mainnet', walletScope: 'wallet', accountIndexes: [0, 2] })
    const backup = await readRgbHdBackupPackage(await controller.exportRgbHdBackup(plan), '11'.repeat(32))
    expect(backup?.accounts).toEqual([
      { index: 0, payload: 'encrypted-wallet-0' },
      { index: 2, payload: 'encrypted-wallet-2' },
    ])
    expect(preferenceService.setCurrentAccount).not.toHaveBeenCalled()
  })

  it('requires another review if the HD wallet backup scope changes', async () => {
    const controller = new WalletController()
    vi.spyOn(controller as any, 'getRgbHdBackupAccounts').mockResolvedValue(accounts)
    vi.spyOn(controller as any, 'getCurrentLocalRgbWallet').mockResolvedValue({
      walletId: 'wallet-0',
      network: 'mainnet',
    })
    const exportAccount = vi.spyOn(controller as any, 'exportRgbBackupForContext')
    await expect(
      controller.exportRgbHdBackup({
        network: 'mainnet',
        walletScope: 'wallet',
        accountIndexes: [0],
      })
    ).rejects.toThrow('scope changed')
    expect(exportAccount).not.toHaveBeenCalled()
  })

  it('validates every account before replacing any account', async () => {
    const controller = new WalletController()
    vi.spyOn(controller as any, 'rgbHdBackupKey').mockResolvedValue('11'.repeat(32))
    const payload = await createRgbHdBackupPackage(
      'mainnet',
      [
        { index: 0, payload: 'encrypted-0' },
        { index: 2, payload: 'encrypted-2' },
      ],
      '11'.repeat(32)
    )
    vi.spyOn(controller as any, 'getRgbHdBackupAccounts').mockResolvedValue(accounts)
    vi.spyOn(controller as any, 'getCurrentLocalRgbWallet').mockResolvedValue({ network: 'mainnet' })
    vi.spyOn(controller as any, 'getRgbWalletRefForAccount').mockImplementation(async (account: any) => ({
      walletId: `wallet-${account.index}`,
      network: 'mainnet',
      fundingAddress: `funding-${account.index}`,
    }))
    vi.spyOn(controller as any, 'getLocalRgbServiceForWallet').mockImplementation(async (wallet: any) => ({
      service: {},
      wallet,
    }))
    const inspect = vi.spyOn(controller as any, 'inspectRgbBackupForContext').mockImplementation(
      async (entry: string) => {
        if (entry === 'encrypted-2') throw new Error('invalid account backup')
      }
    )
    const restore = vi.spyOn(controller as any, 'restoreRgbBackupForContext').mockResolvedValue({ restored: true })

    await expect(controller.restoreRgbHdBackup({ payload, replaceRemote: true })).rejects.toThrow(
      'invalid account backup'
    )
    expect(inspect).toHaveBeenCalledTimes(2)
    expect(restore).not.toHaveBeenCalled()
  })

  it('previews all missing RGB accounts and creates them only after confirmation', async () => {
    const controller = new WalletController()
    const createdAccounts = [0, 1].map(index => ({ index, key: `keyring_0#${index}`, address: `address-${index}` }))
    let currentAccount = createdAccounts[1]!
    const payload = await createRgbHdBackupPackage(
      'mainnet',
      [0, 1, 2, 3, 4].map(index => ({ index, payload: `encrypted-${index}` })),
      '11'.repeat(32)
    )
    vi.spyOn(controller as any, 'rgbHdBackupKey').mockResolvedValue('11'.repeat(32))
    vi.spyOn(controller as any, 'getRgbHdBackupAccounts').mockImplementation(async () => createdAccounts)
    vi.spyOn(controller, 'getCurrentKeyring').mockImplementation(async () => ({
      type: KeyringType.HdKeyring,
      index: 0,
      accounts: createdAccounts,
    } as any))
    vi.mocked(preferenceService.getCurrentAccount).mockImplementation(() => currentAccount as any)
    vi.spyOn(controller as any, 'getCurrentLocalRgbWallet').mockResolvedValue({ network: 'mainnet' })
    vi.spyOn(controller as any, 'getRgbWalletRefForAccount').mockImplementation(async (account: any) => ({
      walletId: `wallet-${account.index}`,
      network: 'mainnet',
      fundingAddress: `funding-${account.index}`,
    }))
    vi.spyOn(controller as any, 'getLocalRgbServiceForWallet').mockImplementation(async (wallet: any) => ({
      service: {},
      wallet,
    }))
    vi.spyOn(controller as any, 'inspectRgbBackupForContext').mockResolvedValue({})
    const restore = vi.spyOn(controller as any, 'restoreRgbBackupForContext').mockResolvedValue({ restored: true })
    keyringService.keyrings[0] = {} as any
    const create = vi.mocked(keyringService.addNewAccount).mockImplementation(async () => {
      const index = createdAccounts.length
      const account = { index, key: `keyring_0#${index}`, address: `address-${index}` }
      createdAccounts.push(account)
      return []
    })
    vi.spyOn(controller, 'changeKeyring').mockImplementation(async (_keyring, index = 0) => {
      currentAccount = createdAccounts[index]!
    })

    await expect(controller.inspectRgbBackupFile(payload)).resolves.toMatchObject({
      accountIndexes: [0, 1, 2, 3, 4],
      missingAccountIndexes: [2, 3, 4],
      accountsToCreateIndexes: [2, 3, 4],
    })
    await expect(controller.restoreRgbHdBackup({ payload, replaceRemote: true })).rejects.toThrow(
      'RGB account 3 has not been created'
    )
    expect(create).not.toHaveBeenCalled()
    expect(restore).not.toHaveBeenCalled()

    const progressEvents = vi.spyOn(bgEventBus, 'emit')
    await expect(controller.restoreRgbHdBackup({
      payload,
      replaceRemote: true,
      createMissingAccounts: true,
      progressId: 'restore-test',
    })).resolves.toMatchObject({ accountIndexes: [0, 1, 2, 3, 4] })
    expect(create).toHaveBeenCalledTimes(3)
    const progress = progressEvents.mock.calls
      .filter(([event, data]) => event === BUS_EVENTS.broadcastToUI && data?.method === BUS_METHODS.RGB_BACKUP_RESTORE_PROGRESS)
      .map(([, data]) => data.params)
    expect(progress[0]).toEqual({ progressId: 'restore-test', completed: 0, total: 5, phase: 'preparing' })
    expect(progress.filter(item => item.phase === 'creating').map(item => item.accountNumber)).toEqual([3, 4, 5])
    expect(progress.filter(item => item.phase === 'restored').map(item => item.completed)).toEqual([1, 2, 3, 4, 5])
    expect(currentAccount.index).toBe(1)
    expect(restore).toHaveBeenCalledTimes(5)
    keyringService.keyrings.length = 0
  })

  it('routes old single-account files to their matching account', async () => {
    const controller = new WalletController()
    const legacyPayload = JSON.stringify({ magic: 'unisat-rgb-backup' })
    const target = {
      account: { index: 2 },
      wallet: { network: 'mainnet', fundingAddress: 'funding-2', walletId: 'wallet-2' },
    }
    vi.spyOn(controller as any, 'findLegacyRgbBackupAccount').mockResolvedValue(target)
    vi.spyOn(controller as any, 'getLocalRgbServiceForWallet').mockResolvedValue({ service: {}, wallet: target.wallet })
    const inspect = vi.spyOn(controller as any, 'inspectRgbBackupForContext').mockResolvedValue({
      createdAt: 123,
      wallet: target.wallet,
    })
    const restore = vi.spyOn(controller as any, 'restoreRgbBackupForContext').mockResolvedValue({ restored: true, createdAt: 123 })

    await expect(controller.inspectRgbBackupFile(legacyPayload)).resolves.toMatchObject({
      kind: 'account',
      accountIndexes: [2],
    })
    await expect(
      controller.restoreRgbBackupFile({ payload: legacyPayload, replaceRemote: true })
    ).resolves.toMatchObject({ accountIndexes: [2] })
    expect(inspect).toHaveBeenCalledWith(legacyPayload, { service: {}, wallet: target.wallet })
    expect(restore).toHaveBeenCalledWith(legacyPayload, { service: {}, wallet: target.wallet })
  })

  it('finds a legacy backup even when another account is selected', async () => {
    const controller = new WalletController()
    vi.spyOn(controller as any, 'getRgbHdBackupAccounts').mockResolvedValue(accounts)
    vi.spyOn(controller as any, 'getRgbWalletRefForAccount').mockImplementation(async (account: any) => ({
      walletId: `wallet-${account.index}`,
      network: 'mainnet',
      fundingAddress: `funding-${account.index}`,
    }))
    vi.spyOn(controller as any, 'rgbBackupKey').mockImplementation(async (wallet: any) =>
      wallet.walletId === 'wallet-2' ? '22'.repeat(32) : '11'.repeat(32)
    )
    const payload = await createRgbBackupPackage({ walletId: 'wallet-2' }, '22'.repeat(32), 123)

    await expect((controller as any).findLegacyRgbBackupAccount(payload)).resolves.toMatchObject({
      account: { index: 2 },
      wallet: { walletId: 'wallet-2' },
    })
  })

  it('does not sign another account without an active HD backup operation', async () => {
    const controller = new WalletController()
    const getChainType = vi
      .spyOn(preferenceService, 'getChainType')
      .mockReturnValue(ChainType.BITCOIN_TESTNET4)
    vi.mocked(preferenceService.getCurrentAccount).mockReturnValue({ index: 0 } as any)
    vi.spyOn(controller as any, 'getRgbWalletRefForAccount').mockResolvedValue({
      walletId: 'wallet-0',
      network: 'testnet4',
      fundingAddress: 'funding-0',
    })
    try {
      await expect(
        (controller as any).createRgbRequestAuthorization({
          method: 'POST',
          path: '/v5/rgb/recovery/checkpoint/read',
          body: {
            wallet: { walletId: 'wallet-2', network: 'testnet4', fundingAddress: 'funding-2' },
          },
        })
      ).rejects.toThrow('RGB operation canceled')
    } finally {
      getChainType.mockRestore()
    }
  })
})

describe('chainTypeToRgbNetwork', () => {
  const withRgbProxyEndpoints = (
    chainType: ChainType,
    endpoints: string[] | undefined,
    assertion: () => void
  ) => {
    const chains = CHAINS_MAP as Record<string, { rgbProxyEndpoints?: string[] }>
    const previousChain = chains[chainType]
    chains[chainType] = { ...previousChain, rgbProxyEndpoints: endpoints }
    try {
      assertion()
    } finally {
      if (previousChain) chains[chainType] = previousChain
      else delete chains[chainType]
    }
  }

  it('rejects Bitcoin mainnet while its RGB proxy is disabled', () => {
    withRgbProxyEndpoints(ChainType.BITCOIN_MAINNET, undefined, () => {
      expect(() => chainTypeToRgbNetwork(ChainType.BITCOIN_MAINNET)).toThrow(
        'RGB is not enabled for wallet chain'
      )
    })
  })

  it.each([
    ChainType.BITCOIN_TESTNET,
    ChainType.BITCOIN_SIGNET,
    ChainType.FRACTAL_BITCOIN_MAINNET,
    ChainType.FRACTAL_BITCOIN_TESTNET,
  ])('rejects disabled chain %s', chainType => {
    withRgbProxyEndpoints(chainType, undefined, () => {
      expect(() => chainTypeToRgbNetwork(chainType)).toThrow('RGB is not enabled for wallet chain')
    })
  })

  it('maps Bitcoin Testnet4', () => {
    withRgbProxyEndpoints(ChainType.BITCOIN_TESTNET4, ['rpcs://rgb-testnet4.example/json-rpc'], () => {
      expect(chainTypeToRgbNetwork(ChainType.BITCOIN_TESTNET4)).toBe('testnet4')
    })
  })

  it('enables a supported test chain when its RGB proxy endpoint is configured', () => {
    withRgbProxyEndpoints(ChainType.BITCOIN_TESTNET, ['rpcs://rgb-testnet.example/json-rpc'], () => {
      expect(chainTypeToRgbNetwork(ChainType.BITCOIN_TESTNET)).toBe('testnet')
    })
  })

  it('maps Bitcoin mainnet when its RGB proxy endpoint is configured', () => {
    withRgbProxyEndpoints(ChainType.BITCOIN_MAINNET, ['rpcs://rgb-mainnet.example/json-rpc'], () => {
      expect(chainTypeToRgbNetwork(ChainType.BITCOIN_MAINNET)).toBe('mainnet')
    })
  })

  it.each([
    [ChainType.FRACTAL_BITCOIN_MAINNET, 'fractal-mainnet'],
    [ChainType.FRACTAL_BITCOIN_TESTNET, 'fractal-test'],
  ] as const)('maps supported Fractal chain %s to %s', (chainType, expected) => {
    withRgbProxyEndpoints(chainType, ['rpcs://rgb-fractal.example/json-rpc'], () => {
      expect(chainTypeToRgbNetwork(chainType)).toBe(expected)
    })
  })
})

describe('planRgbFeePoolTopUp', () => {
  it('creates as many fee-pool UTXOs as the available BTC can fund', () => {
    expect(
      planRgbFeePoolTopUp({
        targetCount: 3,
        minimumSatoshis: 10_000,
        availableSatoshis: 20_500,
        feeRate: 1,
      })
    ).toMatchObject({
      count: 2,
      topUpSatoshis: 20_000,
      estimatedFeeSatoshis: 500,
    })
  })

  it('reports the requirement for one UTXO when none can be funded', () => {
    expect(
      planRgbFeePoolTopUp({
        targetCount: 3,
        minimumSatoshis: 10_000,
        availableSatoshis: 10_499,
        feeRate: 1,
      })
    ).toMatchObject({
      count: 0,
      feePoolUtxoCount: 1,
      requiredSatoshis: 10_500,
    })
  })
})

describe('RGB fee-pool inspection', () => {
  it('keeps every unlocked Fee Pool UTXO eligible regardless of its individual value', async () => {
    const wallet = new WalletController()
    const service = {
      getPendingTransfers: vi.fn(() => [
        { prepared: { feeOutpoints: [{ txid: 'b'.repeat(64), vout: 1 }] } },
      ]),
      getPendingFeePoolUtxos: vi.fn(() => [
        {
          outpoint: { txid: 'c'.repeat(64), vout: 2 },
          satoshis: 500,
          scriptPubKey: '5120' + '33'.repeat(32),
          publicKey: validCompressedPubkey,
          createdAt: 1,
        },
      ]),
    }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({
      service,
      wallet: { fundingAddress: 'bc1p-rgb-funding', network: 'mainnet' },
    })
    vi.spyOn(wallet as any, 'getCurrentRgbFeeAccount').mockResolvedValue({
      address: 'bc1p-rgb-fee',
      derivationPath: "m/86'/0'/0'/1/0",
    })
    vi.mocked(walletApiService.bitcoin.getAllBTCUtxos).mockResolvedValue([
      { txid: 'a'.repeat(64), vout: 0, satoshis: 1_000 },
      { txid: 'b'.repeat(64), vout: 1, satoshis: 5_000 },
    ] as any)

    const inspection = await wallet.getRgbFeePoolInspection()

    expect(inspection.ready).toBe(false)
    expect(inspection.availableCount).toBe(2)
    expect(inspection.withdrawals).toEqual([])
    expect(inspection.utxos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ txid: 'a'.repeat(64), vout: 0, available: true, locked: false }),
        expect.objectContaining({ txid: 'b'.repeat(64), vout: 1, available: false, locked: true }),
        expect.objectContaining({ txid: 'c'.repeat(64), vout: 2, available: true, pending: true }),
      ])
    )
    vi.mocked(walletApiService.bitcoin.getAllBTCUtxos).mockResolvedValue([
      { txid: 'a'.repeat(64), vout: 0, satoshis: 2_500 },
      { txid: 'b'.repeat(64), vout: 1, satoshis: 5_000 },
    ] as any)
    expect((await wallet.getRgbFeePoolInspection()).ready).toBe(true)
  })
})

describe('RGB wallet references', () => {
  let previousMainnetRgbProxyEndpoints: string[] | undefined
  const rgbConsent = { enabled: true, agreementVersion: 'rgb-terms-v1', acceptedAt: 1 }

  // These tests cover RGB wallet behavior independently from the production
  // feature flag. Production mainnet remains disabled and is covered above.
  beforeEach(() => {
    const chain = CHAINS_MAP[ChainType.BITCOIN_MAINNET]!
    previousMainnetRgbProxyEndpoints = chain.rgbProxyEndpoints
    chain.rgbProxyEndpoints = ['rpcs://rgb-mainnet.example/json-rpc']
    ;(keyringService as any).getEncryptedStorageItem = vi.fn(
      (_namespace: string, key: string) => Promise.resolve(key.startsWith('rgb-feature-enabled:') ? rgbConsent : undefined)
    )
    ;(keyringService as any).setEncryptedStorageItem = vi.fn().mockResolvedValue(undefined)
    ;(keyringService as any).removeEncryptedStorageItem = vi.fn().mockResolvedValue(undefined)
    vi.mocked(preferenceService.getCurrentAccount).mockReturnValue({
      pubkey: validCompressedPubkey,
      type: KeyringType.HdKeyring,
      index: 0,
    } as any)
    vi.mocked(keyringService.getKeyringForAccount).mockResolvedValue({
      getRgbFundingAccount: () => ({
        address: 'bc1p-rgb-funding',
        publicKey: validCompressedPubkey,
        derivationPath: "m/86'/0'/0'/0/0",
        masterFingerprint: 'deadbeef',
      }),
      getRgbFeeAccount: () => ({
        address: 'bc1p-rgb-fee',
        publicKey: validCompressedPubkey,
        derivationPath: "m/86'/0'/0'/0/1",
        masterFingerprint: 'deadbeef',
      }),
    } as any)
  })

  afterEach(() => {
    CHAINS_MAP[ChainType.BITCOIN_MAINNET]!.rgbProxyEndpoints = previousMainnetRgbProxyEndpoints
  })

  it('shares one local RGB service initialization for concurrent first requests', async () => {
    const wallet = new WalletController()
    let resolveStorage: ((value: undefined) => void) | undefined
    let signalStorageStarted: (() => void) | undefined
    const storageStarted = new Promise<void>(resolve => (signalStorageStarted = resolve))
    const getEncryptedStorageItem = vi.fn(
      (_namespace: string, key: string) => {
        if (key.startsWith('rgb-feature-enabled:')) return Promise.resolve(rgbConsent)
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
    vi.spyOn(wallet as any, 'restoreRgbRecoveryIfNeeded').mockResolvedValue(undefined)

    const first = (wallet as any).getLocalRgbReadService()
    const second = (wallet as any).getLocalRgbReadService()
    await storageStarted
    expect(getEncryptedStorageItem).toHaveBeenCalledTimes(3)
    resolveStorage!(undefined)
    const [firstContext, secondContext] = await Promise.all([first, second])

    expect(firstContext.service).toBe(secondContext.service)
    expect(getEncryptedStorageItem).toHaveBeenCalledTimes(3)
  })

  it('returns the local RGB read service without waiting for recovery', async () => {
    const wallet = new WalletController()
    let releaseRecovery: (() => void) | undefined
    const recovery = new Promise<void>(resolve => (releaseRecovery = resolve))
    vi.spyOn(wallet as any, 'restoreRgbRecoveryIfNeeded').mockReturnValue(recovery)

    ;(keyringService as any).getEncryptedStorageItem = vi.fn(
      (_namespace: string, key: string) => Promise.resolve(key.startsWith('rgb-feature-enabled:') ? rgbConsent : undefined)
    )
    ;(keyringService as any).setEncryptedStorageItem = vi.fn().mockResolvedValue(undefined)
    ;(keyringService as any).removeEncryptedStorageItem = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(wallet, 'getCurrentRgbWalletRef').mockResolvedValue({
      walletId: 'rgb-wallet',
      network: 'mainnet',
      fundingAddress: 'bc1p-rgb-funding',
    })

    await expect((wallet as any).getLocalRgbReadService()).resolves.toEqual(
      expect.objectContaining({ service: expect.anything() })
    )
    expect((wallet as any).restoreRgbRecoveryIfNeeded).toHaveBeenCalledTimes(1)
    releaseRecovery!()
    await recovery
  })

  it('requires explicit local consent before opening RGB state', async () => {
    const wallet = new WalletController()
    const walletRef = {
      walletId: 'rgb-wallet',
      network: 'mainnet',
      fundingAddress: 'bc1p-rgb-funding',
    }
    const getEncryptedStorageItem = vi.fn().mockResolvedValue(undefined)
    const setEncryptedStorageItem = vi.fn().mockResolvedValue(undefined)
    ;(keyringService as any).getEncryptedStorageItem = getEncryptedStorageItem
    ;(keyringService as any).setEncryptedStorageItem = setEncryptedStorageItem
    vi.spyOn(wallet, 'getCurrentRgbWalletRef').mockResolvedValue(walletRef)

    const disabledError = await (wallet as any).getLocalRgbReadService()
      .then(() => undefined, reason => reason)
    expect(disabledError).toMatchObject({ code: ErrorCodes.RGB_NOT_ENABLED })
    expect(disabledError).not.toHaveProperty('data')
    await expect(wallet.getRgbFeatureStatus()).resolves.toEqual({
      enabled: false,
      supported: true,
      remoteRecoveryAvailable: false,
    })

    const openService = vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue(undefined)
    await expect(wallet.enableRgbFeature()).resolves.toEqual({ enabled: true })
    expect(setEncryptedStorageItem).toHaveBeenCalledWith(
      'rgb-service-v1',
      'rgb-feature-enabled:v1:rgb-wallet:mainnet',
      expect.objectContaining({
        enabled: true,
        agreementVersion: 'rgb-terms-v1',
        acceptedAt: expect.any(Number),
      })
    )
    expect(openService).toHaveBeenCalledTimes(1)
  })

  it('rolls back first-time RGB activation when checkpoint recovery fails', async () => {
    const wallet = new WalletController()
    const storage = new Map<string, unknown>()
    const getEncryptedStorageItem = vi.fn(
      (_namespace: string, key: string) => Promise.resolve(storage.get(key))
    )
    const setEncryptedStorageItem = vi.fn(
      (_namespace: string, key: string, value: unknown) => {
        storage.set(key, value)
        return Promise.resolve()
      }
    )
    const removeEncryptedStorageItem = vi.fn((_namespace: string, key: string) => {
      storage.delete(key)
      return Promise.resolve()
    })
    ;(keyringService as any).getEncryptedStorageItem = getEncryptedStorageItem
    ;(keyringService as any).setEncryptedStorageItem = setEncryptedStorageItem
    ;(keyringService as any).removeEncryptedStorageItem = removeEncryptedStorageItem
    vi.spyOn(wallet, 'getCurrentRgbWalletRef').mockResolvedValue({
      walletId: 'unisat-deadbeef-0',
      network: 'mainnet',
      fundingAddress: 'bc1p-rgb-funding',
    })
    vi.spyOn(wallet as any, 'getLocalRgbService').mockRejectedValue(
      new Error('RGB recovery checkpoint contains an invalid issue history item')
    )

    await expect(wallet.enableRgbFeature()).rejects.toThrow('invalid issue history item')
    expect(storage.has('rgb-feature-enabled:v1:unisat-deadbeef:mainnet')).toBe(false)
    expect(removeEncryptedStorageItem).toHaveBeenCalledWith(
      'rgb-service-v1',
      'rgb-feature-enabled:v1:unisat-deadbeef:mainnet'
    )
  })

  it('shares RGB consent across accounts derived from the same wallet', async () => {
    const wallet = new WalletController()
    const storage = new Map<string, unknown>([
      ['rgb-feature-enabled:v1:unisat-deadbeef:mainnet', rgbConsent],
    ])
    ;(keyringService as any).getEncryptedStorageItem = vi.fn(
      (_namespace: string, key: string) => Promise.resolve(storage.get(key))
    )
    vi.spyOn(wallet, 'getCurrentRgbWalletRef').mockResolvedValue({
      walletId: 'unisat-deadbeef-1',
      network: 'mainnet',
      fundingAddress: 'bc1p-rgb-account-1',
    })

    await expect(wallet.getRgbFeatureStatus()).resolves.toEqual({
      enabled: true,
      supported: true,
      remoteRecoveryAvailable: false,
    })
  })

  it('requires separate RGB activation on testnet4 and mainnet', async () => {
    const wallet = new WalletController()
    const storage = new Map<string, unknown>()
    ;(keyringService as any).getEncryptedStorageItem = vi.fn(
      (_namespace: string, key: string) => Promise.resolve(storage.get(key))
    )
    ;(keyringService as any).setEncryptedStorageItem = vi.fn(
      (_namespace: string, key: string, value: unknown) => {
        storage.set(key, value)
        return Promise.resolve()
      }
    )
    const walletRef = { walletId: 'unisat-deadbeef-0', network: 'testnet4', fundingAddress: 'tb1p-rgb-funding' }
    vi.spyOn(wallet, 'getCurrentRgbWalletRef').mockImplementation(async () => walletRef)
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue(undefined)

    await wallet.enableRgbFeature()
    expect(storage.has('rgb-feature-enabled:v1:unisat-deadbeef:testnet4')).toBe(true)

    walletRef.network = 'mainnet'
    walletRef.fundingAddress = 'bc1p-rgb-funding'
    await expect(wallet.getRgbFeatureStatus()).resolves.toMatchObject({ enabled: false, supported: true })
    await expect((wallet as any).assertRgbFeatureEnabled()).rejects.toThrow('RGB is not enabled')

    await wallet.enableRgbFeature()
    expect(storage.has('rgb-feature-enabled:v1:unisat-deadbeef:mainnet')).toBe(true)
    walletRef.network = 'testnet4'
    await expect(wallet.getRgbFeatureStatus()).resolves.toMatchObject({ enabled: true, supported: true })
  })

  it('ignores unscoped consent but keeps network consent valid across terms versions', async () => {
    const wallet = new WalletController()
    const storage = new Map<string, unknown>([
      ['rgb-feature-enabled:v1:unisat-deadbeef', true],
    ])
    ;(keyringService as any).getEncryptedStorageItem = vi.fn(
      (_namespace: string, key: string) => Promise.resolve(storage.get(key))
    )
    vi.spyOn(wallet, 'getCurrentRgbWalletRef').mockResolvedValue({
      walletId: 'unisat-deadbeef-0',
      network: 'mainnet',
      fundingAddress: 'bc1p-rgb-funding',
    })

    await expect(wallet.getRgbFeatureStatus()).resolves.toMatchObject({ enabled: false, supported: true })
    await expect((wallet as any).assertRgbFeatureEnabled()).rejects.toThrow('RGB is not enabled')

    storage.set('rgb-feature-enabled:v1:unisat-deadbeef:mainnet', {
      enabled: true,
      agreementVersion: 'rgb-terms-v0',
      acceptedAt: 1,
    })
    await expect(wallet.getRgbFeatureStatus()).resolves.toMatchObject({ enabled: true, supported: true })
  })

  it('detects an existing encrypted RGB recovery checkpoint without opening RGB state', async () => {
    const wallet = new WalletController()
    const walletRef = {
      walletId: 'rgb-wallet',
      network: 'mainnet',
      fundingAddress: 'bc1p-rgb-funding',
    }
    ;(keyringService as any).getEncryptedStorageItem = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(wallet, 'getCurrentRgbWalletRef').mockResolvedValue(walletRef)
    const getRgbRecoveryCheckpointMetadata = vi.fn().mockResolvedValue({ exists: true, generation: 2 })
    const openReadService = vi.spyOn(wallet as any, 'getLocalRgbReadService')
    const originalRgb = (walletApiService as any).rgb
    ;(walletApiService as any).rgb = { getRgbRecoveryCheckpointMetadata }
    try {
      await expect(wallet.getRgbFeatureStatus()).resolves.toEqual({
        enabled: false,
        supported: true,
        remoteRecoveryAvailable: true,
      })
      expect(getRgbRecoveryCheckpointMetadata).toHaveBeenCalledWith({ wallet: walletRef })
      expect(openReadService).not.toHaveBeenCalled()
    } finally {
      ;(walletApiService as any).rgb = originalRgb
    }
  })

  it('clears recovery cache entries when encrypted wallet state is discarded', () => {
    const wallet = new WalletController()
    ;(wallet as any).rgbRecoveryVersions.set('mainnet:bc1p-rgb-funding', {
      revision: 'a'.repeat(24),
    })
    ;(wallet as any).rgbRecoveryVerifiedFingerprints.set('mainnet:bc1p-rgb-funding', 'fingerprint')

    ;(wallet as any).clearRgbRecoveryCaches()

    expect((wallet as any).rgbRecoveryVersions.size).toBe(0)
    expect((wallet as any).rgbRecoveryVerifiedFingerprints.size).toBe(0)
  })

  it('adopts a newer recovery revision when the decrypted checkpoint matches local state', async () => {
    const wallet = new WalletController()
    const walletRef = {
      walletId: 'rgb-wallet',
      network: 'mainnet',
      fundingAddress: 'bc1p-rgb-funding',
    }
    const recoveryState = {
      version: 1,
      wallet: walletRef,
      snapshot: { syncedAt: 1, utxos: [] },
      pending: { transfer: { request: { assetId: 'rgb:asset' }, prepared: {}, createdAt: 1 } },
    }
    const recoveryKey = '11'.repeat(32)
    const payload = await encryptRgbRecoveryCheckpoint(recoveryState, recoveryKey)
    const service = {
      needsRecoveryRestore: vi.fn(() => false),
      getRecoveryCheckpointRevision: vi.fn(() => 'a'.repeat(24)),
      matchesRecoveryState: vi.fn(() => true),
      clearRecoveryConflict: vi.fn(),
      markRecoveryConflict: vi.fn(),
      setRecoveryCheckpointVersion: vi.fn(),
      setRecoveryCheckpointRevision: vi.fn(),
      setRecoveryCheckpointGeneration: vi.fn(),
      setRecoveryCheckpointKind: vi.fn(),
      hasRecoveryConflict: vi.fn(() => false),
      enableRecoveryBackup: vi.fn(),
      getRecoveryCheckpointStatus: vi.fn(() => ({ dirty: false, verified: true })),
    }
    ;(walletApiService as any).rgb = {
      getRgbRecoveryCheckpoint: vi.fn().mockResolvedValue({
        payload,
        updatedAt: 2,
        revision: 'b'.repeat(24),
      }),
    }
    vi.spyOn(wallet as any, 'rgbRecoveryKey').mockResolvedValue(recoveryKey)

    await (wallet as any).restoreRgbRecoveryIfNeeded({ service, wallet: walletRef })

    expect(service.matchesRecoveryState).toHaveBeenCalledWith(recoveryState)
    expect(service.clearRecoveryConflict).toHaveBeenCalledTimes(1)
    expect(service.markRecoveryConflict).not.toHaveBeenCalled()
    expect(service.setRecoveryCheckpointVersion).toHaveBeenCalledWith(2)
    expect(service.setRecoveryCheckpointRevision).toHaveBeenCalledWith('b'.repeat(24))
  })

  it('waits for its own queued checkpoint before checking for another installation', async () => {
    const wallet = new WalletController()
    const walletRef = {
      walletId: 'rgb-wallet',
      network: 'mainnet',
      fundingAddress: 'bc1p-rgb-funding',
    }
    const context = {
      service: { isRecoveryBackupEnabled: vi.fn(() => true) },
      wallet: walletRef,
    }
    const key = `${walletRef.network}:${walletRef.fundingAddress}`
    let releaseBackup: () => void
    const backup = new Promise<void>(resolve => { releaseBackup = resolve })
    ;(wallet as any).rgbRecoveryBackups.set(key, backup)
    vi.spyOn(wallet as any, 'assertRgbRecoveryWallet').mockResolvedValue(undefined)
    const restore = vi
      .spyOn(wallet as any, 'restoreRgbRecoveryIfNeeded')
      .mockResolvedValue(undefined)

    const refresh = (wallet as any).refreshRgbRecoveryForWrite(context)
    await Promise.resolve()
    expect(restore).not.toHaveBeenCalled()

    releaseBackup!()
    await refresh

    expect(restore).toHaveBeenCalledOnce()
    expect(restore).toHaveBeenCalledWith(context)
  })

  it('requeues verified local RGB state when the recovery backend is explicitly empty', async () => {
    const wallet = new WalletController()
    const walletRef = {
      walletId: 'rgb-wallet',
      network: 'mainnet',
      fundingAddress: 'bc1p-rgb-funding',
    }
    const service = {
      needsRecoveryRestore: vi.fn(() => false),
      getRecoveryCheckpointRevision: vi.fn(() => 'a'.repeat(24)),
      matchesRecoveryState: vi.fn(),
      markRecoveryConflict: vi.fn(),
      requeueRecoveryCheckpointAfterRemoteReset: vi.fn(),
      setRecoveryCheckpointVersion: vi.fn(),
      setRecoveryCheckpointRevision: vi.fn(),
      setRecoveryCheckpointGeneration: vi.fn(),
      setRecoveryCheckpointKind: vi.fn(),
      hasRecoveryConflict: vi.fn(() => false),
      enableRecoveryBackup: vi.fn(),
      getRecoveryCheckpointStatus: vi.fn(() => ({ dirty: true, verified: false })),
      retryRecoveryCheckpoint: vi.fn(),
    }
    ;(walletApiService as any).rgb = {
      getRgbRecoveryCheckpoint: vi.fn().mockResolvedValue({}),
    }
    const ensureLease = vi.spyOn(wallet as any, 'ensureRgbWriteLease').mockResolvedValue(undefined)

    await (wallet as any).restoreRgbRecoveryIfNeeded({ service, wallet: walletRef })

    expect(ensureLease).toHaveBeenCalledWith({ service, wallet: walletRef }, {
      forceRenew: true,
      ignoreCheckpointRevision: true,
    })
    expect(service.requeueRecoveryCheckpointAfterRemoteReset).toHaveBeenCalledTimes(1)
    expect(service.markRecoveryConflict).not.toHaveBeenCalled()
    expect(service.retryRecoveryCheckpoint).toHaveBeenCalledTimes(1)
  })

  it('does not fast-forward an explicit replacement checkpoint', async () => {
    const wallet = new WalletController()
    const walletRef = {
      walletId: 'rgb-wallet',
      network: 'mainnet',
      fundingAddress: 'bc1p-rgb-funding',
    }
    const recoveryState = { version: 1, wallet: walletRef, snapshot: { syncedAt: 2, utxos: [] } }
    const recoveryKey = '11'.repeat(32)
    const payload = await encryptRgbRecoveryCheckpoint(recoveryState, recoveryKey)
    const service = {
      needsRecoveryRestore: vi.fn(() => false),
      getRecoveryCheckpointRevision: vi.fn(() => 'a'.repeat(24)),
      getRecoveryCheckpointGeneration: vi.fn(() => 1),
      canAdoptNewerNormalRecoveryCheckpoint: vi.fn(() => true),
      matchesRecoveryState: vi.fn(() => false),
      markRecoveryConflict: vi.fn(),
      hasRecoveryConflict: vi.fn(() => true),
      disableRecoveryBackup: vi.fn(),
      restoreRecoveryState: vi.fn(),
    }
    ;(walletApiService as any).rgb = {
      getRgbRecoveryCheckpoint: vi.fn().mockResolvedValue({
        payload,
        updatedAt: 2,
        revision: 'b'.repeat(24),
        generation: 2,
        kind: 'replacement',
      }),
    }
    vi.spyOn(wallet as any, 'rgbRecoveryKey').mockResolvedValue(recoveryKey)

    await expect((wallet as any).restoreRgbRecoveryIfNeeded({ service, wallet: walletRef }))
      .rejects.toThrow('RGB recovery checkpoint has changed on another installation')

    expect(service.restoreRecoveryState).not.toHaveBeenCalled()
    expect(service.markRecoveryConflict).toHaveBeenCalledTimes(1)
    expect(service.disableRecoveryBackup).toHaveBeenCalledTimes(1)
  })

  it('publishes a replacement checkpoint even when its state matches a verified normal checkpoint', async () => {
    const wallet = new WalletController()
    vi.spyOn(wallet as any, 'assertActiveRgbWallet').mockResolvedValue(undefined)
    const walletRef = {
      walletId: 'rgb-wallet',
      network: 'mainnet',
      fundingAddress: 'bc1p-rgb-funding',
    }
    const saveRgbRecoveryCheckpoint = vi
      .fn()
      .mockResolvedValueOnce({
        saved: true,
        updatedAt: 1,
        revision: 'a'.repeat(24),
        generation: 1,
        kind: 'normal',
      })
      .mockResolvedValueOnce({
        saved: true,
        updatedAt: 2,
        revision: 'b'.repeat(24),
        generation: 2,
        kind: 'replacement',
      })
    ;(walletApiService as any).rgb = { saveRgbRecoveryCheckpoint }
    vi.spyOn(wallet as any, 'rgbRecoveryKey').mockResolvedValue('11'.repeat(32))
    const state = { version: 1, wallet: walletRef, snapshot: { syncedAt: 1, utxos: [] } }

    await (wallet as any).queueRgbRecoveryCheckpoint(walletRef, state, {
      reason: 'state_change',
      kind: 'normal',
    })
    await (wallet as any).queueRgbRecoveryCheckpoint(walletRef, state, {
      reason: 'state_change',
      kind: 'replacement',
    })

    expect(saveRgbRecoveryCheckpoint).toHaveBeenCalledTimes(2)
    expect(saveRgbRecoveryCheckpoint.mock.calls.map(([input]: any[]) => input.kind)).toEqual([
      'normal',
      'replacement',
    ])
  })

  it('refreshes the current cloud version before publishing a replacement', async () => {
    const wallet = new WalletController()
    vi.spyOn(wallet as any, 'assertActiveRgbWallet').mockResolvedValue(undefined)
    const walletRef = {
      walletId: 'rgb-wallet',
      network: 'mainnet',
      fundingAddress: 'bc1p-rgb-funding',
    }
    const saveRgbRecoveryCheckpoint = vi.fn().mockResolvedValue({
      saved: true,
      updatedAt: 11,
      revision: 'b'.repeat(24),
      generation: 4,
      kind: 'replacement',
    })
    ;(walletApiService as any).rgb = {
      getRgbRecoveryCheckpoint: vi.fn().mockResolvedValue({
        updatedAt: 10,
        revision: 'a'.repeat(24),
        generation: 3,
        kind: 'normal',
      }),
      saveRgbRecoveryCheckpoint,
    }
    vi.spyOn(wallet as any, 'rgbRecoveryKey').mockResolvedValue('11'.repeat(32))

    await (wallet as any).queueRgbRecoveryCheckpoint(
      walletRef,
      { version: 1, wallet: walletRef, snapshot: { syncedAt: 1, utxos: [] } },
      { reason: 'state_change', kind: 'replacement' }
    )

    expect(saveRgbRecoveryCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'replacement',
        expectedUpdatedAt: 10,
        expectedRevision: 'a'.repeat(24),
      })
    )
  })

  it('re-reads recovery metadata after the server rejects a stale writer version', async () => {
    const wallet = new WalletController()
    vi.spyOn(wallet as any, 'assertActiveRgbWallet').mockResolvedValue(undefined)
    vi.spyOn(wallet as any, 'rgbRecoveryKey').mockResolvedValue('11'.repeat(32))
    const walletRef = {
      walletId: 'rgb-wallet', network: 'mainnet', fundingAddress: 'bc1p-rgb-funding',
    }
    const key = `${walletRef.network}:${walletRef.fundingAddress}`
    ;(wallet as any).rgbRecoveryVersions.set(key, { kind: 'normal', generation: 1 })
    ;(walletApiService as any).rgb = {
      saveRgbRecoveryCheckpoint: vi.fn().mockRejectedValue(
        new Error('RGB recovery checkpoint requires a current wallet version')
      ),
    }

    await expect((wallet as any).queueRgbRecoveryCheckpoint(
      walletRef,
      { version: 1, wallet: walletRef, snapshot: { syncedAt: 1, utxos: [] } },
      { reason: 'state_change', kind: 'normal' }
    )).rejects.toThrow('requires a current wallet version')
    expect((wallet as any).rgbRecoveryVersions.has(key)).toBe(false)
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
      canCancel: true,
    })
  })

  it('marks accepted receipts as not releasable without exposing their blind seal', () => {
    const result = toPublicRgbPendingReceiveInvoice(
      {
        invoice: 'rgb:invoice',
        recipientId: 'recipient-id',
        seal: {
          txid: '11'.repeat(32),
          vout: 0,
          blinding: 1n,
        },
        receivedConsignment: { accepted: true },
      },
      0
    )

    expect(result).toMatchObject({
      status: 'WaitingSenderBroadcast',
      canCancel: false,
      batchTransferIdx: 0,
    })
    expect(result).not.toHaveProperty('seal')
  })

  it('marks an accepted receipt as awaiting confirmation once its sender transaction is broadcast', () => {
    const result = toPublicRgbPendingReceiveInvoice(
      {
        invoice: 'rgb:invoice',
        recipientId: 'recipient-id',
        seal: {
          txid: '11'.repeat(32),
          vout: 0,
          blinding: 1n,
        },
        receivedConsignment: { accepted: true, broadcastDetectedAt: 1 },
      },
      0
    )

    expect(result).toMatchObject({ status: 'WaitingSenderConfirmation', canCancel: false })
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

  it('derives RGB recovery encryption keys through the internal keyring capability', async () => {
    const wallet = new WalletController()
    const account = {
      type: KeyringType.HdKeyring,
      pubkey: validCompressedPubkey,
      address: 'bc1qexample',
      key: 'account-0',
      flag: 0,
      index: 0,
    }
    const deriveRgbRecoveryKey = vi.fn().mockResolvedValue('11'.repeat(32))
    const keyring = {
      getRgbFundingAccount: vi.fn().mockReturnValue({
        address: 'bc1p0rgbfundingaddress',
        publicKey: validCompressedPubkey,
        derivationPath: "m/86'/827166'/0'/0/0",
        masterFingerprint: 'a1b2c3d4',
      }),
      deriveRgbRecoveryKey,
    }
    vi.mocked(preferenceService.getCurrentAccount).mockReturnValue(account as any)
    vi.mocked(keyringService.getKeyringForAccount).mockResolvedValue(keyring as any)
    const publicDerivation = vi.spyOn(wallet, 'deriveContextHash')

    await expect(
      (wallet as any).rgbRecoveryKey({
        network: 'mainnet',
        fundingAddress: 'bc1p0rgbfundingaddress',
      })
    ).resolves.toBe('11'.repeat(32))

    expect(deriveRgbRecoveryKey).toHaveBeenCalledWith(
      validCompressedPubkey,
      'bitcoin-mainnet',
      expect.stringMatching(/^[0-9a-f]{64}$/)
    )
    expect(publicDerivation).not.toHaveBeenCalled()
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

    await wallet.createRgbUtxosBegin({
      num: 1,
      feeRate: 3,
      payment: { address: 'bc1qservice', satoshis: 1500 },
      issue: { name: 'Token', ticker: 'TOK', amount: '100', precision: 0 },
    })
    expect(sendSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      tos: [
        { address: 'bc1p0rgbfundingaddress', satoshis: 330 },
        { address: 'bc1qservice', satoshis: 1500 },
      ],
    }))
    expect(wallet.getToSignData).toHaveBeenLastCalledWith(expect.objectContaining({
      action: expect.objectContaining({
        name: 'Issue RGB asset',
        details: [],
      }),
    }))
  })

  it('builds a withdrawal that spends only unlocked RGB Fee Pool UTXOs', async () => {
    const wallet = new WalletController()
    const account = {
      type: KeyringType.HdKeyring,
      pubkey: validCompressedPubkey,
      address: 'bc1qexample',
      key: 'account-0',
      flag: 0,
      index: 0,
    }
    const service = {
      getPendingTransfers: vi.fn(() => [
        { prepared: { feeOutpoints: [{ txid: 'a'.repeat(64), vout: 0 }] } },
      ]),
    }
    const sendAllSpy = vi.spyOn(txHelpers, 'sendAllBTC').mockResolvedValue({
      psbt: { txOutputs: [{ value: 9_000 }], toHex: () => '70736274ff' } as any,
      toSignInputs: [],
    })

    vi.mocked(preferenceService.getCurrentAccount).mockReturnValue(account as any)
    const localWallet = { fundingAddress: 'bc1p-rgb-funding', network: 'mainnet', walletId: 'rgb-wallet' }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({ service, wallet: localWallet })
    vi.spyOn(wallet, 'getCurrentRgbWalletRef').mockResolvedValue(localWallet)
    const ensureLease = vi.spyOn(wallet as any, 'ensureRgbWriteLease').mockResolvedValue(undefined)
    vi.spyOn(wallet as any, 'getCurrentRgbFeeAccount').mockResolvedValue({
      address: 'bc1pfeepool',
      publicKey: validCompressedPubkey,
    })
    vi.mocked(walletApiService.bitcoin.getAllBTCUtxos).mockResolvedValue([
      {
        txid: 'a'.repeat(64),
        vout: 0,
        satoshis: 10_000,
        scriptPk: '5120' + '00'.repeat(32),
        inscriptions: [],
        atomicals: [],
        runes: [],
      },
      {
        txid: 'b'.repeat(64),
        vout: 1,
        satoshis: 10_000,
        scriptPk: '5120' + '11'.repeat(32),
        inscriptions: [],
        atomicals: [],
        runes: [],
      },
    ] as any)
    vi.spyOn(wallet, 'getFeeSummary').mockResolvedValue({ list: [{ feeRate: 2 }, { feeRate: 3 }] } as any)
    vi.spyOn(wallet, 'getRgbToSignData').mockResolvedValue({ psbtHex: '70736274ff' } as any)

    await expect(wallet.createRgbFeePoolWithdrawBegin({ feeRate: 2 })).resolves.toMatchObject({
      amount: 9_000,
      toSignData: { psbtHex: '70736274ff' },
    })
    expect(sendAllSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        toAddress: account.address,
        feeRate: 2,
        btcUtxos: [expect.objectContaining({ txid: 'b'.repeat(64), vout: 1 })],
      })
    )
    expect(ensureLease).toHaveBeenCalledWith({ service, wallet: localWallet })
  })

  it('removes locally retained Fee Pool UTXOs after a withdrawal is broadcast', async () => {
    const wallet = new WalletController()
    const feeAddress = bitcoin.payments.p2tr({
      internalPubkey: Buffer.from(validCompressedPubkey, 'hex').subarray(1),
      network: bitcoin.networks.bitcoin,
    }).address!
    const signedPsbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin })
      .addInput({
        hash: 'c'.repeat(64),
        index: 2,
        witnessUtxo: {
          script: bitcoin.address.toOutputScript(feeAddress, bitcoin.networks.bitcoin),
          value: 10_000,
        },
      })
      .addOutput({ address: feeAddress, value: 9_000 })
    signedPsbt.updateInput(0, {
      finalScriptWitness: Buffer.concat([
        Buffer.from([2, 1, 0, 33]),
        Buffer.from(validCompressedPubkey, 'hex'),
      ]),
    })
    const service = { removeFeePoolUtxos: vi.fn().mockResolvedValue(undefined) }
    const localWallet = { fundingAddress: feeAddress, network: 'mainnet', walletId: 'rgb-wallet' }
    vi.mocked(preferenceService.getCurrentAccount).mockReturnValue({ address: feeAddress } as any)
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({ service, wallet: localWallet })
    vi.spyOn(wallet as any, 'getCurrentRgbFeeAccount').mockResolvedValue({
      address: feeAddress,
      publicKey: validCompressedPubkey,
    })
    const ensureLease = vi.spyOn(wallet as any, 'ensureRgbWriteLease').mockResolvedValue(undefined)
    const pushTx = vi.spyOn(wallet, 'pushTx').mockResolvedValue('d'.repeat(64))

    await expect(wallet.createRgbFeePoolWithdrawEnd({ signedPsbt: signedPsbt.toBase64() })).resolves.toEqual({
      txid: 'd'.repeat(64),
    })
    expect(ensureLease).toHaveBeenCalledWith({ service, wallet: localWallet }, { forceRenew: true })
    expect(ensureLease.mock.invocationCallOrder[0]).toBeLessThan(pushTx.mock.invocationCallOrder[0])
    expect(service.removeFeePoolUtxos).toHaveBeenCalledWith([{ txid: 'c'.repeat(64), vout: 2 }])
    expect(keyringService.setEncryptedStorageItem).toHaveBeenCalledWith(
      'rgb-local-history-v1',
      'mainnet:rgb-wallet',
      [
        expect.objectContaining({
          txid: 'd'.repeat(64),
          amount: 9_000,
          destination: feeAddress,
        }),
      ]
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
    const ensureLease = vi.spyOn(wallet as any, 'ensureRgbWriteLease').mockResolvedValue(undefined)
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({ service, wallet: localWallet })
    vi.spyOn(wallet as any, 'getCurrentRgbFundingAccount').mockResolvedValue({
      address: fundingAddress,
      publicKey: validCompressedPubkey,
    })
    const pushTx = vi.spyOn(wallet, 'pushTx').mockResolvedValue('e'.repeat(64))

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
    expect(ensureLease).toHaveBeenCalledWith({ service, wallet: localWallet }, { forceRenew: true })
    expect(ensureLease.mock.invocationCallOrder[0]).toBeLessThan(pushTx.mock.invocationCallOrder[0])
    expect(service.queueUtxoSync.mock.invocationCallOrder[0]).toBeLessThan(
      syncOutbox.mock.invocationCallOrder[0]
    )

    service.queueUtxoSync.mockRejectedValueOnce(new Error('temporary sync failure'))
    await expect(wallet.createRgbUtxosEnd({ signedPsbt: signedPsbt.toBase64() })).resolves.toMatchObject({
      txid: 'e'.repeat(64),
      syncPending: true,
    })
  })

  it('does not broadcast RGB funding UTXOs after the writer lease is fenced', async () => {
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
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({ service, wallet: localWallet })
    vi.spyOn(wallet as any, 'getCurrentRgbFundingAccount').mockResolvedValue({
      address: fundingAddress,
      publicKey: validCompressedPubkey,
    })
    vi.spyOn(wallet as any, 'ensureRgbWriteLease').mockRejectedValue(new Error('RGB write lease is unavailable'))
    const pushTx = vi.spyOn(wallet, 'pushTx').mockResolvedValue('e'.repeat(64))

    await expect(wallet.createRgbUtxosEnd({ signedPsbt: signedPsbt.toBase64() })).rejects.toThrow(
      'RGB write lease is unavailable'
    )
    expect(pushTx).not.toHaveBeenCalled()
    expect(service.queueUtxoSync).not.toHaveBeenCalled()
  })

  it('completes the sole persisted RGB transfer after a background restart', async () => {
    const wallet = new WalletController()
    const service = { getPendingTransfers: vi.fn(() => [{ id: 'persisted-rgb-transfer' }]), completeSend: vi.fn().mockResolvedValue({ txid: 'aa'.repeat(32) }) }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({
      service,
      wallet: { fundingAddress: 'bc1p-rgb-funding' },
    })
    const ensureLease = vi.spyOn(wallet as any, 'ensureRgbWriteLease').mockResolvedValue(undefined)

    const signedPsbt = new bitcoin.Psbt().toBase64()
    await expect(wallet.createRgbSendEnd({ signedPsbt })).resolves.toEqual({ txid: 'aa'.repeat(32) })
    expect(ensureLease).toHaveBeenCalledWith(
      expect.anything(),
      { forceRenew: true }
    )
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
    vi.spyOn(wallet as any, 'ensureRgbWriteLease').mockResolvedValue(undefined)

    const signedPsbt = new bitcoin.Psbt().toBase64()
    await expect(
      wallet.createRgbSendEnd({ signedPsbt, transferId: 'pending-rgb-transfer' })
    ).resolves.toEqual({
      transferId: 'pending-rgb-transfer',
      txid: 'bb'.repeat(32),
      status: 'waiting_ack',
    })
  })

  it('returns a sender action when the recipient already accepted during signing', async () => {
    const wallet = new WalletController()
    const service = {
      getPendingTransfers: vi.fn(() => [{
        id: 'accepted-rgb-transfer',
        delivery: { acknowledgedAt: 1, completed: { txid: 'bb'.repeat(32) } },
      }]),
      completeSend: vi.fn().mockResolvedValue({ txid: 'bb'.repeat(32) }),
    }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({
      service,
      wallet: { fundingAddress: 'bc1p-rgb-funding' },
    })
    vi.spyOn(wallet as any, 'ensureRgbWriteLease').mockResolvedValue(undefined)

    const signedPsbt = new bitcoin.Psbt().toBase64()
    await expect(wallet.createRgbSendEnd({ signedPsbt, transferId: 'accepted-rgb-transfer' }))
      .resolves.toEqual({
        transferId: 'accepted-rgb-transfer',
        txid: 'bb'.repeat(32),
        status: 'ready_to_broadcast',
      })
  })

  it('formats atomic RGB amounts for the signing action', async () => {
    const wallet = new WalletController()
    vi.spyOn(wallet as any, 'assertActiveRgbWallet').mockResolvedValue(undefined)
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
    const localWallet = { fundingAddress: 'bc1p-rgb-funding', network: 'mainnet', walletId: 'rgb-wallet' }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({ service, wallet: localWallet })
    const ensureLease = vi.spyOn(wallet as any, 'ensureRgbWriteLease').mockResolvedValue(undefined)

    await wallet.createRgbSendBegin({
      invoice: 'rgb:asset/schema/~/bc:utxob:recipient?amount=8888888888&endpoints=rpc://proxy',
      assetId: 'rgb:asset',
      amount: '8888888888',
      ticker: '*',
      name: 'Star Token',
      precision: 8,
      feeRate: 2,
    })

    expect(ensureLease).toHaveBeenNthCalledWith(
      1,
      { service, wallet: localWallet },
      { forceRenew: true }
    )
    expect(service.prepareSend).toHaveBeenCalledWith(
      expect.objectContaining({ precision: 8, amount: '8888888888' }),
      expect.anything()
    )

    expect(getRgbToSignData).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({
          name: 'Send Star Token',
          details: expect.arrayContaining([
            expect.objectContaining({ label: 'Amount', value: '88.88888888 Star Token' }),
          ]),
        }),
      })
    )
  })

  it('creates an Arbitrum burn with a V1 direct destination', async () => {
    const wallet = new WalletController()
    vi.spyOn(wallet as any, 'assertActiveRgbWallet').mockResolvedValue(undefined)
    const service = {
      sync: vi.fn(),
      prepareBurn: vi.fn().mockResolvedValue({
        id: 'rgb-burn', psbt: 'cHNidP8=', toSignInputs: [],
      }),
    }
    vi.spyOn(wallet, 'getRgbToSignData').mockResolvedValue({ psbtHex: '00', toSignInputs: [] } as any)
    const localWallet = { fundingAddress: 'bc1p-rgb-funding', network: 'mainnet', walletId: 'rgb-wallet' }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({ service, wallet: localWallet })
    vi.spyOn(wallet as any, 'ensureRgbWriteLease').mockResolvedValue(undefined)

    await wallet.createRgbSendBegin({
      invoice: '', assetId: 'rgb:asset', amount: '1000000', feeRate: 2,
      burn: true, burnDestinationChainId: 42161,
      burnReason: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
    })

    expect(service.prepareBurn).toHaveBeenCalledWith(expect.objectContaining({
      burnDestination: {
        version: 1,
        destinationChainId: 42161,
        dstEid: 0,
        recipient: 'f39fd6e51aad88f6f4ce6ab8827279cfffb92266',
      },
    }))
  })

  it('revalidates the lease before RGB mutations that can follow an approval', async () => {
    const wallet = new WalletController()
    const context = {
      service: { getPendingReceives: vi.fn(() => []) },
      wallet: { fundingAddress: 'bc1p-rgb-funding', network: 'mainnet', walletId: 'rgb-wallet' },
    }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue(context)
    const ensureLease = vi.spyOn(wallet as any, 'ensureRgbWriteLease').mockResolvedValue(undefined)
    vi.spyOn((wallet as any).rgbReceiveOperations, 'createBlindReceive').mockResolvedValue({})
    vi.spyOn((wallet as any).rgbReceiveOperations, 'cancelReceiveInvoice').mockResolvedValue({ changed: false })
    const abortVanillaTx = vi.spyOn((wallet as any).rgbSendOperations, 'abortVanillaTx').mockResolvedValue({ aborted: false })

    await wallet.createRgbBlindReceive({})
    await wallet.cancelRgbReceiveInvoice({ batchTransferIdx: 0 })
    await wallet.abortRgbVanillaTx({ txid: 'pending-transfer', discardUnsigned: true })

    expect(ensureLease).toHaveBeenNthCalledWith(1, context, { forceRenew: true })
    expect(ensureLease).toHaveBeenNthCalledWith(2, context, { forceRenew: true })
    expect(ensureLease).toHaveBeenNthCalledWith(3, context, { forceRenew: true })
    expect(abortVanillaTx).toHaveBeenCalledWith('pending-transfer', context, { discardUnsigned: true })
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
    vi.spyOn(wallet as any, 'ensureRgbWriteLease').mockResolvedValue(undefined)

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
        delivery: { acknowledgedAt: 1, broadcastError: 'broadcast unavailable' },
      },
    ]
    const service = {
      getPendingTransfers: vi.fn(() => pending),
      broadcastPendingSend: vi.fn(async () => {
        pending.splice(0)
      }),
    }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({
      service,
      wallet: { fundingAddress: 'bc1p-rgb-funding' },
    })
    const ensureLease = vi.spyOn(wallet as any, 'ensureRgbWriteLease').mockResolvedValue(undefined)

    await expect(wallet.retryRgbBroadcast({ transferId: 'pending-rgb-transfer' })).resolves.toEqual({
      broadcast: true,
      status: 'confirming',
    })
    expect(ensureLease).toHaveBeenCalledWith(
      expect.anything(),
      { forceRenew: true }
    )
    expect(service.broadcastPendingSend).toHaveBeenCalledWith('pending-rgb-transfer')
  })

  it('does not process pending RGB receives when another device owns the writer lease', async () => {
    const wallet = new WalletController()
    const service = {
      claimPendingReceives: vi.fn(),
      processClaimedReceives: vi.fn(),
      backfillWitnessReceivePublicKey: vi.fn(),
      getPendingReceives: vi.fn(() => [{ recipientId: 'pending-receive' }]),
    }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({
      service,
      wallet: { fundingAddress: 'bc1p-rgb-funding', network: 'mainnet', walletId: 'rgb-wallet' },
    })
    vi.spyOn(wallet, 'getCurrentRgbWalletRef').mockResolvedValue({
      fundingAddress: 'bc1p-rgb-funding',
      network: 'mainnet',
      walletId: 'rgb-wallet',
    })
    const ensureLease = vi.spyOn(wallet as any, 'tryEnsureRgbWriteLease').mockResolvedValue(false)

    await (wallet as any).syncRgbReceivedAllocations()

    expect(ensureLease).toHaveBeenCalledWith(expect.anything(), { forceRenew: true })
    expect(ensureLease).toHaveBeenCalledTimes(1)
    expect(service.backfillWitnessReceivePublicKey).not.toHaveBeenCalled()
    expect(service.claimPendingReceives).not.toHaveBeenCalled()
    expect(service.processClaimedReceives).not.toHaveBeenCalled()
  })

  it('does not poll RGB receive infrastructure when there are no pending invoices', async () => {
    const wallet = new WalletController()
    const calls: string[] = []
    const service = {
      sync: vi.fn(async () => void calls.push('sync')),
      claimPendingReceives: vi.fn(async () => void calls.push('claim')),
      processClaimedReceives: vi.fn(async () => ({ received: 0 })),
      hasStoredPendingReceives: vi.fn(() => false),
      getPendingReceives: vi.fn(() => []),
    }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({ service, wallet: { fundingAddress: 'bc1p-rgb-funding' } })

    await wallet.getRgbPendingReceiveInvoices()
    expect(calls).toEqual([])
  })

  it('refreshes the funding UTXO snapshot before reporting a pending invoice status', async () => {
    const wallet = new WalletController()
    let confirmed = false
    const pendingReceive = {
      invoice: 'rgb:invoice',
      recipientId: 'recipient-id',
      seal: { txid: '11'.repeat(32), vout: 0, blinding: 1n },
    }
    const service = {
      sync: vi.fn(async () => {
        confirmed = true
      }),
      hasStoredPendingReceives: vi.fn(() => true),
      getPendingReceives: vi.fn(() => [pendingReceive]),
      getSnapshot: vi.fn(() => ({
        utxos: [
          {
            outpoint: { txid: pendingReceive.seal.txid, vout: pendingReceive.seal.vout },
            chainStatus: confirmed ? 'confirmed' : 'mempool',
          },
        ],
      })),
      processClaimedReceives: vi.fn(async () => ({ received: 0 })),
      backfillWitnessReceivePublicKey: vi.fn().mockResolvedValue(undefined),
    }
    const context = {
      service,
      wallet: { fundingAddress: 'bc1p-rgb-funding', network: 'mainnet', walletId: 'rgb-wallet' },
    }
    vi.spyOn(wallet as any, 'getLocalRgbReadService').mockResolvedValue(context)
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue(context)
    vi.spyOn(wallet, 'getCurrentRgbWalletRef').mockResolvedValue(context.wallet)
    vi.spyOn(wallet as any, 'tryEnsureRgbWriteLease').mockResolvedValue(true)
    vi.spyOn(wallet as any, 'syncRgbIndexerOutbox').mockResolvedValue(false)
    vi.spyOn(wallet as any, 'syncRgbReceiveHistory').mockResolvedValue(undefined)

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
    vi.spyOn(wallet as any, 'ensureRgbWriteLease').mockResolvedValue(undefined)
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
    })
    expect(service.markReceiveHistorySynced).toHaveBeenCalledWith('receive:invoice-1')
  })

  it('syncs a rejected receive outcome so a stale confirmed indexer entry is corrected', async () => {
    const wallet = new WalletController()
    const syncRgbReceiveTransfer = vi.fn().mockResolvedValue(undefined)
    ;(walletApiService as any).rgb = { syncRgbReceiveTransfer }
    const service = {
      getPendingReceiveHistory: vi.fn(() => [{
        transferId: 'receive:invoice-2',
        assetId: '', amount: '', txid: '',
        createdAt: 1_786_688_361_585,
        status: 'rejected',
        rejectionReason: 'Rejected by you',
      }]),
      markReceiveHistorySynced: vi.fn().mockResolvedValue(undefined),
    }
    const walletRef = { fundingAddress: 'bc1p-rgb-funding' }

    await (wallet as any).syncRgbReceiveHistory(service, walletRef)

    expect(syncRgbReceiveTransfer).toHaveBeenCalledWith({
      wallet: walletRef,
      transferId: 'receive:invoice-2',
      status: 'rejected',
      createdAt: 1_786_688_361_585,
      rejectionReason: 'Rejected by you',
    })
    expect(service.markReceiveHistorySynced).toHaveBeenCalledWith('receive:invoice-2')
  })

  it('reports a remote RGB writer as read-only without exposing its identity', async () => {
    const wallet = new WalletController()
    const getRgbWriteLeaseStatus = vi.fn().mockResolvedValue({
      available: false,
      heldByCaller: false,
      expiresAt: 1_800_000_000_000,
    })
    ;(walletApiService as any).rgb = { getRgbWriteLeaseStatus }
    const walletRef = { walletId: 'wallet-1', fundingAddress: 'bc1p-rgb-funding', network: 'mainnet' }
    vi.spyOn(wallet as any, 'getLocalRgbReadService').mockResolvedValue({ service: {}, wallet: walletRef })

    await expect(wallet.getRgbWriteLeaseStatus()).resolves.toEqual({
      mode: 'readonly',
      expiresAt: 1_800_000_000_000,
    })
    expect(getRgbWriteLeaseStatus).toHaveBeenCalledWith({ wallet: walletRef })
  })

  it('releases the local RGB writer lease for an explicit device handoff', async () => {
    const wallet = new WalletController()
    const releaseRgbWriteLease = vi.fn().mockResolvedValue({ released: true })
    ;(walletApiService as any).rgb = { releaseRgbWriteLease }
    const walletRef = { walletId: 'wallet-1', fundingAddress: 'bc1p-rgb-funding', network: 'mainnet' }
    vi.spyOn(wallet as any, 'getLocalRgbReadService').mockResolvedValue({ service: {}, wallet: walletRef })
    ;(wallet as any).rgbWriteLeases.set('mainnet:bc1p-rgb-funding', {
      deviceId: 'device_abcdefghijklmnop',
      leaseId: 'a'.repeat(24),
      fencingToken: 1,
      expiresAt: Date.now() + 60_000,
    })

    await expect(wallet.releaseRgbWriteLease()).resolves.toEqual({ released: true })
    expect(releaseRgbWriteLease).toHaveBeenCalledWith({
      wallet: walletRef,
      deviceId: 'device_abcdefghijklmnop',
      leaseId: 'a'.repeat(24),
      fencingToken: 1,
    })
    expect((wallet as any).rgbWriteLeases.size).toEqual(0)
  })

  it('takes over RGB writing through the explicit activation action', async () => {
    const wallet = new WalletController()
    const walletRef = { walletId: 'wallet-1', fundingAddress: 'bc1p-rgb-funding', network: 'mainnet' }
    const context = { service: {}, wallet: walletRef }
    vi.spyOn(wallet as any, 'getLocalRgbReadService').mockResolvedValue(context)
    const restore = vi
      .spyOn(wallet as any, 'restoreLatestRgbRecoveryCheckpointForContext')
      .mockResolvedValue(undefined)
    const ensure = vi.spyOn(wallet as any, 'ensureRgbWriteLease').mockImplementation(async () => {
      ;(wallet as any).rgbWriteLeases.set('mainnet:bc1p-rgb-funding', {
        deviceId: 'device_abcdefghijklmnop',
        leaseId: 'a'.repeat(24),
        fencingToken: 1,
        expiresAt: 1_800_000_000_000,
      })
    })

    await expect(wallet.activateRgbWriteLease({ takeover: true })).resolves.toEqual({
      active: true,
      expiresAt: 1_800_000_000_000,
    })
    expect(restore).toHaveBeenCalledWith(context)
    expect(ensure).toHaveBeenCalledWith(context, { takeover: true })
  })

  it('coalesces concurrent RGB writer lease acquisition for the same wallet', async () => {
    const wallet = new WalletController()
    const context = {
      service: {},
      wallet: { walletId: 'wallet-1', fundingAddress: 'bc1p-rgb-funding', network: 'mainnet' },
    }
    let resolveAcquire: ((value: { leaseId: string; fencingToken: number; expiresAt: number }) => void) | undefined
    const acquireRgbWriteLease = vi.fn(
      () =>
        new Promise<{ leaseId: string; fencingToken: number; expiresAt: number }>(resolve => {
          resolveAcquire = resolve
        })
    )
    ;(walletApiService as any).rgb = { acquireRgbWriteLease }
    vi.spyOn(wallet as any, 'getRgbDeviceId').mockResolvedValue('device_abcdefghijklmnop')

    const first = (wallet as any).ensureRgbWriteLease(context, { forceRenew: true })
    const second = (wallet as any).ensureRgbWriteLease(context, { forceRenew: true })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(acquireRgbWriteLease).toHaveBeenCalledTimes(1)

    resolveAcquire?.({ leaseId: 'a'.repeat(24), fencingToken: 1, expiresAt: Date.now() + 60_000 })
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined])
  })

  it('reacquires a missing server lease after recovery data was reset', async () => {
    const wallet = new WalletController()
    const walletRef = { walletId: 'wallet-1', fundingAddress: 'bc1p-rgb-funding', network: 'mainnet' }
    const service = {
      getRecoveryCheckpointRevision: vi.fn(() => 'a'.repeat(24)),
      requeueRecoveryCheckpointAfterRemoteReset: vi.fn(),
    }
    const context = { service, wallet: walletRef }
    const renewRgbWriteLease = vi
      .fn()
      .mockRejectedValue(new Error('RGB write lease is unavailable'))
    const getRgbRecoveryCheckpoint = vi.fn().mockResolvedValue({})
    const acquireRgbWriteLease = vi.fn().mockResolvedValue({
      leaseId: 'b'.repeat(24),
      fencingToken: 2,
      expiresAt: Date.now() + 60_000,
    })
    ;(walletApiService as any).rgb = {
      renewRgbWriteLease,
      getRgbRecoveryCheckpoint,
      acquireRgbWriteLease,
    }
    vi.spyOn(wallet as any, 'getRgbDeviceId').mockResolvedValue('device_abcdefghijklmnop')
    ;(wallet as any).rgbWriteLeases.set('mainnet:bc1p-rgb-funding', {
      deviceId: 'device_abcdefghijklmnop',
      leaseId: 'a'.repeat(24),
      fencingToken: 1,
      expiresAt: Date.now() + 60_000,
    })

    await expect((wallet as any).ensureRgbWriteLease(context, { forceRenew: true })).resolves.toBeUndefined()

    expect(service.requeueRecoveryCheckpointAfterRemoteReset).toHaveBeenCalledTimes(1)
    expect(acquireRgbWriteLease).toHaveBeenCalledWith({
      wallet: walletRef,
      deviceId: 'device_abcdefghijklmnop',
    })
  })

  it('reconciles a stale checkpoint before retrying background RGB synchronization', async () => {
    const wallet = new WalletController()
    const walletRef = { walletId: 'wallet-1', fundingAddress: 'bc1p-rgb-funding', network: 'mainnet' }
    let revision = 'a'.repeat(24)
    const context = {
      service: { getRecoveryCheckpointRevision: () => revision },
      wallet: walletRef,
    }
    const acquireRgbWriteLease = vi
      .fn()
      .mockRejectedValueOnce(new Error('RGB lease checkpoint revision is stale'))
      .mockResolvedValueOnce({
        leaseId: 'c'.repeat(24),
        fencingToken: 2,
        expiresAt: Date.now() + 60_000,
      })
    ;(walletApiService as any).rgb = { acquireRgbWriteLease }
    vi.spyOn(wallet as any, 'getRgbDeviceId').mockResolvedValue('device_abcdefghijklmnop')
    const refresh = vi
      .spyOn(wallet as any, 'refreshRgbRecoveryForWrite')
      .mockImplementation(async () => {
        revision = 'b'.repeat(24)
      })

    await expect((wallet as any).tryEnsureRgbWriteLease(context, { forceRenew: true })).resolves.toBe(
      true
    )

    expect(refresh).toHaveBeenCalledOnce()
    expect(acquireRgbWriteLease).toHaveBeenCalledTimes(2)
    expect(acquireRgbWriteLease.mock.calls.map(([request]) => request.checkpointRevision)).toEqual([
      'a'.repeat(24),
      'b'.repeat(24),
    ])
  })

  it('does not retry a stale lease when recovery state conflicts', async () => {
    const wallet = new WalletController()
    const context = {
      service: { getRecoveryCheckpointRevision: () => 'a'.repeat(24) },
      wallet: { walletId: 'wallet-1', fundingAddress: 'bc1p-rgb-funding', network: 'mainnet' },
    }
    const acquireRgbWriteLease = vi
      .fn()
      .mockRejectedValue(new Error('RGB lease checkpoint revision is stale'))
    ;(walletApiService as any).rgb = { acquireRgbWriteLease }
    vi.spyOn(wallet as any, 'getRgbDeviceId').mockResolvedValue('device_abcdefghijklmnop')
    vi.spyOn(wallet as any, 'refreshRgbRecoveryForWrite').mockRejectedValue(
      new Error('RGB recovery checkpoint has changed on another installation')
    )

    await expect((wallet as any).tryEnsureRgbWriteLease(context, { forceRenew: true })).resolves.toBe(
      false
    )
    expect(acquireRgbWriteLease).toHaveBeenCalledOnce()
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
    expect(service.markUtxoSyncCompleted).toHaveBeenCalledWith(
      'd'.repeat(64),
      expect.objectContaining({ txid: 'd'.repeat(64) })
    )
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

  it('reads RGB asset list, balance, and detail from the local RGB service', async () => {
    const wallet = new WalletController()
    const service = {
      getLocalAssetList: vi.fn(() => ({
        total: 1,
        list: [{ assetId: 'rgb:asset', balance: '10', spendable: '10' }],
      })),
      getLocalAssetBalance: vi.fn(() => ({ assetId: 'rgb:asset', balance: '10' })),
      getLocalAssetDetail: vi.fn(() => ({ assetId: 'rgb:asset', name: 'Local token' })),
    }
    vi.spyOn(wallet as any, 'getLocalRgbReadService').mockResolvedValue({ service })

    await expect(wallet.getRgbAssetList('bc1p-rgb-funding', 1, 20)).resolves.toMatchObject({
      total: 1,
      list: [{ assetId: 'rgb:asset', balance: '10' }],
    })
    await expect(wallet.getRgbAssetBalance('bc1p-rgb-funding', 'rgb:asset')).resolves.toMatchObject({
      assetId: 'rgb:asset',
      balance: '10',
    })
    await expect(wallet.getRgbAssetDetail('rgb:asset')).resolves.toMatchObject({
      assetId: 'rgb:asset',
      name: 'Local token',
    })

    expect(service.getLocalAssetList).toHaveBeenCalledWith(1, 20)
    expect(service.getLocalAssetBalance).toHaveBeenCalledWith('rgb:asset')
    expect(service.getLocalAssetDetail).toHaveBeenCalledWith('rgb:asset')
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
      isRecoveryBackupEnabled: vi.fn(() => true),
    }
    vi.spyOn(wallet as any, 'getLocalRgbReadService').mockResolvedValue({
      service,
      wallet: { walletId: 'rgb-wallet', network: 'mainnet', fundingAddress: 'bc1p-rgb-funding' },
    })
    const ensureLease = vi.spyOn(wallet as any, 'tryEnsureRgbWriteLease').mockResolvedValue(true)
    vi.spyOn(wallet, 'getRgbFundingAddress').mockResolvedValue({ address: 'bc1p-rgb-funding' })
    vi.spyOn(wallet, 'getRgbAssetList').mockResolvedValue({ currentPage: 1, pageSize: 20, total: 0, list: [] })

    await Promise.all([wallet.getRGBList('', 1, 20), wallet.getRGBList('', 1, 20)])

    expect(service.sync).toHaveBeenCalledTimes(1)
    expect(ensureLease).toHaveBeenCalledWith(expect.anything(), { forceRenew: true })
  })

  it('keeps the RGB asset list read-only when no writer lease is available', async () => {
    const wallet = new WalletController()
    const service = {
      sync: vi.fn(),
      getSnapshot: vi.fn(() => ({ utxos: [{ allocations: [{ assetId: 'rgb:asset' }] }] })),
      isRecoveryBackupEnabled: vi.fn(() => true),
    }
    const context = {
      service,
      wallet: { network: 'mainnet', fundingAddress: 'bc1p-rgb-funding', walletId: 'rgb-wallet' },
    }
    vi.spyOn(wallet as any, 'getLocalRgbReadService').mockResolvedValue(context)
    const ensureLease = vi.spyOn(wallet as any, 'tryEnsureRgbWriteLease').mockResolvedValue(false)

    await (wallet as any).rgbCoordinator.syncListState()

    expect(ensureLease).toHaveBeenCalledWith(context, { forceRenew: true })
    expect(service.sync).not.toHaveBeenCalled()
  })

  it('notifies the UI only when a background RGB list sync changes the local assets', async () => {
    const wallet = new WalletController()
    vi.spyOn((wallet as any).rgbCoordinator, 'syncListState').mockResolvedValue(undefined)
    const getAssetList = vi.spyOn(wallet, 'getRgbAssetList')
    const emit = vi.spyOn(bgEventBus, 'emit')
    const initialList = { currentPage: 1, pageSize: 20, total: 0, list: [] }

    getAssetList.mockResolvedValueOnce(initialList)
    await (wallet as any).syncRgbListState(initialList)
    expect(emit).not.toHaveBeenCalled()

    getAssetList.mockResolvedValueOnce({
      currentPage: 1,
      pageSize: 20,
      total: 1,
      list: [{ assetId: 'rgb:asset', balance: '10', spendable: '10' }],
    })
    await (wallet as any).syncRgbListState(initialList)

    expect(emit).toHaveBeenCalledWith(BUS_EVENTS.broadcastToUI, {
      method: BUS_METHODS.RGB_ASSETS_CHANGED,
      params: {},
    })
  })

  it('cancels a queued RGB list refresh after the wallet is locked', async () => {
    const wallet = new WalletController()
    const syncListState = vi.spyOn((wallet as any).rgbCoordinator, 'syncListState')
    ;(keyringService as any).memStore = { getState: () => ({ isUnlocked: false }) }
    try {
      await (wallet as any).syncRgbListState({
        currentPage: 1,
        pageSize: 20,
        total: 0,
        list: [],
      })
      expect(syncListState).not.toHaveBeenCalled()
    } finally {
      delete (keyringService as any).memStore
    }
  })

  it('shares a snapshot refresh across sequential RGB list and receive polling', async () => {
    const wallet = new WalletController()
    const service = {
      sync: vi.fn().mockResolvedValue(undefined),
      processClaimedReceives: vi.fn().mockResolvedValue({ received: 0 }),
      getPendingTransfers: vi.fn(() => []),
      getSnapshot: vi.fn(() => ({ utxos: [{ allocations: [{ assetId: 'rgb:asset' }] }] })),
      isRecoveryBackupEnabled: vi.fn(() => true),
      backfillWitnessReceivePublicKey: vi.fn().mockResolvedValue(undefined),
    }
    const walletRef = {
      walletId: 'rgb-wallet',
      network: 'mainnet',
      fundingAddress: 'bc1p-rgb-funding',
    }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({ service, wallet: walletRef })
    vi.spyOn(wallet as any, 'getLocalRgbReadService').mockResolvedValue({ service, wallet: walletRef })
    vi.spyOn(wallet, 'getCurrentRgbWalletRef').mockResolvedValue(walletRef)
    vi.spyOn(wallet, 'getRgbFundingAddress').mockResolvedValue({ address: walletRef.fundingAddress })
    vi.spyOn(wallet, 'getRgbAssetList').mockResolvedValue({ currentPage: 1, pageSize: 20, total: 0, list: [] })
    const ensureLease = vi.spyOn(wallet as any, 'tryEnsureRgbWriteLease').mockResolvedValue(true)
    vi.spyOn(wallet as any, 'syncRgbIndexerOutbox').mockResolvedValue(false)
    vi.spyOn(wallet as any, 'syncRgbReceiveHistory').mockResolvedValue(undefined)

    await wallet.getRGBList('', 1, 20)
    await (wallet as any).syncRgbReceivedAllocations()
    await (wallet as any).syncRgbReceivedAllocations()

    expect(ensureLease).toHaveBeenCalledTimes(2)
    expect(service.sync).toHaveBeenCalledTimes(1)
    expect(service.backfillWitnessReceivePublicKey).toHaveBeenCalledTimes(1)
    expect(service.processClaimedReceives).toHaveBeenCalledWith({
      includeClaimed: false,
      deferConfirmedSettlement: true,
    })
  })

  it('refreshes the RGB snapshot only after receive confirmation is detected', async () => {
    const wallet = new WalletController()
    const service = {
      sync: vi.fn().mockResolvedValue(undefined),
      processClaimedReceives: vi
        .fn()
        .mockResolvedValueOnce({ received: 0, snapshotRequired: true })
        .mockResolvedValueOnce({ received: 0, snapshotRequired: false }),
      getSnapshot: vi.fn(() => ({ utxos: [] })),
      backfillWitnessReceivePublicKey: vi.fn().mockResolvedValue(undefined),
    }
    const walletRef = {
      walletId: 'rgb-wallet',
      network: 'mainnet',
      fundingAddress: 'bc1p-rgb-funding',
    }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({ service, wallet: walletRef })
    vi.spyOn(wallet, 'getCurrentRgbWalletRef').mockResolvedValue(walletRef)
    vi.spyOn(wallet as any, 'tryEnsureRgbWriteLease').mockResolvedValue(true)
    vi.spyOn(wallet as any, 'syncRgbIndexerOutbox').mockResolvedValue(false)
    vi.spyOn(wallet as any, 'syncRgbReceiveHistory').mockResolvedValue(undefined)

    await (wallet as any).syncRgbReceivedAllocations()

    expect(service.sync).toHaveBeenCalledTimes(1)
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
    vi.spyOn(wallet as any, 'getLocalRgbReadService').mockResolvedValue({
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

  it('lists a locally issued RGB asset as unconfirmed when its genesis UTXO is not confirmed', async () => {
    const wallet = new WalletController()
    const txid = 'c'.repeat(64)
    const service = {
      getPendingTransfers: vi.fn(() => []),
      getPendingReceives: vi.fn(() => []),
      getPendingIssues: vi.fn(() => []),
      getIssueHistory: vi.fn(() => [
        {
          assetId: 'rgb:issued',
          amount: '100000000',
          txid,
          createdAt: 100,
          asset: { ticker: 'ISS', name: 'Issued', precision: 8, schema: 'NIA', issuedSupply: '100000000' },
        },
      ]),
    }
    vi.spyOn(wallet as any, 'getLocalRgbReadService').mockResolvedValue({
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

    expect(result.list).toMatchObject([
      {
        id: 'local-issue:rgb:issued',
        type: 'issue',
        amount: '100000000',
        txid,
        status: 'unconfirmed',
        ticker: 'ISS',
        precision: 8,
        local: true,
      },
    ])
  })

  it('uses the latest genesis UTXO state when merging local issuance into activity', async () => {
    const wallet = new WalletController()
    vi.spyOn(wallet as any, 'assertRgbEnabled').mockImplementation(() => undefined)
    const walletRef = { fundingAddress: 'bc1p-rgb-funding', network: 'mainnet', walletId: 'rgb-wallet' }
    const service = {
      getPendingIssues: vi.fn(() => []),
      getIssueHistory: vi.fn(() => [
        {
          assetId: 'rgb:issued',
          amount: '42',
          issuanceTxid: 'e'.repeat(64),
          txid: 'd'.repeat(64),
          createdAt: 100,
          asset: { ticker: 'ISS', name: 'Issued', precision: 0, schema: 'NIA', issuedSupply: '42' },
          chainStatus: 'mempool',
        },
      ]),
    }
    ;(walletApiService as any).rgb = {
      getRgbAssetActivity: vi.fn().mockResolvedValue({ total: 0, list: [] }),
      getAddressRgbActivity: vi.fn().mockResolvedValue({ total: 0, list: [] }),
      getRgbWalletUtxoSnapshot: vi.fn().mockResolvedValue({
        syncedAt: 1,
        utxos: [
          {
            txid: 'd'.repeat(64),
            vout: 0,
            allocations: [{ assetId: 'rgb:issued', amount: '42', settled: true, spendable: true }],
            chainStatus: 'confirmed',
          },
        ],
      }),
    }
    vi.spyOn(wallet as any, 'getLocalRgbReadService').mockResolvedValue({ service, wallet: walletRef })

    await expect(wallet.getRgbAssetActivity('rgb:issued', 1, 20, walletRef.fundingAddress)).resolves
      .toMatchObject({
        total: 1,
        list: [{ id: 'local-issue:rgb:issued', type: 'issue', amount: '42', txid: 'e'.repeat(64), status: 'confirmed' }],
      })
    await expect(wallet.getAddressRgbActivity(walletRef.fundingAddress, 1, 20)).resolves.toMatchObject({
      total: 1,
      list: [{ id: 'local-issue:rgb:issued', type: 'issue', amount: '42', txid: 'e'.repeat(64), status: 'confirmed' }],
    })
  })

  it('does not advance pending RGB transfers when this device cannot renew the writer lease', async () => {
    const wallet = new WalletController()
    const service = { syncPendingTransfers: vi.fn().mockResolvedValue(undefined) }
    const context = {
      service,
      wallet: { fundingAddress: 'bc1p-rgb-funding', network: 'mainnet', walletId: 'rgb-wallet' },
    }
    const ensureLease = vi
      .spyOn(wallet as any, 'tryEnsureRgbWriteLease')
      .mockResolvedValue(false)

    await (wallet as any).syncRgbPendingTransfers(service, context)

    expect(ensureLease).toHaveBeenCalledWith(context, { forceRenew: true })
    expect(service.syncPendingTransfers).not.toHaveBeenCalled()
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
    vi.spyOn(wallet as any, 'getLocalRgbReadService').mockResolvedValue({
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
    vi.spyOn(wallet as any, 'getLocalRgbReadService').mockResolvedValue({
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

    expect(result).toMatchObject({ currentPage: 2, total: 22 })
    expect(result.list).toEqual([expect.objectContaining({ id: 'remote-page-two' })])
  })

  it('does not subtract active RGB send locks twice in the asset list', async () => {
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
              { assetId: 'rgb:asset', amount: '2', settled: true, spendable: true },
            ],
          },
          {
            outpoint: { txid: 'b'.repeat(64), vout: 0 },
            allocations: [
              { assetId: 'rgb:asset', amount: '8', settled: true, spendable: true },
            ],
          },
        ],
      })),
    }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({ service })
    vi.spyOn(wallet as any, 'getLocalRgbReadService').mockResolvedValue({ service })
    vi.spyOn(wallet, 'getRgbFundingAddress').mockResolvedValue({ address: 'bc1p-rgb-funding' })
    vi.spyOn(wallet, 'getRgbAssetList').mockResolvedValue({
      currentPage: 1,
      pageSize: 20,
      total: 1,
      list: [{ assetId: 'rgb:asset', spendable: '8', lockedAmount: '2' }],
    })

    const result = await wallet.getRGBList('', 1, 20, { skipSync: true })

    expect(result.list).toEqual([{ assetId: 'rgb:asset', spendable: '8', lockedAmount: '2' }])
  })

  it('does not subtract a still-active broadcast RGB send lock twice', async () => {
    const wallet = new WalletController()
    const service = {
      getPendingTransfers: vi.fn(() => [
        {
          broadcast: { completed: { txid: 'b'.repeat(64) } },
          request: { assetId: 'rgb:asset', amount: '2' },
          prepared: { lockedOutpoints: [{ txid: 'a'.repeat(64), vout: 0 }] },
        },
      ]),
      getPendingSendHistory: vi.fn(() => [
        {
          assetId: 'rgb:asset', status: 'broadcasted',
          spentOutpoints: [{ txid: 'a'.repeat(64), vout: 0 }],
        },
      ]),
      getSnapshot: vi.fn(() => ({
        utxos: [
          {
            outpoint: { txid: 'a'.repeat(64), vout: 0 },
            allocations: [
              { assetId: 'rgb:asset', amount: '2', settled: true, spendable: true },
            ],
          },
          {
            outpoint: { txid: 'b'.repeat(64), vout: 0 },
            allocations: [
              { assetId: 'rgb:asset', amount: '8', settled: true, spendable: true },
            ],
          },
        ],
      })),
    }
    vi.spyOn(wallet as any, 'getLocalRgbService').mockResolvedValue({ service })
    vi.spyOn(wallet as any, 'getLocalRgbReadService').mockResolvedValue({ service })
    vi.spyOn(wallet, 'getRgbFundingAddress').mockResolvedValue({ address: 'bc1p-rgb-funding' })
    vi.spyOn(wallet, 'getRgbAssetBalance').mockResolvedValue({
      assetId: 'rgb:asset', spendable: '8', lockedAmount: '2',
    })

    await expect(wallet.getRGBAssetBalance('', 'rgb:asset')).resolves.toEqual({
      assetId: 'rgb:asset',
      spendable: '8',
      lockedAmount: '2',
    })
  })

  it('refreshes the RGB snapshot while a token detail balance is pending', async () => {
    const wallet = new WalletController()
    vi.spyOn(wallet, 'getRgbFundingAddress').mockResolvedValue({ address: 'bc1p-rgb-funding' })
    vi.spyOn(wallet, 'getRgbAssetBalance').mockResolvedValue({
      assetId: 'rgb:asset',
      settled: '0',
      spendable: '0',
      pending: '998',
    })
    vi.spyOn(wallet as any, 'getRgbPendingLockedAmounts').mockResolvedValue(new Map())
    const syncListState = vi.spyOn(wallet as any, 'syncRgbListState').mockResolvedValue(undefined)

    await expect(wallet.getRGBAssetBalance('', 'rgb:asset')).resolves.toMatchObject({
      pending: '998',
    })
    expect(syncListState).toHaveBeenCalledOnce()
  })

  it('keeps a broadcast RGB history entry locked after it is compacted from pending transfers', async () => {
    const wallet = new WalletController()
    const service = {
      getPendingTransfers: vi.fn(() => []),
      getPendingSendHistory: vi.fn(() => [
        {
          transferId: 'broadcasted-transfer',
          assetId: 'rgb:asset',
          status: 'broadcasted',
          spentOutpoints: [{ txid: 'a'.repeat(64), vout: 0 }],
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
    vi.spyOn(wallet as any, 'getLocalRgbReadService').mockResolvedValue({ service })
    vi.spyOn(wallet, 'getRgbFundingAddress').mockResolvedValue({ address: 'bc1p-rgb-funding' })
    vi.spyOn(wallet, 'getRgbAssetBalance').mockResolvedValue({ assetId: 'rgb:asset', spendable: '10' })

    await expect(wallet.getRGBAssetBalance('', 'rgb:asset')).resolves.toEqual({
      assetId: 'rgb:asset',
      spendable: '0',
      lockedAmount: '10',
    })
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
    vi.spyOn(wallet as any, 'getLocalRgbReadService').mockResolvedValue({ service, wallet: walletRef })
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
    vi.spyOn(wallet as any, 'getLocalRgbReadService').mockResolvedValue({ service, wallet: walletRef })
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
            amount: '100',
            precision: 2,
            discoveredAt: 96,
          },
        },
        {
          recipientId: 'ack-intent',
          assetId: 'rgb:asset',
          amount: '6',
          createdAt: 94,
          pendingAccept: {
            payload: 'consignment',
            txid: 'a'.repeat(64),
            assetId: 'rgb:asset',
            amount: '6',
            discoveredAt: 94,
          },
          receivedConsignment: {
            txid: 'a'.repeat(64),
            receivedAt: 94,
            acknowledgementPending: true,
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
          createdAt: 85,
          receivedConsignment: {
            txid: 'e'.repeat(64),
            receivedAt: 86,
            assetId: 'rgb:received-asset',
            amount: '400',
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
    vi.spyOn(wallet as any, 'getLocalRgbReadService').mockResolvedValue({ service, wallet: walletRef })
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
        amount: '100',
        precision: 2,
      }),
      expect.objectContaining({
        id: 'local-receive:ack-intent',
        status: 'waiting_receive',
        amount: '6',
      }),
      expect.objectContaining({
        id: 'local-receive:accepted-unbroadcast',
        status: 'waiting_receive',
        assetId: 'rgb:received-asset',
        amount: '400',
      }),
      expect.objectContaining({
        id: 'local-receive:legacy-auto-accepted',
        status: 'pending_accept',
        amount: '7',
      }),
    ])
    const pendingReceive = result.list.find(item => item.id === 'local-receive:pending-accept')
    expect(toRgbDisplayAmount(pendingReceive?.amount, pendingReceive?.precision ?? 0)).toBe('1')
  })

  it('issues an RGB asset on a mempool funding UTXO as immediately spendable', async () => {
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
      getAvailableIssueUtxos: vi.fn(() => snapshot.utxos),
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
    const context = {
      service,
      wallet: { fundingAddress: 'bc1p-rgb-funding', network: 'mainnet', walletId: 'rgb-wallet' },
    }
    vi.spyOn(wallet as any, 'getLocalRgbReadService').mockResolvedValue(context)
    vi.spyOn(wallet as any, 'refreshRgbRecoveryForWrite').mockResolvedValue(undefined)
    vi.spyOn(wallet as any, 'ensureRgbWriteLease').mockResolvedValue(undefined)
    vi.spyOn(wallet as any, 'assertActiveRgbWallet').mockResolvedValue(undefined)

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
            allocations: [expect.objectContaining({ settled: true, spendable: true })],
          }),
        ],
      })
    )
  })
})
