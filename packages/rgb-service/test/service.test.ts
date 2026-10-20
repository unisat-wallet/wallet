import { Psbt } from 'bitcoinjs-lib'
import { describe, expect, it, vi } from 'vitest'
import type {
  RgbCompletedTransfer,
  RgbServiceDependencies,
  RgbValidationHistory,
  RgbWalletRef,
  RgbWalletSnapshot,
} from '../src'
import {
  encodeNiaContract,
  encodeNiaGenesis,
  encodeRgbContractId,
  decodeNiaConsignment,
  decodeRgbInvoice,
  rgbProxyInvoiceId,
  RgbInsufficientBalanceError,
  RgbService,
  RgbServiceError,
} from '../src'

const wallet: RgbWalletRef = {
  walletId: 'rgb-wallet-1',
  fundingAddress: 'bc1p-rgb-funding',
  network: 'mainnet',
}

const blindRecipient = 'bc:utxob:xDfmDF9g-yNOjriV-6Anbe6H-MLJ__g6-lo7Dd4f-dhWBW8S-XYGBm'
const proxyEndpoint = 'rpcs://proxy.example/json-rpc'
const rgbInvoice = (amount = 60) =>
  `rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE/schema/~/${blindRecipient}?amount=${amount}&endpoints=${encodeURIComponent(proxyEndpoint)}`

function swapPsbt(outpoints: Array<{ txid: string; vout: number }>) {
  const psbt = new Psbt()
  for (const outpoint of outpoints) {
    psbt.addInput({
      hash: outpoint.txid,
      index: outpoint.vout,
      sequence: 0xffff_ffff,
      witnessUtxo: { value: 1_000, script: Buffer.from(`5120${'11'.repeat(32)}`, 'hex') },
    })
  }
  psbt.addOutput({ script: Buffer.from([0x6a]), value: 0 })
  return psbt.toHex()
}

function createDependencies(): RgbServiceDependencies {
  const stored = new Map<string, unknown>()
  return {
    storage: {
      get: async <T>(key: string) => stored.get(key) as T | undefined,
      set: async <T>(key: string, value: T) => void stored.set(key, value),
      remove: async key => void stored.delete(key),
    },
    stateSource: {
      getSnapshot: vi.fn().mockResolvedValue({
        syncedAt: 1,
        utxos: [
          {
            outpoint: { txid: 'a'.repeat(64), vout: 0 },
            satoshis: 1000,
            scriptPubKey: '5120' + '00'.repeat(32),
            publicKey: '02' + '11'.repeat(32),
            allocations: [
              {
                assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
                amount: '40',
                settled: true,
                spendable: true,
                opId: 'c'.repeat(64),
                assignmentIndex: 0,
                assignmentType: 4000,
              },
            ],
          },
          {
            outpoint: { txid: 'b'.repeat(64), vout: 1 },
            satoshis: 1000,
            scriptPubKey: '5120' + '11'.repeat(32),
            publicKey: '02' + '22'.repeat(32),
            allocations: [
              {
                assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
                amount: '60',
                settled: true,
                spendable: true,
                opId: 'd'.repeat(64),
                assignmentIndex: 0,
                assignmentType: 4000,
              },
            ],
          },
        ],
      }),
      getValidationHistory: vi.fn().mockResolvedValue({
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        consignments: [],
      }),
      syncBroadcast: vi.fn(),
    },
    encoder: {
      prepareTransfer: vi.fn().mockResolvedValue({
        id: 'transfer-1',
        psbt: 'cHNidP8=',
        toSignInputs: [{ index: 0, publicKey: '02' + '11'.repeat(32) }],
        lockedOutpoints: [{ txid: 'b'.repeat(64), vout: 1 }],
      }),
      completeTransfer: vi.fn().mockResolvedValue({
        txid: 'c'.repeat(64),
        rawTx: '02000000000000000000',
        consignments: [
          {
            recipientId: 'recipient',
            payload: 'consignment',
            assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
            opIds: ['d'.repeat(64)],
          },
        ],
      }),
    },
    transport: {
      getEndpoints: vi.fn().mockReturnValue([proxyEndpoint]),
      publishConsignment: vi.fn(),
      getAcknowledgement: vi.fn().mockResolvedValue(true),
    },
    broadcaster: { broadcast: vi.fn().mockResolvedValue('c'.repeat(64)) },
  }
}

describe('RgbService', () => {
  it('reopens an Any Asset receive canceled before its asset was known', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    const storageKey = (service as any).storageKey(wallet)
    await dependencies.storage.set(storageKey, {
      version: 1,
      wallet,
      snapshot: { syncedAt: 0, utxos: [] },
      pending: {},
      pendingReceiveHistory: [{
        transferId: 'receive:any-asset-recipient',
        assetId: '',
        amount: '',
        txid: 'c'.repeat(64),
        createdAt: 1,
        status: 'canceled',
      }],
    })

    await expect(service.open(wallet)).resolves.toBeUndefined()
    expect(service.getPendingReceiveHistory()).toEqual([
      expect.objectContaining({ assetId: '', status: 'canceled' }),
    ])
    expect(await dependencies.storage.get<any>(storageKey)).toMatchObject({
      pendingReceiveHistory: [expect.objectContaining({ assetId: '' })],
    })
  })

  it.each(['canceled', 'rejected'] as const)(
    'normalizes a prefix-only asset ID in %s receive history',
    async status => {
      const dependencies = createDependencies()
      const service = new RgbService(dependencies)
      const storageKey = (service as any).storageKey(wallet)
      await dependencies.storage.set(storageKey, {
        version: 1,
        wallet,
        snapshot: { syncedAt: 0, utxos: [] },
        pending: {},
        pendingReceiveHistory: [{
          transferId: 'receive:recipient',
          assetId: 'rgb:',
          amount: '',
          txid: 'c'.repeat(64),
          createdAt: 1,
          status,
        }],
      })

      await expect(service.open(wallet)).resolves.toBeUndefined()
      expect(service.getPendingReceiveHistory()).toEqual([
        expect.objectContaining({ assetId: '', status }),
      ])
      expect(await dependencies.storage.get<any>(storageKey)).toMatchObject({
        pendingReceiveHistory: [expect.objectContaining({ assetId: '', status })],
      })
    }
  )

  it.each(['settled', 'canceled'] as const)(
    'still rejects a malformed non-empty asset ID in %s receive history',
    async status => {
      const dependencies = createDependencies()
      const service = new RgbService(dependencies)
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const storageKey = (service as any).storageKey(wallet)
      const stored = {
        version: 1,
        wallet,
        snapshot: { syncedAt: 0, utxos: [] },
        pending: {},
        pendingReceiveHistory: [{
          transferId: 'receive:recipient',
          assetId: 'rgb:invalid',
          amount: '1',
          txid: 'c'.repeat(64),
          createdAt: 1,
          status,
        }],
      }
      await dependencies.storage.set(storageKey, stored)

      await expect(service.open(wallet)).rejects.toThrow('RGB receive history contains an invalid asset ID')
      expect(await dependencies.storage.get(storageKey)).toEqual(stored)
      expect(warning).toHaveBeenCalledWith('RGB receive history contains an invalid asset ID', {
        index: 0,
        status,
        assetId: 'rgb:invalid',
      })
      warning.mockRestore()
    }
  )

  it('accepts the shared tb invoice prefix for a Testnet4 wallet', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open({ ...wallet, network: 'testnet4' })
    await service.sync()
    const testnetInvoice = rgbInvoice(40).replace('/bc:', '/tb:')
    vi.mocked(dependencies.encoder.prepareTransfer).mockResolvedValueOnce({
      id: 'transfer-1',
      psbt: 'cHNidP8=',
      toSignInputs: [{ index: 0, publicKey: '02' + '11'.repeat(32) }],
      lockedOutpoints: [{ txid: 'a'.repeat(64), vout: 0 }],
    })

    await expect(service.checkInvoiceAvailability(testnetInvoice)).resolves.toEqual({
      available: true,
    })
    await expect(
      service.prepareSend({
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '40',
        invoice: testnetInvoice,
        feeRate: 2,
      })
    ).resolves.toMatchObject({ id: 'transfer-1' })
  })

  it('rejects an invoice whose transport recipient ID is already occupied', async () => {
    const dependencies = createDependencies()
    dependencies.transport.checkConsignmentAvailability = vi.fn().mockResolvedValue(false)
    const service = new RgbService(dependencies)
    await service.open(wallet)

    await expect(service.checkInvoiceAvailability(rgbInvoice())).rejects.toMatchObject({
      code: 'RGB_INVOICE_UNAVAILABLE',
    })
  })

  it('includes local pending invoice reservations in the UTXO inspection view', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [
      {
        invoice: 'rgb:invoice',
        recipientId: 'recipient-id',
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '50',
        createdAt: 123,
        seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
      },
    ]

    expect(service.getUtxoInspection()).toEqual({
      snapshot: service.getSnapshot(),
      assetMetadata: {},
      invoiceReservations: [
        {
          invoice: 'rgb:invoice',
          recipientId: 'recipient-id',
          assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
          amount: '50',
          expirationTimestamp: undefined,
          createdAt: 123,
          txid: 'a'.repeat(64),
          vout: 0,
        },
      ],
    })
  })

  it('persists provider payment ownership across a restart without checkpointing the origin', async () => {
    const stored = new Map<string, unknown>()
    const checkpoint = vi.fn().mockResolvedValue(undefined)
    const dependencies = createDependencies()
    dependencies.storage = {
      get: async <T>(key: string) => stored.get(key) as T | undefined,
      set: async <T>(key: string, value: T) => void stored.set(key, value),
      remove: async key => void stored.delete(key),
    }
    dependencies.onStatePersisted = checkpoint
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.enableRecoveryBackup()
    checkpoint.mockClear()

    const prepared = await service.prepareSend(
      { assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE', amount: '60', invoice: rgbInvoice(), feeRate: 2 },
      { providerOrigin: 'https://dapp.example' }
    )
    const receive = await service.createWitnessReceive({
      scriptPubKey: `5120${'33'.repeat(32)}`,
      publicKey: `02${'44'.repeat(32)}`,
      providerOrigin: 'https://dapp.example',
    })

    await expect(service.getTransferProviderOrigin(prepared.id)).resolves.toBe(
      'https://dapp.example'
    )

    const restarted = new RgbService(dependencies)
    await restarted.open(wallet)
    await expect(restarted.getTransferProviderOrigin(prepared.id)).resolves.toBe(
      'https://dapp.example'
    )
    expect(
      restarted.getPendingReceives().find(item => item.recipientId === receive.recipientId)
    ).toMatchObject({ providerOrigin: 'https://dapp.example' })

    await restarted.queueFeePoolUtxos([])
    const recovery = checkpoint.mock.calls.at(-1)?.[0] as {
      pending: Record<string, { providerOrigin?: string }>
      pendingReceives?: Array<{ providerOrigin?: string }>
    }
    expect(recovery.pending[prepared.id]?.providerOrigin).toBeUndefined()
    expect(recovery.pendingReceives?.[0]?.providerOrigin).toBeUndefined()

    await restarted.abortSend(prepared.id, { discardUnsigned: true })
    await expect(restarted.getTransferProviderOrigin(prepared.id)).resolves.toBe(
      'https://dapp.example'
    )
  })

  it('removes completed payment ownership after 24 hours', async () => {
    let now = 1_000
    const stored = new Map<string, unknown>()
    const dependencies = createDependencies()
    dependencies.now = () => now
    dependencies.storage = {
      get: async <T>(key: string) => stored.get(key) as T | undefined,
      set: async <T>(key: string, value: T) => void stored.set(key, value),
      remove: async key => void stored.delete(key),
    }
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    const prepared = await service.prepareSend(
      { assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE', amount: '60', invoice: rgbInvoice(), feeRate: 2 },
      { providerOrigin: 'https://dapp.example' }
    )

    await service.abortSend(prepared.id)
    await expect(service.getTransferProviderOrigin(prepared.id)).resolves.toBe(
      'https://dapp.example'
    )

    now += 24 * 60 * 60 * 1000
    const restarted = new RgbService(dependencies)
    await restarted.open(wallet)
    expect(restarted.getPendingSendHistory()[0]).toMatchObject({ transferId: prepared.id })
    expect(restarted.getPendingSendHistory()[0]).not.toHaveProperty('providerOrigin')
  })

  it('does not release an invoice after a consignment is awaiting acceptance', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [
      {
        invoice: 'rgb:invoice',
        recipientId: 'recipient-id',
        seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
        pendingAccept: { payload: 'consignment', txid: 'b'.repeat(64), endpoint: proxyEndpoint },
      },
    ]

    await expect(service.cancelBlindReceive('recipient-id')).resolves.toEqual({ cancelled: false })
    expect(service.getPendingReceives()).toHaveLength(1)
  })

  it('records a release tombstone in the recovery state', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [{ recipientId: 'released-recipient', createdAt: 1 }]

    await expect(service.cancelBlindReceive('released-recipient')).resolves.toEqual({
      cancelled: true,
    })
    expect(service.exportRecoveryState()).toMatchObject({
      pendingReceives: [],
      releasedReceiveRecipientIds: ['released-recipient'],
    })
  })

  it('deletes an unused witness invoice and records a recovery tombstone', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [
      { recipientId: 'witness-recipient', recipientType: 'witness', createdAt: 1 },
    ]

    await expect(service.removePendingReceive('witness-recipient')).resolves.toEqual({
      cancelled: true,
    })
    expect(service.exportRecoveryState()).toMatchObject({
      pendingReceives: [],
      releasedReceiveRecipientIds: ['witness-recipient'],
    })
  })

  it('records a terminal receive tombstone after settlement is abandoned', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [
      {
        recipientId: 'settled-on-another-device',
        createdAt: 1,
        receivedConsignment: { txid: 'a'.repeat(64), receivedAt: 1, accepted: true },
      },
    ]

    await expect(service.abandonAcceptedReceive('settled-on-another-device')).resolves.toEqual({
      abandoned: true,
      recipientId: 'settled-on-another-device',
    })
    expect(service.exportRecoveryState()).toMatchObject({
      pendingReceives: [],
      releasedReceiveRecipientIds: ['settled-on-another-device'],
    })
  })

  it('rolls back an invoice release when its recovery checkpoint cannot be saved', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.enableRecoveryBackup()
    ;(service as any).state.pendingReceives = [{ recipientId: 'recipient-id', createdAt: 1 }]
    dependencies.onStatePersisted = vi.fn().mockRejectedValue(new Error('recovery unavailable'))

    await expect(service.cancelBlindReceive('recipient-id')).rejects.toThrow('recovery unavailable')
    expect(service.getPendingReceives()).toHaveLength(1)
    expect(service.exportRecoveryState()).not.toHaveProperty('releasedReceiveRecipientIds')
  })

  it('excludes active blind-invoice seals from NIA issuance funding UTXOs', async () => {
    const dependencies = createDependencies()
    const fundingUtxos = Array.from({ length: 5 }, (_, vout) => ({
      outpoint: { txid: String(vout + 1).repeat(64), vout },
      satoshis: 330,
      scriptPubKey: `5120${String(vout + 1).repeat(64)}`,
      publicKey: `02${String(vout + 1).repeat(64)}`,
      chainStatus: 'confirmed' as const,
      allocations: [],
    }))
    vi.mocked(dependencies.stateSource.getSnapshot).mockResolvedValue({
      syncedAt: 1,
      utxos: fundingUtxos,
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()

    const receive = await service.createBlindReceive({ assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE', amount: '1' })
    const issueFunding = service.getAvailableIssueUtxos()

    expect(receive.seal).toMatchObject(fundingUtxos[0]!.outpoint)
    expect(issueFunding).toHaveLength(4)
    expect(issueFunding.map(utxo => utxo.outpoint)).not.toContainEqual(receive.seal)
  })

  it('persists a witness invoice without requiring a blind seal', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    const witness = await service.createWitnessReceive({
      scriptPubKey: '512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      publicKey: `02${'11'.repeat(32)}`,
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '1',
    })
    expect(witness.recipientType).toBe('witness')
    expect(witness).not.toHaveProperty('seal')
    expect(witness.proxyRecipientId).toMatch(/^[0-9a-f]{64}$/)

    const reopened = new RgbService(dependencies)
    await reopened.open(wallet)
    expect(reopened.getPendingReceives()).toContainEqual(
      expect.objectContaining({
        proxyRecipientId: witness.proxyRecipientId,
        recipientType: 'witness',
      })
    )
    expect(reopened.getUtxoInspection().invoiceReservations).toContainEqual(
      expect.objectContaining({
        invoice: witness.invoice,
        recipientId: witness.recipientId,
        proxyRecipientId: witness.proxyRecipientId,
      })
    )
    ;(reopened as any).state.pendingReceives[0].witnessPublicKey = undefined
    await expect(reopened.backfillWitnessReceivePublicKey(`02${'22'.repeat(32)}`)).resolves.toEqual(
      {
        changed: true,
      }
    )
    expect(reopened.getPendingReceives()[0]?.witnessPublicKey).toBe(`02${'22'.repeat(32)}`)
  })

  it('persists locally broadcast funding UTXOs until the indexer replacement succeeds', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    const fundingUtxo = {
      outpoint: { txid: 'f'.repeat(64), vout: 1 },
      satoshis: 1_000,
      scriptPubKey: '5120' + 'ff'.repeat(32),
      publicKey: '02' + '33'.repeat(32),
      allocations: [],
    }

    await service.queueUtxoSync({ txid: fundingUtxo.outpoint.txid, outpoints: [fundingUtxo] })
    const restoredService = new RgbService(dependencies)
    await restoredService.open(wallet)

    expect(restoredService.getSnapshot().utxos).toContainEqual(
      expect.objectContaining({ ...fundingUtxo, chainStatus: 'mempool' })
    )
    expect(restoredService.getPendingUtxoSync()).toMatchObject({
      txid: fundingUtxo.outpoint.txid,
      outpoints: expect.arrayContaining([expect.objectContaining(fundingUtxo)]),
    })
    await restoredService.sync()
    expect(dependencies.stateSource.getSnapshot).toHaveBeenCalledTimes(1)

    await restoredService.markUtxoSyncCompleted(fundingUtxo.outpoint.txid)
    await restoredService.sync()
    expect(dependencies.stateSource.getSnapshot).toHaveBeenCalledTimes(2)
  })

  it('refreshes the wallet snapshot while received asset metadata is waiting to be indexed', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingAssetMetadata = [
      {
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        metadata: { ticker: 'TOK', name: 'Token', precision: 0, schema: 'NIA', issuedSupply: '1' },
      },
    ]

    await service.sync()

    expect(dependencies.stateSource.getSnapshot).toHaveBeenCalledTimes(1)
  })

  it('restores a recovery checkpoint only for the exact opened wallet context', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    const recovery = {
      version: 1 as const,
      wallet,
      snapshot: {
        syncedAt: 1,
        utxos: [
          {
            outpoint: { txid: 'a'.repeat(64), vout: 0 },
            satoshis: 330,
            scriptPubKey: '5120' + '11'.repeat(32),
            publicKey: '02' + '22'.repeat(32),
            allocations: [],
          },
        ],
      },
      pending: {},
    }

    await expect(service.restoreRecoveryState(recovery)).resolves.toBe(true)
    expect(service.getSnapshot().utxos).toHaveLength(1)
    expect(service.getRecoveryCheckpointStatus()).toEqual({ dirty: false, verified: true })
    await expect(
      service.restoreRecoveryState({
        ...recovery,
        wallet: { ...wallet, fundingAddress: 'bc1p-other' },
      })
    ).resolves.toBe(false)
    await expect(
      service.restoreRecoveryState({ ...recovery, wallet: { ...wallet, network: 'testnet' } })
    ).resolves.toBe(false)
    await expect(
      service.restoreRecoveryState({ ...recovery, wallet: { ...wallet, walletId: 'rgb-wallet-2' } })
    ).resolves.toBe(false)
    await expect(
      service.restoreRecoveryState({
        ...recovery,
        snapshot: { ...recovery.snapshot, syncedAt: -1 },
      })
    ).rejects.toThrow('RGB recovery checkpoint snapshot is invalid')
  })

  it('restores issuance history with wallet API RGB20 order IDs', async () => {
    const service = new RgbService(createDependencies())
    await service.open(wallet)
    const assetId = 'rgb:BgYGBgYG-BgYGBgY-GBgYGBg-YGBgYGB-gYGBgYG-BgYGBgY'
    const issue = {
      assetId,
      orderId: '202610-RGB20-ABC12345',
      amount: '1',
      txid: 'a'.repeat(64),
      createdAt: 1,
      asset: { ticker: 'ISS', name: 'Issued', precision: 0, schema: 'NIA', issuedSupply: '1' },
    }
    const recovery = {
      version: 1 as const,
      wallet,
      snapshot: { syncedAt: 1, utxos: [] },
      pending: {},
      issueHistory: [issue],
    }

    await expect(service.restoreRecoveryState(recovery)).resolves.toBe(true)
    expect(service.getIssueHistory()).toEqual([issue])
    await expect(
      service.restoreRecoveryState({
        ...recovery,
        issueHistory: [{ ...issue, orderId: 'f7f0e1f0-0000-4000-8000-000000000001' }],
      })
    ).resolves.toBe(true)
    await expect(
      service.restoreRecoveryState({
        ...recovery,
        issueHistory: [{ ...issue, orderId: 'invalid-order-id' }],
      })
    ).rejects.toThrow('RGB recovery checkpoint contains an invalid issue history item')
  })

  it('adopts a newer normal checkpoint without interpreting its RGB state machine', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.recoveryCheckpoint = { dirty: false, verified: true }
    ;(service as any).state.recoveryCheckpointGeneration = 4

    expect(service.canAdoptNewerNormalRecoveryCheckpoint()).toBe(true)
    ;(service as any).state.recoveryCheckpoint.dirty = true
    expect(service.canAdoptNewerNormalRecoveryCheckpoint()).toBe(false)
  })

  it('recognizes an identical remote checkpoint despite local recovery metadata', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    const recovery = {
      version: 1 as const,
      wallet,
      snapshot: { syncedAt: 1, utxos: [] },
      pending: {
        transfer: { request: { assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE' }, prepared: {}, createdAt: 1 },
      },
    }

    await expect(service.restoreRecoveryState(recovery)).resolves.toBe(true)
    await service.setRecoveryCheckpointRevision('a'.repeat(24))
    expect(service.matchesRecoveryState(recovery)).toBe(true)
    expect(
      service.matchesRecoveryState({
        ...recovery,
        pending: { ...recovery.pending, other: recovery.pending.transfer },
      })
    ).toBe(false)
  })

  it('leaves the live state untouched when atomic recovery persistence fails', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    const recovery = {
      version: 1 as const,
      wallet,
      snapshot: {
        syncedAt: 1,
        utxos: [
          {
            outpoint: { txid: 'a'.repeat(64), vout: 0 },
            satoshis: 330,
            scriptPubKey: '5120' + '11'.repeat(32),
            publicKey: '02' + '22'.repeat(32),
            allocations: [],
          },
        ],
      },
      pending: {},
    }
    dependencies.storage.set = vi.fn().mockRejectedValue(new Error('storage unavailable'))

    await expect(service.restoreRecoveryState(recovery)).rejects.toThrow('storage unavailable')
    expect(service.getSnapshot()).toEqual({ utxos: [], syncedAt: 0 })
  })

  it('does not read wallet-api claimed consignments during proxy-only receive polling', async () => {
    const dependencies = createDependencies()
    dependencies.stateSource.getClaimedConsignments = vi.fn().mockResolvedValue([])
    const service = new RgbService(dependencies)
    await service.open(wallet)

    await service.processClaimedReceives({ includeClaimed: false })

    expect(dependencies.stateSource.getClaimedConsignments).not.toHaveBeenCalled()
  })

  it('uses the optional batched proxy lookup for pending receive invoices', async () => {
    const dependencies = createDependencies()
    const getConsignments = vi.fn().mockResolvedValue([])
    dependencies.transport.getConsignments = getConsignments
    dependencies.transport.getConsignment = vi.fn()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [
      {
        invoice: rgbInvoice(),
        recipientId: 'recipient',
        createdAt: 1,
        seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
      },
    ]

    await (service as any).getProxyConsignments()

    expect(getConsignments).toHaveBeenCalledWith([
      { recipientId: 'recipient', endpoints: [proxyEndpoint] },
    ])
    expect(dependencies.transport.getConsignment).not.toHaveBeenCalled()
  })

  it('claims each pending invoice only once after the recovery service accepts it', async () => {
    const dependencies = createDependencies()
    const claimConsignments = vi.fn().mockResolvedValue(1)
    dependencies.stateSource.claimConsignments = claimConsignments
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [
      {
        invoice: rgbInvoice(),
        recipientId: 'recipient-1',
        createdAt: 1,
        seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
      },
      {
        invoice: rgbInvoice(),
        recipientId: 'recipient-2',
        createdAt: 1,
        seal: { txid: 'b'.repeat(64), vout: 1, blinding: 2n },
      },
    ]

    await expect(service.claimPendingReceives()).resolves.toEqual({ claimed: 2 })
    await expect(service.claimPendingReceives()).resolves.toEqual({ claimed: 0 })

    const reopened = new RgbService(dependencies)
    await reopened.open(wallet)
    await expect(reopened.claimPendingReceives()).resolves.toEqual({ claimed: 0 })

    expect(claimConsignments).toHaveBeenCalledTimes(2)
    expect((service as any).state.pendingReceives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ recipientId: 'recipient-1', claimedAt: expect.any(Number) }),
        expect.objectContaining({ recipientId: 'recipient-2', claimedAt: expect.any(Number) }),
      ])
    )
  })

  it('queues metadata from a validated receive before the user accepts it', async () => {
    const dependencies = createDependencies()
    dependencies.transport.getConsignment = vi.fn().mockResolvedValue({
      recipientId: 'recipient',
      payload: 'received-consignment',
      txid: 'c'.repeat(64),
      endpoint: proxyEndpoint,
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [
      {
        invoice: rgbInvoice(),
        recipientId: 'recipient',
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60',
        createdAt: 1,
        seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
      },
    ]
    const metadata = {
      ticker: 'TOK',
      name: 'Received Token',
      precision: 2,
      schema: 'NIA',
      issuedSupply: '1000',
    }
    ;(service as any).validateIncomingConsignment = vi.fn().mockReturnValue({
      decoded: { metadata },
      assetId: 'rgb:ByzWWOsh-yWg6Im0-FB8oump-lf5bv7o-mJTgBls-Z~CmcZ8',
      amount: '60',
      txid: 'c'.repeat(64),
      opId: 'd'.repeat(64),
      assignmentIndex: 0,
    })

    await expect(service.processClaimedReceives({ includeClaimed: false })).resolves.toMatchObject({
      received: 0,
    })
    expect(service.getPendingAssetMetadata()).toEqual([
      {
        assetId: 'rgb:ByzWWOsh-yWg6Im0-FB8oump-lf5bv7o-mJTgBls-Z~CmcZ8',
        metadata,
      },
    ])
    expect(service.getPendingReceives()[0]?.pendingAccept).toMatchObject({
      assetId: 'rgb:ByzWWOsh-yWg6Im0-FB8oump-lf5bv7o-mJTgBls-Z~CmcZ8',
      amount: '60',
      precision: 2,
    })

    const reopened = new RgbService(dependencies)
    await reopened.open(wallet)
    expect(reopened.getPendingAssetMetadata()).toEqual(service.getPendingAssetMetadata())
  })

  it('does not requeue indexed metadata while polling the same pending receive', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [
      {
        invoice: rgbInvoice(),
        recipientId: 'recipient',
        createdAt: 1,
        seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
        pendingAccept: {
          payload: 'consignment',
          txid: 'c'.repeat(64),
          endpoint: proxyEndpoint,
          assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
          amount: '60',
          precision: 2,
          discoveredAt: 1,
        },
      },
    ]
    ;(service as any).state.pendingAssetMetadata = [
      {
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        metadata: { ticker: 'TOK', name: 'Token', precision: 0, schema: 'NIA', issuedSupply: '60' },
      },
    ]

    await service.markAssetMetadataSynced('rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE')

    expect((service as any).state.pendingReceives[0]).toMatchObject({ assetMetadataIndexed: true })
    expect(service.getPendingAssetMetadata()).toEqual([])
    expect(service.getLocalAssetDetail('rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE')).toMatchObject({
      ticker: 'TOK', name: 'Token', precision: 0,
    })
    const reopened = new RgbService(dependencies)
    await reopened.open(wallet)
    expect(reopened.getPendingAssetMetadata()).toEqual([])
    expect(reopened.getLocalAssetDetail('rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE')).toMatchObject({
      ticker: 'TOK', name: 'Token', precision: 0,
    })
    dependencies.transport.getConsignment = vi.fn().mockResolvedValue({
      recipientId: 'recipient',
      payload: 'consignment',
      txid: 'c'.repeat(64),
      endpoint: proxyEndpoint,
    })
    ;(service as any).validateIncomingConsignment = vi.fn().mockReturnValue({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      txid: 'c'.repeat(64),
      decoded: {
        metadata: { ticker: 'TOK', name: 'Token', precision: 0, schema: 'NIA', issuedSupply: '60' },
      },
    })

    await service.processClaimedReceives({ includeClaimed: false })

    expect(service.getPendingAssetMetadata()).toEqual([])
  })

  it('recovers the name from an accepted receipt when an older wallet already removed indexed metadata', async () => {
    const genesis = encodeNiaGenesis({
      ticker: 'ARRIVE',
      name: 'Arriving Asset',
      precision: 2,
      timestamp: 1_713_261_744,
      network: 'mainnet',
      allocations: [{ txid: 'a'.repeat(64), vout: 0, blinding: 1n, amount: 100n }],
    })
    const assetId = encodeRgbContractId(genesis.assetId)
    const service = new RgbService(createDependencies())
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [{
      recipientId: 'recipient',
      createdAt: 1,
      receivedConsignment: {
        accepted: true,
        assetId,
        amount: '2',
        txid: 'b'.repeat(64),
        receivedAt: 1,
        payload: Buffer.from(encodeNiaContract(genesis).strict).toString('base64'),
      },
    }]

    expect(service.getLocalAssetBalance(assetId)).toMatchObject({
      ticker: 'ARRIVE', name: 'Arriving Asset', precision: 2,
      pending: '2', incomingPending: '2', spendable: '0',
    })
  })

  it('exports a history-free NIA contract from local wallet state', async () => {
    const genesis = encodeNiaGenesis({
      ticker: 'USDT',
      name: 'Test USDT',
      precision: 6,
      timestamp: 1_713_261_744,
      network: 'mainnet',
      allocations: [{ txid: 'a'.repeat(64), vout: 0, blinding: 1n, amount: 100n }],
    })
    const assetId = encodeRgbContractId(genesis.assetId)
    const service = new RgbService(createDependencies())
    await service.open(wallet)
    await service.storeContract(assetId, encodeNiaContract(genesis).strict, genesis.strict)

    const exported = service.exportContractConsignment(assetId)
    const decoded = decodeNiaConsignment(exported)
    expect(decoded.assetId).toBe(assetId)
    expect(decoded.transfer).toBe(false)
    expect(decoded.witnessBundles).toEqual([])
    expect(decoded.terminals).toEqual([])
    expect(decoded.metadata).toMatchObject({ ticker: 'USDT', name: 'Test USDT', precision: 6 })
    expect(() => service.exportContractConsignment(encodeRgbContractId(new Uint8Array(32))))
      .toThrow('is not known locally')
  })

  it('archives an invalid receive when the proxy ACK is already immutable', async () => {
    const dependencies = createDependencies()
    dependencies.transport.getConsignment = vi.fn().mockResolvedValue({
      recipientId: 'recipient',
      payload: 'invalid-consignment',
      txid: 'c'.repeat(64),
      endpoint: proxyEndpoint,
    })
    dependencies.transport.acknowledgeConsignment = vi
      .fn()
      .mockRejectedValue(new Error('RGB proxy ack.post failed: Cannot change ACK'))
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [
      {
        invoice: rgbInvoice(),
        recipientId: 'recipient',
        createdAt: 1,
        seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
      },
    ]
    ;(service as any).validateIncomingConsignment = vi.fn().mockReturnValue(undefined)

    await expect(service.processClaimedReceives({ includeClaimed: false })).resolves.toMatchObject({
      received: 0,
    })

    expect(service.getPendingReceives()).toEqual([])
    expect(service.getPendingReceiveHistory()).toEqual([
      expect.objectContaining({ status: 'rejected', txid: 'c'.repeat(64) }),
    ])
  })

  it('keeps an acknowledged receive pending when local settlement fails', async () => {
    const dependencies = createDependencies()
    dependencies.transport.acknowledgeConsignment = vi.fn()
    dependencies.transport.getConsignment = vi.fn().mockResolvedValue({
      recipientId: 'recipient',
      payload: 'consignment',
      txid: 'c'.repeat(64),
      endpoint: proxyEndpoint,
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [
      {
        invoice: rgbInvoice(),
        recipientId: 'recipient',
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60',
        createdAt: 1,
        seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
        receivedConsignment: {
          txid: 'c'.repeat(64),
          receivedAt: 1,
          accepted: true,
          payload: 'consignment',
          endpoint: proxyEndpoint,
        },
      },
    ]
    ;(service as any).validateIncomingConsignment = vi.fn().mockReturnValue({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      txid: 'c'.repeat(64),
      decoded: {
        metadata: { ticker: 'TOK', name: 'Token', precision: 0, schema: 'NIA', issuedSupply: '60' },
      },
    })
    vi.spyOn(service as any, 'advanceAcceptedReceive').mockRejectedValue(
      new RgbServiceError('RGB history has conflicting Transition data')
    )

    await expect(service.processClaimedReceives({ includeClaimed: false })).resolves.toMatchObject({
      received: 0,
    })

    expect(dependencies.transport.acknowledgeConsignment).not.toHaveBeenCalled()
    expect(service.getPendingReceives()).toEqual([
      expect.objectContaining({
        recipientId: 'recipient',
        receivedConsignment: expect.objectContaining({ accepted: true }),
      }),
    ])
    expect(service.getPendingReceiveHistory()).toEqual([])
  })

  it('does not downgrade a settled receive history record during a later proxy poll', () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    ;(service as any).state = {
      version: 1,
      wallet,
      snapshot: { syncedAt: 0, utxos: [] },
      pending: {},
      pendingReceiveHistory: [
        {
          transferId: 'receive:recipient',
          assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
          amount: '60',
          txid: 'c'.repeat(64),
          createdAt: 1,
          status: 'settled',
        },
      ],
    }
    ;(service as any).recordReceiveOutcome(
      { recipientId: 'recipient', createdAt: 1 },
      'rejected',
      'c'.repeat(64)
    )

    expect(service.getPendingReceiveHistory()).toEqual([
      expect.objectContaining({ status: 'settled' }),
    ])
  })

  it('coalesces concurrent snapshot synchronizations', async () => {
    const dependencies = createDependencies()
    let releaseSnapshot: (() => void) | undefined
    const snapshot: RgbWalletSnapshot = { syncedAt: 1, utxos: [] }
    vi.mocked(dependencies.stateSource.getSnapshot).mockImplementation(
      () =>
        new Promise<RgbWalletSnapshot>(resolve => {
          releaseSnapshot = () => resolve(snapshot)
        })
    )
    const service = new RgbService(dependencies)
    await service.open(wallet)

    const synchronizations = [service.sync(), service.sync(), service.sync()]
    expect(dependencies.stateSource.getSnapshot).toHaveBeenCalledTimes(1)

    releaseSnapshot!()
    await expect(Promise.all(synchronizations)).resolves.toEqual([snapshot, snapshot, snapshot])
  })

  it('does not checkpoint when a snapshot refresh only advances syncedAt or returns an unverified empty replica', async () => {
    const dependencies = createDependencies()
    const checkpoint = vi.fn().mockResolvedValue({ verified: true })
    dependencies.onStatePersisted = checkpoint
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.enableRecoveryBackup()

    expect(checkpoint).toHaveBeenCalledTimes(1)

    const unchanged = {
      ...(await vi.mocked(dependencies.stateSource.getSnapshot)(wallet)),
      syncedAt: 2,
    }
    vi.mocked(dependencies.stateSource.getSnapshot).mockResolvedValueOnce(unchanged)
    await service.sync()

    expect(service.getSnapshot().syncedAt).toBe(2)
    expect(checkpoint).toHaveBeenCalledTimes(1)

    vi.mocked(dependencies.stateSource.getSnapshot).mockResolvedValueOnce({
      syncedAt: 3,
      utxos: [],
    })
    await service.sync()

    // A wiped/rebuilding indexer must not erase the durable local allocations
    // until their spent status is independently confirmed.
    expect(service.getSnapshot().syncedAt).toBe(2)
    expect(service.getSnapshot().utxos).toHaveLength(2)
    expect(checkpoint).toHaveBeenCalledTimes(1)
  })

  it('clears local allocations for an empty snapshot after every local UTXO is confirmed terminal', async () => {
    const dependencies = createDependencies()
    dependencies.stateSource.getTransactionStatus = vi.fn().mockResolvedValue({
      status: 'spent',
      confirmations: 1,
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()

    vi.mocked(dependencies.stateSource.getSnapshot).mockResolvedValueOnce({
      syncedAt: 2,
      utxos: [],
    })
    await service.sync()

    expect(dependencies.stateSource.getTransactionStatus).toHaveBeenCalledTimes(2)
    expect(service.getSnapshot()).toEqual({ syncedAt: 2, utxos: [] })
  })

  it('derives asset list, balance, and detail from local allocations and contract metadata', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    ;(service as any).state.contracts = {
      'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE': {
        consignment: 'local-consignment',
        createdAt: 1,
        metadata: {
          ticker: 'TOK',
          name: 'Local token',
          precision: 8,
          schema: 'NIA',
          issuedSupply: '100',
        },
      },
    }

    expect(service.getLocalAssetList(1, 20)).toEqual({
      total: 1,
      list: [
        expect.objectContaining({
          assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
          balance: '100',
          settled: '100',
          spendable: '100',
          pending: '0',
          ticker: 'TOK',
          name: 'Local token',
          precision: 8,
        }),
      ],
    })
    expect(service.getLocalAssetBalance('rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE')).toMatchObject({ balance: '100' })
    expect(service.getLocalAssetDetail('rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE')).toMatchObject({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      name: 'Local token',
      issuedSupply: '100',
    })
  })

  it('rejects an endpoint-less invoice before locking RGB allocations', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()

    await expect(
      service.prepareSend({
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60',
        invoice: `rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE/schema/~/${blindRecipient}?amount=60`,
        feeRate: 2,
      })
    ).rejects.toThrow('RGB invoice has no proxy transport endpoint')

    expect(dependencies.encoder.prepareTransfer).not.toHaveBeenCalled()
    expect(service.getPendingTransfers()).toEqual([])
  })

  it('refuses to prepare a transfer when a selected outpoint is no longer spendable', async () => {
    const dependencies = createDependencies()
    dependencies.stateSource.verifyUtxos = vi.fn().mockResolvedValue([
      {
        outpoint: { txid: 'a'.repeat(64), vout: 0 },
        status: 'spent',
        confirmations: 0,
      },
    ])
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()

    await expect(
      service.prepareSend({
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '40',
        invoice: rgbInvoice(40),
        feeRate: 2,
      })
    ).rejects.toThrow('Selected RGB allocation is no longer spendable')
    expect(dependencies.encoder.prepareTransfer).not.toHaveBeenCalled()
  })

  it('serializes concurrent send preparation before selecting RGB allocations', async () => {
    const dependencies = createDependencies()
    let releaseHistory: (() => void) | undefined
    let signalHistoryStarted: (() => void) | undefined
    const historyStarted = new Promise<void>(resolve => (signalHistoryStarted = resolve))
    vi.mocked(dependencies.stateSource.getValidationHistory).mockImplementationOnce(
      () =>
        new Promise<RgbValidationHistory>(resolve => {
          signalHistoryStarted!()
          releaseHistory = () => resolve({ assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE', consignments: [] })
        })
    )
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()

    const first = service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      invoice: rgbInvoice(),
      feeRate: 2,
    })
    await historyStarted
    const second = service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      invoice: rgbInvoice(),
      feeRate: 2,
    })
    releaseHistory!()

    await expect(first).resolves.toMatchObject({ id: 'transfer-1' })
    await expect(second).rejects.toBeInstanceOf(RgbInsufficientBalanceError)
    expect(dependencies.encoder.prepareTransfer).toHaveBeenCalledTimes(1)
    expect(service.getPendingTransfers()).toHaveLength(1)
  })

  it('reuses an unsent prepared swap and excludes its lock from displayed spendable balance', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    const request = {
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      invoice: rgbInvoice(),
      feeRate: 2,
      swapPsbt: swapPsbt([{ txid: 'b'.repeat(64), vout: 1 }]),
    }

    const first = await service.prepareSend(request, { providerOrigin: 'https://market.example' })
    const retried = await service.prepareSend(request, { providerOrigin: 'https://market.example' })

    expect(retried).toEqual(first)
    expect(dependencies.encoder.prepareTransfer).toHaveBeenCalledTimes(1)
    expect(service.getLocalAssetBalance('rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE')?.spendable).toBe('40')
  })

  it('selects RGB allocations only from inputs committed by a swap PSBT', async () => {
    const dependencies = createDependencies()
    vi.mocked(dependencies.stateSource.getSnapshot).mockResolvedValue({
      syncedAt: 1,
      utxos: [
        {
          outpoint: { txid: 'a'.repeat(64), vout: 0 },
          satoshis: 1_000,
          scriptPubKey: `5120${'11'.repeat(32)}`,
          publicKey: `02${'11'.repeat(32)}`,
          allocations: [
            {
              assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
              amount: '20',
              settled: true,
              spendable: true,
              opId: '1'.repeat(64),
              assignmentIndex: 0,
              assignmentType: 4000,
            },
          ],
        },
        {
          outpoint: { txid: 'b'.repeat(64), vout: 1 },
          satoshis: 1_000,
          scriptPubKey: `5120${'22'.repeat(32)}`,
          publicKey: `02${'22'.repeat(32)}`,
          allocations: [
            {
              assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
              amount: '60',
              settled: true,
              spendable: true,
              opId: '2'.repeat(64),
              assignmentIndex: 0,
              assignmentType: 4000,
            },
          ],
        },
        {
          outpoint: { txid: 'c'.repeat(64), vout: 2 },
          satoshis: 1_000,
          scriptPubKey: `5120${'33'.repeat(32)}`,
          publicKey: `02${'33'.repeat(32)}`,
          allocations: [
            {
              assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
              amount: '40',
              settled: true,
              spendable: true,
              opId: '3'.repeat(64),
              assignmentIndex: 0,
              assignmentType: 4000,
            },
          ],
        },
      ],
    })
    vi.mocked(dependencies.encoder.prepareTransfer).mockResolvedValueOnce({
      id: 'transfer-swap-subset',
      psbt: 'cHNidP8=',
      toSignInputs: [],
      lockedOutpoints: [
        { txid: 'a'.repeat(64), vout: 0 },
        { txid: 'c'.repeat(64), vout: 2 },
      ],
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()

    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      invoice: rgbInvoice(),
      feeRate: 2,
      swapPsbt: swapPsbt([
        { txid: 'a'.repeat(64), vout: 0 },
        { txid: 'c'.repeat(64), vout: 2 },
      ]),
    })

    expect(dependencies.encoder.prepareTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedUtxos: [
          expect.objectContaining({ outpoint: { txid: 'a'.repeat(64), vout: 0 } }),
          expect.objectContaining({ outpoint: { txid: 'c'.repeat(64), vout: 2 } }),
        ],
      })
    )
  })

  it('rejects a swap PSBT whose committed RGB inputs do not cover the amount', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()

    await expect(
      service.prepareSend({
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60',
        invoice: rgbInvoice(),
        feeRate: 2,
        swapPsbt: swapPsbt([{ txid: 'a'.repeat(64), vout: 0 }]),
      })
    ).rejects.toBeInstanceOf(RgbInsufficientBalanceError)
    expect(dependencies.encoder.prepareTransfer).not.toHaveBeenCalled()
  })

  it('reserves a fee-pool input while its RGB transfer is pending', async () => {
    const dependencies = createDependencies()
    const feeUtxos = [
      {
        outpoint: { txid: 'e'.repeat(64), vout: 0 },
        satoshis: 10_000,
        scriptPubKey: '5120' + '44'.repeat(32),
        publicKey: '02' + '44'.repeat(32),
      },
      {
        outpoint: { txid: 'f'.repeat(64), vout: 0 },
        satoshis: 10_000,
        scriptPubKey: '5120' + '55'.repeat(32),
        publicKey: '02' + '55'.repeat(32),
      },
    ]
    dependencies.feeSource = {
      getFeeFunding: vi.fn().mockResolvedValue({
        utxos: feeUtxos,
        changeScriptPubKey: '5120' + '66'.repeat(32),
        changeDustLimit: 330,
      }),
    }
    let nextId = 0
    const feeFunding = vi
      .mocked(dependencies.encoder.prepareTransfer)
      .mockImplementation(async input => {
        nextId++
        return {
          id: `transfer-${nextId}`,
          psbt: 'cHNidP8=',
          toSignInputs: [],
          lockedOutpoints: [input.selectedUtxos[0]!.outpoint],
          feeOutpoints: [input.feeFunding!.utxos[0]!.outpoint],
        }
      })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()

    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '40',
      invoice: rgbInvoice(40),
      feeRate: 2,
    })
    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      invoice: rgbInvoice(60),
      feeRate: 2,
    })

    expect(feeFunding.mock.calls[1]![0].feeFunding?.utxos).toEqual([feeUtxos[1]])
  })

  it('persists an issuance outbox and retains its local allocation until indexed', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    const outpoints = [
      {
        outpoint: { txid: 'f'.repeat(64), vout: 0 },
        satoshis: 330,
        scriptPubKey: '5120' + '33'.repeat(32),
        publicKey: '02' + '33'.repeat(32),
        chainStatus: 'confirmed' as const,
        allocations: [
          {
            assetId: 'rgb:BgYGBgYG-BgYGBgY-GBgYGBg-YGBgYGB-gYGBgYG-BgYGBgY',
            amount: '1',
            settled: true,
            spendable: true,
            opId: 'e'.repeat(64),
            assignmentIndex: 0,
            assignmentType: 4000,
          },
        ],
      },
    ]

    await service.queueIssue({
      assetId: 'rgb:BgYGBgYG-BgYGBgY-GBgYGBg-YGBgYGB-gYGBgYG-BgYGBgY',
      contract: Uint8Array.from([1]),
      genesis: Uint8Array.from([2]),
      asset: {
        ticker: 'ISS',
        name: 'Issued',
        precision: 0,
        schema: 'NIA',
        issuedSupply: '1',
      },
      utxoSync: { txid: outpoints[0]!.outpoint.txid, outpoints },
    })

    await service.sync()
    expect(dependencies.stateSource.getSnapshot).not.toHaveBeenCalled()
    expect(service.getSnapshot().utxos).toEqual(outpoints)

    const reopened = new RgbService(dependencies)
    await reopened.open(wallet)
    expect(reopened.getPendingIssues()).toEqual([
      expect.objectContaining({
        assetId: 'rgb:BgYGBgYG-BgYGBgY-GBgYGBg-YGBgYGB-gYGBgYG-BgYGBgY',
        utxoSync: { txid: outpoints[0]!.outpoint.txid, outpoints },
      }),
    ])
    expect(reopened.getIssueHistory()).toEqual([
      expect.objectContaining({
        assetId: 'rgb:BgYGBgYG-BgYGBgY-GBgYGBg-YGBgYGB-gYGBgYG-BgYGBgY',
        amount: '1',
        txid: outpoints[0]!.outpoint.txid,
        chainStatus: 'confirmed',
        asset: expect.objectContaining({ ticker: 'ISS', name: 'Issued' }),
      }),
    ])
    ;(reopened as any).state.snapshot.utxos[0].chainStatus = 'mempool'
    expect(reopened.getIssueHistory()).toEqual([
      expect.objectContaining({ assetId: 'rgb:BgYGBgYG-BgYGBgY-GBgYGBg-YGBgYGB-gYGBgYG-BgYGBgY', chainStatus: 'mempool' }),
    ])
    ;(reopened as any).state.snapshot.utxos[0].chainStatus = 'confirmed'
    await reopened.markIssueSynced('rgb:BgYGBgYG-BgYGBgY-GBgYGBg-YGBgYGB-gYGBgYG-BgYGBgY')
    expect(reopened.getIssueHistory()).toHaveLength(1)
    expect(reopened.getSnapshot().utxos).toEqual(outpoints)
  })

  it('rolls back an issuance when its recovery checkpoint fails', async () => {
    const dependencies = createDependencies()
    const checkpoint = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('recovery unavailable'))
    dependencies.onStatePersisted = checkpoint
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.enableRecoveryBackup()
    const outpoints = [
      {
        outpoint: { txid: 'f'.repeat(64), vout: 0 },
        satoshis: 330,
        scriptPubKey: '5120' + '33'.repeat(32),
        publicKey: '02' + '33'.repeat(32),
        chainStatus: 'confirmed' as const,
        allocations: [],
      },
    ]

    await expect(
      service.queueIssue({
        assetId: 'rgb:BgYGBgYG-BgYGBgY-GBgYGBg-YGBgYGB-gYGBgYG-BgYGBgY',
        contract: Uint8Array.from([1]),
        genesis: Uint8Array.from([2]),
        asset: { ticker: 'ISS', name: 'Issued', precision: 0, schema: 'NIA', issuedSupply: '1' },
        utxoSync: { txid: outpoints[0]!.outpoint.txid, outpoints },
      })
    ).rejects.toThrow('recovery unavailable')

    expect(service.getPendingIssues()).toEqual([])
    expect(service.getContractConsignment('rgb:BgYGBgYG-BgYGBgY-GBgYGBg-YGBgYGB-gYGBgYG-BgYGBgY')).toBeUndefined()
  })

  it('retains already-broadcast RGB funding UTXOs when recovery checkpointing fails', async () => {
    const dependencies = createDependencies()
    dependencies.onStatePersisted = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('recovery unavailable'))
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.enableRecoveryBackup()
    const fundingUtxo = {
      outpoint: { txid: 'f'.repeat(64), vout: 1 },
      satoshis: 330,
      scriptPubKey: '5120' + '44'.repeat(32),
      publicKey: '02' + '44'.repeat(32),
      chainStatus: 'mempool' as const,
      allocations: [],
    }

    await expect(
      service.queueUtxoSync({ txid: fundingUtxo.outpoint.txid, outpoints: [fundingUtxo] })
    ).rejects.toThrow('recovery unavailable')

    expect(service.getPendingUtxoSync()).toMatchObject({ txid: fundingUtxo.outpoint.txid })
    expect(service.getSnapshot().utxos).toContainEqual(fundingUtxo)
  })

  it('releases a rejected send instead of leaving it pending', async () => {
    const dependencies = createDependencies()
    dependencies.transport.getAcknowledgement = vi.fn().mockResolvedValue(false)
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    const prepared = await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      invoice: rgbInvoice(),
      feeRate: 2,
    })

    await expect(service.completeSend(prepared.id, 'signed-psbt')).rejects.toThrow(
      'was rejected by the recipient'
    )
    expect(service.getPendingTransfers()).toEqual([])
  })

  it('persists blind receive seal bigint values through JSON-based encrypted storage', async () => {
    const dependencies = createDependencies()
    vi.mocked(dependencies.stateSource.getSnapshot).mockResolvedValue({
      syncedAt: 1,
      utxos: [
        {
          outpoint: { txid: 'f'.repeat(64), vout: 0 },
          satoshis: 1_000,
          scriptPubKey: '5120' + '11'.repeat(32),
          publicKey: '02' + '22'.repeat(32),
          chainStatus: 'confirmed',
          confirmations: 1,
          allocations: [],
        },
      ],
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()

    await expect(
      service.createBlindReceive({ assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE', amount: '1' })
    ).resolves.toMatchObject({ assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE' })
    expect(service.getAvailableReceiveUtxos()).toEqual([])
  })

  it('stores a proxy v1 invoice key alongside the registered blind receive', async () => {
    const dependencies = createDependencies()
    vi.mocked(dependencies.stateSource.getSnapshot).mockResolvedValue({
      syncedAt: 1,
      utxos: [{
        outpoint: { txid: 'f'.repeat(64), vout: 0 },
        satoshis: 1_000,
        scriptPubKey: '5120' + '11'.repeat(32),
        publicKey: '02' + '22'.repeat(32),
        chainStatus: 'confirmed',
        confirmations: 1,
        allocations: [],
      }],
    })
    const publicKey = 'ab'.repeat(32)
    const privateKey = 'cd'.repeat(32)
    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    dependencies.transport.prepareInvoice = vi.fn(async ({ recipientId }) => ({
      publicKey,
      privateKey,
      invoiceId: rgbProxyInvoiceId(recipientId, publicKey),
      expirationTimestamp: expiresAt,
    }))
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    const receive = await service.createBlindReceive({ durationSeconds: 3600 })
    const invoice = decodeRgbInvoice(receive.invoice)
    expect(invoice.proxyPublicKey).toBe(publicKey)
    expect(invoice.proxyRecipientId).toBe(receive.proxyRecipientId)
    expect(receive).toMatchObject({
      proxyPrivateKey: privateKey,
      proxyPublicKey: publicKey,
      proxyInvoiceId: invoice.proxyInvoiceId,
      expirationTimestamp: expiresAt,
    })
    expect(service.getPendingReceives()[0]?.proxyPrivateKey).toBe(privateKey)
  })

  it('rejects a fixed receive amount when the invoice does not name an RGB asset', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)

    await expect(service.createBlindReceive({ amount: '1000' })).rejects.toThrow(
      'requires an asset ID'
    )
  })

  it('rejects a fixed receive amount above the RGB u64 maximum', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)

    await expect(
      service.createBlindReceive({ assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE', amount: '18446744073709551616' })
    ).rejects.toThrow('exceeds the maximum u64 value')
  })

  it('waits for a recovery checkpoint before returning a new blind invoice', async () => {
    const dependencies = createDependencies()
    vi.mocked(dependencies.stateSource.getSnapshot).mockResolvedValue({
      syncedAt: 1,
      utxos: [
        {
          outpoint: { txid: 'f'.repeat(64), vout: 0 },
          satoshis: 1_000,
          scriptPubKey: '5120' + '11'.repeat(32),
          publicKey: '02' + '22'.repeat(32),
          chainStatus: 'confirmed',
          confirmations: 1,
          allocations: [],
        },
      ],
    })
    let finishCheckpoint: (() => void) | undefined
    let checkpointStarted: (() => void) | undefined
    const checkpointStartedPromise = new Promise<void>(resolve => (checkpointStarted = resolve))
    dependencies.onStatePersisted = vi.fn(() => {
      checkpointStarted?.()
      return new Promise<void>(resolve => (finishCheckpoint = resolve))
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    service.enableRecoveryBackup()

    let completed = false
    const creating = service
      .createBlindReceive({ assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE', amount: '1' })
      .then(result => {
        completed = true
        return result
      })
    await checkpointStartedPromise

    expect(dependencies.onStatePersisted).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingReceives: [expect.objectContaining({ assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE' })],
      }),
      { reason: 'state_change', kind: 'normal' }
    )
    const checkpointState = vi
      .mocked(dependencies.onStatePersisted)
      .mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(checkpointState).not.toHaveProperty('recoveryCheckpointUpdatedAt')
    expect(checkpointState).not.toHaveProperty('recoveryCheckpointRevision')
    expect(completed).toBe(false)
    finishCheckpoint?.()
    await expect(creating).resolves.toMatchObject({ assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE' })
  })

  it('does not report a new blind invoice as created when its recovery checkpoint fails', async () => {
    const dependencies = createDependencies()
    vi.mocked(dependencies.stateSource.getSnapshot).mockResolvedValue({
      syncedAt: 1,
      utxos: [
        {
          outpoint: { txid: 'f'.repeat(64), vout: 0 },
          satoshis: 1_000,
          scriptPubKey: '5120' + '11'.repeat(32),
          publicKey: '02' + '22'.repeat(32),
          chainStatus: 'confirmed',
          confirmations: 1,
          allocations: [],
        },
      ],
    })
    dependencies.onStatePersisted = vi.fn().mockRejectedValue(new Error('recovery unavailable'))
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    service.enableRecoveryBackup()

    await expect(service.createBlindReceive({ assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE', amount: '1' })).rejects.toThrow(
      'recovery unavailable'
    )
    expect(service.getPendingReceives()).toEqual([])
    expect(service.getAvailableReceiveUtxos()).toHaveLength(1)
  })

  it('batches a new invoice and its claim into one recovery checkpoint', async () => {
    const dependencies = createDependencies()
    vi.mocked(dependencies.stateSource.getSnapshot).mockResolvedValue({
      syncedAt: 1,
      utxos: [
        {
          outpoint: { txid: 'f'.repeat(64), vout: 0 },
          satoshis: 1_000,
          scriptPubKey: '5120' + '11'.repeat(32),
          publicKey: '02' + '22'.repeat(32),
          chainStatus: 'confirmed',
          confirmations: 1,
          allocations: [],
        },
      ],
    })
    dependencies.onStatePersisted = vi.fn()
    dependencies.stateSource.claimConsignments = vi.fn().mockResolvedValue(1)
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.enableRecoveryBackup()
    ;(service as any).state.recoveryCheckpoint = { dirty: false, verified: true }
    vi.mocked(dependencies.onStatePersisted).mockClear()

    await expect(
      service.createBlindReceive({
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '1',
        deferRecoveryCheckpoint: true,
      })
    ).resolves.toMatchObject({ assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE' })

    expect(dependencies.onStatePersisted).not.toHaveBeenCalled()
    await expect(service.claimPendingReceives()).resolves.toEqual({ claimed: 1 })
    expect(dependencies.onStatePersisted).toHaveBeenCalledTimes(1)
    expect(dependencies.onStatePersisted).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingReceives: [expect.objectContaining({ claimedAt: expect.any(Number) })],
      }),
      { reason: 'state_change', kind: 'normal' }
    )
    expect(service.getPendingReceives()).toHaveLength(1)
  })

  it('releases prepared-send allocations when its recovery checkpoint fails', async () => {
    const dependencies = createDependencies()
    dependencies.onStatePersisted = vi.fn().mockRejectedValue(new Error('recovery unavailable'))
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    service.enableRecoveryBackup()

    await expect(
      service.prepareSend({ assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE', amount: '60', feeRate: 1, invoice: rgbInvoice() })
    ).rejects.toThrow('recovery unavailable')

    expect(service.getPendingTransfers()).toEqual([])
    await expect(
      service.prepareSend({ assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE', amount: '60', feeRate: 1, invoice: rgbInvoice() })
    ).rejects.toThrow('recovery unavailable')
  })

  it('locks RGB writes when the backend reports a checkpoint revision conflict', async () => {
    const dependencies = createDependencies()
    dependencies.onStatePersisted = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ saved: false })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.enableRecoveryBackup()

    await expect(service.storeContract('rgb:BwcHBwcH-BwcHBwc-HBwcHBw-cHBwcHB-wcHBwcH-BwcHBwc', Uint8Array.from([1]))).rejects.toThrow(
      'conflicts with a newer remote state'
    )

    expect(service.hasRecoveryConflict()).toBe(true)
    expect(service.isRecoveryBackupEnabled()).toBe(false)
    expect(service.getContractConsignment('rgb:BwcHBwcH-BwcHBwc-HBwcHBw-cHBwcHB-wcHBwcH-BwcHBwc')).toBeUndefined()
  })

  it('persists dirty recovery status and retries it after reopening', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.enableRecoveryBackup()
    dependencies.onStatePersisted = vi.fn().mockRejectedValue(new Error('recovery unavailable'))
    await expect(
      service.queueUtxoSync({
        txid: 'f'.repeat(64),
        outpoints: [
          {
            outpoint: { txid: 'f'.repeat(64), vout: 0 },
            satoshis: 330,
            scriptPubKey: '5120' + '44'.repeat(32),
            publicKey: '02' + '44'.repeat(32),
            chainStatus: 'mempool',
            allocations: [],
          },
        ],
      })
    ).rejects.toThrow('recovery unavailable')
    expect(service.getRecoveryCheckpointStatus()).toMatchObject({ dirty: true, verified: false })

    const reopened = new RgbService(dependencies)
    await reopened.open(wallet)
    dependencies.onStatePersisted = vi
      .fn()
      .mockResolvedValue({ verified: true, checksum: 'ab'.repeat(32), totalLength: 12 })
    await reopened.retryRecoveryCheckpoint()
    expect(reopened.getRecoveryCheckpointStatus()).toMatchObject({ dirty: false, verified: true })
  })

  it('does not re-enable recovery writes after an unavailable initial recovery read', async () => {
    const dependencies = createDependencies()
    dependencies.onStatePersisted = vi.fn().mockResolvedValue(undefined)
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.disableRecoveryBackup()

    const reopened = new RgbService(dependencies)
    await reopened.open(wallet)
    expect(dependencies.onStatePersisted).not.toHaveBeenCalled()

    await reopened.enableRecoveryBackup()
    expect(dependencies.onStatePersisted).toHaveBeenCalledTimes(1)
  })

  it('creates a pending invoice from an unconfirmed funding UTXO', async () => {
    const dependencies = createDependencies()
    vi.mocked(dependencies.stateSource.getSnapshot).mockResolvedValue({
      syncedAt: 1,
      utxos: [
        {
          outpoint: { txid: 'e'.repeat(64), vout: 0 },
          satoshis: 1_000,
          scriptPubKey: '5120' + '11'.repeat(32),
          publicKey: '02' + '22'.repeat(32),
          chainStatus: 'mempool',
          confirmations: 0,
          allocations: [],
        },
      ],
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()

    await expect(
      service.createBlindReceive({ assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE', amount: '1' })
    ).resolves.toMatchObject({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
    })
    expect(service.getPendingConfirmationReceiveUtxos()).toEqual([])
  })

  it('selects a locally issued NIA whose genesis outpoint is in the mempool', async () => {
    const dependencies = createDependencies()
    dependencies.encoder.prepareTransfer = vi.fn().mockResolvedValue({
      id: 'transfer-mempool',
      psbt: 'cHNidP8=',
      toSignInputs: [{ index: 0, publicKey: '02' + '22'.repeat(32) }],
      lockedOutpoints: [{ txid: 'e'.repeat(64), vout: 0 }],
    })
    dependencies.stateSource.verifyUtxos = vi.fn().mockResolvedValue([
      {
        outpoint: { txid: 'e'.repeat(64), vout: 0 },
        status: 'mempool',
        confirmations: 0,
      },
    ])
    vi.mocked(dependencies.stateSource.getSnapshot).mockResolvedValue({
      syncedAt: 1,
      utxos: [
        {
          outpoint: { txid: 'e'.repeat(64), vout: 0 },
          satoshis: 1_000,
          scriptPubKey: '5120' + '11'.repeat(32),
          publicKey: '02' + '22'.repeat(32),
          chainStatus: 'mempool',
          confirmations: 0,
          allocations: [
            {
              assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
              amount: '60',
              settled: true,
              spendable: true,
              opId: 'd'.repeat(64),
              assignmentIndex: 0,
              assignmentType: 4000,
            },
          ],
        },
      ],
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()

    await expect(
      service.prepareSend({
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60',
        invoice: rgbInvoice(),
        feeRate: 2,
      })
    ).resolves.toMatchObject({ id: 'transfer-mempool' })
    expect(dependencies.encoder.prepareTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedUtxos: [expect.objectContaining({ chainStatus: 'mempool' })],
      })
    )
  })

  it('selects and locks local colored UTXOs before requesting a local PSBT', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()

    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      invoice: rgbInvoice(),
      feeRate: 2,
    })

    expect(dependencies.encoder.prepareTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: expect.objectContaining({
          invoice: expect.objectContaining({ recipientType: 'blind' }),
          transition: expect.objectContaining({
            inputAmount: '60',
            recipientAmount: '60',
            changeAmount: '0',
          }),
        }),
        selectedUtxos: [expect.objectContaining({ outpoint: { txid: 'b'.repeat(64), vout: 1 } })],
      })
    )
    expect(dependencies.stateSource.getValidationHistory).toHaveBeenCalledWith(wallet, {
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      allocations: [
        {
          outpoint: { txid: 'b'.repeat(64), vout: 1 },
          opId: 'd'.repeat(64),
          assignmentIndex: 0,
          assignmentType: 4000,
        },
      ],
    })
    await expect(
      service.prepareSend({
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60',
        invoice: rgbInvoice(),
        feeRate: 2,
      })
    ).rejects.toBeInstanceOf(RgbInsufficientBalanceError)
  })

  it('restores a persisted pending transfer after the service is reopened', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      invoice: rgbInvoice(),
      feeRate: 2,
    })

    const reopened = new RgbService(dependencies)
    await reopened.open(wallet)

    expect(reopened.getPendingTransfers()).toEqual([expect.objectContaining({ id: 'transfer-1' })])
    await reopened.completeSend('transfer-1', 'signed-psbt')
    await reopened.broadcastPendingSend('transfer-1')
    expect(dependencies.broadcaster.broadcast).toHaveBeenCalled()
  })

  it('rejects a locally decoded invoice for another asset before invoking the encoder', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()

    await expect(
      service.prepareSend({
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60',
        invoice: `rgb:AgICAgIC-AgICAgI-CAgICAg-ICAgICA-gICAgIC-AgICAgI/schema/~/${blindRecipient}`,
        feeRate: 2,
      })
    ).rejects.toThrow('RGB invoice asset does not match the requested asset')
    expect(dependencies.encoder.prepareTransfer).not.toHaveBeenCalled()
  })

  it('uses a fixed invoice amount when the caller does not provide one', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()

    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      invoice: rgbInvoice(),
      feeRate: 2,
    })

    expect(dependencies.encoder.prepareTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ amount: '60' }),
        intent: expect.objectContaining({ amount: '60' }),
      })
    )
  })

  it('adds the locally stored contract to self-issued asset history', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.storeContract('rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE', Uint8Array.from([1, 2, 3]))

    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      invoice: `rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE/schema/~/${blindRecipient}?amount=60&endpoints=${encodeURIComponent(proxyEndpoint)}`,
      feeRate: 2,
    })

    expect(dependencies.encoder.prepareTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        validationHistory: {
          assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
          consignments: [{ opId: '01'.repeat(32), payload: Buffer.from([1, 2, 3]).toString('base64') }],
          localContract: Buffer.from([1, 2, 3]).toString('base64'),
          knownBlindSeals: [],
        },
      })
    )
  })

  it('uses a recovered complete local history without asking the backend', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    ;(service as any).state.contracts = {
      'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE': {
        consignment: 'Y29tcGxldGUtbG9jYWwtaGlzdG9yeQ==',
        createdAt: 1,
        history: {
          payload: 'Y29tcGxldGUtbG9jYWwtaGlzdG9yeQ==',
          opIds: ['c'.repeat(64), 'd'.repeat(64)],
          updatedAt: 1,
        },
      },
    }
    await (service as any).persist()
    const checkpoint = JSON.parse(JSON.stringify((service as any).state))

    const reopened = new RgbService(dependencies)
    await reopened.open(wallet)
    await expect(reopened.restoreRecoveryState(checkpoint)).resolves.toBe(true)
    vi.mocked(dependencies.stateSource.getValidationHistory).mockRejectedValue(
      new Error('backend is offline')
    )
    vi.mocked(dependencies.stateSource.getValidationHistory).mockClear()

    await expect(
      reopened.prepareSend({
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '100',
        invoice: rgbInvoice(100),
        feeRate: 2,
      })
    ).resolves.toMatchObject({ id: 'transfer-1' })

    expect(dependencies.stateSource.getValidationHistory).not.toHaveBeenCalled()
    expect(dependencies.encoder.prepareTransfer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        validationHistory: expect.objectContaining({
          consignments: [{ opId: '01'.repeat(32), payload: 'Y29tcGxldGUtbG9jYWwtaGlzdG9yeQ==' }],
        }),
      })
    )
  })

  it('refetches history when a checkpoint index claims an allocation missing from its payload', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    ;(service as any).state.contracts = {
      'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE': {
        consignment: 'Y29tcGxldGUtbG9jYWwtaGlzdG9yeQ==',
        createdAt: 1,
        history: {
          payload: 'Y29tcGxldGUtbG9jYWwtaGlzdG9yeQ==',
          opIds: ['c'.repeat(64), 'd'.repeat(64)],
          updatedAt: 1,
        },
      },
    }
    vi.mocked(dependencies.encoder.prepareTransfer)
      .mockRejectedValueOnce(
        new RgbServiceError('RGB allocation parent Transition is missing from local history')
      )
      .mockResolvedValueOnce({
        id: 'transfer-recovered-history',
        psbt: 'cHNidP8=',
        toSignInputs: [],
        lockedOutpoints: [{ txid: 'b'.repeat(64), vout: 1 }],
      })
    vi.mocked(dependencies.stateSource.getValidationHistory).mockResolvedValueOnce({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      consignments: [{ opId: 'd'.repeat(64), payload: 'cmVtb3RlLWhpc3Rvcnk=' }],
    })

    await expect(
      service.prepareSend({
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '100',
        invoice: rgbInvoice(100),
        feeRate: 2,
      })
    ).resolves.toMatchObject({ id: 'transfer-recovered-history' })

    expect(dependencies.stateSource.getValidationHistory).toHaveBeenCalledTimes(1)
    expect(dependencies.encoder.prepareTransfer).toHaveBeenCalledTimes(2)
  })

  it('waits for the sender to broadcast after recipient acknowledgement', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      precision: 7,
      invoice: rgbInvoice(),
      feeRate: 2,
    })

    const completed = await service.completeSend('transfer-1', 'signed-psbt')

    expect(dependencies.transport.publishConsignment).toHaveBeenCalledWith({
      recipientId: blindRecipient,
      payload: 'consignment',
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      opIds: ['d'.repeat(64)],
      transportId: 'transfer-1:0',
      txid: 'c'.repeat(64),
      endpoints: [proxyEndpoint],
    })
    expect(dependencies.broadcaster.broadcast).not.toHaveBeenCalled()
    await service.sync()
    expect(dependencies.broadcaster.broadcast).not.toHaveBeenCalled()
    await service.broadcastPendingSend('transfer-1')
    expect(dependencies.broadcaster.broadcast).toHaveBeenCalledWith(completed.rawTx)
    expect(
      vi.mocked(dependencies.transport.publishConsignment).mock.invocationCallOrder[0]
    ).toBeLessThan(vi.mocked(dependencies.broadcaster.broadcast).mock.invocationCallOrder[0]!)
    expect(dependencies.stateSource.syncBroadcast).toHaveBeenCalledWith(
      wallet,
      'transfer-1',
      completed,
      service.getSnapshot(),
      { amount: '60', createdAt: expect.any(Number), invoice: rgbInvoice() }
    )
    expect(service.getPendingSendHistory()).toEqual([
      expect.objectContaining({
        transferId: 'transfer-1',
        txid: completed.txid,
        precision: 7,
        status: 'broadcasted',
      }),
    ])
  })

  it('leaves seller swap broadcast to the dApp after buyer returns a final PSBT', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      invoice: rgbInvoice(),
      feeRate: 2,
    })

    await service.publishSwap('transfer-1', 'maker-signed-psbt')

    expect(dependencies.encoder.completeTransfer).toHaveBeenLastCalledWith(
      expect.objectContaining({ signedPsbt: 'maker-signed-psbt', allowIncomplete: true })
    )
    expect(dependencies.broadcaster.broadcast).not.toHaveBeenCalled()
    expect(service.getPendingTransfers()).toEqual([
      expect.objectContaining({
        id: 'transfer-1',
        delivery: expect.objectContaining({ requiresCounterpartySignature: true }),
      }),
    ])

    // Restart/background polling cannot turn a buyer-less acknowledgement into a broadcast.
    await service.sync()
    expect(dependencies.broadcaster.broadcast).not.toHaveBeenCalled()

    await service.completePublishedSwap('transfer-1', 'fully-signed-psbt', {
      externalBroadcast: true,
    })

    expect(dependencies.encoder.completeTransfer).toHaveBeenLastCalledWith(
      expect.objectContaining({ signedPsbt: 'fully-signed-psbt' })
    )
    expect(dependencies.broadcaster.broadcast).not.toHaveBeenCalled()
    expect(service.getPendingTransfers()).toEqual([
      expect.objectContaining({
        delivery: expect.objectContaining({
          externalBroadcast: true,
          acknowledgedAt: expect.any(Number),
        }),
      }),
    ])

    dependencies.stateSource.getTransactionStatus = vi.fn().mockResolvedValue({ status: 'mempool' })
    await service.sync()
    expect(service.getPendingTransfers()).toEqual([])
  })

  it('does not re-fetch a consignment immediately after accepting it', async () => {
    const dependencies = createDependencies()
    dependencies.transport.acknowledgeConsignment = vi.fn().mockResolvedValue(undefined)
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [
      {
        invoice: rgbInvoice(),
        recipientId: 'recipient',
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60',
        createdAt: 1,
        seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
        pendingAccept: {
          payload: 'consignment',
          txid: 'c'.repeat(64),
          endpoint: proxyEndpoint,
          assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
          amount: '60',
          precision: 2,
          discoveredAt: 1,
        },
      },
    ]
    const processClaimedReceives = vi.spyOn(service, 'processClaimedReceives')

    await expect(service.acceptReceive('recipient')).resolves.toEqual({
      accepted: true,
      status: 'accepted',
    })
    expect((service as any).state.pendingReceives[0].receivedConsignment).toMatchObject({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      precision: 2,
    })
    expect(service.getLocalAssetBalance('rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE')).toMatchObject({
      settled: '0', spendable: '0', pending: '60', incomingPending: '60',
    })

    expect(dependencies.transport.getAcknowledgement).toHaveBeenCalledTimes(1)
    expect(dependencies.transport.acknowledgeConsignment).toHaveBeenCalledTimes(1)
    expect(processClaimedReceives).not.toHaveBeenCalled()
    expect((service as any).state.pendingReceives[0].receivedConsignment).toMatchObject({
      accepted: true,
      payload: 'consignment',
      endpoint: proxyEndpoint,
    })
  })

  it('shows an accepted receive as incoming pending without making it spendable or counting it twice', async () => {
    const service = new RgbService(createDependencies())
    await service.open(wallet)
    const state = (service as any).state
    state.snapshot.utxos = [{
      outpoint: { txid: 'a'.repeat(64), vout: 0 },
      satoshis: 1000,
      scriptPubKey: '5120' + '00'.repeat(32),
      publicKey: '02' + '11'.repeat(32),
      chainStatus: 'confirmed',
      allocations: [],
    }]
    state.pendingAssetMetadata = [{
      assetId: 'rgb:CAgICAgI-CAgICAg-ICAgICA-gICAgIC-AgICAgI-CAgICAg',
      metadata: {
        ticker: 'NEW', name: 'New Asset', precision: 2,
        schema: 'NIA', issuedSupply: '100',
      },
    }]
    state.pendingReceives = [{
      recipientId: 'recipient',
      createdAt: 1,
      seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
      receivedConsignment: {
        accepted: false,
        txid: 'c'.repeat(64),
        assetId: 'rgb:CAgICAgI-CAgICAg-ICAgICA-gICAgIC-AgICAgI-CAgICAg',
        amount: '2',
        precision: 0,
        receivedAt: 1,
      },
    }]
    expect(service.getLocalAssetBalance('rgb:CAgICAgI-CAgICAg-ICAgICA-gICAgIC-AgICAgI-CAgICAg')).toBeUndefined()

    state.pendingReceives[0].receivedConsignment.accepted = true
    expect(service.getLocalAssetBalance('rgb:CAgICAgI-CAgICAg-ICAgICA-gICAgIC-AgICAgI-CAgICAg')).toMatchObject({
      settled: '0',
      spendable: '0',
      pending: '2',
      incomingPending: '2',
      ticker: 'NEW',
      precision: 2,
    })
    expect(service.getLocalAssetList().list.some(item => item.assetId === 'rgb:CAgICAgI-CAgICAg-ICAgICA-gICAgIC-AgICAgI-CAgICAg')).toBe(true)

    state.pendingReceives[0].receivedConsignment.broadcastDetectedAt = 2
    expect(service.getLocalAssetBalance('rgb:CAgICAgI-CAgICAg-ICAgICA-gICAgIC-AgICAgI-CAgICAg')).toMatchObject({
      spendable: '0', pending: '2', incomingPending: '2',
    })

    state.snapshot.utxos[0].allocations.push({
      assetId: 'rgb:CAgICAgI-CAgICAg-ICAgICA-gICAgIC-AgICAgI-CAgICAg', amount: '2', settled: false, spendable: false,
    })
    expect(service.getLocalAssetBalance('rgb:CAgICAgI-CAgICAg-ICAgICA-gICAgIC-AgICAgI-CAgICAg')).toMatchObject({
      settled: '0', pending: '2', incomingPending: '2',
    })

    state.snapshot.utxos[0].allocations.at(-1).settled = true
    state.snapshot.utxos[0].allocations.at(-1).spendable = true
    expect(service.getLocalAssetBalance('rgb:CAgICAgI-CAgICAg-ICAgICA-gICAgIC-AgICAgI-CAgICAg')).toMatchObject({
      settled: '2', spendable: '2', pending: '0', incomingPending: '0',
    })
  })

  it('serializes acceptance of multiple witness invoices without waiting for confirmation', async () => {
    const dependencies = createDependencies()
    let activeAcknowledgements = 0
    let maximumActiveAcknowledgements = 0
    dependencies.transport.acknowledgeConsignment = vi.fn().mockImplementation(async () => {
      activeAcknowledgements++
      maximumActiveAcknowledgements = Math.max(
        maximumActiveAcknowledgements,
        activeAcknowledgements
      )
      await Promise.resolve()
      activeAcknowledgements--
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = ['first', 'second'].map((recipientId, index) => ({
      invoice: rgbInvoice(),
      recipientId,
      proxyRecipientId: `proxy-${recipientId}`,
      recipientType: 'witness',
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: String(60 + index),
      createdAt: index + 1,
      pendingAccept: {
        payload: `consignment-${recipientId}`,
        txid: String(index + 1).repeat(64),
        endpoint: proxyEndpoint,
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: String(60 + index),
        precision: 2,
        discoveredAt: index + 1,
      },
    }))

    await expect(
      Promise.all([service.acceptReceive('proxy-first'), service.acceptReceive('proxy-second')])
    ).resolves.toEqual([
      { accepted: true, status: 'accepted' },
      { accepted: true, status: 'accepted' },
    ])

    expect(maximumActiveAcknowledgements).toBe(1)
    expect(service.getPendingReceives()).toEqual([
      expect.objectContaining({
        recipientId: 'first',
        receivedConsignment: expect.objectContaining({ accepted: true }),
      }),
      expect.objectContaining({
        recipientId: 'second',
        receivedConsignment: expect.objectContaining({ accepted: true }),
      }),
    ])
  })

  it('treats a repeated accept for an already accepted witness invoice as success', async () => {
    const dependencies = createDependencies()
    dependencies.transport.acknowledgeConsignment = vi.fn()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [
      {
        invoice: rgbInvoice(),
        recipientId: 'recipient',
        proxyRecipientId: 'proxy-recipient',
        recipientType: 'witness',
        createdAt: 1,
        receivedConsignment: {
          txid: 'c'.repeat(64),
          receivedAt: 1,
          accepted: true,
          payload: 'consignment',
          endpoint: proxyEndpoint,
        },
      },
    ]

    await expect(service.acceptReceive('proxy-recipient')).resolves.toEqual({
      accepted: true,
      status: 'accepted',
    })
    expect(dependencies.transport.acknowledgeConsignment).not.toHaveBeenCalled()
  })

  it('records the actual asset and amount for an accepted Any Asset invoice', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    const receive = {
      invoice: rgbInvoice(),
      recipientId: 'any-asset-recipient',
      createdAt: 1,
      seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
      receivedConsignment: {
        txid: 'c'.repeat(64),
        receivedAt: 2,
        assetId: 'rgb:CQkJCQkJ-CQkJCQk-JCQkJCQ-kJCQkJC-QkJCQkJ-CQkJCQk',
        amount: '125',
        accepted: true,
      },
    }
    ;(service as any).state.pendingReceives = [receive]
    ;(service as any).recordReceiveOutcome(receive, 'settled', 'c'.repeat(64))

    expect(service.getPendingReceiveHistory()).toEqual([
      expect.objectContaining({ assetId: 'rgb:CQkJCQkJ-CQkJCQk-JCQkJCQ-kJCQkJC-QkJCQkJ-CQkJCQk', amount: '125' }),
    ])
    ;(service as any).state.pendingReceiveHistory[0].assetId = ''
    ;(service as any).state.pendingReceiveHistory[0].amount = ''

    expect(service.getPendingReceiveHistory()).toEqual([
      expect.objectContaining({ assetId: 'rgb:CQkJCQkJ-CQkJCQk-JCQkJCQ-kJCQkJC-QkJCQkJ-CQkJCQk', amount: '125' }),
    ])
  })

  it('settles an accepted receive from its persisted consignment when the proxy is unavailable', async () => {
    const dependencies = createDependencies()
    dependencies.transport.getConsignment = vi.fn()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [
      {
        invoice: rgbInvoice(),
        recipientId: 'recipient',
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60',
        createdAt: 1,
        seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
        receivedConsignment: {
          txid: 'c'.repeat(64),
          receivedAt: 1,
          accepted: true,
          payload: 'consignment',
          endpoint: proxyEndpoint,
        },
      },
    ]
    ;(service as any).validateIncomingConsignment = vi.fn().mockReturnValue({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      txid: 'c'.repeat(64),
      decoded: {
        metadata: {
          ticker: 'TOK',
          name: 'Token',
          precision: 0,
          schema: 'NIA',
          issuedSupply: '60',
        },
      },
    })
    const advanceAcceptedReceive = vi
      .spyOn(service as any, 'advanceAcceptedReceive')
      .mockResolvedValue(false)

    await service.processClaimedReceives({ includeClaimed: false })

    expect(dependencies.transport.getConsignment).not.toHaveBeenCalled()
    expect(advanceAcceptedReceive).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ payload: 'consignment' }),
      expect.anything(),
      false
    )
  })

  it('keeps a WebRGB receive unsettled below its requested confirmation floor', async () => {
    const dependencies = createDependencies()
    dependencies.stateSource.getTransactionStatus = vi.fn().mockResolvedValue({
      status: 'confirmed', confirmations: 2,
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    const receive = {
      invoice: rgbInvoice(), recipientId: 'recipient', createdAt: 1,
      minConfirmations: 3,
      receivedConsignment: { txid: 'c'.repeat(64), receivedAt: 1, accepted: true },
    }
    const result = await (service as any).advanceAcceptedReceive(
      receive, { recipientId: 'recipient', payload: 'consignment' },
      { txid: 'c'.repeat(64) }, false
    )
    expect(result).toBe(false)
    expect(dependencies.stateSource.getTransactionStatus).toHaveBeenCalledWith(wallet, 'c'.repeat(64))
  })

  it('reconciles a persisted ACK intent after restart without requiring the proxy payload', async () => {
    const dependencies = createDependencies()
    dependencies.transport.getConsignment = vi.fn()
    dependencies.transport.getAcknowledgement = vi.fn().mockResolvedValue(true)
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [
      {
        invoice: rgbInvoice(),
        recipientId: 'recipient',
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60',
        createdAt: 1,
        seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
        pendingAccept: {
          payload: 'consignment',
          txid: 'c'.repeat(64),
          endpoint: proxyEndpoint,
          assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
          amount: '60',
          discoveredAt: 1,
        },
        receivedConsignment: {
          txid: 'c'.repeat(64),
          receivedAt: 1,
          acknowledgementPending: true,
          payload: 'consignment',
          endpoint: proxyEndpoint,
        },
      },
    ]
    ;(service as any).validateIncomingConsignment = vi.fn().mockReturnValue({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      txid: 'c'.repeat(64),
      decoded: {
        metadata: {
          ticker: 'TOK',
          name: 'Token',
          precision: 0,
          schema: 'NIA',
          issuedSupply: '60',
        },
      },
    })
    const advanceAcceptedReceive = vi
      .spyOn(service as any, 'advanceAcceptedReceive')
      .mockResolvedValue(false)

    await service.processClaimedReceives({ includeClaimed: false })

    const receipt = (service as any).state.pendingReceives[0].receivedConsignment
    expect(dependencies.transport.getConsignment).not.toHaveBeenCalled()
    expect(receipt).toMatchObject({ accepted: true, payload: 'consignment' })
    expect(receipt).not.toHaveProperty('acknowledgementPending')
    expect((service as any).state.pendingReceives[0]).not.toHaveProperty('pendingAccept')
    expect(advanceAcceptedReceive).toHaveBeenCalled()
  })

  it('retries a persisted ACK intent when the proxy acknowledgement is unavailable', async () => {
    const dependencies = createDependencies()
    dependencies.transport.getConsignment = vi.fn()
    dependencies.transport.getAcknowledgement = vi.fn().mockResolvedValue(undefined)
    dependencies.transport.acknowledgeConsignment = vi.fn().mockResolvedValue(undefined)
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [
      {
        invoice: rgbInvoice(),
        recipientId: 'recipient',
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60',
        createdAt: 1,
        seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
        pendingAccept: {
          payload: 'consignment',
          txid: 'c'.repeat(64),
          endpoint: proxyEndpoint,
          assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
          amount: '60',
          discoveredAt: 1,
        },
        receivedConsignment: {
          txid: 'c'.repeat(64),
          receivedAt: 1,
          acknowledgementPending: true,
          payload: 'consignment',
          endpoint: proxyEndpoint,
        },
      },
    ]
    ;(service as any).validateIncomingConsignment = vi.fn().mockReturnValue({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      txid: 'c'.repeat(64),
      decoded: {
        metadata: {
          ticker: 'TOK',
          name: 'Token',
          precision: 0,
          schema: 'NIA',
          issuedSupply: '60',
        },
      },
    })
    const advanceAcceptedReceive = vi
      .spyOn(service as any, 'advanceAcceptedReceive')
      .mockResolvedValue(false)

    await service.processClaimedReceives({ includeClaimed: false })

    expect(dependencies.transport.acknowledgeConsignment).toHaveBeenCalledWith({
      recipientId: 'recipient',
      endpoints: [proxyEndpoint],
      acknowledged: true,
    })
    expect((service as any).state.pendingReceives[0].receivedConsignment).toMatchObject({
      accepted: true,
      payload: 'consignment',
    })
    expect((service as any).state.pendingReceives[0].receivedConsignment).not.toHaveProperty(
      'acknowledgementPending'
    )
    expect(advanceAcceptedReceive).toHaveBeenCalled()
  })

  it('keeps ACK intent when retrying the proxy acknowledgement fails', async () => {
    const dependencies = createDependencies()
    dependencies.transport.getConsignment = vi.fn()
    dependencies.transport.getAcknowledgement = vi.fn().mockResolvedValue(undefined)
    dependencies.transport.acknowledgeConsignment = vi
      .fn()
      .mockRejectedValue(new Error('proxy unavailable'))
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [
      {
        invoice: rgbInvoice(),
        recipientId: 'recipient',
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60',
        createdAt: 1,
        seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
        pendingAccept: {
          payload: 'consignment',
          txid: 'c'.repeat(64),
          endpoint: proxyEndpoint,
          assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
          amount: '60',
          discoveredAt: 1,
        },
        receivedConsignment: {
          txid: 'c'.repeat(64),
          receivedAt: 1,
          acknowledgementPending: true,
          payload: 'consignment',
          endpoint: proxyEndpoint,
        },
      },
    ]
    ;(service as any).validateIncomingConsignment = vi.fn().mockReturnValue({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      txid: 'c'.repeat(64),
      decoded: {
        metadata: {
          ticker: 'TOK',
          name: 'Token',
          precision: 0,
          schema: 'NIA',
          issuedSupply: '60',
        },
      },
    })

    await service.processClaimedReceives({ includeClaimed: false })

    expect((service as any).state.pendingReceives[0].receivedConsignment).toMatchObject({
      acknowledgementPending: true,
      payload: 'consignment',
    })
    expect((service as any).state.pendingReceives[0]).toHaveProperty('pendingAccept')
  })

  it('persists receive ACK intent before acknowledging the proxy', async () => {
    const dependencies = createDependencies()
    let persistedAckIntent = false
    const stored = new Map<string, unknown>()
    dependencies.storage = {
      get: async <T>(key: string) => stored.get(key) as T | undefined,
      set: async <T>(key: string, value: T) => {
        const receives = (value as any).pendingReceives || []
        persistedAckIntent = receives.some(
          (receive: any) => receive.receivedConsignment?.acknowledgementPending === true
        )
        stored.set(key, value)
      },
      remove: async key => void stored.delete(key),
    }
    dependencies.transport.acknowledgeConsignment = vi.fn().mockImplementation(async () => {
      expect(persistedAckIntent).toBe(true)
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [
      {
        invoice: rgbInvoice(),
        recipientId: 'recipient',
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60',
        createdAt: 1,
        seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
        pendingAccept: {
          payload: 'consignment',
          txid: 'c'.repeat(64),
          endpoint: proxyEndpoint,
          assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
          amount: '60',
          discoveredAt: 1,
        },
      },
    ]

    await expect(service.acceptReceive('recipient')).resolves.toEqual({
      accepted: true,
      status: 'accepted',
    })
  })

  it('does not reject or cancel a receive once ACK intent is durable', async () => {
    const dependencies = createDependencies()
    dependencies.transport.acknowledgeConsignment = vi.fn()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [
      {
        invoice: rgbInvoice(),
        recipientId: 'recipient',
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60',
        createdAt: 1,
        seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
        pendingAccept: {
          payload: 'consignment',
          txid: 'c'.repeat(64),
          endpoint: proxyEndpoint,
          assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
          amount: '60',
          discoveredAt: 1,
        },
        receivedConsignment: {
          txid: 'c'.repeat(64),
          receivedAt: 1,
          acknowledgementPending: true,
          payload: 'consignment',
          endpoint: proxyEndpoint,
        },
      },
    ]

    await expect(service.rejectReceive('recipient')).rejects.toThrow('was already accepted')
    await expect(service.cancelBlindReceive('recipient')).resolves.toEqual({ cancelled: false })
    expect(dependencies.transport.acknowledgeConsignment).not.toHaveBeenCalledWith(
      expect.objectContaining({ acknowledged: false })
    )
    expect(service.getPendingReceives()).toEqual([
      expect.objectContaining({ recipientId: 'recipient' }),
    ])
  })

  it('keeps an accepted receive available after its invoice expires so it can settle', async () => {
    const dependencies = createDependencies()
    dependencies.now = () => 2_000
    dependencies.transport.getConsignment = vi.fn().mockResolvedValue({
      recipientId: 'recipient',
      payload: 'consignment',
      txid: 'c'.repeat(64),
      endpoint: proxyEndpoint,
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [
      {
        invoice: rgbInvoice(),
        recipientId: 'recipient',
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60',
        expirationTimestamp: 1,
        createdAt: 1,
        seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
        receivedConsignment: {
          txid: 'c'.repeat(64),
          receivedAt: 1,
          accepted: true,
        },
      },
    ]
    ;(service as any).validateIncomingConsignment = vi.fn().mockReturnValue({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      txid: 'c'.repeat(64),
      decoded: {
        metadata: {
          ticker: 'TOK',
          name: 'Token',
          precision: 0,
          schema: 'NIA',
          issuedSupply: '60',
        },
      },
    })
    const advanceAcceptedReceive = vi
      .spyOn(service as any, 'advanceAcceptedReceive')
      .mockResolvedValue(false)

    await service.processClaimedReceives({ includeClaimed: false })

    expect(service.getPendingReceives()).toEqual([
      expect.objectContaining({ recipientId: 'recipient' }),
    ])
    expect(dependencies.transport.getConsignment).toHaveBeenCalledWith({
      recipientId: 'recipient',
      endpoints: [proxyEndpoint],
    })
    expect(advanceAcceptedReceive).toHaveBeenCalled()
  })

  it('does not checkpoint an accepted mempool receive again after recording its broadcast', async () => {
    const dependencies = createDependencies()
    dependencies.onStatePersisted = vi.fn().mockResolvedValue({ verified: true })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.enableRecoveryBackup()
    ;(service as any).state.pendingReceives = [
      {
        invoice: rgbInvoice(),
        recipientId: 'recipient',
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60',
        createdAt: 1,
        seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
        receivedConsignment: {
          txid: 'c'.repeat(64),
          receivedAt: 1,
          accepted: true,
          payload: 'consignment',
          endpoint: proxyEndpoint,
        },
      },
    ]
    ;(service as any).validateIncomingConsignment = vi.fn().mockReturnValue({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      txid: 'c'.repeat(64),
      decoded: {
        metadata: { ticker: 'TOK', name: 'Token', precision: 0, schema: 'NIA', issuedSupply: '60' },
      },
    })
    vi.spyOn(service as any, 'advanceAcceptedReceive').mockImplementation(async (receive: any) => {
      receive.receivedConsignment.broadcastDetectedAt ||= 2
      return false
    })

    await service.processClaimedReceives({ includeClaimed: false })
    expect(dependencies.onStatePersisted).toHaveBeenCalledTimes(2)

    await service.processClaimedReceives({ includeClaimed: false })
    expect(dependencies.onStatePersisted).toHaveBeenCalledTimes(2)
  })

  it('does not cancel an accepted receive awaiting Bitcoin confirmation', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [
      {
        invoice: rgbInvoice(),
        recipientId: 'recipient',
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60',
        createdAt: 1,
        seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
        receivedConsignment: {
          txid: 'c'.repeat(64),
          receivedAt: 1,
          accepted: true,
        },
      },
    ]

    await expect(service.cancelBlindReceive('recipient')).resolves.toEqual({ cancelled: false })
    expect(service.getPendingReceives()).toEqual([
      expect.objectContaining({ recipientId: 'recipient' }),
    ])
  })

  it('releases an accepted receive when the backend publishes a reviewed cancellation', async () => {
    const dependencies = createDependencies()
    dependencies.stateSource.getBroadcastCancellation = vi.fn().mockResolvedValue(true)
    dependencies.transport.getConsignment = vi.fn().mockResolvedValue({
      recipientId: 'recipient',
      payload: 'consignment',
      txid: 'c'.repeat(64),
      endpoint: proxyEndpoint,
    })
    dependencies.transport.getAcknowledgement = vi.fn().mockResolvedValue(false)
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [
      {
        invoice: rgbInvoice(),
        recipientId: 'recipient',
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60',
        createdAt: 1,
        seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
        receivedConsignment: {
          txid: 'c'.repeat(64),
          receivedAt: 1,
          accepted: true,
        },
      },
    ]
    ;(service as any).validateIncomingConsignment = vi.fn().mockReturnValue({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      txid: 'c'.repeat(64),
      decoded: {
        metadata: {
          ticker: 'TOK',
          name: 'Token',
          precision: 0,
          schema: 'NIA',
          issuedSupply: '60',
        },
      },
    })
    const advanceAcceptedReceive = vi.spyOn(service as any, 'advanceAcceptedReceive')

    await service.processClaimedReceives({ includeClaimed: false })

    expect(service.getPendingReceives()).toEqual([])
    expect(service.getPendingReceiveHistory()).toEqual([
      expect.objectContaining({ status: 'canceled', txid: 'c'.repeat(64) }),
    ])
    expect(advanceAcceptedReceive).not.toHaveBeenCalled()
  })

  it('discards a staged receive invoice when the sender cancels before ACK', async () => {
    const dependencies = createDependencies()
    dependencies.transport.getAcknowledgement = vi.fn().mockResolvedValue(false)
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [
      {
        invoice: rgbInvoice(),
        recipientId: 'recipient',
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60',
        createdAt: 1,
        seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
        pendingAccept: {
          payload: 'consignment',
          txid: 'c'.repeat(64),
          endpoint: proxyEndpoint,
          assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
          amount: '60',
          discoveredAt: 1,
        },
      },
    ]

    await service.processClaimedReceives({ includeClaimed: false })

    expect(service.getPendingReceives()).toEqual([])
    expect(service.getPendingReceiveHistory()).toEqual([
      expect.objectContaining({ status: 'canceled', txid: 'c'.repeat(64) }),
    ])
  })

  it('does not abort a send once the recipient acknowledgement starts broadcasting', async () => {
    const dependencies = createDependencies()
    let resolveBroadcast: ((txid: string) => void) | undefined
    const broadcastStarted = new Promise<void>(markBroadcastStarted => {
      dependencies.broadcaster.broadcast = vi.fn(
        () =>
          new Promise<string>(resolve => {
            resolveBroadcast = resolve
            markBroadcastStarted()
          })
      )
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      invoice: rgbInvoice(),
      feeRate: 2,
    })

    await service.completeSend('transfer-1', 'signed-psbt')
    const completing = service.broadcastPendingSend('transfer-1')
    await broadcastStarted

    const aborting = service.abortSend('transfer-1')
    expect(service.getPendingTransfers()).toEqual([
      expect.objectContaining({ id: 'transfer-1', delivery: expect.any(Object) }),
    ])
    resolveBroadcast?.('c'.repeat(64))
    await completing
    await expect(aborting).resolves.toEqual({ aborted: false })
  })

  it('serializes cancellation behind an in-flight send completion', async () => {
    const dependencies = createDependencies()
    let finishEncoding: (() => void) | undefined
    const encodingStarted = new Promise<void>(resolve => {
      vi.mocked(dependencies.encoder.completeTransfer).mockImplementation(
        () =>
          new Promise<RgbCompletedTransfer>(resolveEncoding => {
            finishEncoding = () => {
              resolveEncoding({
                txid: 'c'.repeat(64),
                rawTx: '02000000000000000000',
                consignments: [
                  {
                    recipientId: 'recipient',
                    payload: 'consignment',
                    assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
                    opIds: ['d'.repeat(64)],
                  },
                ],
              })
            }
            resolve()
          })
      )
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      invoice: rgbInvoice(),
      feeRate: 2,
    })

    const completing = service.completeSend('transfer-1', 'signed-psbt')
    await encodingStarted
    const aborting = service.abortSend('transfer-1')
    finishEncoding?.()

    await completing
    await expect(aborting).resolves.toEqual({ aborted: false })
    expect(dependencies.broadcaster.broadcast).not.toHaveBeenCalled()
  })

  it('discards a rejected receive invoice because its proxy recipient ID is single-use', async () => {
    const dependencies = createDependencies()
    dependencies.transport.acknowledgeConsignment = vi.fn().mockResolvedValue(undefined)
    dependencies.transport.getConsignment = vi.fn().mockResolvedValue({
      recipientId: 'recipient',
      payload: 'consignment',
      txid: 'c'.repeat(64),
      endpoint: proxyEndpoint,
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [
      {
        invoice: rgbInvoice(),
        recipientId: 'recipient',
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60',
        createdAt: 1,
        seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
        pendingAccept: {
          payload: 'consignment',
          txid: 'c'.repeat(64),
          endpoint: proxyEndpoint,
          assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
          amount: '60',
          discoveredAt: 1,
        },
        receivedConsignment: {
          txid: 'c'.repeat(64),
          receivedAt: 1,
          accepted: false,
        },
      },
    ]

    await expect(service.rejectReceive('recipient')).resolves.toEqual({ rejected: true })

    expect(dependencies.transport.acknowledgeConsignment).toHaveBeenCalledWith({
      recipientId: 'recipient',
      endpoints: [proxyEndpoint],
      acknowledged: false,
    })
    expect(service.getPendingReceives()).toEqual([])
    expect(service.getPendingReceiveHistory()).toEqual([
      expect.objectContaining({
        transferId: 'receive:recipient',
        status: 'rejected',
        txid: 'c'.repeat(64),
      }),
    ])
  })

  it('discards an Any Amount invoice after rejecting a consignment', async () => {
    const dependencies = createDependencies()
    dependencies.transport.acknowledgeConsignment = vi.fn().mockResolvedValue(undefined)
    dependencies.transport.getConsignment = vi.fn().mockResolvedValue({
      recipientId: 'recipient',
      payload: 'received-consignment',
      txid: 'c'.repeat(64),
      endpoint: proxyEndpoint,
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [
      {
        invoice: rgbInvoice(),
        recipientId: 'recipient',
        createdAt: 1,
        seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
      },
    ]
    ;(service as any).validateIncomingConsignment = vi.fn().mockReturnValue({
      decoded: {
        metadata: {
          ticker: 'TOK',
          name: 'Token',
          precision: 2,
          schema: 'NIA',
          issuedSupply: '1000',
        },
      },
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '1000',
      txid: 'c'.repeat(64),
      opId: 'd'.repeat(64),
      assignmentIndex: 0,
    })
    await service.processClaimedReceives({ includeClaimed: false })
    await service.rejectReceive('recipient')

    expect(service.getPendingReceives()).toEqual([])
  })

  it('persists a signed transfer without broadcasting until the proxy returns an acknowledgement', async () => {
    const dependencies = createDependencies()
    vi.mocked(dependencies.transport.getAcknowledgement!).mockResolvedValueOnce(undefined)
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      invoice: rgbInvoice(),
      feeRate: 2,
    })

    await expect(service.completeSend('transfer-1', 'signed-psbt')).rejects.toThrow(
      'awaiting recipient acknowledgement'
    )
    expect(dependencies.broadcaster.broadcast).not.toHaveBeenCalled()
    expect(service.getPendingTransfers()).toEqual([
      expect.objectContaining({ id: 'transfer-1', delivery: expect.any(Object) }),
    ])
    await expect(service.broadcastPendingSend('transfer-1')).rejects.toThrow(
      'not ready for sender broadcast'
    )

    vi.mocked(dependencies.transport.getAcknowledgement!).mockResolvedValueOnce(true)
    await service.sync()

    expect(service.getPendingTransfers()[0]?.delivery?.acknowledgedAt).toEqual(expect.any(Number))
    expect(dependencies.broadcaster.broadcast).not.toHaveBeenCalled()
    await service.broadcastPendingSend('transfer-1')
    expect(dependencies.broadcaster.broadcast).toHaveBeenCalledTimes(1)
    expect(service.getPendingTransfers()).toEqual([])
  })

  it('explains when a proxy rejects an invoice that was already used', async () => {
    const dependencies = createDependencies()
    dependencies.transport.publishConsignment = vi
      .fn()
      .mockRejectedValue(
        new Error('RGB proxy consignment.post failed: Cannot change uploaded file')
      )
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      invoice: rgbInvoice(),
      feeRate: 2,
    })

    await expect(service.completeSend('transfer-1', 'signed-psbt')).rejects.toMatchObject({
      name: 'RgbInvoiceUnavailableError',
      code: 'RGB_INVOICE_UNAVAILABLE',
    })
    expect(dependencies.broadcaster.broadcast).not.toHaveBeenCalled()
    expect(service.getPendingTransfers()).toEqual([])
  })

  it('continues syncing while a signed transfer awaits recipient acknowledgement', async () => {
    const dependencies = createDependencies()
    vi.mocked(dependencies.transport.getAcknowledgement!).mockResolvedValue(undefined)
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      invoice: rgbInvoice(),
      feeRate: 2,
    })

    await expect(service.completeSend('transfer-1', 'signed-psbt')).rejects.toThrow(
      'awaiting recipient acknowledgement'
    )
    const snapshot = service.getSnapshot()
    vi.mocked(dependencies.stateSource.getSnapshot).mockResolvedValue({
      ...snapshot,
      utxos: [
        ...snapshot.utxos,
        {
          outpoint: { txid: 'e'.repeat(64), vout: 0 },
          satoshis: 330,
          scriptPubKey: '5120' + 'ee'.repeat(32),
          publicKey: '02' + '44'.repeat(32),
          chainStatus: 'confirmed',
          allocations: [],
        },
      ],
    })
    await expect(service.sync()).resolves.toEqual(
      expect.objectContaining({ utxos: expect.any(Array) })
    )
    await expect(service.createBlindReceive({})).resolves.toEqual(
      expect.objectContaining({ invoice: expect.stringMatching(/^rgb:/) })
    )

    expect(service.getPendingTransfers()).toEqual([
      expect.objectContaining({ id: 'transfer-1', delivery: expect.any(Object) }),
    ])
    expect(dependencies.broadcaster.broadcast).not.toHaveBeenCalled()
  })

  it('persists a broadcast failure after acknowledgement and retries the signed transaction', async () => {
    const dependencies = createDependencies()
    vi.mocked(dependencies.broadcaster.broadcast)
      .mockRejectedValueOnce(new Error('broadcast unavailable'))
      .mockResolvedValueOnce('c'.repeat(64))
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      invoice: rgbInvoice(),
      feeRate: 2,
    })

    await service.completeSend('transfer-1', 'signed-psbt')
    await expect(service.broadcastPendingSend('transfer-1')).rejects.toThrow(
      'broadcast unavailable'
    )
    expect(service.getPendingTransfers()).toEqual([
      expect.objectContaining({
        id: 'transfer-1',
        delivery: expect.objectContaining({
          acknowledgedAt: expect.any(Number),
          broadcastError: 'broadcast unavailable',
        }),
      }),
    ])

    const reopened = new RgbService(dependencies)
    await reopened.open(wallet)
    expect(reopened.getPendingTransfers()).toEqual([
      expect.objectContaining({
        id: 'transfer-1',
        delivery: expect.objectContaining({ broadcastError: 'broadcast unavailable' }),
      }),
    ])

    await reopened.sync()
    expect(dependencies.broadcaster.broadcast).toHaveBeenCalledTimes(1)
    await reopened.broadcastPendingSend('transfer-1')
    expect(dependencies.broadcaster.broadcast).toHaveBeenCalledTimes(2)
    expect(reopened.getPendingTransfers()).toEqual([])
  })

  it('keeps a below-relay-fee transfer retryable', async () => {
    const dependencies = createDependencies()
    dependencies.transport.acknowledgeConsignment = vi.fn().mockResolvedValue(undefined)
    vi.mocked(dependencies.broadcaster.broadcast).mockRejectedValue(
      new Error('Error: min relay fee not met, 23 < 26')
    )
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      invoice: rgbInvoice(),
      feeRate: 2,
    })

    await service.completeSend('transfer-1', 'signed-psbt')
    await expect(service.broadcastPendingSend('transfer-1')).rejects.toThrow('min relay fee not met')
    expect(service.getPendingTransfers()[0]?.delivery?.broadcastError).toContain('min relay fee not met')
    expect(dependencies.transport.acknowledgeConsignment).not.toHaveBeenCalled()
    expect(service.getPendingSendHistory()).toEqual([])
  })

  it('treats a broadcast exception as successful when the txid is in the mempool', async () => {
    const dependencies = createDependencies()
    vi.mocked(dependencies.broadcaster.broadcast).mockRejectedValue(
      new Error('broadcast request timed out')
    )
    dependencies.stateSource.getTransactionStatus = vi.fn().mockResolvedValue({
      status: 'mempool',
      confirmations: 0,
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    const retainCompletedLocalHistory = vi.spyOn(service as any, 'retainCompletedLocalHistory')
    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      invoice: rgbInvoice(),
      feeRate: 2,
    })

    await service.completeSend('transfer-1', 'signed-psbt')
    await expect(service.broadcastPendingSend('transfer-1')).resolves.toMatchObject({
      txid: 'c'.repeat(64),
    })
    expect(dependencies.stateSource.getTransactionStatus).toHaveBeenCalledWith(
      wallet,
      'c'.repeat(64)
    )
    expect(retainCompletedLocalHistory).toHaveBeenCalledWith(
      expect.objectContaining({ txid: 'c'.repeat(64) })
    )
    expect(service.getPendingTransfers()).toEqual([])
  })

  it('keeps a transfer retryable when its failed broadcast txid is not found on-chain', async () => {
    const dependencies = createDependencies()
    dependencies.stateSource.reportBroadcastFailure = vi.fn()
      .mockRejectedValueOnce(new Error('backend offline'))
      .mockResolvedValue(undefined)
    dependencies.transport.acknowledgeConsignment = vi.fn().mockResolvedValue(undefined)
    vi.mocked(dependencies.broadcaster.broadcast).mockRejectedValue(
      new Error('broadcast unavailable')
    )
    dependencies.stateSource.getTransactionStatus = vi.fn().mockResolvedValue({
      status: 'unknown',
      confirmations: 0,
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      invoice: rgbInvoice(),
      feeRate: 2,
    })

    await service.completeSend('transfer-1', 'signed-psbt')
    await expect(service.broadcastPendingSend('transfer-1')).rejects.toThrow('broadcast unavailable')
    expect(service.getPendingTransfers()[0]?.delivery?.broadcastError).toBe('broadcast unavailable')
    expect(dependencies.transport.acknowledgeConsignment).not.toHaveBeenCalled()
    await service.processBroadcastCancellations()
    expect(dependencies.stateSource.reportBroadcastFailure).toHaveBeenCalledTimes(2)
  })

  it('retains a replaced transfer until an admin publishes cancellation', async () => {
    const dependencies = createDependencies()
    dependencies.transport.acknowledgeConsignment = vi.fn().mockResolvedValue(undefined)
    dependencies.broadcaster.broadcast = vi
      .fn()
      .mockRejectedValue(new Error('bad-txns-inputs-missingorspent'))
    dependencies.stateSource.getTransactionStatus = vi.fn().mockResolvedValue({
      status: 'replaced',
      confirmations: 0,
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      invoice: rgbInvoice(),
      feeRate: 2,
    })

    await service.completeSend('transfer-1', 'signed-psbt')
    await expect(service.broadcastPendingSend('transfer-1')).rejects.toThrow('bad-txns-inputs-missingorspent')

    expect(service.getPendingTransfers()[0]?.delivery?.broadcastError).toContain('bad-txns-inputs-missingorspent')
    expect(dependencies.stateSource.getTransactionStatus).toHaveBeenCalledWith(
      wallet,
      'c'.repeat(64)
    )
    expect(service.getPendingSendHistory()).toEqual([])
    expect(dependencies.transport.acknowledgeConsignment).not.toHaveBeenCalled()
    dependencies.stateSource.getBroadcastCancellation = vi.fn().mockResolvedValue(true)
    await expect(service.processBroadcastCancellations()).resolves.toBe(1)
    expect(service.getPendingTransfers()).toEqual([])
    expect(service.getPendingSendHistory()).toEqual([
      expect.objectContaining({ transferId: 'transfer-1', status: 'canceled' }),
    ])
  })

  it('releases an accepted receive only for a reviewed backend cancellation', async () => {
    const dependencies = createDependencies()
    dependencies.transport.getAcknowledgement = vi.fn().mockResolvedValue(false)
    dependencies.stateSource.getBroadcastCancellation = vi.fn().mockResolvedValue(true)
    const service = new RgbService(dependencies)
    await service.open(wallet)
    const receive = {
      invoice: rgbInvoice(),
      recipientId: 'recipient',
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      createdAt: 1,
      seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
      receivedConsignment: {
        txid: 'c'.repeat(64),
        receivedAt: 1,
        accepted: true,
        payload: 'consignment',
        endpoint: proxyEndpoint,
      },
    }

    await expect(
      (service as any).isAcceptedReceiveTerminallyCanceled(receive, proxyEndpoint)
    ).resolves.toBe(true)
  })

  it('discards an unsigned send without adding a canceled transfer to history', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    const prepared = await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      invoice: rgbInvoice(),
      feeRate: 2,
    })

    await expect(service.abortSend(prepared.id, { discardUnsigned: true })).resolves.toEqual({
      aborted: true,
      status: 'discarded',
    })
    expect(service.getPendingTransfers()).toEqual([])
    expect(service.getPendingSendHistory()).toEqual([])

    const reopened = new RgbService(dependencies)
    await reopened.open(wallet)
    expect(reopened.getPendingTransfers()).toEqual([])
    expect(reopened.getPendingSendHistory()).toEqual([])
  })

  it('allows the sender to abort a delivered transfer before it is broadcast', async () => {
    const dependencies = createDependencies()
    vi.mocked(dependencies.transport.getAcknowledgement!).mockResolvedValueOnce(undefined)
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      invoice: rgbInvoice(),
      feeRate: 2,
    })

    await expect(service.completeSend('transfer-1', 'signed-psbt')).rejects.toThrow(
      'awaiting recipient acknowledgement'
    )
    expect(service.getPendingTransfers()).toEqual([
      expect.objectContaining({ id: 'transfer-1', delivery: expect.any(Object) }),
    ])

    await expect(service.abortSend('transfer-1', { discardUnsigned: true })).resolves.toEqual({
      aborted: true,
      status: 'canceled',
    })
    expect(service.getPendingTransfers()).toEqual([])
    expect(service.getPendingSendHistory()).toEqual([
      expect.objectContaining({ transferId: 'transfer-1', status: 'canceled', amount: '60' }),
    ])
    expect(dependencies.broadcaster.broadcast).not.toHaveBeenCalled()
  })

  it('retains a broadcast transfer and retries delivery without rebroadcasting', async () => {
    const dependencies = createDependencies()
    vi.mocked(dependencies.stateSource.syncBroadcast)
      .mockRejectedValueOnce(new Error('indexer unavailable'))
      .mockResolvedValueOnce(undefined)
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      invoice: rgbInvoice(),
      feeRate: 2,
    })

    await service.completeSend('transfer-1', 'signed-psbt')
    await expect(service.broadcastPendingSend('transfer-1')).rejects.toThrow(
      'indexer unavailable'
    )
    expect(service.getPendingTransfers()).toEqual([
      expect.objectContaining({ id: 'transfer-1', broadcast: expect.any(Object) }),
    ])
    await expect(service.abortSend('transfer-1')).resolves.toEqual({ aborted: false })

    const reopened = new RgbService(dependencies)
    await reopened.open(wallet)
    await reopened.sync()

    expect(dependencies.broadcaster.broadcast).toHaveBeenCalledTimes(1)
    expect(reopened.getPendingTransfers()).toEqual([])
    expect(dependencies.stateSource.syncBroadcast).toHaveBeenCalledTimes(2)
  })

  it('replaces spent funding UTXOs with the locally derived RGB change output after broadcast', async () => {
    const dependencies = createDependencies()
    vi.mocked(dependencies.encoder.completeTransfer).mockResolvedValue({
      txid: 'e'.repeat(64),
      rawTx: '02000000000000000000',
      consignments: [
        {
          recipientId: 'recipient',
          payload: 'consignment',
          assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
          opIds: ['d'.repeat(64)],
        },
      ],
      fundingUpdate: {
        spentOutpoints: [{ txid: 'b'.repeat(64), vout: 1 }],
        createdUtxo: {
          outpoint: { txid: 'e'.repeat(64), vout: 1 },
          satoshis: 700,
          scriptPubKey: '5120' + '11'.repeat(32),
          publicKey: '02' + '22'.repeat(32),
          allocations: [
            {
              assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
              amount: '40',
              settled: true,
              spendable: true,
              opId: 'd'.repeat(64),
              assignmentIndex: 1,
              assignmentType: 4000,
            },
          ],
        },
      },
    })
    vi.mocked(dependencies.broadcaster.broadcast).mockResolvedValue('e'.repeat(64))
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      invoice: rgbInvoice(),
      feeRate: 2,
    })
    await service.completeSend('transfer-1', 'signed-psbt')
    await service.broadcastPendingSend('transfer-1')

    expect(service.getSnapshot().utxos.map(utxo => utxo.outpoint)).toEqual([
      { txid: 'a'.repeat(64), vout: 0 },
      { txid: 'e'.repeat(64), vout: 1 },
    ])
    expect(service.getLocalAssetBalance('rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE')).toMatchObject({
      settled: '40',
      spendable: '40',
      pending: '40',
    })

    // The indexer has not yet observed the funding transaction and still
    // reports the spent 60-unit allocation. Do not regress the local balance.
    await service.sync()
    expect(service.getSnapshot().utxos.map(utxo => utxo.outpoint)).toEqual([
      { txid: 'a'.repeat(64), vout: 0 },
      { txid: 'e'.repeat(64), vout: 1 },
    ])

    // As soon as the remote snapshot no longer contains the spent outpoint,
    // normal snapshot synchronization resumes.
    vi.mocked(dependencies.stateSource.getSnapshot).mockResolvedValue({
      syncedAt: 2,
      utxos: [
        {
          outpoint: { txid: 'a'.repeat(64), vout: 0 },
          satoshis: 1000,
          scriptPubKey: '5120' + '00'.repeat(32),
          publicKey: '02' + '11'.repeat(32),
          allocations: [
            {
              assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
              amount: '40',
              settled: true,
              spendable: true,
              opId: 'c'.repeat(64),
              assignmentIndex: 0,
              assignmentType: 4000,
            },
          ],
        },
        {
          outpoint: { txid: 'e'.repeat(64), vout: 1 },
          satoshis: 700,
          scriptPubKey: '5120' + '11'.repeat(32),
          publicKey: '02' + '22'.repeat(32),
          allocations: [
            {
              assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
              amount: '40',
              settled: true,
              spendable: true,
              opId: 'd'.repeat(64),
              assignmentIndex: 1,
              assignmentType: 4000,
            },
          ],
        },
      ],
    })
    await service.sync()
    expect(service.getSnapshot().syncedAt).toBe(2)
    expect(service.getLocalAssetBalance('rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE')).toMatchObject({ balance: '80' })
  })

  it('checkpoints only irreversible RGB send milestones', async () => {
    const dependencies = createDependencies()
    dependencies.onStatePersisted = vi.fn().mockResolvedValue({ verified: true })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.enableRecoveryBackup()
    await service.sync()
    vi.mocked(dependencies.onStatePersisted).mockClear()

    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      invoice: rgbInvoice(),
      feeRate: 2,
    })
    expect(dependencies.onStatePersisted).not.toHaveBeenCalled()

    await service.completeSend('transfer-1', 'signed-psbt')
    await service.broadcastPendingSend('transfer-1')

    // Signed state, recipient ACK, and successful Bitcoin broadcast are the
    // only non-replayable milestones. Publishing and history bookkeeping are
    // recoverable from those checkpoints and stay local.
    expect(dependencies.onStatePersisted).toHaveBeenCalledTimes(3)
  })
})
