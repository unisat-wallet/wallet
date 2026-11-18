import { Psbt, Transaction } from 'bitcoinjs-lib'
import { describe, expect, it, vi } from 'vitest'
import type {
  RgbCompletedTransfer,
  RgbServiceDependencies,
  RgbValidationHistory,
  RgbWalletRef,
  RgbWalletSnapshot,
} from '../src'
import {
  appendRgbInvoiceRecipientNonce,
  encodeNiaContract,
  encodeNiaGenesis,
  encodeNiaTransferConsignment,
  encodeBlindRgbInvoice,
  encodeWitnessRgbInvoice,
  encodeRgbContractId,
  decodeNiaConsignment,
  decodeRgbInvoice,
  deriveProxyV1SealBlinding,
  prepareNiaOpretTransfer,
  proxyV1SenderPublicKey,
  proxyV1SenderTransferId,
  serializeNiaOpretWitnessBundle,
  signProxyV1SenderMessage,
  rgbProxyInvoiceId,
  RgbBfaValidationUnavailableError,
  RgbInsufficientBalanceError,
  RgbMissingAncestorError,
  RgbProxyAlreadyAcknowledgedError,
  RgbProxyOperationNotFoundError,
  RgbService,
  RgbServiceError,
} from '../src'
import {
  BFA_SCHEMA_ID,
  encodeBfaContractConsignment,
  encodeBfaTransferConsignment,
  isSupportedV1TransferConsignment,
  LEGACY_BFA_SCHEMA_ID,
  NIA_V1_SCHEMA_ID,
} from '../src/protocol/bfa-consignment'
import { serializeBfaOpretWitnessBundle } from '../src/protocol/consignment'
import { validateBfaTransferConsignment } from '../src/protocol/bfa-validator'

const wallet: RgbWalletRef = {
  walletId: 'rgb-wallet-1',
  fundingAddress: 'bc1p-rgb-funding',
  network: 'mainnet',
}

const blindRecipient = 'bc:utxob:xDfmDF9g-yNOjriV-6Anbe6H-MLJ__g6-lo7Dd4f-dhWBW8S-XYGBm'
const proxyEndpoint = 'rpcs://proxy.example/json-rpc'
const rgbInvoice = (amount = 60) =>
  `rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE/~/~/${blindRecipient}?amount=${amount}&endpoints=${encodeURIComponent(proxyEndpoint)}`

function receiveAnchorTransaction(marker = 0, witnessMarker?: number) {
  const transaction = new Transaction()
  transaction.version = 2
  transaction.addInput(Buffer.alloc(32, marker), 0)
  transaction.addOutput(Buffer.from([0x6a, marker]), 0)
  if (witnessMarker !== undefined) transaction.setWitness(0, [Buffer.from([witnessMarker])])
  return { rawTx: transaction.toHex(), txid: transaction.getId() }
}

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
      testTransactionAcceptance: vi.fn().mockResolvedValue({
        txid: 'c'.repeat(64),
        allowed: true,
      }),
    },
    validateBfaConsignment: ({ payload, pendingWitnessTxid, allowPendingLastWitness, requiredOperationIds, knownBlindSeals }) =>
      validateBfaTransferConsignment(payload, {
        network: 0,
        isBitcoinTxConfirmed: async () => true,
        ...(pendingWitnessTxid ? { pendingWitnessTxid } : {}),
        ...(allowPendingLastWitness ? { allowPendingLastWitness: true } : {}),
        ...(requiredOperationIds ? { requiredOperationIds } : {}),
        knownBlindSeals,
      }),
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
  it('uploads canonical history once and persists the content-addressed delivery cursor', async () => {
    const dependencies = createDependencies()
    dependencies.stateSource.storeValidationHistory = vi.fn(async (_wallet, fragment) => ({
      stored: true as const,
      payloadHash: fragment.payloadHash,
    }))
    const service = new RgbService(dependencies)
    await service.open(wallet)
    const state = (service as any).state
    const assetId = 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE'
    state.contracts = {}
    state.contracts[assetId] = {
      consignment: 'Y29udHJhY3Q=',
      history: { payload: 'aGlzdG9yeQ==', opIds: ['a'.repeat(64)] },
      createdAt: 1,
    }

    expect(service.getPendingHistoryFragments()).toEqual([
      expect.objectContaining({ assetId, payload: 'aGlzdG9yeQ==', opIds: ['a'.repeat(64)] }),
    ])
    const [{ payloadHash }] = service.getPendingHistoryFragments()
    state.pendingUtxoSync = {
      txid: 'b'.repeat(64),
      outpoints: [{
        outpoint: { txid: 'b'.repeat(64), vout: 0 },
        satoshis: 330,
        scriptPubKey: '5120' + '11'.repeat(32),
        publicKey: '02' + '11'.repeat(32),
        allocations: [{
          assetId, amount: '1', settled: true, spendable: true,
          opId: 'a'.repeat(64), assignmentIndex: 0, assignmentType: 4000,
        }],
      }],
    }
    expect(service.getPendingUtxoSync()?.outpoints[0].allocations[0].historyRef).toBe(payloadHash)
    await expect(service.syncPendingHistoryFragments()).resolves.toBe(true)
    await expect(service.syncPendingHistoryFragments()).resolves.toBe(false)
    expect(dependencies.stateSource.storeValidationHistory).toHaveBeenCalledTimes(1)

    const reopened = new RgbService(dependencies)
    await reopened.open(wallet)
    expect(reopened.getPendingHistoryFragments()).toEqual([])
  })

  it('grants legacy witness blinding fallback only to proxy invoices migrated from old state', async () => {
    const dependencies = createDependencies()
    await dependencies.storage.set(
      `rgb-service:v1:${wallet.network}:${wallet.fundingAddress}`,
      {
        version: 1,
        wallet,
        snapshot: { utxos: [], syncedAt: 1 },
        pending: {},
        pendingReceives: [{
          invoice: 'legacy', recipientId: 'recipient', recipientType: 'witness',
          proxyPrivateKey: '44'.repeat(32), createdAt: 1,
        }],
      } as any
    )
    const service = new RgbService(dependencies)
    await service.open(wallet)

    expect((service as any).state).toMatchObject({ witnessBlindingPolicyVersion: 1 })
    expect(service.getPendingReceives()[0]).toMatchObject({ allowLegacyWitnessBlinding: true })

    const fresh = new RgbService(createDependencies())
    await fresh.open(wallet)
    expect((fresh as any).state).toMatchObject({ witnessBlindingPolicyVersion: 1 })
  })

  it('reports an active send lock separately from settled and available amounts', async () => {
    const service = new RgbService(createDependencies())
    await service.open(wallet)
    await service.sync()
    const state = (service as any).state
    const assetId = state.snapshot.utxos[0].allocations[0].assetId
    const lockedOutpoint = state.snapshot.utxos[0].outpoint
    state.pending['waiting-for-ack'] = {
      request: { assetId, amount: '20' },
      prepared: { lockedOutpoints: [lockedOutpoint] },
      createdAt: 1,
    }

    expect(service.getLocalAssetBalance(assetId)).toMatchObject({
      settled: '100', spendable: '60', pending: '0', lockedAmount: '40',
    })
  })

  it('rejects carrier abandonment when an outpoint contains another RGB asset', async () => {
    const service = new RgbService(createDependencies())
    await service.open(wallet)
    await service.sync()
    const state = (service as any).state
    const assetId = state.snapshot.utxos[0].allocations[0].assetId
    state.snapshot.utxos[0].allocations.push({
      ...state.snapshot.utxos[0].allocations[0],
      assetId: 'rgb:AgICAgIC-AgICAgI-CAgICAg-ICAgICA-gICAgIC-AgICAgI',
    })

    expect(() => service.getAssetAbandonmentPlan(assetId)).toThrow(
      'RGB carrier also contains another asset'
    )
  })

  it('compacts an abandoned asset after all exclusive carriers are spent', async () => {
    const service = new RgbService(createDependencies())
    await service.open(wallet)
    await service.sync()
    const state = (service as any).state
    const assetId = state.snapshot.utxos[0].allocations[0].assetId
    state.snapshot.utxos.forEach((utxo: any) => { utxo.chainStatus = 'confirmed' })
    state.contracts = {
      [assetId]: {
        consignment: Buffer.alloc(1024).toString('base64'),
        metadata: { ticker: 'OLD', name: 'Old', precision: 0, schema: 'NIA', issuedSupply: '100' },
        createdAt: 1,
      },
    }
    state.validatedV1SendHistories = { [assetId]: { large: 'cache' } }
    state.pendingSendHistory = [{
      transferId: 'old-send', assetId, amount: '1', createdAt: 1, status: 'broadcasted',
    }]
    const plan = service.getAssetAbandonmentPlan(assetId)

    await expect(service.finalizeAssetAbandonment(
      assetId,
      'e'.repeat(64),
      plan.utxos.map(utxo => ({ txid: utxo.txid, vout: utxo.vout }))
    )).resolves.toMatchObject({ discarded: true, assetId, txid: 'e'.repeat(64) })

    expect(service.getLocalAssetBalance(assetId)).toBeUndefined()
    expect(state.contracts[assetId]).toBeUndefined()
    expect(state.validatedV1SendHistories[assetId]).toBeUndefined()
    expect(state.pendingSendHistory).toEqual([])
    expect(state.discardedAssets[assetId]).toMatchObject({ txid: 'e'.repeat(64) })

    // The indexer can briefly return its pre-broadcast snapshot. The durable
    // tombstone must prevent that stale carrier from restoring the asset.
    await service.sync()
    expect(service.getLocalAssetBalance(assetId)).toBeUndefined()
  })

  it('recovers an indexed broadcast restored as a prepared reservation', async () => {
    const dependencies = createDependencies()
    dependencies.stateSource.getTransactionStatus = vi.fn().mockResolvedValue({
      status: 'mempool',
      confirmations: 0,
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60', invoice: rgbInvoice(), feeRate: 2,
    })

    await expect(service.reconcileIndexedBroadcast({
      transferId: 'transfer-1',
      txid: 'c'.repeat(64),
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
    })).resolves.toBe(true)

    expect(service.getPendingTransfers()).toEqual([])
    expect(service.getPendingSendHistory()).toEqual([
      expect.objectContaining({
        transferId: 'transfer-1',
        txid: 'c'.repeat(64),
        status: 'broadcasted',
        spentOutpoints: [{ txid: 'b'.repeat(64), vout: 1 }],
      }),
    ])
  })

  it('does not trust an indexed send whose transaction is absent from the chain source', async () => {
    const dependencies = createDependencies()
    dependencies.stateSource.getTransactionStatus = vi.fn().mockResolvedValue({
      status: 'not_found',
      confirmations: 0,
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60', invoice: rgbInvoice(), feeRate: 2,
    })

    await expect(service.reconcileIndexedBroadcast({
      transferId: 'transfer-1', txid: 'c'.repeat(64), amount: '60',
    })).resolves.toBe(false)
    expect(service.getPendingTransfers()).toHaveLength(1)
    expect(service.getPendingSendHistory()).toEqual([])
  })

  it('releases a signed send rejected by mempool preflight before publishing it', async () => {
    const dependencies = createDependencies()
    dependencies.stateSource.testTransactionAcceptance = vi.fn().mockResolvedValue({
      txid: 'c'.repeat(64),
      allowed: false,
      rejectReason: 'bad-txns-inputs-missingorspent',
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60', invoice: rgbInvoice(), feeRate: 2,
    })

    await expect(service.completeSend('transfer-1', 'signed-psbt'))
      .rejects.toThrow('bad-txns-inputs-missingorspent')

    expect(dependencies.stateSource.testTransactionAcceptance).toHaveBeenCalledWith(
      wallet,
      '02000000000000000000'
    )
    expect(dependencies.transport.publishConsignment).not.toHaveBeenCalled()
    expect(dependencies.broadcaster.broadcast).not.toHaveBeenCalled()
    expect(service.getPendingTransfers()).toEqual([])
    expect(service.getPendingSendHistory()).toEqual([])
    expect(service.getLocalAssetBalance(
      'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE'
    )?.spendable).toBe('100')

    const reopened = new RgbService(dependencies)
    await reopened.open(wallet)
    expect(reopened.getPendingTransfers()).toEqual([])
  })

  it('keeps a signed send retryable when mempool preflight is unavailable', async () => {
    const dependencies = createDependencies()
    dependencies.stateSource.testTransactionAcceptance = vi.fn().mockRejectedValue(
      new Error('Bitcoin RPC unavailable')
    )
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60', invoice: rgbInvoice(), feeRate: 2,
    })

    await expect(service.completeSend('transfer-1', 'signed-psbt'))
      .rejects.toThrow('Bitcoin RPC unavailable')

    expect(dependencies.transport.publishConsignment).not.toHaveBeenCalled()
    expect(service.getPendingTransfers()).toHaveLength(1)
  })

  it('does not count both sides of a self-transfer while its source UTXO is still active', async () => {
    const service = new RgbService(createDependencies())
    await service.open(wallet)
    await service.sync()
    const state = (service as any).state
    const assetId = state.snapshot.utxos[0].allocations[0].assetId
    const source = state.snapshot.utxos[1]
    const invoice = rgbInvoice(10)
    const txid = 'e'.repeat(64)
    state.pending['self-send'] = {
      request: { assetId, amount: '10', invoice },
      prepared: { lockedOutpoints: [source.outpoint] },
      delivery: { completed: { txid } },
      createdAt: 1,
    }
    state.pendingReceives = [{
      invoice, recipientId: 'self', createdAt: 1,
      receivedConsignment: { accepted: true, assetId, amount: '10', txid, receivedAt: 1 },
    }]

    const total = () => {
      const balance = service.getLocalAssetBalance(assetId)!
      return BigInt(balance.settled) + BigInt(balance.pending)
    }
    expect(total()).toBe(100n)
    expect(service.getLocalAssetBalance(assetId)?.incomingPending).toBe('10')

    state.snapshot.utxos.push(
      { ...source, outpoint: { txid, vout: 0 }, allocations: [{ ...source.allocations[0], amount: '10', settled: false, spendable: false }] },
      { ...source, outpoint: { txid, vout: 1 }, allocations: [{ ...source.allocations[0], amount: '50', settled: false, spendable: false }] },
    )
    expect(total()).toBe(100n)

    state.pendingSendHistory = [{
      transferId: 'self-send', invoice, assetId, amount: '10', txid,
      spentOutpoints: [source.outpoint], createdAt: 1, status: 'broadcasted',
    }]
    delete state.pending['self-send']
    expect(total()).toBe(100n)

    const [pendingReceive] = state.pendingReceives
    state.pendingReceiveHistory = [{
      transferId: 'receive:self', assetId, amount: '10', txid,
      createdAt: 1, status: 'settled',
    }]
    state.pendingReceives = []
    expect(total()).toBe(100n)
    state.pendingReceives = [pendingReceive]

    source.chainStatus = 'spent'
    expect(service.getLocalAssetBalance(assetId)).toMatchObject({
      settled: '40', pending: '60', incomingPending: '10',
    })
    expect(total()).toBe(100n)

    for (const utxo of state.snapshot.utxos.slice(-2)) {
      utxo.allocations[0].settled = true
      utxo.allocations[0].spendable = true
    }
    expect(service.getLocalAssetBalance(assetId)).toMatchObject({
      settled: '100', pending: '0', incomingPending: '0',
    })
  })

  it('shows unconfirmed BFA burn change as locked until it settles', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    const assetId = 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE'
    const txid = 'e'.repeat(64)
    await service.open(wallet)
    const state = (service as any).state
    state.pendingSendHistory = [{
      transferId: 'burn-1', assetId, amount: '20', txid, burn: true,
      createdAt: 1, status: 'broadcasted',
    }]
    state.snapshot.utxos = [{
      outpoint: { txid, vout: 0 }, satoshis: 1000,
      scriptPubKey: `5120${'00'.repeat(32)}`, publicKey: `02${'11'.repeat(32)}`,
      chainStatus: 'mempool', confirmations: 0,
      allocations: [{ assetId, amount: '40', settled: false, spendable: false }],
    }]

    expect(service.getLocalAssetBalance(assetId)).toMatchObject({
      spendable: '0', pending: '0', lockedAmount: '40',
    })

    // The indexer can report other UTXOs before it reports the burn change.
    // That stale response must not erase the locally known locked balance.
    ;(dependencies.stateSource.getSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue({
      syncedAt: 2, utxos: [{
        outpoint: { txid: 'f'.repeat(64), vout: 0 }, satoshis: 1000,
        scriptPubKey: `5120${'22'.repeat(32)}`, publicKey: `02${'33'.repeat(32)}`,
        allocations: [],
      }],
    })
    let outputConfirmed = false
    dependencies.stateSource.verifyUtxos = vi.fn(async (_wallet, outpoints) =>
      outpoints.map(utxo => ({
        outpoint: utxo.outpoint,
        status: outputConfirmed ? 'confirmed' as const : 'mempool' as const,
        confirmations: outputConfirmed ? 1 : 0,
      }))
    )
    await service.sync()
    expect(service.getLocalAssetBalance(assetId)?.lockedAmount).toBe('40')

    outputConfirmed = true
    await service.sync()
    expect(service.getLocalAssetBalance(assetId)).toMatchObject({
      spendable: '40', pending: '0',
    })
    expect(service.getLocalAssetBalance(assetId)?.lockedAmount).toBeUndefined()
    expect(service.getPendingUtxoSync()?.outpoints[0]?.allocations[0]).toMatchObject({
      settled: true, spendable: true,
    })
    await service.markUtxoSyncCompleted(txid)
    await service.sync()
    expect(service.getLocalAssetBalance(assetId)?.spendable).toBe('40')

    // A replica can return the output while still carrying the old pending allocation.
    ;(dependencies.stateSource.getSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue({
      syncedAt: 3,
      utxos: [{
        ...state.snapshot.utxos[0], chainStatus: 'confirmed', confirmations: 1,
        allocations: [{ ...state.snapshot.utxos[0].allocations[0], settled: false, spendable: false }],
      }],
    })
    await service.sync()
    expect(service.getLocalAssetBalance(assetId)?.spendable).toBe('40')
  })

  it.each([
    { label: 'legacy direct', burnReason: '0xf39FD6e51aad88f6f4ce6ab8827279cfffb92266',
      burnDestination: undefined,
      expectedReason: '000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266' },
    { label: 'V1 LayerZero', burnReason: undefined,
      burnDestination: { version: 1 as const, destinationChainId: 1, dstEid: 30101,
        recipient: '22'.repeat(20) },
      expectedReason: '9274beba7130d3f8a4ef95c5c4c555616718050c688f8478e23f8131762a9537' },
  ])('broadcasts a $label BFA burn and retains its proof after reopening', async ({ burnReason, burnDestination, expectedReason }) => {
    const dependencies = createDependencies()
    dependencies.onBurnBroadcasted = vi.fn()
    const service = new RgbService(dependencies)
    const assetId = 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE'
    const txid = 'c'.repeat(64)
    const proof = Buffer.from('RGB\0TFRburn-proof')
    dependencies.encoder.prepareBurn = vi.fn().mockResolvedValue({
      id: 'burn-1', psbt: 'cHNidP8=', toSignInputs: [],
      lockedOutpoints: [{ txid: 'b'.repeat(64), vout: 1 }],
      metadata: { schema: 'BFA_BURN', transitionId: 'd'.repeat(64) },
    })
    dependencies.encoder.completeTransfer = vi.fn().mockResolvedValue({
      txid, rawTx: '02000000000000000000',
      consignments: [{ recipientId: '', payload: proof.toString('base64'), assetId, opIds: ['d'.repeat(64)] }],
      fundingUpdate: {
        spentOutpoints: [{ txid: 'b'.repeat(64), vout: 1 }],
        createdUtxo: {
          outpoint: { txid, vout: 0 }, satoshis: 700,
          scriptPubKey: `5120${'11'.repeat(32)}`, publicKey: `02${'22'.repeat(32)}`,
          allocations: [{ assetId, amount: '40', settled: true, spendable: true,
            opId: 'd'.repeat(64), assignmentIndex: 1, assignmentType: 4000 }],
        },
      },
    })
    dependencies.validateBfaConsignment = vi.fn().mockResolvedValue({
      assetId, metadata: { schema: 'BFA' }, terminals: [], bundles: [{ operationIds: ['d'.repeat(64)] }],
    })
    await service.open(wallet)
    ;(service as any).state.contracts = {
      [assetId]: { consignment: proof.toString('base64'), createdAt: 1,
        metadata: { ticker: 'BFA', name: 'Burnable', precision: 0, schema: 'BFA', issuedSupply: '100' },
        history: { payload: proof.toString('base64'), opIds: ['d'.repeat(64)], updatedAt: 1 } },
    }
    await service.sync()
    ;(service as any).state.snapshot.utxos[0].allocations[0].amount = '100'
    await expect(service.prepareBurn({ assetId, amount: '60', feeRate: 1 })).rejects.toThrow('requires an EVM address')
    await service.prepareBurn(
      { assetId, amount: '60', feeRate: 1, burnReason, burnDestination },
      { providerOrigin: 'https://dapp.example' }
    )
    expect(service.getPendingTransfers()[0]?.request.burnReason).toBe(expectedReason)
    expect(service.getPendingTransfers()[0]?.providerOrigin).toBe('https://dapp.example')
    await service.completeSend('burn-1', 'signed-psbt')

    expect(dependencies.transport.publishConsignment).not.toHaveBeenCalled()
    expect(dependencies.stateSource.syncBroadcast).not.toHaveBeenCalled()
    expect(dependencies.broadcaster.broadcast).toHaveBeenCalledTimes(1)
    expect(dependencies.onBurnBroadcasted).toHaveBeenCalledWith(expect.objectContaining({
      wallet,
      txid,
      assetId,
      amount: '60',
      destinationChainId: burnDestination?.destinationChainId ?? 42161,
      recipient: burnDestination?.recipient ?? burnReason?.replace(/^0x/i, '').toLowerCase(),
    }))
    expect(service.getPendingUtxoSync()?.outpoints).toContainEqual(expect.objectContaining({
      outpoint: { txid, vout: 0 },
      allocations: [expect.objectContaining({ assetId, amount: '40', settled: false })],
    }))
    expect(Buffer.from(service.exportBurnConsignment(txid))).toEqual(proof)
    expect(Buffer.from(service.exportBurnConsignment(txid, assetId))).toEqual(proof)
    expect(() => service.exportBurnConsignment(
      txid,
      'rgb:AgICAgIC-AgICAgI-CAgICAg-ICAgICA-gICAgIC-AgICAgI'
    )).toThrow('does not match the requested asset')
    const reopened = new RgbService(dependencies)
    await reopened.open(wallet)
    expect(reopened.getPendingUtxoSync()?.txid).toBe(txid)
    expect(Buffer.from(reopened.exportBurnConsignment(txid))).toEqual(proof)
    if (burnDestination) {
      expect(reopened.exportBurnDestination(txid)).toEqual({
        ...burnDestination, recipient: `0x${burnDestination.recipient}`,
      })
      expect(reopened.exportBurn(txid)).toEqual({
        format: 'utexo-burn',
        version: 1,
        consignment: {
          encoding: 'base64',
          byteLength: proof.byteLength,
          data: proof.toString('base64'),
        },
        burnDestination: { ...burnDestination, recipient: `0x${burnDestination.recipient}` },
      })
    } else {
      expect(() => reopened.exportBurnDestination(txid)).toThrow('unavailable')
      expect(reopened.exportBurn(txid)).toEqual({
        format: 'utexo-burn',
        version: 1,
        consignment: {
          encoding: 'base64',
          byteLength: proof.byteLength,
          data: proof.toString('base64'),
        },
      })
    }
    expect(reopened.getPendingSendHistory()).toEqual([
      expect.objectContaining({ burn: true, txid, amount: '60', status: 'broadcasted',
        ...(burnDestination ? { burnDestinationChainId: 1 } : {}) }),
    ])
  })

  it('rejects BFA burns below one whole token using the asset precision', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    const assetId = 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE'
    await service.open(wallet)
    ;(service as any).state.contracts = {
      [assetId]: { consignment: 'AA==', createdAt: 1,
        metadata: { ticker: 'USDT', name: 'USDT', precision: 6, schema: 'BFA', issuedSupply: '2000000' } },
    }
    await service.sync()
    await expect(service.prepareBurn({ assetId, amount: '999999', feeRate: 1,
      burnReason: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266' }))
      .rejects.toThrow('at least one token')
    expect(service.getPendingTransfers()).toEqual([])
  })

  it('selects an exact UTXO subset for current-schema BFA burns', async () => {
    const dependencies = createDependencies()
    dependencies.encoder.prepareBurn = vi.fn(async input => ({
      id: 'burn-exact', psbt: 'cHNidP8=', toSignInputs: [],
      lockedOutpoints: input.selectedUtxos.map(utxo => utxo.outpoint),
    }))
    const service = new RgbService(dependencies)
    const assetId = 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE'
    await service.open(wallet)
    ;(service as any).state.contracts = {
      [assetId]: {
        consignment: 'AA==', createdAt: 1,
        genesis: Buffer.from(`0000${BFA_SCHEMA_ID}`, 'hex').toString('base64'),
        metadata: { ticker: 'BFA', name: 'Burnable', precision: 0, schema: 'BFA', issuedSupply: '9' },
      },
    }
    ;(service as any).state.snapshot.utxos = [2, 3, 4].map((value, index) => ({
      outpoint: { txid: String(index + 1).repeat(64), vout: index },
      satoshis: 1000, scriptPubKey: `5120${String(index + 1).repeat(64)}`,
      publicKey: `02${String(index + 1).repeat(64)}`,
      allocations: [{ assetId, amount: String(value), settled: true, spendable: true,
        opId: String(index + 4).repeat(64), assignmentIndex: 0, assignmentType: 4000 }],
    }))

    await service.prepareBurn({ assetId, amount: '7', feeRate: 1,
      burnReason: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266' })

    const selected = vi.mocked(dependencies.encoder.prepareBurn!).mock.calls[0]![0].selectedUtxos
    expect(selected.flatMap(utxo => utxo.allocations.map(item => item.amount))).toEqual(['3', '4'])
  })

  it('prepares an internal split only when a current-schema BFA burn is not exact', async () => {
    const assetId = 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE'
    const setup = async (schemaId: string) => {
      const dependencies = createDependencies()
      dependencies.encoder.prepareBurn = vi.fn(async input => ({
        id: 'burn-selection', psbt: 'cHNidP8=', toSignInputs: [],
        lockedOutpoints: input.selectedUtxos.map(utxo => utxo.outpoint),
      }))
      dependencies.encoder.prepareTransfer = vi.fn(async input => ({
        id: 'burn-split', psbt: 'cHNidP8=', toSignInputs: [],
        lockedOutpoints: input.selectedUtxos.map(utxo => utxo.outpoint),
        metadata: { schema: 'BFA' },
      }))
      const service = new RgbService(dependencies)
      await service.open(wallet)
      ;(service as any).state.contracts = {
        [assetId]: { consignment: 'AA==', createdAt: 1,
          genesis: Buffer.from(`0000${schemaId}`, 'hex').toString('base64'),
          metadata: { ticker: 'BFA', name: 'Burnable', precision: 0, schema: 'BFA', issuedSupply: '6' } },
      }
      ;(service as any).state.snapshot.utxos = [2, 4].map((value, index) => ({
        outpoint: { txid: String(index + 1).repeat(64), vout: index }, satoshis: 1000,
        scriptPubKey: `5120${String(index + 1).repeat(64)}`,
        publicKey: `02${String(index + 1).repeat(64)}`,
        allocations: [{ assetId, amount: String(value), settled: true, spendable: true,
          opId: String(index + 4).repeat(64), assignmentIndex: 0, assignmentType: 4000 }],
      }))
      return { dependencies, service }
    }
    const request = { assetId, amount: '5', feeRate: 1,
      burnReason: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266' }

    const current = await setup(BFA_SCHEMA_ID)
    await expect(current.service.prepareBurn(request)).resolves.toMatchObject({
      id: 'burn-split', metadata: { burnSplit: 'true' },
    })
    expect(current.dependencies.encoder.prepareBurn).not.toHaveBeenCalled()
    expect(current.dependencies.encoder.prepareTransfer).toHaveBeenCalledOnce()
    expect(current.service.getPendingTransfers()[0]).toMatchObject({
      burnSplit: { request: { burn: true, amount: '5' } },
      request: { amount: '5' },
    })
    expect(current.service.getPendingTransfers()[0]?.request.burn).toBeUndefined()
    vi.mocked(current.dependencies.encoder.completeTransfer).mockResolvedValueOnce({
      txid: 'c'.repeat(64), rawTx: '02000000000000000000',
      consignments: [{ recipientId: 'internal', payload: 'consignment', assetId, opIds: ['a'.repeat(64)] }],
      fundingUpdate: {
        spentOutpoints: [
          { txid: '1'.repeat(64), vout: 0 },
          { txid: '2'.repeat(64), vout: 1 },
        ],
        createdUtxos: [
          { outpoint: { txid: 'c'.repeat(64), vout: 1 }, satoshis: 330,
            scriptPubKey: `5120${'1'.repeat(64)}`, publicKey: `02${'1'.repeat(64)}`,
            allocations: [{ assetId, amount: '5', settled: true, spendable: true,
              opId: 'a'.repeat(64), assignmentIndex: 0, assignmentType: 4000 }] },
          { outpoint: { txid: 'c'.repeat(64), vout: 2 }, satoshis: 330,
            scriptPubKey: `5120${'1'.repeat(64)}`, publicKey: `02${'1'.repeat(64)}`,
            allocations: [{ assetId, amount: '1', settled: true, spendable: true,
              opId: 'a'.repeat(64), assignmentIndex: 1, assignmentType: 4000 }] },
        ],
      },
    })
    ;(current.service as any).state.contracts[assetId].history = {
      payload: 'AA==', opIds: ['a'.repeat(64)], updatedAt: 1,
    }
    await current.service.completeSend('burn-split', 'signed-psbt')
    expect(current.dependencies.broadcaster.broadcast).toHaveBeenCalledWith('02000000000000000000')
    expect(current.service.getPendingTransfers()).toEqual([])
    expect(current.service.getSnapshot().utxos.map(utxo => ({
      amount: utxo.allocations[0]?.amount,
      spendable: utxo.allocations[0]?.spendable,
      chainStatus: utxo.chainStatus,
    }))).toEqual([
      { amount: '5', spendable: true, chainStatus: 'mempool' },
      { amount: '1', spendable: true, chainStatus: 'mempool' },
    ])

    // The address indexer may lag the successful parent broadcast. Its absent
    // response must not prevent the immediately chained terminal burn.
    current.dependencies.stateSource.verifyUtxos = vi.fn(async () => [])
    await expect(current.service.prepareBurn(request)).resolves.toMatchObject({
      id: 'burn-selection',
      metadata: { pendingParentWitnessTxid: 'c'.repeat(64) },
    })
    expect(vi.mocked(current.dependencies.encoder.prepareBurn!).mock.calls.at(-1)?.[0].selectedUtxos)
      .toHaveLength(1)

    const legacy = await setup(LEGACY_BFA_SCHEMA_ID)
    await expect(legacy.service.prepareBurn(request)).resolves.toMatchObject({ id: 'burn-selection' })
    expect(vi.mocked(legacy.dependencies.encoder.prepareBurn!).mock.calls[0]![0].selectedUtxos)
      .toHaveLength(2)
  })

  it('does not rebroadcast a failed BFA burn during sync and allows explicit retry', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    const assetId = 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE'
    const txid = 'c'.repeat(64)
    dependencies.encoder.prepareBurn = vi.fn().mockResolvedValue({
      id: 'burn-1', psbt: 'cHNidP8=', toSignInputs: [],
      lockedOutpoints: [{ txid: 'b'.repeat(64), vout: 1 }], metadata: { schema: 'BFA_BURN', transitionId: 'd'.repeat(64) },
    })
    dependencies.encoder.completeTransfer = vi.fn().mockResolvedValue({
      txid, rawTx: '02000000000000000000',
      consignments: [{ recipientId: '', payload: Buffer.from('RGB\0TFRburn').toString('base64'), assetId, opIds: ['d'.repeat(64)] }],
    })
    dependencies.validateBfaConsignment = vi.fn().mockResolvedValue({
      assetId, metadata: { schema: 'BFA' }, terminals: [], bundles: [{ operationIds: ['d'.repeat(64)] }],
    })
    ;(dependencies.broadcaster.broadcast as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('node unavailable')).mockResolvedValue(txid)
    await service.open(wallet)
    ;(service as any).state.contracts = {
      [assetId]: { consignment: 'AA==', createdAt: 1,
        metadata: { ticker: 'BFA', name: 'Burnable', precision: 0, schema: 'BFA', issuedSupply: '100' } },
    }
    await service.sync()
    await service.prepareBurn({ assetId, amount: '60', feeRate: 1,
      burnReason: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266' })
    await expect(service.completeSend('burn-1', 'signed-psbt')).rejects.toThrow('node unavailable')
    await service.syncPendingTransfers()
    expect(dependencies.broadcaster.broadcast).toHaveBeenCalledTimes(1)
    await service.broadcastPendingSend('burn-1')
    expect(dependencies.broadcaster.broadcast).toHaveBeenCalledTimes(2)
    expect(Buffer.from(service.exportBurnConsignment(txid))).toEqual(Buffer.from('RGB\0TFRburn'))
  })

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
      expect(warning).not.toHaveBeenCalled()
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

  it('passes the proxy protocol explicitly for nonce witness and v1 invoices', async () => {
    const dependencies = createDependencies()
    dependencies.transport.checkConsignmentAvailability = vi.fn().mockResolvedValue(true)
    const service = new RgbService(dependencies)
    await service.open(wallet)
    const scriptPubKey = '512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
    const legacyInvoice = encodeWitnessRgbInvoice({
      network: 'mainnet',
      scriptPubKey,
      transportEndpoints: [appendRgbInvoiceRecipientNonce(proxyEndpoint, new Uint8Array(16).fill(1))],
    })
    const v1Invoice = encodeWitnessRgbInvoice({
      network: 'mainnet',
      scriptPubKey,
      transportEndpoints: [proxyEndpoint],
      proxyPublicKey: 'ab'.repeat(32),
    })

    await service.checkInvoiceAvailability(legacyInvoice)
    await service.checkInvoiceAvailability(v1Invoice)

    const check = vi.mocked(dependencies.transport.checkConsignmentAvailability!)
    expect(decodeRgbInvoice(legacyInvoice).proxyRecipientId).toMatch(/^[0-9a-f]{64}$/)
    expect(check).toHaveBeenNthCalledWith(1, {
      recipientId: decodeRgbInvoice(legacyInvoice).proxyRecipientId,
      endpoints: decodeRgbInvoice(legacyInvoice).transportEndpoints,
      protocol: 'legacy',
    })
    expect(check).toHaveBeenNthCalledWith(2, {
      recipientId: decodeRgbInvoice(v1Invoice).proxyRecipientId,
      endpoints: decodeRgbInvoice(v1Invoice).transportEndpoints,
      protocol: 'v1',
    })
  })

  it('uses one stable Proxy v1 sender key for seal encoding and publication', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    const assetId = 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE'
    const invoice = encodeWitnessRgbInvoice({
      network: 'mainnet',
      scriptPubKey: '512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      assetId,
      amount: '60',
      transportEndpoints: [proxyEndpoint],
      proxyPublicKey: 'a09aa5f47a6759802ff955f8dc2d2a14a5c99d23be97f864127ff9383455a4f0',
    })

    await service.prepareSend({ assetId, amount: '60', invoice, feeRate: 2 })

    const encoderInput = vi.mocked(dependencies.encoder.prepareTransfer).mock.calls[0]![0]
    const senderPrivateKey = encoderInput.intent.proxySenderPrivateKey
    expect(senderPrivateKey).toMatch(/^[0-9a-f]{64}$/)
    expect((service as any).state.pending['transfer-1'].proxySenderPrivateKey)
      .toBe(senderPrivateKey)
  })

  it('rejects an asset whose schema conflicts with an open invoice constraint', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    const assetId = 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE'
    ;(service as any).state.contracts = {
      [assetId]: {
        consignment: Buffer.from([1]).toString('base64'),
        createdAt: 1,
        metadata: {
          ticker: 'BFA', name: 'Bridge Asset', precision: 0,
          schema: 'BFA', issuedSupply: '100',
        },
      },
    }
    const invoice =
      `rgb:~/RWhwUfTMpuP2Zfx1~j4nswCANGeJrYOqDcKelaMV4zU/~/` +
      `bc:wvout:A8cJ7Ww3-NIzADo3-Tzp_5aD-7CTBWmA-AAAAAAA-AAAAAAA-ALSQkcw` +
      `?pk=${'ab'.repeat(32)}&endpoints=${encodeURIComponent(proxyEndpoint)}`

    await expect(service.prepareSend({ assetId, amount: '60', invoice, feeRate: 2 }))
      .rejects.toThrow('RGB invoice schema does not match the requested asset')
    expect(dependencies.encoder.prepareTransfer).not.toHaveBeenCalled()
    expect(service.getPendingTransfers()).toEqual([])
  })

  it('enforces the expiration time on legacy invoices', async () => {
    const service = new RgbService(createDependencies())
    await service.open(wallet)
    const now = Math.floor(Date.now() / 1000)

    await expect(service.checkInvoiceAvailability(`${rgbInvoice()}&expirationTimestamp=${now + 3600}`))
      .resolves.toEqual({ available: true })
    await expect(service.checkInvoiceAvailability(`${rgbInvoice()}&expirationTimestamp=${now - 1}`))
      .rejects.toThrow('RGB invoice has expired')
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

  it('allows a funding UTXO to be reused after its unused blind invoice is cancelled', async () => {
    const dependencies = createDependencies()
    vi.mocked(dependencies.stateSource.getSnapshot).mockResolvedValue({
      syncedAt: 1,
      utxos: [{
        outpoint: { txid: 'f'.repeat(64), vout: 0 },
        satoshis: 1_000,
        scriptPubKey: `5120${'11'.repeat(32)}`,
        publicKey: `02${'22'.repeat(32)}`,
        chainStatus: 'confirmed',
        confirmations: 1,
        allocations: [],
      }],
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()

    const first = await service.createBlindReceive({})
    await expect(service.cancelBlindReceive(first.recipientId)).resolves.toEqual({
      cancelled: true,
    })
    const second = await service.createBlindReceive({})

    expect(second.seal).toMatchObject({ txid: first.seal.txid, vout: first.seal.vout })
    expect(second.recipientId).not.toBe(first.recipientId)
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

  it('deletes the selected witness invoice when multiple invoices share a beneficiary', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [
      {
        invoice: 'rgb:witness:first',
        recipientId: 'shared-witness-recipient',
        proxyRecipientId: 'proxy-witness-first',
        recipientType: 'witness',
        createdAt: 1,
      },
      {
        invoice: 'rgb:witness:second',
        recipientId: 'shared-witness-recipient',
        proxyRecipientId: 'proxy-witness-second',
        recipientType: 'witness',
        createdAt: 2,
      },
    ]

    await expect(service.removePendingReceive('proxy-witness-second')).resolves.toEqual({
      cancelled: true,
    })
    expect(service.getPendingReceives()).toEqual([
      expect.objectContaining({ proxyRecipientId: 'proxy-witness-first' }),
    ])
    expect(service.exportRecoveryState()).toMatchObject({
      releasedReceiveRecipientIds: ['proxy-witness-second'],
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

    expect(decodeRgbInvoice(receive.invoice).expirationTimestamp).toBe(receive.expirationTimestamp)
    expect(receive.expirationTimestamp).toBe(Math.floor(receive.createdAt / 1000) + 24 * 60 * 60)
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
    expect(decodeRgbInvoice(witness.invoice).expirationTimestamp).toBe(witness.expirationTimestamp)
    expect(witness.expirationTimestamp).toBe(Math.floor(witness.createdAt / 1000) + 24 * 60 * 60)

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

  it('keeps BFA bridge invoices amount-open', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    const assetId = 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE'
    await service.open(wallet)
    ;(service as any).state.contracts = {
      [assetId]: { consignment: 'AA==', createdAt: 1,
        metadata: { ticker: 'USDT', name: 'USDT', precision: 6, schema: 'BFA', issuedSupply: '2000000' } },
    }

    await expect(service.createBlindReceive({ assetId, amount: '1000000' }))
      .rejects.toThrow('BFA bridge invoices cannot specify a fixed amount')
    await expect(service.createWitnessReceive({
      scriptPubKey: '512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      publicKey: `02${'11'.repeat(32)}`,
      assetId,
      amount: '1000000',
    })).rejects.toThrow('BFA bridge invoices cannot specify a fixed amount')

    const receive = await service.createWitnessReceive({
      scriptPubKey: '512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      publicKey: `02${'11'.repeat(32)}`,
      assetId,
    })
    expect(receive.amount).toBeUndefined()
    expect(receive.invoice).toContain('/~/~/bc:wvout:')
    expect(decodeRgbInvoice(receive.invoice).amount).toBeUndefined()
  })

  it('durably releases an expired unused invoice after confirming the proxy is empty', async () => {
    const dependencies = createDependencies()
    let now = 1_000_000_000_000
    dependencies.now = () => now
    dependencies.transport.getConsignment = vi.fn().mockResolvedValue(undefined)
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.enableRecoveryBackup()
    const receive = await service.createWitnessReceive({
      scriptPubKey: '512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      publicKey: `02${'11'.repeat(32)}`,
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '1',
    })

    now += 24 * 60 * 60 * 1000
    expect(service.getPendingReceives()).toEqual([])
    expect(service.hasStoredPendingReceives()).toBe(true)
    await service.processClaimedReceives({ includeClaimed: false })

    expect(dependencies.transport.getConsignment).toHaveBeenCalledWith({
      recipientId: receive.proxyRecipientId,
      endpoints: decodeRgbInvoice(receive.invoice).transportEndpoints,
      proxyPrivateKey: receive.proxyPrivateKey,
      encryption: 'required',
    })
    expect(service.hasStoredPendingReceives()).toBe(false)
    expect(service.getUtxoInspection().invoiceReservations).toEqual([])
    expect(service.exportRecoveryState()).toMatchObject({
      pendingReceives: [],
      releasedReceiveRecipientIds: [receive.recipientId],
    })
    const reopened = new RgbService(dependencies)
    await reopened.open(wallet)
    expect(reopened.hasStoredPendingReceives()).toBe(false)
  })

  it('keeps expired invoices with a staged consignment or an uncertain proxy result', async () => {
    const dependencies = createDependencies()
    let now = 1_000_000_000_000
    dependencies.now = () => now
    dependencies.transport.getConsignment = vi.fn().mockRejectedValue(new Error('proxy unavailable'))
    dependencies.transport.getConsignments = vi.fn().mockResolvedValue([])
    const service = new RgbService(dependencies)
    await service.open(wallet)
    vi.spyOn(service as any, 'isReceiveCanceledBySender').mockResolvedValue(false)
    const input = {
      scriptPubKey: '512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      publicKey: `02${'11'.repeat(32)}`,
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '1',
    }
    const staged = await service.createWitnessReceive(input)
    const uncertain = await service.createWitnessReceive(input)
    ;(service as any).state.pendingReceives[0].pendingAccept = {
      payload: 'consignment', txid: 'c'.repeat(64), discoveredAt: now,
    }
    now += 24 * 60 * 60 * 1000

    expect(service.getPendingReceives().map(item => item.recipientId)).toEqual([staged.recipientId])
    await service.processClaimedReceives({ includeClaimed: false })
    expect(service.hasStoredPendingReceives()).toBe(true)
    expect(service.getPendingReceives().map(item => item.recipientId)).toEqual([staged.recipientId])
    expect(service.exportRecoveryState().pendingReceives?.map(item => item.recipientId))
      .toContain(uncertain.recipientId)
  })

  it('rolls back expired-invoice cleanup if its recovery checkpoint fails', async () => {
    const dependencies = createDependencies()
    let now = 1_000_000_000_000
    dependencies.now = () => now
    dependencies.transport.getConsignment = vi.fn().mockResolvedValue(undefined)
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.enableRecoveryBackup()
    const receive = await service.createWitnessReceive({
      scriptPubKey: '512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      publicKey: `02${'11'.repeat(32)}`,
    })
    now += 24 * 60 * 60 * 1000
    dependencies.onStatePersisted = vi.fn().mockRejectedValue(new Error('recovery unavailable'))

    await expect(service.processClaimedReceives({ includeClaimed: false }))
      .rejects.toThrow('recovery unavailable')
    expect(service.hasStoredPendingReceives()).toBe(true)
    expect(service.exportRecoveryState().pendingReceives?.[0]?.recipientId).toBe(receive.recipientId)
    expect(service.exportRecoveryState()).not.toHaveProperty('releasedReceiveRecipientIds')
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
    expect(dependencies.stateSource.getSnapshot).toHaveBeenCalledTimes(2)
    expect(restoredService.getSnapshot().utxos).toContainEqual(
      expect.objectContaining({ ...fundingUtxo, chainStatus: 'mempool' })
    )

    await restoredService.markUtxoSyncCompleted(fundingUtxo.outpoint.txid)
    await restoredService.sync()
    expect(dependencies.stateSource.getSnapshot).toHaveBeenCalledTimes(3)
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
      issuanceTxid: 'b'.repeat(64),
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
    await expect(
      service.restoreRecoveryState({
        ...recovery,
        issueHistory: [{ ...issue, issuanceTxid: 'invalid-txid' }],
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
    ;(service as any).state.snapshot.revision = 7
    expect(service.matchesRecoveryState(recovery)).toBe(true)
    expect(service.exportRecoveryState().snapshot).not.toHaveProperty('revision')
    expect(
      service.matchesRecoveryState({
        ...recovery,
        pending: { ...recovery.pending, other: recovery.pending.transfer },
      })
    ).toBe(false)
  })

  it('matches a v1.7 checkpoint after applying deterministic metadata migration', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    const genesis = encodeNiaGenesis({
      ticker: 'OLD',
      name: 'Legacy asset',
      precision: 0,
      timestamp: 1_713_261_744,
      network: 'mainnet',
      allocations: [{ txid: 'ab'.repeat(32), vout: 0, blinding: 1n, amount: 100n }],
    })
    const assetId = encodeRgbContractId(genesis.assetId)
    const legacyRecovery = {
      version: 1 as const,
      wallet,
      snapshot: { syncedAt: 1, utxos: [] },
      pending: {},
      contracts: {
        [assetId]: {
          consignment: Buffer.from(encodeNiaContract(genesis).strict).toString('base64'),
          createdAt: 1,
        },
      },
    }

    await expect(service.restoreRecoveryState(legacyRecovery)).resolves.toBe(true)
    expect(service.getPendingAssetMetadata()).toEqual([
      expect.objectContaining({ assetId, metadata: expect.objectContaining({ ticker: 'OLD' }) }),
    ])
    expect(service.matchesRecoveryState(legacyRecovery)).toBe(true)
    expect(legacyRecovery.contracts[assetId]).not.toHaveProperty('metadata')

    await service.markAssetMetadataSynced(assetId)
    expect(service.getPendingAssetMetadata()).toEqual([])
    expect(service.matchesRecoveryState(legacyRecovery)).toBe(true)
  })

  it('migrates Wallet 1.8.2 v1 contract history while restoring a checkpoint', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    const genesis = encodeNiaGenesis({
      ticker: 'V182', name: 'Legacy V1 asset', precision: 0,
      timestamp: 1_713_261_744, network: 'mainnet',
      allocations: [{ txid: 'ab'.repeat(32), vout: 0, blinding: 1n, amount: 100n }],
    })
    const assetId = encodeRgbContractId(genesis.assetId)
    const canonical = encodeBfaContractConsignment(genesis.strict)
    const legacy = Uint8Array.from([
      canonical[0]!, canonical[1]!, 0, 0, ...canonical.slice(2),
    ])
    const legacyPayload = Buffer.from(legacy).toString('base64')
    const canonicalPayload = Buffer.from(canonical).toString('base64')
    const recovery = {
      version: 1 as const,
      wallet,
      snapshot: { syncedAt: 1, utxos: [] },
      pending: {},
      contracts: {
        [assetId]: {
          consignment: legacyPayload,
          createdAt: 1,
          history: { payload: legacyPayload, opIds: [], updatedAt: 1 },
        },
      },
    }

    await expect(service.restoreRecoveryState(recovery)).resolves.toBe(true)
    const exported = service.exportRecoveryState()
    expect(exported.contracts?.[assetId]?.consignment).toBe(canonicalPayload)
    expect(exported.contracts?.[assetId]?.history?.payload).toBe(canonicalPayload)
    expect(recovery.contracts[assetId].consignment).toBe(legacyPayload)
  })

  it('clears a stale recovery conflict after an identical checkpoint is proven', async () => {
    const service = new RgbService(createDependencies())
    await service.open(wallet)
    await service.markRecoveryConflict()
    expect(service.hasRecoveryConflict()).toBe(true)

    await service.clearRecoveryConflict()

    expect(service.hasRecoveryConflict()).toBe(false)
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

  it('matches a v1 witness receive in the newest bundle without a concealed terminal', async () => {
    const dependencies = createDependencies()
    const scriptPubKey = `5120${'11'.repeat(32)}`
    const oldTxid = 'a'.repeat(64)
    const newTxid = 'b'.repeat(64)
    const oldAssignment = {
      opId: 'c'.repeat(64), assignmentIndex: 0, amount: '40',
      bundleId: 'old-bundle', txid: oldTxid, vout: 1, secretSeal: '',
      output: { scriptPubKey: `5120${'22'.repeat(32)}`, satoshis: 330 },
    }
    const newAssignment = {
      ...oldAssignment, opId: 'd'.repeat(64), amount: '10',
      bundleId: 'new-bundle', txid: newTxid, vout: 2,
      output: { scriptPubKey, satoshis: 330 },
    }
    const validated = {
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      genesis: new Uint8Array(),
      metadata: { schema: 'NIA', ticker: 'NIA', name: 'NIA', precision: 0, issuedSupply: '100' },
      witnessOutputScripts: [scriptPubKey],
      terminals: [],
      bundles: [{ id: 'old-bundle' }, { id: 'new-bundle' }],
      terminalAssignments: [oldAssignment, newAssignment],
    }
    dependencies.validateBfaConsignment = vi.fn().mockResolvedValue(validated)
    const service = new RgbService(dependencies)
    await service.open(wallet)
    const payload = Buffer.from(Uint8Array.from([
      1, 1, 0, 0, ...Buffer.from(NIA_V1_SCHEMA_ID, 'hex'),
    ])).toString('base64')
    const receive = { recipientType: 'witness', witnessScriptPubKey: scriptPubKey }
    const item = { recipientId: 'recipient', payload }

    await expect((service as any).validateIncomingConsignment(receive, item))
      .resolves.toMatchObject({ txid: newTxid, amount: '10', opId: newAssignment.opId })
    await expect((service as any).validateIncomingConsignment(receive, { ...item, txid: newTxid }))
      .resolves.toMatchObject({ txid: newTxid, amount: '10', opId: newAssignment.opId })
    vi.mocked(dependencies.validateBfaConsignment!).mockResolvedValueOnce({
      ...validated, terminals: [], terminalAssignments: [oldAssignment],
    } as any)
    await expect((service as any).validateIncomingConsignment(receive, item))
      .resolves.toBeUndefined()
  })

  it('refuses a v1 witness receive with multiple terminal destinations', async () => {
    const dependencies = createDependencies()
    const scriptPubKey = `5120${'11'.repeat(32)}`
    const assignment = (bundleId: string, txid: string, vout: number, secretSeal: string) => ({
      opId: txid, assignmentIndex: 0, amount: '10', bundleId, txid, vout, secretSeal,
      output: { scriptPubKey, satoshis: 330 },
    })
    dependencies.validateBfaConsignment = vi.fn().mockResolvedValue({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      genesis: new Uint8Array(),
      metadata: { schema: 'NIA', ticker: 'NIA', name: 'NIA', precision: 0, issuedSupply: '100' },
      witnessOutputScripts: [scriptPubKey],
      terminals: [
        { bundleId: 'bundle-a', secretSeals: ['seal-a'] },
        { bundleId: 'bundle-b', secretSeals: ['seal-b'] },
      ],
      bundles: [{ id: 'bundle-a' }, { id: 'bundle-b' }],
      terminalAssignments: [
        assignment('bundle-a', 'a'.repeat(64), 0, 'seal-a'),
        assignment('bundle-b', 'b'.repeat(64), 1, 'seal-b'),
      ],
    } as any)
    const service = new RgbService(dependencies)
    await service.open(wallet)
    const reasons: string[] = []
    const result = await (service as any).validateIncomingConsignment(
      { recipientType: 'witness', witnessScriptPubKey: scriptPubKey },
      {
        recipientId: 'recipient',
        payload: Buffer.from(Uint8Array.from([
          1, 1, 0, 0, ...Buffer.from(NIA_V1_SCHEMA_ID, 'hex'),
        ])).toString('base64'),
      },
      (reason: string) => reasons.push(reason)
    )

    expect(result).toBeUndefined()
    expect(reasons).toEqual(['ambiguous_recipient_assignment'])
  })

  it('aggregates every asset assignment paid to one terminal destination', async () => {
    const dependencies = createDependencies()
    const scriptPubKey = `5120${'11'.repeat(32)}`
    const txid = 'b'.repeat(64)
    const assetId = 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE'
    const assignments = [
      { opId: 'c'.repeat(64), assignmentIndex: 0, amount: '6', secretSeal: 'seal-a' },
      { opId: 'd'.repeat(64), assignmentIndex: 1, amount: '9', secretSeal: 'seal-b' },
    ].map(assignment => ({
      ...assignment, bundleId: 'bundle', txid, vout: 1,
      output: { scriptPubKey, satoshis: 330 },
    }))
    dependencies.validateBfaConsignment = vi.fn().mockResolvedValue({
      assetId, genesis: new Uint8Array(),
      metadata: { schema: 'NIA', ticker: 'NIA', name: 'NIA', precision: 0, issuedSupply: '100' },
      witnessOutputScripts: [scriptPubKey],
      terminals: [{ bundleId: 'bundle', secretSeals: ['seal-a', 'seal-b'] }],
      bundles: [{ id: 'bundle' }], terminalAssignments: assignments,
    } as any)
    dependencies.stateSource.getTransactionStatus = vi.fn().mockResolvedValue({
      status: 'confirmed', confirmations: 1,
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    vi.spyOn(service as any, 'needsV1HistoryMerge').mockReturnValue(false)
    vi.spyOn(service as any, 'storeAcceptedHistory').mockImplementation(() => undefined)
    const receive = {
      invoice: '', recipientId: 'recipient', recipientType: 'witness' as const,
      witnessScriptPubKey: scriptPubKey, witnessPublicKey: `02${'22'.repeat(32)}`,
      amount: '15', createdAt: 1,
      receivedConsignment: { accepted: true, assetId, amount: '15', txid, receivedAt: 1 },
    }
    const item = {
      recipientId: 'recipient',
      payload: Buffer.from(Uint8Array.from([
        1, 1, 0, 0, ...Buffer.from(NIA_V1_SCHEMA_ID, 'hex'),
      ])).toString('base64'),
    }

    const validated = await (service as any).validateIncomingConsignment(receive, item)
    expect(validated).toMatchObject({
      amount: '15',
      assignments: [
        { opId: 'c'.repeat(64), assignmentIndex: 0, amount: '6' },
        { opId: 'd'.repeat(64), assignmentIndex: 1, amount: '9' },
      ],
    })
    await expect((service as any).advanceAcceptedReceive(receive, item, validated, false))
      .resolves.toBe(true)
    const utxo = (service as any).state.snapshot.utxos.find(
      (candidate: any) => candidate.outpoint.txid === txid && candidate.outpoint.vout === 1
    )
    expect(utxo.allocations).toEqual([
      expect.objectContaining({ opId: 'c'.repeat(64), assignmentIndex: 0, amount: '6' }),
      expect.objectContaining({ opId: 'd'.repeat(64), assignmentIndex: 1, amount: '9' }),
    ])
  })

  it('requires derived witness blinding except for migrated legacy invoices', async () => {
    const dependencies = createDependencies()
    const scriptPubKey = `5120${'11'.repeat(32)}`
    const recipientPrivateKey = '22'.repeat(32)
    const senderPublicKey = 'd04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c9778737'
    const expectedBlinding = deriveProxyV1SealBlinding(recipientPrivateKey, senderPublicKey)
    const assignment = (opId: string, blinding: bigint) => ({
      opId, assignmentIndex: 0, amount: '10', bundleId: 'new-bundle',
      txid: 'b'.repeat(64), vout: 1, secretSeal: '', blinding,
      output: { scriptPubKey, satoshis: 330 },
    })
    const legacy = assignment('c'.repeat(64), 7n)
    const compliant = assignment('d'.repeat(64), expectedBlinding)
    dependencies.validateBfaConsignment = vi.fn().mockResolvedValue({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      genesis: new Uint8Array(),
      metadata: { schema: 'NIA', ticker: 'NIA', name: 'NIA', precision: 0, issuedSupply: '100' },
      witnessOutputScripts: [scriptPubKey],
      terminals: [],
      bundles: [{ id: 'new-bundle' }], terminalAssignments: [legacy, compliant],
    } as any)
    const service = new RgbService(dependencies)
    await service.open(wallet)
    const receive = {
      recipientType: 'witness', witnessScriptPubKey: scriptPubKey,
      proxyPrivateKey: recipientPrivateKey,
    }
    const item = {
      recipientId: 'recipient',
      payload: Buffer.from(Uint8Array.from([
        1, 1, 0, 0, ...Buffer.from(NIA_V1_SCHEMA_ID, 'hex'),
      ])).toString('base64'),
      proxySenderPublicKey: senderPublicKey,
    }

    await expect((service as any).validateIncomingConsignment(receive, item))
      .resolves.toMatchObject({ opId: compliant.opId })

    vi.mocked(dependencies.validateBfaConsignment!).mockResolvedValueOnce({
      ...(await dependencies.validateBfaConsignment!({
        wallet, payload: new Uint8Array(),
      } as any)),
      terminalAssignments: [legacy],
    } as any)
    await expect((service as any).validateIncomingConsignment(receive, item))
      .resolves.toBeUndefined()

    vi.mocked(dependencies.validateBfaConsignment!).mockResolvedValueOnce({
      ...(await dependencies.validateBfaConsignment!({
        wallet, payload: new Uint8Array(),
      } as any)),
      terminalAssignments: [legacy],
    } as any)
    await expect((service as any).validateIncomingConsignment(
      { ...receive, allowLegacyWitnessBlinding: true }, item
    )).resolves.toMatchObject({ opId: legacy.opId })
  })

  it('requires sender key metadata before matching a Proxy v1 witness receive', async () => {
    const dependencies = createDependencies()
    const scriptPubKey = `5120${'11'.repeat(32)}`
    dependencies.validateBfaConsignment = vi.fn().mockResolvedValue({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      genesis: new Uint8Array(),
      metadata: { schema: 'NIA', ticker: 'NIA', name: 'NIA', precision: 0, issuedSupply: '100' },
      witnessOutputScripts: [scriptPubKey],
      terminals: [{ bundleId: 'new-bundle', secretSeals: [''] }],
      bundles: [{ id: 'new-bundle' }],
      terminalAssignments: [{
        opId: 'd'.repeat(64), assignmentIndex: 0, amount: '10',
        bundleId: 'new-bundle', txid: 'b'.repeat(64), vout: 1,
        secretSeal: '', blinding: 7n, output: { scriptPubKey, satoshis: 330 },
      }],
    } as any)
    const service = new RgbService(dependencies)
    await service.open(wallet)
    const reasons: string[] = []

    const result = await (service as any).validateIncomingConsignment(
      {
        recipientType: 'witness', witnessScriptPubKey: scriptPubKey,
        proxyPrivateKey: '22'.repeat(32), proxyPublicKey: '33'.repeat(32),
      },
      {
        recipientId: 'recipient',
        payload: Buffer.from(Uint8Array.from([
          1, 1, 0, 0, ...Buffer.from(NIA_V1_SCHEMA_ID, 'hex'),
        ])).toString('base64'),
      },
      (reason: string) => reasons.push(reason)
    )

    expect(result).toBeUndefined()
    expect(reasons).toEqual(['missing_proxy_sender_public_key'])
  })

  it('matches a v0 witness receive only in the newest witness bundle', async () => {
    const parentTxids = [
      '8d54c98d4c29a1ec4fd90635f543f0f7a871a78eb6a6e706342f831d92e3ba19',
      'ff'.repeat(32),
    ]
    const genesis = encodeNiaGenesis({
      ticker: 'HISTORY', name: 'Witness History', precision: 0,
      timestamp: 1_713_261_744, network: 'mainnet',
      allocations: parentTxids.map(txid => ({ txid, vout: 0, blinding: 1n, amount: 100n })),
    })
    const contractId = `rgb:${Buffer.from(genesis.assetId).toString('hex')}`
    const allocations = decodeNiaConsignment(encodeNiaContract(genesis).strict).genesisAllocations
    const witnessRecipient = 'bc:wvout:A8cJ7Ww3-NIzADo3-Tzp_5aD-7CTBWmA-AAAAAAA-AAAAAAA-ALSQkcw'
    const makeBundle = (index: number, amount: string) => {
      const assignmentIndex = allocations.findIndex(item => item.txid === parentTxids[index])
      expect(assignmentIndex).toBeGreaterThanOrEqual(0)
      const invoice = decodeRgbInvoice(
        `rgb:${contractId.slice(4)}/~/~/${witnessRecipient}?amount=${amount}`
      )
      const prepared = prepareNiaOpretTransfer({
        network: 'mainnet', assetId: contractId, amount, recipientSeal: invoice.seal,
        selectedUtxos: [{
          outpoint: { txid: parentTxids[index]!, vout: 0 }, satoshis: 10_000,
          scriptPubKey: `5120${'11'.repeat(32)}`, publicKey: `02${'22'.repeat(32)}`,
          allocations: [{
            assetId: contractId, amount: '100', settled: true, spendable: true,
            opId: contractId.slice(4), assignmentIndex, assignmentType: 4000,
          }],
        }],
        witnessAmountSat: 330, feeRate: 2,
        feeFunding: {
          utxos: [{
            outpoint: { txid: index === 0 ? 'cc'.repeat(32) : 'dd'.repeat(32), vout: 1 },
            satoshis: 10_000, scriptPubKey: `5120${'11'.repeat(32)}`,
            publicKey: `02${'22'.repeat(32)}`,
          }],
          changeScriptPubKey: `5120${'11'.repeat(32)}`, changeDustLimit: 330,
        },
        nonce: BigInt(index + 1), entropy: BigInt(index + 2),
        recipientBlinding: 3n, changeBlinding: 4n,
      })
      const psbt = Psbt.fromHex(prepared.psbtHex)
      const witnessTx = ((psbt.data.globalMap.unsignedTx as any).tx || psbt.data.globalMap.unsignedTx).toBuffer()
      return serializeNiaOpretWitnessBundle({
        witnessTx, contractId, transitionId: prepared.transitionId,
        transition: prepared.transition,
        inputs: [{ opId: contractId.slice(4), assignmentType: 4000, assignmentIndex }],
        entropy: BigInt(index + 2),
      })
    }
    const oldBundle = makeBundle(0, '40')
    const newBundle = makeBundle(1, '10')
    const payload = Buffer.from(encodeNiaTransferConsignment({
      genesis, priorWitnessBundles: [oldBundle.strict], witnessBundle: newBundle.strict, terminals: [],
    })).toString('base64')
    const decoded = decodeNiaConsignment(Uint8Array.from(Buffer.from(payload, 'base64')))
    const scriptPubKey = decoded.witnessBundles[1]!.outputs[1]!.scriptPubKey
    expect(decoded.witnessBundles[0]!.outputs[1]!.scriptPubKey).toBe(scriptPubKey)
    const dependencies = createDependencies()
    dependencies.validateBfaConsignment = vi.fn(dependencies.validateBfaConsignment!)
    const service = new RgbService(dependencies)
    await service.open(wallet)
    const receive = { recipientType: 'witness', witnessScriptPubKey: scriptPubKey }
    const item = { recipientId: 'recipient', payload }

    const match = await (service as any).validateIncomingConsignment(receive, item)
    expect(match).toMatchObject({
      txid: decoded.witnessBundles[1]!.txid, amount: '10', legacyPayload: payload,
    })
    const validatedPayload = vi.mocked(dependencies.validateBfaConsignment!).mock.calls[0]?.[0].payload
    expect(validatedPayload && isSupportedV1TransferConsignment(validatedPayload)).toBe(true)
    dependencies.stateSource.getTransactionStatus = vi.fn().mockResolvedValue({
      status: 'confirmed', confirmations: 1,
    })
    await expect((service as any).advanceAcceptedReceive({
      ...receive,
      recipientId: 'recipient', invoice: '', createdAt: 1,
      witnessPublicKey: `02${'22'.repeat(32)}`,
      receivedConsignment: {
        accepted: true, assetId: match.assetId, amount: match.amount,
        txid: match.txid, receivedAt: 1,
      },
    }, item, match, true)).resolves.toBe(true)
    const stored = (service as any).state.contracts[match.assetId]
    expect(isSupportedV1TransferConsignment(
      Uint8Array.from(Buffer.from(stored.history.payload, 'base64'))
    )).toBe(true)
    expect(stored.history.legacyPayloads).toContain(payload)
    await expect((service as any).validateIncomingConsignment(receive, {
      ...item, txid: decoded.witnessBundles[0]!.txid,
    })).resolves.toBeUndefined()
  })

  it.each([
    { recipientType: 'blind', source: 'claimed' },
    { recipientType: 'witness', source: 'claimed' },
    { recipientType: 'blind', source: 'v1 proxy' },
  ] as const)(
    'stages a $source $recipientType NIA consignment without a backend txid',
    async ({ recipientType, source }) => {
      const parentTxid = '8d54c98d4c29a1ec4fd90635f543f0f7a871a78eb6a6e706342f831d92e3ba19'
      const genesis = encodeNiaGenesis({
        ticker: 'PARSE', name: 'Parse NIA', precision: 0,
        timestamp: 1_713_261_744, network: 'mainnet',
        allocations: [{ txid: parentTxid, vout: 0, blinding: 1n, amount: 100n }],
      })
      const assetId = encodeRgbContractId(genesis.assetId)
      const contractId = `rgb:${Buffer.from(genesis.assetId).toString('hex')}`
      const seal = { txid: 'aa'.repeat(32), vout: 1, blinding: 7n }
      const invoice = decodeRgbInvoice(recipientType === 'blind'
        ? encodeBlindRgbInvoice({
            network: 'mainnet', seal,
            ...(source === 'v1 proxy' ? {
              transportEndpoints: [proxyEndpoint], proxyPublicKey: '33'.repeat(32),
            } : { assetId: contractId, amount: '60' }),
          })
        : `rgb:${contractId.slice(4)}/~/~/bc:wvout:A8cJ7Ww3-NIzADo3-Tzp_5aD-7CTBWmA-AAAAAAA-AAAAAAA-ALSQkcw?amount=60`)
      const prepared = prepareNiaOpretTransfer({
        network: 'mainnet', assetId: contractId, amount: '60', recipientSeal: invoice.seal,
        selectedUtxos: [{
          outpoint: { txid: parentTxid, vout: 0 }, satoshis: 10_000,
          scriptPubKey: `5120${'11'.repeat(32)}`, publicKey: `02${'22'.repeat(32)}`,
          allocations: [{
            assetId: contractId, amount: '100', settled: true, spendable: true,
            opId: contractId.slice(4), assignmentIndex: 0, assignmentType: 4000,
          }],
        }],
        ...(recipientType === 'witness' ? { witnessAmountSat: 330 } : {}),
        feeRate: 2,
        feeFunding: {
          utxos: [{
            outpoint: { txid: 'cc'.repeat(32), vout: 1 }, satoshis: 10_000,
            scriptPubKey: `5120${'11'.repeat(32)}`, publicKey: `02${'22'.repeat(32)}`,
          }],
          changeScriptPubKey: `5120${'11'.repeat(32)}`, changeDustLimit: 330,
        },
        nonce: 1n, entropy: 2n, recipientBlinding: 3n, changeBlinding: 4n,
      })
      const psbt = Psbt.fromHex(prepared.psbtHex)
      const witnessTx = ((psbt.data.globalMap.unsignedTx as any).tx || psbt.data.globalMap.unsignedTx).toBuffer()
      const bundle = serializeNiaOpretWitnessBundle({
        witnessTx, contractId, transitionId: prepared.transitionId,
        transition: prepared.transition,
        inputs: [{ opId: contractId.slice(4), assignmentType: 4000, assignmentIndex: 0 }],
        entropy: 2n,
      })
      const payload = Buffer.from(encodeNiaTransferConsignment({
        genesis, witnessBundle: bundle.strict,
        terminals: recipientType === 'blind' && invoice.seal.type === 'confidential'
          ? [{ bundleId: bundle.bundleId, secretSeals: [invoice.seal.secretSeal] }]
          : [],
      })).toString('base64')
      const decoded = decodeNiaConsignment(Uint8Array.from(Buffer.from(payload, 'base64')))
      const witnessTxid = decoded.witnessBundles[0]!.txid
      const dependencies = createDependencies()
      if (source === 'v1 proxy') {
        dependencies.transport.getConsignment = vi.fn().mockResolvedValue({
          recipientId: invoice.proxyRecipientId, payload, txid: '',
          endpoint: proxyEndpoint, proxyTransferId: 'dd'.repeat(32),
        })
      } else {
        dependencies.stateSource.getClaimedConsignments = vi.fn().mockResolvedValue([
          { recipientId: invoice.proxyRecipientId, payload },
        ])
      }
      dependencies.transport.acknowledgeConsignment = vi.fn()
      const service = new RgbService(dependencies)
      await service.open(wallet)
      ;(service as any).state.pendingReceives = [{
        invoice: invoice.raw, recipientId: invoice.recipientId,
        proxyRecipientId: invoice.proxyRecipientId, recipientType,
        ...(source === 'v1 proxy' ? { proxyPrivateKey: '44'.repeat(32) } : { assetId, amount: '60' }),
        createdAt: 1,
        ...(recipientType === 'blind' ? { seal } : {
          witnessScriptPubKey: decoded.witnessBundles[0]!.outputs[1]!.scriptPubKey,
        }),
      }]

      await service.processClaimedReceives()

      expect(service.getPendingReceives()).toEqual([
        expect.objectContaining({
          pendingAccept: expect.objectContaining({
            txid: witnessTxid,
            payload,
            assetId,
            amount: '60',
            operationIds: [Buffer.from(prepared.transitionId).toString('hex')],
          }),
        }),
      ])
      expect(service.getPendingReceiveHistory()).toEqual([])
      expect(dependencies.transport.acknowledgeConsignment).not.toHaveBeenCalled()
    }
  )

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
      { recipientId: 'recipient', endpoints: [proxyEndpoint], encryption: 'required' },
    ])
    expect(dependencies.transport.getConsignment).not.toHaveBeenCalled()
  })

  it('shares chain validation caches across receives discovered in one polling pass', async () => {
    const dependencies = createDependencies()
    dependencies.transport.getConsignments = vi.fn().mockResolvedValue([
      { recipientId: 'recipient-1', payload: 'same-batch-consignment', txid: 'c'.repeat(64) },
      { recipientId: 'recipient-2', payload: 'same-batch-consignment', txid: 'c'.repeat(64) },
    ])
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [1, 2].map(index => ({
      invoice: rgbInvoice(),
      recipientId: `recipient-${index}`,
      proxyRecipientId: `recipient-${index}`,
      createdAt: index,
      seal: { txid: `${index}`.repeat(64), vout: 0, blinding: BigInt(index) },
    }))
    const validateIncoming = vi.fn().mockImplementation((_receive, item) => ({
      decoded: { metadata: { ticker: 'TOK', name: 'Token', precision: 0, schema: 'BFA' } },
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '1',
      txid: item.txid,
      opId: 'd'.repeat(64),
      assignmentIndex: 0,
    }))
    ;(service as any).validateIncomingConsignment = validateIncoming

    await service.processClaimedReceives({ includeClaimed: false })

    expect(validateIncoming).toHaveBeenCalledTimes(2)
    const firstCaches = validateIncoming.mock.calls[0]![3]
    const secondCaches = validateIncoming.mock.calls[1]![3]
    expect(firstCaches).toBe(secondCaches)
    expect(firstCaches.evmRpcCache).toBeInstanceOf(Map)
    expect(firstCaches.bitcoinStatusCache).toBeInstanceOf(Map)
    expect(firstCaches.consignments).toBeInstanceOf(Map)
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

  it('keeps an invalid receive for review without attempting an automatic NACK', async () => {
    const dependencies = createDependencies()
    dependencies.stateSource.reportReceiveValidationFailure = vi.fn().mockResolvedValue({
      caseId: 'e'.repeat(64), status: 'under_review',
    })
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

    expect(dependencies.transport.acknowledgeConsignment).not.toHaveBeenCalled()
    expect(service.getPendingReceives()).toEqual([
      expect.objectContaining({ pendingValidationFailure: expect.objectContaining({
        reason: 'Consignment does not match this invoice',
        txid: 'c'.repeat(64),
        endpoint: proxyEndpoint,
        reviewCaseId: 'e'.repeat(64),
        reviewStatus: 'under_review',
      }) }),
    ])
    expect(dependencies.stateSource.reportReceiveValidationFailure).toHaveBeenCalledWith(
      wallet,
      expect.objectContaining({ recipientId: 'recipient', payload: 'invalid-consignment' })
    )
    await expect(service.rejectReceive('recipient')).rejects.toThrow(
      'RGB receive is still under validation review'
    )
    expect(service.getPendingReceiveHistory()).toEqual([])
  })

  it('keeps a broadcast-first receive pending when the proxy has no ACK operation', async () => {
    const dependencies = createDependencies()
    dependencies.transport.getConsignment = vi.fn().mockResolvedValue({
      recipientId: 'recipient', payload: 'invalid-consignment', endpoint: proxyEndpoint,
      proxyTransferId: 'dd'.repeat(32),
    })
    dependencies.transport.acknowledgeConsignment = vi
      .fn()
      .mockRejectedValue(new RgbProxyOperationNotFoundError())
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [{
      invoice: rgbInvoice(), recipientId: 'recipient', createdAt: 1,
      proxyPrivateKey: '44'.repeat(32),
      seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
    }]
    ;(service as any).validateIncomingConsignment = vi.fn().mockReturnValue(undefined)

    await service.processClaimedReceives({ includeClaimed: false })

    expect(dependencies.transport.acknowledgeConsignment).not.toHaveBeenCalled()
    expect(service.getPendingReceives()).toHaveLength(1)
    expect(service.getPendingReceives()[0]?.pendingValidationFailure?.endpoint).toBe(proxyEndpoint)
    expect(service.getPendingReceiveHistory()).toEqual([])
  })

  it('reports an existing validation failure even when the proxy payload is unavailable', async () => {
    const dependencies = createDependencies()
    dependencies.transport.getConsignment = vi.fn().mockRejectedValue(new Error('proxy unavailable'))
    dependencies.stateSource.reportReceiveValidationFailure = vi.fn().mockResolvedValue({
      caseId: 'e'.repeat(64), status: 'under_review',
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [{
      invoice: rgbInvoice(), recipientId: 'recipient', createdAt: 1,
      proxyPrivateKey: '44'.repeat(32),
      seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
      pendingValidationFailure: {
        reason: 'No matching blind assignment was found', discoveredAt: 2,
        txid: 'c'.repeat(64), endpoint: proxyEndpoint,
        proxyTransferId: 'd'.repeat(64), proxyConsignmentHash: 'f'.repeat(64),
      },
    }]

    await expect(service.processClaimedReceives({ includeClaimed: false }))
      .rejects.toThrow('proxy unavailable')

    expect(dependencies.stateSource.reportReceiveValidationFailure).toHaveBeenCalledWith(
      wallet,
      expect.objectContaining({
        recipientId: 'recipient', txid: 'c'.repeat(64),
        reason: 'No matching blind assignment was found', endpoint: proxyEndpoint,
        proxyTransferId: 'd'.repeat(64), proxyConsignmentHash: 'f'.repeat(64),
      })
    )
    const report = vi.mocked(dependencies.stateSource.reportReceiveValidationFailure).mock.calls[0]?.[1]
    expect(report).not.toHaveProperty('payload')
    expect(service.getPendingReceives()[0]?.pendingValidationFailure).toMatchObject({
      reviewCaseId: 'e'.repeat(64), reviewStatus: 'under_review',
    })
  })

  it('does not record a backend-claimed consignment as rejected without a proxy ACK endpoint', async () => {
    const dependencies = createDependencies()
    dependencies.stateSource.getClaimedConsignments = vi.fn().mockResolvedValue([{
      recipientId: 'recipient', payload: 'invalid-consignment',
    }])
    dependencies.transport.acknowledgeConsignment = vi.fn()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [{
      invoice: rgbInvoice(), recipientId: 'recipient', createdAt: 1,
      seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
    }]
    ;(service as any).validateIncomingConsignment = vi.fn().mockReturnValue(undefined)

    await service.processClaimedReceives({ includeClaimed: true })

    expect(dependencies.transport.acknowledgeConsignment).not.toHaveBeenCalled()
    expect(service.getPendingReceives()).toHaveLength(1)
    expect(service.getPendingReceives()[0]?.pendingValidationFailure?.endpoint).toBeUndefined()
    expect(service.getPendingReceiveHistory()).toEqual([])
  })

  it('records the validation reason only after an explicit reject decision', async () => {
    const dependencies = createDependencies()
    dependencies.transport.acknowledgeConsignment = vi.fn()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [{
      invoice: rgbInvoice(), recipientId: 'recipient', createdAt: 1,
      proxyPrivateKey: '44'.repeat(32),
      seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
      pendingValidationFailure: {
        reason: 'No matching blind assignment was found',
        discoveredAt: 1,
        txid: 'c'.repeat(64),
        endpoint: proxyEndpoint,
        reviewStatus: 'rejection_allowed',
      },
    }]

    await service.rejectReceive('recipient')

    expect(dependencies.transport.acknowledgeConsignment).toHaveBeenCalledWith(
      expect.objectContaining({ acknowledged: false, endpoints: [proxyEndpoint] })
    )
    expect(service.getPendingReceives()).toEqual([
      expect.objectContaining({
        proxyPrivateKey: '44'.repeat(32),
        rejection: expect.objectContaining({ kind: 'proxy_nack' }),
      }),
    ])
    expect(service.exportRecoveryState().pendingReceives).toEqual([
      expect.objectContaining({
        proxyPrivateKey: '44'.repeat(32),
        rejection: expect.objectContaining({ kind: 'proxy_nack' }),
      }),
    ])
    expect(service.getPendingReceiveHistory()).toEqual([
      expect.objectContaining({
        status: 'rejected', txid: 'c'.repeat(64),
        rejectionReason: 'Rejected by you after validation failed: No matching blind assignment was found',
      }),
    ])
  })

  it('allows an explicit local rejection when a claimed consignment has no ACK endpoint', async () => {
    const dependencies = createDependencies()
    dependencies.transport.acknowledgeConsignment = vi.fn()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [{
      invoice: rgbInvoice(), recipientId: 'recipient', createdAt: 1,
      proxyPrivateKey: '44'.repeat(32),
      seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
      pendingValidationFailure: {
        reason: 'No matching blind assignment was found',
        discoveredAt: 1,
        reviewStatus: 'rejection_allowed',
      },
    }]

    await expect(service.rejectReceive('recipient')).resolves.toEqual({
      rejected: true,
      rejectionReason: 'Discarded locally by you without notifying the sender after validation failed: No matching blind assignment was found',
    })

    expect(dependencies.transport.acknowledgeConsignment).not.toHaveBeenCalled()
    expect(service.getPendingReceives()).toEqual([
      expect.objectContaining({
        proxyPrivateKey: '44'.repeat(32),
        rejection: expect.objectContaining({ kind: 'local_validation_reject' }),
      }),
    ])
    expect(service.getPendingReceiveHistory()).toEqual([
      expect.objectContaining({
        status: 'rejected',
        rejectionReason: 'Discarded locally by you without notifying the sender after validation failed: No matching blind assignment was found',
      }),
    ])
  })

  it('clears a validation failure when a later poll verifies the consignment', async () => {
    const dependencies = createDependencies()
    dependencies.stateSource.reportReceiveValidationFailure = vi.fn().mockResolvedValue({
      caseId: 'e'.repeat(64), status: 'under_review',
    })
    dependencies.stateSource.resolveReceiveValidationFailure = vi.fn()
    dependencies.transport.getConsignment = vi.fn().mockResolvedValue({
      recipientId: 'recipient', payload: 'consignment', endpoint: proxyEndpoint,
    })
    dependencies.transport.acknowledgeConsignment = vi.fn()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [{
      invoice: rgbInvoice(), recipientId: 'recipient', createdAt: 1,
      seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
    }]
    ;(service as any).validateIncomingConsignment = vi.fn()
      .mockReturnValueOnce(undefined)
      .mockReturnValue({
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60', txid: 'c'.repeat(64),
        decoded: { metadata: { ticker: 'TOK', name: 'Token', precision: 0, schema: 'NIA', issuedSupply: '60' } },
      })

    await service.processClaimedReceives({ includeClaimed: false })
    expect(service.getPendingReceives()[0]?.pendingValidationFailure).toBeDefined()

    await service.processClaimedReceives({ includeClaimed: false })

    expect(service.getPendingReceives()[0]?.pendingValidationFailure).toBeUndefined()
    expect(service.getPendingReceives()[0]?.pendingAccept).toMatchObject({
      txid: 'c'.repeat(64), amount: '60',
    })
    expect(dependencies.stateSource.resolveReceiveValidationFailure).toHaveBeenCalledWith(
      wallet,
      'e'.repeat(64)
    )
    expect(dependencies.transport.acknowledgeConsignment).not.toHaveBeenCalled()
  })

  it('reopens a locally rejected donation after a later validator accepts it', async () => {
    const dependencies = createDependencies()
    dependencies.transport.getConsignment = vi.fn().mockResolvedValue({
      recipientId: 'recipient', payload: 'consignment', endpoint: proxyEndpoint,
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [{
      invoice: rgbInvoice(), recipientId: 'recipient', createdAt: 1,
      proxyPrivateKey: '44'.repeat(32),
      pendingValidationFailure: {
        reason: 'Old validator mismatch', discoveredAt: 1,
        endpoint: proxyEndpoint, reviewStatus: 'rejection_allowed',
      },
      rejection: {
        kind: 'local_validation_reject', rejectedAt: 2,
        reason: 'Discarded locally by you after validation failed: Old validator mismatch',
      },
    }]
    ;(service as any).state.pendingReceiveHistory = [{
      transferId: 'receive:recipient', assetId: '', amount: '', txid: '',
      createdAt: 1, status: 'rejected', rejectionReason: 'Old validator mismatch',
    }]
    ;(service as any).validateIncomingConsignment = vi.fn().mockReturnValue({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60', txid: 'c'.repeat(64),
      decoded: { metadata: {
        ticker: 'TOK', name: 'Token', precision: 0, schema: 'NIA', issuedSupply: '60',
      } },
    })

    await service.processClaimedReceives({ includeClaimed: false })

    expect(service.getPendingReceives()).toEqual([
      expect.objectContaining({
        proxyPrivateKey: '44'.repeat(32),
        pendingAccept: expect.objectContaining({ txid: 'c'.repeat(64) }),
      }),
    ])
    expect(service.getPendingReceives()[0]).not.toHaveProperty('rejection')
    expect(service.getPendingReceives()[0]).not.toHaveProperty('pendingValidationFailure')
    expect(service.getPendingReceiveHistory()).toEqual([])
  })

  it('keeps a receive pending while EVM mint finality is unavailable and retries it', async () => {
    const dependencies = createDependencies()
    let now = 1_000
    dependencies.now = () => now
    dependencies.transport.getConsignment = vi.fn().mockResolvedValue({
      recipientId: 'recipient', payload: 'consignment', endpoint: proxyEndpoint,
    })
    dependencies.transport.acknowledgeConsignment = vi.fn()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [{
      invoice: rgbInvoice(), recipientId: 'recipient', createdAt: 1,
      seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
    }]
    ;(service as any).validateIncomingConsignment = vi.fn()
      .mockRejectedValueOnce(new RgbBfaValidationUnavailableError(
        `Finalized BFA FundsIn event is missing for mint ${'d'.repeat(64)}`
      ))
      .mockReturnValue({
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60', txid: 'c'.repeat(64),
        decoded: { metadata: { ticker: 'TOK', name: 'Token', precision: 0, schema: 'BFA', issuedSupply: '60' } },
      })

    await service.processClaimedReceives({ includeClaimed: false })

    expect(service.getPendingReceives()[0]).not.toHaveProperty('pendingValidationFailure')
    expect(service.getPendingReceives()[0]).not.toHaveProperty('pendingAccept')
    expect(service.getPendingReceives()[0]?.validationRetry).toMatchObject({
      attempts: 1,
      nextRetryAt: now + 5 * 60_000,
    })
    const reopened = new RgbService(dependencies)
    await reopened.open(wallet)
    expect(reopened.getPendingReceives()[0]?.validationRetry).toMatchObject({
      attempts: 1,
      nextRetryAt: now + 5 * 60_000,
    })
    expect(dependencies.transport.acknowledgeConsignment).not.toHaveBeenCalled()

    await service.processClaimedReceives({ includeClaimed: false })
    expect((service as any).validateIncomingConsignment).toHaveBeenCalledTimes(1)
    expect(service.getPendingReceives()[0]).not.toHaveProperty('pendingAccept')

    now += 5 * 60_000
    await service.processClaimedReceives({ includeClaimed: false })

    expect(service.getPendingReceives()[0]?.pendingAccept).toMatchObject({
      txid: 'c'.repeat(64), amount: '60',
    })
    expect(service.getPendingReceives()[0]).not.toHaveProperty('validationRetry')
    expect(dependencies.transport.acknowledgeConsignment).not.toHaveBeenCalled()
  })

  it('bypasses receive validation backoff when the proxy payload changes', async () => {
    const dependencies = createDependencies()
    dependencies.now = () => 1_000
    dependencies.transport.getConsignment = vi.fn()
      .mockResolvedValueOnce({
        recipientId: 'recipient', payload: 'first-consignment', endpoint: proxyEndpoint,
      })
      .mockResolvedValue({
        recipientId: 'recipient', payload: 'replacement-consignment', endpoint: proxyEndpoint,
      })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [{
      invoice: rgbInvoice(), recipientId: 'recipient', createdAt: 1,
      seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
    }]
    ;(service as any).validateIncomingConsignment = vi.fn()
      .mockRejectedValueOnce(new RgbBfaValidationUnavailableError('EVM data unavailable'))
      .mockReturnValue({
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60', txid: 'c'.repeat(64),
        decoded: { metadata: {
          ticker: 'TOK', name: 'Token', precision: 0, schema: 'BFA', issuedSupply: '60',
        } },
      })

    await service.processClaimedReceives({ includeClaimed: false })
    await service.processClaimedReceives({ includeClaimed: false })

    expect((service as any).validateIncomingConsignment).toHaveBeenCalledTimes(2)
    expect(service.getPendingReceives()[0]).not.toHaveProperty('validationRetry')
    expect(service.getPendingReceives()[0]?.pendingAccept).toMatchObject({
      txid: 'c'.repeat(64), amount: '60',
    })
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

  it('refreshes unrelated outpoints while protecting an unsigned transfer input', async () => {
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
    const pending = service.getPendingTransfers()[0]!
    const protectedKeys = new Set(pending.prepared.lockedOutpoints.map(
      outpoint => `${outpoint.txid}:${outpoint.vout}`
    ))
    const preparedSnapshot = structuredClone(service.getSnapshot())
    const protectedUtxos = preparedSnapshot.utxos.filter(utxo =>
      protectedKeys.has(`${utxo.outpoint.txid}:${utxo.outpoint.vout}`)
    )
    const unrelated = preparedSnapshot.utxos.find(utxo =>
      !protectedKeys.has(`${utxo.outpoint.txid}:${utxo.outpoint.vout}`)
    )!
    vi.mocked(dependencies.stateSource.getSnapshot).mockResolvedValueOnce({
      syncedAt: 2,
      utxos: preparedSnapshot.utxos.map(utxo =>
        protectedKeys.has(`${utxo.outpoint.txid}:${utxo.outpoint.vout}`)
          ? { ...utxo, allocations: [] }
          : {
              ...utxo,
              chainStatus: 'confirmed', confirmations: 2,
              allocations: utxo.allocations.map(allocation => ({
                ...allocation, settled: true, spendable: true,
              })),
            }
      ),
    })

    await service.sync()

    expect(dependencies.stateSource.getSnapshot).toHaveBeenCalled()
    for (const protectedUtxo of protectedUtxos) {
      expect(service.getSnapshot().utxos.find(utxo =>
        utxo.outpoint.txid === protectedUtxo.outpoint.txid &&
        utxo.outpoint.vout === protectedUtxo.outpoint.vout
      )).toEqual(protectedUtxo)
    }
    expect(service.getSnapshot().utxos.find(utxo =>
      utxo.outpoint.txid === unrelated.outpoint.txid &&
      utxo.outpoint.vout === unrelated.outpoint.vout
    )).toMatchObject({
      chainStatus: 'confirmed', confirmations: 2,
      allocations: [expect.objectContaining({ settled: true, spendable: true })],
    })
  })

  it('keeps an allocation queued while an older snapshot request is in flight', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    let releaseSnapshot: (() => void) | undefined
    vi.mocked(dependencies.stateSource.getSnapshot).mockImplementationOnce(() =>
      new Promise<RgbWalletSnapshot>(resolve => {
        releaseSnapshot = () => resolve({ syncedAt: 2, utxos: [] })
      })
    )
    const refreshing = service.sync()
    const local = service.getSnapshot().utxos[0]!
    await service.queueUtxoSync({ txid: local.outpoint.txid, outpoints: [local] })
    await service.markUtxoSyncCompleted(local.outpoint.txid, service.getPendingUtxoSync())
    releaseSnapshot!()
    await refreshing
    expect(service.getSnapshot().utxos).toContainEqual(expect.objectContaining({
      outpoint: local.outpoint,
      allocations: local.allocations,
    }))
    expect(service.getSnapshot().syncedAt).toBe(1)
  })

  it('does not clear a newer allocation sync with an older completion for the same txid', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    const local = (await vi.mocked(dependencies.stateSource.getSnapshot)(wallet)).utxos[0]!
    await service.queueUtxoSync({ txid: local.outpoint.txid, outpoints: [local] })
    const previous = service.getPendingUtxoSync()!
    const updated = {
      ...local,
      allocations: [...local.allocations, { ...local.allocations[0]!, assignmentIndex: 1 }],
    }
    await service.queueUtxoSync({ txid: local.outpoint.txid, outpoints: [updated] })
    await service.markUtxoSyncCompleted(local.outpoint.txid, previous)
    expect(service.getPendingUtxoSync()?.outpoints.find(utxo =>
      utxo.outpoint.txid === local.outpoint.txid
    )?.allocations).toHaveLength(2)
    const current = service.getPendingUtxoSync()!
    await service.markUtxoSyncCompleted(local.outpoint.txid, current)
    expect(service.getPendingUtxoSync()).toBeUndefined()
  })

  it('refreshes unrelated assets while preserving a queued local output', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    const protectedUtxo = service.getSnapshot().utxos[0]!
    const unrelated = service.getSnapshot().utxos[1]!
    unrelated.chainStatus = 'mempool'
    unrelated.confirmations = 0
    unrelated.allocations = unrelated.allocations.map(allocation => ({
      ...allocation, settled: false, spendable: false,
    }))
    await service.queueUtxoSync({
      txid: protectedUtxo.outpoint.txid,
      outpoints: service.getSnapshot().utxos,
    })
    vi.mocked(dependencies.stateSource.getSnapshot).mockResolvedValueOnce({
      syncedAt: 2,
      utxos: [
        { ...protectedUtxo, allocations: [] },
        {
          ...unrelated,
          chainStatus: 'confirmed', confirmations: 2,
          allocations: unrelated.allocations.map(allocation => ({
            ...allocation, settled: true, spendable: true,
          })),
        },
      ],
    })

    await service.sync()

    expect(service.getSnapshot().utxos.find(utxo =>
      utxo.outpoint.txid === protectedUtxo.outpoint.txid &&
      utxo.outpoint.vout === protectedUtxo.outpoint.vout
    )?.allocations).toEqual(protectedUtxo.allocations)
    expect(service.getSnapshot().utxos.find(utxo =>
      utxo.outpoint.txid === unrelated.outpoint.txid &&
      utxo.outpoint.vout === unrelated.outpoint.vout
    )).toMatchObject({
      chainStatus: 'confirmed', confirmations: 2,
      allocations: [expect.objectContaining({ settled: true, spendable: true })],
    })
    expect(service.getPendingUtxoSync()?.txid).toBe(protectedUtxo.outpoint.txid)
  })

  it('replays locally settled allocations when the indexer omits them on a live outpoint', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    const local = service.getSnapshot().utxos[0]!
    vi.mocked(dependencies.stateSource.getSnapshot).mockResolvedValueOnce({
      syncedAt: 2,
      utxos: [{ ...local, allocations: [] }, service.getSnapshot().utxos[1]!],
    })
    await service.sync()
    expect(service.getSnapshot().utxos[0]?.allocations).toEqual(local.allocations)
    expect(service.getPendingUtxoSync()?.txid).toBe(local.outpoint.txid)
  })

  it.each(['mempool', 'confirmed'] as const)(
    'keeps a locally confirmed allocation settled while the indexer reports %s with pending color',
    async remoteStatus => {
      const dependencies = createDependencies()
      const service = new RgbService(dependencies)
      await service.open(wallet)
      await service.sync()
      const local = service.getSnapshot().utxos[0]!
      local.chainStatus = 'confirmed'
      local.confirmations = 1
      const assetId = local.allocations[0]!.assetId
      vi.mocked(dependencies.stateSource.getSnapshot).mockResolvedValueOnce({
        syncedAt: 2,
        utxos: [{
          ...local,
          chainStatus: remoteStatus,
          confirmations: remoteStatus === 'confirmed' ? 1 : 0,
          allocations: local.allocations.map(allocation => ({
            ...allocation, settled: false, spendable: false,
          })),
        }, service.getSnapshot().utxos[1]!],
      })

      await service.sync()

      expect(service.getLocalAssetBalance(assetId)).toMatchObject({
        settled: '100', spendable: '100', pending: '0',
      })
      expect(service.getSnapshot().utxos[0]).toMatchObject({
        chainStatus: 'confirmed',
        allocations: [expect.objectContaining({ settled: true, spendable: true })],
      })
      expect(service.getPendingUtxoSync()?.txid).toBe(local.outpoint.txid)
    }
  )

  it.each(['change', 'blind'] as const)(
    'recovers a lost v1 %s allocation from accepted history and a confirmed wallet output',
    async recipient => {
    const genesis = encodeNiaGenesis({
      ticker: 'NIA', name: 'Recovered', precision: 0, timestamp: 1,
      network: 'mainnet', allocations: [{ txid: 'a'.repeat(64), vout: 0, blinding: 1n, amount: 100n }],
    })
    const rawAssetId = `rgb:${Buffer.from(genesis.assetId).toString('hex')}`
    const assetId = encodeRgbContractId(genesis.assetId)
    const receivedSeal = { txid: 'd'.repeat(64), vout: 0, blinding: 5n }
    const invoice = decodeRgbInvoice(recipient === 'blind'
      ? encodeBlindRgbInvoice({ network: 'mainnet', seal: receivedSeal, assetId, amount: '60' })
      : `${rawAssetId}/~/~/` + blindRecipient + '?amount=60')
    const prepared = prepareNiaOpretTransfer({
      network: 'mainnet', assetId: rawAssetId, amount: '60',
      selectedUtxos: [{
        outpoint: { txid: 'a'.repeat(64), vout: 0 }, satoshis: 10_000,
        scriptPubKey: `5120${'11'.repeat(32)}`, publicKey: `02${'22'.repeat(32)}`,
        allocations: [{ assetId: rawAssetId, amount: '100', settled: true, spendable: true,
          opId: rawAssetId.slice(4), assignmentIndex: 0, assignmentType: 4000 }],
      }],
      recipientSeal: invoice.seal, feeRate: 2,
      feeFunding: { utxos: [{
        outpoint: { txid: 'b'.repeat(64), vout: 1 }, satoshis: 10_000,
        scriptPubKey: `5120${'11'.repeat(32)}`, publicKey: `02${'22'.repeat(32)}`,
      }], changeScriptPubKey: `5120${'11'.repeat(32)}`, changeDustLimit: 330 },
      nonce: 1n, entropy: 2n, recipientBlinding: 3n, changeBlinding: 4n,
    })
    const psbt = Psbt.fromHex(prepared.psbtHex)
    const transaction = Transaction.fromBuffer(
      ((psbt.data.globalMap.unsignedTx as any).tx || psbt.data.globalMap.unsignedTx).toBuffer()
    )
    const bundle = serializeBfaOpretWitnessBundle({
      witnessTx: transaction.toBuffer(), contractId: rawAssetId,
      transitionId: prepared.transitionId, transition: prepared.transition,
      inputs: [{ opId: rawAssetId.slice(4), assignmentType: 4000, assignmentIndex: 0 }],
      entropy: 2n,
    })
    const consignment = encodeBfaTransferConsignment({
      genesis: genesis.strict, validatedWitnessBundles: [], witnessBundle: bundle.strict,
    })
    const output = transaction.outs[prepared.changeVout!]!
    const target = recipient === 'blind'
      ? { outpoint: { txid: receivedSeal.txid, vout: receivedSeal.vout },
          satoshis: 1_000, scriptPubKey: `5120${'11'.repeat(32)}` }
      : { outpoint: { txid: transaction.getId(), vout: prepared.changeVout! },
          satoshis: output.value, scriptPubKey: output.script.toString('hex') }
    const dependencies = createDependencies()
    let now = 1_000_000
    dependencies.now = () => now
    vi.mocked(dependencies.stateSource.getSnapshot).mockResolvedValue({
      syncedAt: 1, utxos: [{
        ...target,
        publicKey: `02${'22'.repeat(32)}`, chainStatus: 'confirmed', confirmations: 1,
        allocations: [],
      }],
    })
    let outputStatus: 'spent' | 'confirmed' = 'spent'
    dependencies.stateSource.verifyUtxos = vi.fn(async (_wallet, outpoints) =>
      outpoints.map(utxo => ({
        outpoint: utxo.outpoint, status: outputStatus, confirmations: outputStatus === 'confirmed' ? 1 : 0,
      }))
    )
    dependencies.validateBfaConsignment = vi.fn(({ payload, knownBlindSeals }) =>
      validateBfaTransferConsignment(payload, {
        network: 0, knownBlindSeals, isBitcoinTxConfirmed: async () => true,
      })
    )
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.contracts = {
      [assetId]: { consignment: Buffer.from(consignment).toString('base64'), createdAt: 1 },
    }
    if (recipient === 'blind') (service as any).state.receivedBlindSeals = [receivedSeal]
    await service.sync()
    expect(service.getLocalAssetBalance(assetId)?.settled || '0').toBe('0')
    expect(service.getPendingUtxoSync()).toBeUndefined()
    outputStatus = 'confirmed'
    now += 5 * 60_000 + 1
    await service.sync()
    expect(service.getLocalAssetBalance(assetId)).toMatchObject({
      settled: recipient === 'blind' ? '60' : '40',
      spendable: recipient === 'blind' ? '60' : '40',
    })
    expect(service.getPendingUtxoSync()?.outpoints[0]?.allocations).toContainEqual(
      expect.objectContaining({ assetId, amount: recipient === 'blind' ? '60' : '40' })
    )
    expect(dependencies.stateSource.verifyUtxos).toHaveBeenCalledTimes(2)
    }
  )

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

  it('reuses the persisted snapshot when the backend revision is unchanged', async () => {
    const dependencies = createDependencies()
    const firstSnapshot = {
      ...(await vi.mocked(dependencies.stateSource.getSnapshot)(wallet)),
      revision: 12,
    }
    vi.mocked(dependencies.stateSource.getSnapshot)
      .mockReset()
      .mockResolvedValueOnce(firstSnapshot)
      .mockResolvedValueOnce({
        unchanged: true,
        revision: 12,
        syncedAt: 2,
        utxos: [],
      })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    const originalUtxos = structuredClone(service.getSnapshot().utxos)

    await service.sync()

    expect(dependencies.stateSource.getSnapshot).toHaveBeenNthCalledWith(2, wallet, {
      knownRevision: 12,
    })
    expect(service.getSnapshot()).toMatchObject({
      revision: 12,
      syncedAt: 2,
      utxos: originalUtxos,
    })
  })

  it('consumes terminal snapshot tombstones without retaining spent UTXOs locally', async () => {
    const dependencies = createDependencies()
    const firstSnapshot = {
      ...(await vi.mocked(dependencies.stateSource.getSnapshot)(wallet)),
      revision: 20,
    }
    const spent = {
      ...structuredClone(firstSnapshot.utxos[0]),
      chainStatus: 'spent' as const,
      confirmations: 0,
    }
    vi.mocked(dependencies.stateSource.getSnapshot)
      .mockReset()
      .mockResolvedValueOnce(firstSnapshot)
      .mockResolvedValueOnce({
        revision: 21,
        syncedAt: 2,
        utxos: [spent, firstSnapshot.utxos[1]],
      })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()

    await service.sync()

    expect(service.getSnapshot()).toMatchObject({ revision: 21, syncedAt: 2 })
    expect(service.getSnapshot().utxos.map(utxo => utxo.outpoint)).toEqual([
      firstSnapshot.utxos[1].outpoint,
    ])
    expect(service.getUtxoInspection().snapshot.utxos).toHaveLength(1)
  })

  it('removes explicit terminal tombstones while retaining unresolved local state', async () => {
    const dependencies = createDependencies()
    const firstSnapshot = {
      ...(await vi.mocked(dependencies.stateSource.getSnapshot)(wallet)),
      revision: 20,
    }
    vi.mocked(dependencies.stateSource.getSnapshot)
      .mockReset()
      .mockResolvedValueOnce(firstSnapshot)
      .mockResolvedValueOnce({
        revision: 21,
        syncedAt: 2,
        utxos: [{
          ...structuredClone(firstSnapshot.utxos[0]),
          chainStatus: 'spent' as const,
          confirmations: 0,
        }],
      })
    dependencies.stateSource.getTransactionStatus = vi.fn(async () => ({
      status: 'confirmed' as const,
      confirmations: 1,
    }))
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()

    await service.sync()

    expect(service.getSnapshot().revision).toBe(20)
    expect(service.getSnapshot().utxos.map(utxo => utxo.outpoint)).toEqual([
      firstSnapshot.utxos[1].outpoint,
    ])
  })

  it('prunes a spent locally overlaid broadcast output when the backend revision is unchanged', async () => {
    const dependencies = createDependencies()
    const firstSnapshot = {
      ...(await vi.mocked(dependencies.stateSource.getSnapshot)(wallet)),
      revision: 33,
    }
    vi.mocked(dependencies.stateSource.getSnapshot)
      .mockReset()
      .mockResolvedValueOnce(firstSnapshot)
      .mockResolvedValueOnce({
        unchanged: true,
        revision: 33,
        syncedAt: 2,
        utxos: [],
      })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    const state = (service as any).state
    const txid = 'e'.repeat(64)
    state.snapshot.utxos.push({
      ...structuredClone(state.snapshot.utxos[0]),
      outpoint: { txid, vout: 1 },
      chainStatus: 'mempool',
      confirmations: 0,
    })
    state.pendingSendHistory = [{
      transferId: 'broadcast-transfer', invoice: rgbInvoice(),
      assetId: state.snapshot.utxos[0].allocations[0].assetId,
      amount: '40', txid, spentOutpoints: [{ txid: 'b'.repeat(64), vout: 1 }],
      createdAt: 1, status: 'broadcasted', fundingSnapshotConverged: true,
    }]
    dependencies.stateSource.verifyUtxos = vi.fn(async (_wallet, outpoints) =>
      outpoints.map(utxo => ({
        outpoint: utxo.outpoint,
        status: 'spent' as const,
        confirmations: 0,
      }))
    )

    await service.sync()

    expect(dependencies.stateSource.verifyUtxos).toHaveBeenCalledWith(
      wallet,
      [expect.objectContaining({ outpoint: { txid, vout: 1 } })]
    )
    expect(service.getSnapshot().utxos).not.toContainEqual(
      expect.objectContaining({ outpoint: { txid, vout: 1 } })
    )
    expect(service.getSnapshot()).toMatchObject({ revision: 33, syncedAt: 2 })
    expect(state.broadcastOutputVerificationVersion).toBe(1)
  })

  it('explicitly removes spent carriers retained by a correct unchanged backend snapshot', async () => {
    const dependencies = createDependencies()
    dependencies.stateSource.verifyUtxos = vi.fn(async (_wallet, outpoints) =>
      outpoints.map(utxo => ({
        outpoint: utxo.outpoint,
        status: utxo.outpoint.txid === 'a'.repeat(64) ? 'spent' as const : 'confirmed' as const,
        confirmations: utxo.outpoint.txid === 'a'.repeat(64) ? 0 : 1,
      }))
    )
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()

    await expect(service.pruneSpentSnapshotUtxos()).resolves.toEqual({
      checked: 2,
      removed: 1,
      remaining: 1,
    })
    expect(service.getSnapshot().utxos.map(utxo => utxo.outpoint)).toEqual([
      { txid: 'b'.repeat(64), vout: 1 },
    ])
    expect(service.getLocalAssetBalance('rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE'))
      .toMatchObject({ settled: '60', spendable: '60' })
  })

  it('does not restore a broadcast output omitted by the snapshot after it was spent', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    const state = (service as any).state
    const txid = 'e'.repeat(64)
    const created = {
      ...structuredClone(state.snapshot.utxos[0]),
      outpoint: { txid, vout: 1 },
      chainStatus: 'mempool' as const,
      confirmations: 0,
    }
    state.snapshot.utxos.push(created)
    state.pendingSendHistory = [{
      transferId: 'broadcast-transfer', invoice: rgbInvoice(),
      assetId: created.allocations[0].assetId,
      amount: '40', txid, spentOutpoints: [{ txid: 'b'.repeat(64), vout: 1 }],
      createdAt: 1, status: 'broadcasted',
    }]
    dependencies.stateSource.verifyUtxos = vi.fn().mockResolvedValue([{
      outpoint: created.outpoint,
      status: 'spent',
      confirmations: 0,
    }])
    vi.mocked(dependencies.stateSource.getSnapshot).mockResolvedValueOnce({
      syncedAt: 2,
      utxos: [structuredClone(state.snapshot.utxos[0])],
    })

    await service.sync()

    expect(service.getSnapshot().utxos).not.toContainEqual(
      expect.objectContaining({ outpoint: { txid, vout: 1 } })
    )
    expect(state.pendingSendHistory[0].fundingSnapshotConverged).toBe(true)
  })

  it('promotes confirmed local send change when the UTXO snapshot remains at mempool', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    const state = (service as any).state
    const txid = 'e'.repeat(64)
    const assetId = state.snapshot.utxos[0].allocations[0].assetId
    const opId = 'f'.repeat(64)
    const created = {
      ...structuredClone(state.snapshot.utxos[0]),
      outpoint: { txid, vout: 1 },
      chainStatus: 'mempool' as const,
      confirmations: 0,
      allocations: [{
        ...structuredClone(state.snapshot.utxos[0].allocations[0]),
        opId,
        amount: '968',
        settled: false,
        spendable: false,
        historyAvailable: true,
      }],
    }
    state.snapshot.utxos.push(created)
    state.contracts = {
      [assetId]: {
        consignment: 'local-consignment',
        createdAt: 1,
        metadata: { ticker: 'RGB', name: 'RGB', precision: 0, schema: 'NIA', issuedSupply: '1000' },
        history: { payload: 'local-consignment', opIds: [opId], updatedAt: 1 },
      },
    }
    // Activity confirmation may already have compacted the send tombstone
    // while the UTXO index still reports this output as mempool.
    state.pendingSendHistory = []
    dependencies.stateSource.verifyUtxos = vi.fn().mockResolvedValue([{
      outpoint: created.outpoint,
      status: 'confirmed',
      confirmations: 4,
      confirmationHeight: 53_511,
    }])
    vi.mocked(dependencies.stateSource.getSnapshot).mockResolvedValueOnce({
      syncedAt: 2,
      utxos: [
        structuredClone(state.snapshot.utxos[0]),
        structuredClone(created),
      ],
    })

    await service.sync()

    expect(dependencies.stateSource.verifyUtxos).toHaveBeenCalledWith(
      wallet,
      [expect.objectContaining({ outpoint: { txid, vout: 1 } })]
    )
    expect(service.getSnapshot().utxos).toContainEqual(expect.objectContaining({
      outpoint: { txid, vout: 1 },
      chainStatus: 'confirmed',
      confirmations: 4,
      confirmationHeight: 53_511,
      allocations: [expect.objectContaining({ amount: '968', settled: true, spendable: true })],
    }))
    expect(state.pendingUtxoSync).toMatchObject({ txid })
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
        invoice: `rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE/~/~/${blindRecipient}?amount=60`,
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

    const issuanceTxid = 'a'.repeat(64)
    await service.queueIssue({
      assetId: 'rgb:BgYGBgYG-BgYGBgY-GBgYGBg-YGBgYGB-gYGBgYG-BgYGBgY',
      issuanceTxid,
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
        issuanceTxid,
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

  it('serializes concurrent blind invoice creation before selecting a funding UTXO', async () => {
    const dependencies = createDependencies()
    vi.mocked(dependencies.stateSource.getSnapshot).mockResolvedValue({
      syncedAt: 1,
      utxos: ['e', 'f'].map((prefix, index) => ({
        outpoint: { txid: prefix.repeat(64), vout: index },
        satoshis: 1_000,
        scriptPubKey: `5120${String(index + 1).repeat(64)}`,
        publicKey: `02${String(index + 2).repeat(64)}`,
        chainStatus: 'confirmed' as const,
        confirmations: 1,
        allocations: [],
      })),
    })
    let releaseFirst!: () => void
    let firstStarted!: () => void
    const started = new Promise<void>(resolve => (firstStarted = resolve))
    dependencies.transport.prepareInvoice = vi.fn()
      .mockImplementationOnce(async () => {
        firstStarted()
        await new Promise<void>(resolve => (releaseFirst = resolve))
        return undefined
      })
      .mockResolvedValue(undefined)
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()

    const first = service.createBlindReceive({})
    await started
    const second = service.createBlindReceive({})
    await Promise.resolve()
    expect(dependencies.transport.prepareInvoice).toHaveBeenCalledTimes(1)
    releaseFirst()

    const receives = await Promise.all([first, second])
    expect(dependencies.transport.prepareInvoice).toHaveBeenCalledTimes(2)
    expect(new Set(receives.map(receive => `${receive.seal.txid}:${receive.seal.vout}`)).size)
      .toBe(2)
  })

  it('shares a serialized ten-invoice limit between blind and witness receives', async () => {
    const dependencies = createDependencies()
    vi.mocked(dependencies.stateSource.getSnapshot).mockResolvedValue({
      syncedAt: 1,
      utxos: [{
        outpoint: { txid: 'f'.repeat(64), vout: 0 },
        satoshis: 1_000,
        scriptPubKey: `5120${'11'.repeat(32)}`,
        publicKey: `02${'22'.repeat(32)}`,
        chainStatus: 'confirmed',
        confirmations: 1,
        allocations: [],
      }],
    })
    let releaseBlind!: () => void
    let blindStarted!: () => void
    const started = new Promise<void>(resolve => (blindStarted = resolve))
    dependencies.transport.prepareInvoice = vi.fn()
      .mockImplementationOnce(async () => {
        blindStarted()
        await new Promise<void>(resolve => (releaseBlind = resolve))
        return undefined
      })
      .mockResolvedValue(undefined)
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    ;(service as any).state.pendingReceives = Array.from({ length: 9 }, (_, index) => ({
      recipientId: `existing-${index}`,
      recipientType: index % 2 ? 'witness' : 'blind',
      createdAt: index + 1,
    }))
    const witnessInput = {
      scriptPubKey: `5120${'33'.repeat(32)}`,
      publicKey: `02${'44'.repeat(32)}`,
    }

    const blind = service.createBlindReceive({})
    await started
    const witness = service.createWitnessReceive(witnessInput)
    await Promise.resolve()
    expect(dependencies.transport.prepareInvoice).toHaveBeenCalledTimes(1)
    releaseBlind()
    const createdBlind = await blind

    await expect(witness).rejects.toThrow(
      'RGB receive invoice limit reached (maximum 10)'
    )
    expect(service.getReceiveInvoiceCapacity()).toEqual({
      count: 10,
      limit: 10,
      available: false,
    })
    expect(dependencies.transport.prepareInvoice).toHaveBeenCalledTimes(1)

    await expect(service.cancelBlindReceive(createdBlind.recipientId)).resolves.toEqual({
      cancelled: true,
    })
    await expect(service.createWitnessReceive(witnessInput)).resolves.toMatchObject({
      recipientType: 'witness',
    })
  })

  it('releases a rejected blind receive outpoint while retaining its recovery tombstone', async () => {
    const dependencies = createDependencies()
    const funding = {
      outpoint: { txid: 'f'.repeat(64), vout: 0 },
      satoshis: 1_000,
      scriptPubKey: `5120${'11'.repeat(32)}`,
      publicKey: `02${'22'.repeat(32)}`,
      chainStatus: 'confirmed' as const,
      confirmations: 1,
      allocations: [],
    }
    vi.mocked(dependencies.stateSource.getSnapshot).mockResolvedValue({
      syncedAt: 1, utxos: [funding],
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    ;(service as any).state.pendingReceives = [{
      invoice: rgbInvoice(), recipientId: 'rejected-recipient', createdAt: 1,
      seal: { ...funding.outpoint, blinding: 1n },
      pendingValidationFailure: { reason: 'invalid', discoveredAt: 1 },
      rejection: {
        kind: 'local_donation_reject', rejectedAt: 2, reason: 'Rejected by you',
      },
    }]

    expect(service.getPendingReceives()).toHaveLength(1)
    expect(service.getAvailableReceiveUtxos()).toEqual([funding])
    expect(service.getAvailableIssueUtxos()).toEqual([funding])
    expect(service.getUtxoInspection().invoiceReservations).toEqual([])
  })

  it('abandons a rejected companion allocation without removing the valid target allocation', async () => {
    const service = new RgbService(createDependencies())
    await service.open(wallet)
    const targetAssetId = 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE'
    const rejectedAssetId = 'rgb:AgICAgIC-AgICAgI-CAgICAg-ICAgICA-gICAgIC-AgICAgI'
    const utxo = {
      outpoint: { txid: 'a'.repeat(64), vout: 0 },
      satoshis: 1_000,
      scriptPubKey: `5120${'11'.repeat(32)}`,
      publicKey: `02${'22'.repeat(32)}`,
      chainStatus: 'confirmed' as const,
      allocations: [
        { assetId: targetAssetId, amount: '10', settled: true, spendable: true,
          opId: '1'.repeat(64), assignmentIndex: 0, assignmentType: 4000 },
        { assetId: rejectedAssetId, amount: '20', settled: true, spendable: true,
          opId: '2'.repeat(64), assignmentIndex: 0, assignmentType: 4000 },
      ],
    }
    const state = (service as any).state
    state.snapshot = { syncedAt: 1, utxos: [utxo] }
    state.pendingReceives = [{
      invoice: rgbInvoice(), recipientId: 'rejected', createdAt: 1,
      pendingAccept: {
        payload: 'payload', txid: 'b'.repeat(64), assetId: rejectedAssetId,
        amount: '20', operationIds: ['2'.repeat(64)], discoveredAt: 1,
        recipientAllocations: [{
          outpoint: utxo.outpoint,
          opId: '2'.repeat(64),
          assignmentIndex: 0,
        }],
      },
      rejection: { kind: 'local_donation_reject', rejectedAt: 2, reason: 'Rejected by you' },
    }]

    await expect((service as any).discardRejectedCompanionAllocations([utxo], targetAssetId))
      .resolves.toBe(1)

    expect(state.snapshot.utxos[0].allocations).toEqual([
      expect.objectContaining({ assetId: targetAssetId, opId: '1'.repeat(64) }),
    ])
    expect(state.discardedAllocations).toEqual([
      expect.objectContaining({
        assetId: rejectedAssetId,
        opId: '2'.repeat(64),
        reason: 'rejected_receive',
      }),
    ])
    expect(state.pendingUtxoSync.outpoints[0].allocations).toHaveLength(1)
  })

  it('rejects only the donation recipient assignment and preserves self-transfer change', async () => {
    const service = new RgbService(createDependencies())
    await service.open(wallet)
    const state = (service as any).state
    const assetId = 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE'
    const txid = 'a'.repeat(64)
    const opId = '2'.repeat(64)
    const recipient = {
      outpoint: { txid, vout: 0 },
      satoshis: 330,
      scriptPubKey: `5120${'11'.repeat(32)}`,
      publicKey: `02${'22'.repeat(32)}`,
      chainStatus: 'confirmed' as const,
      allocations: [{ assetId, amount: '20', settled: true, spendable: true,
        opId, assignmentIndex: 0, assignmentType: 4000 }],
    }
    const change = {
      outpoint: { txid, vout: 1 },
      satoshis: 330,
      scriptPubKey: `5120${'33'.repeat(32)}`,
      publicKey: `02${'44'.repeat(32)}`,
      chainStatus: 'confirmed' as const,
      allocations: [{ assetId, amount: '80', settled: true, spendable: true,
        opId, assignmentIndex: 1, assignmentType: 4000 }],
    }
    state.snapshot = { syncedAt: 1, utxos: [recipient, change] }
    state.contracts = { [assetId]: {
      consignment: 'payload', createdAt: 1,
      history: { payload: 'payload', opIds: [opId], updatedAt: 1 },
    } }
    state.pendingReceives = [{
      invoice: rgbInvoice(), recipientId: 'rejected', createdAt: 1,
      pendingAccept: {
        payload: 'payload', txid, assetId, amount: '20', operationIds: [opId], discoveredAt: 1,
        recipientAllocations: [{
          outpoint: recipient.outpoint,
          opId,
          assignmentIndex: 0,
        }],
      },
      rejection: { kind: 'local_donation_reject', rejectedAt: 2, reason: 'Rejected by you' },
    }]

    const inspection = service.getUtxoInspection().snapshot.utxos
    expect(inspection[0].allocations[0]).toMatchObject({ rejected: true, discardable: true })
    expect(inspection[1].allocations[0]).toMatchObject({ rejected: false, discardable: false })
    expect(service.getLocalAssetBalance(assetId)).toMatchObject({
      balance: '80',
      spendable: '80',
    })
    expect((service as any).selectUtxos(assetId, '80')).toEqual([change])
    expect(() => (service as any).selectUtxos(assetId, '81')).toThrow(
      'Insufficient spendable RGB balance'
    )

    await expect(service.discardUtxoAllocation({
      outpoint: change.outpoint, assetId, opId, assignmentIndex: 1,
    })).rejects.toThrow('valid RGB allocation cannot be removed')
    await expect(service.discardUtxoAllocation({
      outpoint: recipient.outpoint, assetId, opId, assignmentIndex: 0,
    })).resolves.toMatchObject({ discarded: 1 })
    expect(state.snapshot.utxos[1].allocations).toEqual(change.allocations)
    expect(state.discardedAllocations).toEqual([
      expect.objectContaining({
        outpoint: recipient.outpoint,
        opId,
        assignmentIndex: 0,
        reason: 'rejected_receive',
      }),
    ])
  })

  it('uses an old rejected witness invoice destination without matching its self-change', async () => {
    const service = new RgbService(createDependencies())
    await service.open(wallet)
    const state = (service as any).state
    const assetId = 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE'
    const txid = 'a'.repeat(64)
    const opId = '2'.repeat(64)
    const recipientScript = `5120${'11'.repeat(32)}`
    state.snapshot = { syncedAt: 1, utxos: [
      {
        outpoint: { txid, vout: 0 }, satoshis: 330, scriptPubKey: recipientScript,
        publicKey: `02${'22'.repeat(32)}`, chainStatus: 'confirmed',
        allocations: [{ assetId, amount: '20', settled: true, spendable: true,
          opId, assignmentIndex: 0, assignmentType: 4000 }],
      },
      {
        outpoint: { txid, vout: 1 }, satoshis: 330, scriptPubKey: `5120${'33'.repeat(32)}`,
        publicKey: `02${'44'.repeat(32)}`, chainStatus: 'confirmed',
        allocations: [{ assetId, amount: '80', settled: true, spendable: true,
          opId, assignmentIndex: 1, assignmentType: 4000 }],
      },
    ] }
    state.pendingReceives = [{
      invoice: rgbInvoice(), recipientId: 'legacy-rejected', recipientType: 'witness',
      witnessScriptPubKey: recipientScript, createdAt: 1,
      pendingAccept: {
        payload: 'payload', txid, assetId, amount: '20', operationIds: [opId], discoveredAt: 1,
      },
      rejection: { kind: 'local_donation_reject', rejectedAt: 2, reason: 'Rejected by you' },
    }]

    const inspection = service.getUtxoInspection().snapshot.utxos
    expect(inspection[0].allocations[0].rejected).toBe(true)
    expect(inspection[1].allocations[0].rejected).toBe(false)
  })

  it('only allows manual removal of rejected or locally unverifiable allocations', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    const state = (service as any).state
    const assetId = 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE'
    const utxo = {
      outpoint: { txid: 'a'.repeat(64), vout: 0 },
      satoshis: 1_000,
      scriptPubKey: `5120${'11'.repeat(32)}`,
      publicKey: `02${'22'.repeat(32)}`,
      chainStatus: 'confirmed' as const,
      allocations: [{ assetId, amount: '10', settled: true, spendable: true,
        opId: '1'.repeat(64), assignmentIndex: 0, assignmentType: 4000 }],
    }
    state.snapshot = { syncedAt: 1, utxos: [utxo] }
    state.contracts = { [assetId]: {
      consignment: 'payload', createdAt: 1,
      history: { payload: 'payload', opIds: ['1'.repeat(64)], updatedAt: 1 },
    } }

    await expect(service.discardUtxoAllocation({
      outpoint: utxo.outpoint, assetId, opId: '1'.repeat(64), assignmentIndex: 0,
    })).rejects.toThrow('valid RGB allocation cannot be removed')

    delete state.contracts[assetId]
    await expect(service.discardUtxoAllocation({
      outpoint: utxo.outpoint, assetId, opId: '1'.repeat(64), assignmentIndex: 0,
    })).rejects.toThrow('Repair RGB history before removing')
    vi.mocked(dependencies.stateSource.getValidationHistory).mockRejectedValueOnce(
      new Error('history service unavailable')
    )
    await expect(service.repairUtxoAllocationHistory({
      outpoint: utxo.outpoint, assetId, opId: '1'.repeat(64), assignmentIndex: 0,
    })).rejects.toThrow('history service unavailable')
    expect(service.getUtxoInspection().snapshot.utxos[0].allocations[0]).toMatchObject({
      repairable: true,
      repairFailed: false,
      discardable: false,
    })
    vi.mocked(dependencies.stateSource.getValidationHistory).mockResolvedValue({
      assetId,
      consignments: [],
    })
    await expect(service.repairUtxoAllocationHistory({
      outpoint: utxo.outpoint, assetId, opId: '1'.repeat(64), assignmentIndex: 0,
    })).resolves.toMatchObject({
      repaired: false,
      removable: true,
    })
    await expect(service.discardUtxoAllocation({
      outpoint: utxo.outpoint, assetId, opId: '1'.repeat(64), assignmentIndex: 0,
    })).resolves.toMatchObject({ discarded: 1, assetId })
    expect(state.snapshot.utxos[0].allocations).toEqual([])
  })

  it('does not display or restore a tombstoned allocation from a stale local snapshot', async () => {
    const dependencies = createDependencies()
    const assetId = 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE'
    const allocation = { assetId, amount: '10', settled: true, spendable: true,
      opId: '1'.repeat(64), assignmentIndex: 0, assignmentType: 4000 }
    const utxo = {
      outpoint: { txid: 'a'.repeat(64), vout: 0 },
      satoshis: 1_000,
      scriptPubKey: `5120${'11'.repeat(32)}`,
      publicKey: `02${'22'.repeat(32)}`,
      chainStatus: 'confirmed' as const,
      confirmations: 1,
      allocations: [allocation],
    }
    vi.mocked(dependencies.stateSource.getSnapshot).mockResolvedValue({
      syncedAt: 2,
      utxos: [{ ...utxo, allocations: [] }],
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    const state = (service as any).state
    state.snapshot = { syncedAt: 1, utxos: [utxo] }
    state.discardedAllocations = [{
      outpoint: utxo.outpoint,
      assetId,
      opId: allocation.opId,
      assignmentIndex: allocation.assignmentIndex,
      discardedAt: 1,
      reason: 'manual',
    }]

    expect(service.getUtxoInspection().snapshot.utxos[0].allocations).toEqual([])
    await service.sync()
    expect(state.snapshot.utxos[0].allocations).toEqual([])
    expect(state.pendingUtxoSync).toBeUndefined()
  })

  it('does not count hidden expired invoices against active receive capacity', async () => {
    const dependencies = createDependencies()
    dependencies.now = () => 2_000_000
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = Array.from({ length: 10 }, (_, index) => ({
      invoice: `expired-${index}`,
      recipientId: `expired-${index}`,
      createdAt: 1,
      expirationTimestamp: 1_999,
    }))

    expect(service.getPendingReceives()).toEqual([])
    expect(service.getReceiveInvoiceCapacity()).toEqual({
      count: 0,
      limit: 10,
      available: true,
    })
  })

  it('preserves unexpired duplicate blind invoices after an empty proxy poll', async () => {
    const dependencies = createDependencies()
    dependencies.transport.getConsignment = vi.fn().mockResolvedValue(undefined)
    const service = new RgbService(dependencies)
    await service.open(wallet)
    const expirationTimestamp = Math.floor(Date.now() / 1000) + 3_600
    const outpoint = { txid: 'f'.repeat(64), vout: 2 }
    const receives = [1n, 2n].map((blinding, index) => {
      const seal = { ...outpoint, blinding }
      const invoice = encodeBlindRgbInvoice({
        network: 'mainnet', seal, expirationTimestamp, transportEndpoints: [proxyEndpoint],
      })
      return {
        invoice,
        recipientId: decodeRgbInvoice(invoice).recipientId,
        createdAt: index + 1,
        expirationTimestamp,
        seal,
      }
    })
    ;(service as any).state.pendingReceives = receives
    await service.processClaimedReceives({ includeClaimed: false })

    expect(service.getPendingReceives()).toEqual(receives)
    expect((service as any).state.releasedReceiveRecipientIds).toBeUndefined()
  })

  it('releases expired duplicate blind invoices after an empty batch proxy poll', async () => {
    const dependencies = createDependencies()
    const getConsignments = vi.fn().mockResolvedValue([])
    dependencies.transport.getConsignments = getConsignments
    const service = new RgbService(dependencies)
    await service.open(wallet)
    const expirationTimestamp = Math.floor(Date.now() / 1000) - 1
    const outpoint = { txid: 'f'.repeat(64), vout: 2 }
    const receives = [1n, 2n].map((blinding, index) => {
      const seal = { ...outpoint, blinding }
      const invoice = encodeBlindRgbInvoice({
        network: 'mainnet', seal, expirationTimestamp, transportEndpoints: [proxyEndpoint],
      })
      return {
        invoice,
        recipientId: decodeRgbInvoice(invoice).recipientId,
        createdAt: index + 1,
        expirationTimestamp,
        seal,
      }
    })
    const queriedRecipientIds = receives.map(receive => receive.recipientId)
    ;(service as any).state.pendingReceives = receives

    await service.processClaimedReceives({ includeClaimed: false })

    expect((service as any).state.pendingReceives).toEqual([])
    expect((service as any).state.releasedReceiveRecipientIds).toEqual(
      expect.arrayContaining(queriedRecipientIds)
    )
    expect(getConsignments).toHaveBeenCalledWith(
      expect.arrayContaining(queriedRecipientIds.map(recipientId =>
        expect.objectContaining({ recipientId })
      ))
    )
  })

  it('restores invoice capacity after an empty batch poll for an expired receive', async () => {
    const dependencies = createDependencies()
    dependencies.transport.getConsignments = vi.fn().mockResolvedValue([])
    const service = new RgbService(dependencies)
    await service.open(wallet)
    const expirationTimestamp = Math.floor(Date.now() / 1000) - 1
    const seal = { txid: 'f'.repeat(64), vout: 2, blinding: 1n }
    const invoice = encodeBlindRgbInvoice({
      network: 'mainnet', seal, expirationTimestamp, transportEndpoints: [proxyEndpoint],
    })
    const receive = {
      invoice,
      recipientId: decodeRgbInvoice(invoice).recipientId,
      createdAt: 1,
      expirationTimestamp,
      seal,
    }
    ;(service as any).state.pendingReceives = [receive]

    await service.processClaimedReceives({ includeClaimed: false })

    expect((service as any).state.pendingReceives).toEqual([])
    expect(service.getReceiveInvoiceCapacity()).toEqual({
      count: 0,
      limit: 10,
      available: true,
    })
  })

  it('skips a malformed durable invoice while polling valid receives', async () => {
    const dependencies = createDependencies()
    const getConsignments = vi.fn().mockResolvedValue([])
    dependencies.transport.getConsignments = getConsignments
    const service = new RgbService(dependencies)
    await service.open(wallet)
    const now = Math.floor(Date.now() / 1000)
    const malformedReceive = {
      invoice: 'not-an-rgb-invoice',
      recipientId: 'malformed-recipient',
      createdAt: 1,
      expirationTimestamp: now - 1,
    }
    const seal = { txid: 'f'.repeat(64), vout: 2, blinding: 1n }
    const invoice = encodeBlindRgbInvoice({
      network: 'mainnet', seal, expirationTimestamp: now + 3_600,
      transportEndpoints: [proxyEndpoint],
    })
    const validReceive = {
      invoice,
      recipientId: decodeRgbInvoice(invoice).recipientId,
      createdAt: 2,
      expirationTimestamp: now + 3_600,
      seal,
    }
    ;(service as any).state.pendingReceives = [malformedReceive, validReceive]

    await service.processClaimedReceives({ includeClaimed: false })

    expect(getConsignments).toHaveBeenCalledWith([
      expect.objectContaining({ recipientId: validReceive.recipientId }),
    ])
    expect((service as any).state.pendingReceives).toEqual([
      malformedReceive,
      validReceive,
    ])
  })

  it('preserves an expired duplicate when its batch proxy entry has a consignment', async () => {
    const dependencies = createDependencies()
    const getConsignments = vi.fn()
    dependencies.transport.getConsignments = getConsignments
    const service = new RgbService(dependencies)
    await service.open(wallet)
    const expirationTimestamp = Math.floor(Date.now() / 1000) - 1
    const outpoint = { txid: 'f'.repeat(64), vout: 2 }
    const receives = [1n, 2n].map((blinding, index) => {
      const seal = { ...outpoint, blinding }
      const invoice = encodeBlindRgbInvoice({
        network: 'mainnet', seal, expirationTimestamp, transportEndpoints: [proxyEndpoint],
      })
      return {
        invoice,
        recipientId: decodeRgbInvoice(invoice).recipientId,
        createdAt: index + 1,
        expirationTimestamp,
        seal,
      }
    })
    const discardedRecipientId = receives[0]!.recipientId
    const protectedReceive = receives[1]!
    getConsignments.mockResolvedValue([{
      recipientId: protectedReceive.recipientId,
      payload: 'consignment',
    }])
    ;(service as any).state.pendingReceives = receives

    await service.processClaimedReceives({ includeClaimed: false })

    expect((service as any).state.pendingReceives).toEqual([
      expect.objectContaining({ recipientId: protectedReceive.recipientId }),
    ])
    expect((service as any).state.releasedReceiveRecipientIds).toEqual([
      discardedRecipientId,
    ])
  })

  it('does not invalidate duplicate blind invoices that are already in use', async () => {
    const dependencies = createDependencies()
    dependencies.transport.getConsignment = vi.fn().mockResolvedValue(undefined)
    const service = new RgbService(dependencies)
    await service.open(wallet)
    const expirationTimestamp = Math.floor(Date.now() / 1000) + 3_600
    const outpoint = { txid: 'f'.repeat(64), vout: 2 }
    const receives = [1n, 2n].map((blinding, index) => {
      const seal = { ...outpoint, blinding }
      const invoice = encodeBlindRgbInvoice({
        network: 'mainnet', seal, expirationTimestamp, transportEndpoints: [proxyEndpoint],
      })
      return {
        invoice,
        recipientId: decodeRgbInvoice(invoice).recipientId,
        createdAt: index + 1,
        expirationTimestamp,
        seal,
        pendingAccept: { payload: 'payload', txid: `${index}`.repeat(64) },
      }
    })
    ;(service as any).state.pendingReceives = receives

    await service.processClaimedReceives({ includeClaimed: false })

    expect(service.getPendingReceives()).toEqual(receives)
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
    const selectedEndpoint = 'rpcs://legacy-proxy.example/v1/json-rpc'
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
    const receive = await service.createBlindReceive({
      durationSeconds: 3600,
      transportEndpoints: [selectedEndpoint],
    })
    const invoice = decodeRgbInvoice(receive.invoice)
    expect(invoice.transportEndpoints).toEqual([selectedEndpoint])
    expect(dependencies.transport.prepareInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoints: [selectedEndpoint],
      })
    )
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
        invoice: `rgb:AgICAgIC-AgICAgI-CAgICAg-ICAgICA-gICAgIC-AgICAgI/~/~/${blindRecipient}`,
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
      invoice: `rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE/~/~/${blindRecipient}?amount=60&endpoints=${encodeURIComponent(proxyEndpoint)}`,
      feeRate: 2,
    })

    expect(dependencies.encoder.prepareTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        validationHistory: expect.objectContaining({
          assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
          consignments: [{ opId: '01'.repeat(32), payload: Buffer.from([1, 2, 3]).toString('base64') }],
          localContract: Buffer.from([1, 2, 3]).toString('base64'),
          knownBlindSeals: [],
        }),
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

  it('refetches history when a selected allocation is missing from its local payload', async () => {
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
      .mockRejectedValueOnce(new RgbMissingAncestorError())
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

  it('prefers canonical-history allocations over an exact orphan allocation', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    const assetId = 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE'
    ;(service as any).state.contracts = {
      [assetId]: {
        consignment: 'Y2Fub25pY2FsLWhpc3Rvcnk=',
        createdAt: 1,
        history: {
          payload: 'Y2Fub25pY2FsLWhpc3Rvcnk=',
          opIds: ['c'.repeat(64), 'd'.repeat(64)],
          updatedAt: 1,
        },
      },
    }
    ;(service as any).state.snapshot.utxos.push({
      outpoint: { txid: 'e'.repeat(64), vout: 2 },
      satoshis: 330,
      scriptPubKey: `5120${'33'.repeat(32)}`,
      publicKey: `02${'44'.repeat(32)}`,
      chainStatus: 'confirmed',
      confirmations: 1,
      allocations: [{
        assetId,
        amount: '100',
        settled: true,
        spendable: true,
        opId: 'e'.repeat(64),
        assignmentIndex: 0,
        assignmentType: 4000,
      }],
    })

    const inspection = service.getUtxoInspection()
    expect(inspection.snapshot.utxos[0]?.allocations[0]?.localHistoryAvailable).toBe(true)
    expect(inspection.snapshot.utxos.at(-1)?.allocations[0]?.localHistoryAvailable).toBe(false)

    await service.prepareSend({
      assetId,
      amount: '100',
      invoice: rgbInvoice(100),
      feeRate: 2,
    })

    expect(dependencies.encoder.prepareTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedUtxos: expect.arrayContaining([
          expect.objectContaining({ outpoint: { txid: 'a'.repeat(64), vout: 0 } }),
          expect.objectContaining({ outpoint: { txid: 'b'.repeat(64), vout: 1 } }),
        ]),
      })
    )
    const selected = vi.mocked(dependencies.encoder.prepareTransfer).mock.calls[0]![0].selectedUtxos
    expect(selected).toHaveLength(2)
    expect(selected).not.toContainEqual(
      expect.objectContaining({ outpoint: { txid: 'e'.repeat(64), vout: 2 } })
    )
  })

  it('supplements stale backend history with retained burn proofs', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    const assetId = 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE'
    await service.open(wallet)
    await service.sync()
    ;(service as any).state.contracts = {
      [assetId]: {
        consignment: 'bG9jYWwtY2Fub25pY2Fs', createdAt: 1,
        history: { payload: 'bG9jYWwtY2Fub25pY2Fs', opIds: ['c'.repeat(64)], updatedAt: 1 },
      },
    }
    ;(service as any).state.burnProofs = {
      ['e'.repeat(64)]: {
        assetId, amount: '5', payload: 'YnVybi1wcm9vZi13aXRoLXNwbGl0LWFuY2VzdHJ5', createdAt: 2,
      },
    }
    vi.mocked(dependencies.stateSource.getValidationHistory).mockResolvedValueOnce({
      assetId,
      consignments: [{ opId: 'd'.repeat(64), payload: 'c3RhbGUtYmFja2VuZC1oaXN0b3J5' }],
    })

    await service.prepareSend({
      assetId, amount: '60', invoice: rgbInvoice(), feeRate: 2,
    })

    expect(dependencies.encoder.prepareTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        validationHistory: expect.objectContaining({
          consignments: expect.arrayContaining([
            expect.objectContaining({ payload: 'c3RhbGUtYmFja2VuZC1oaXN0b3J5' }),
            expect.objectContaining({ payload: 'bG9jYWwtY2Fub25pY2Fs' }),
            expect.objectContaining({ payload: 'YnVybi1wcm9vZi13aXRoLXNwbGl0LWFuY2VzdHJ5' }),
          ]),
        }),
      })
    )
  })

  it('uses a validated pending receive history for an immediate chained send', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    const assetId = 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE'
    await service.open(wallet)
    await service.sync()
    ;(service as any).state.contracts = {
      [assetId]: {
        consignment: 'b2xkLWNhbm9uaWNhbA==', createdAt: 1,
        history: { payload: 'b2xkLWNhbm9uaWNhbA==', opIds: ['c'.repeat(64)], updatedAt: 1 },
      },
    }
    ;(service as any).state.pendingReceives = [{
      invoice: rgbInvoice(), recipientId: 'new-receive', createdAt: 1,
      receivedConsignment: {
        txid: 'b'.repeat(64), receivedAt: 2, accepted: true,
        assetId, amount: '60', payload: 'dmFsaWRhdGVkLXBlbmRpbmctcmVjZWl2ZQ==',
      },
    }]
    vi.mocked(dependencies.stateSource.getValidationHistory).mockResolvedValue({
      assetId,
      consignments: [{ opId: 'c'.repeat(64), payload: 'c3RhbGUtYmFja2VuZA==' }],
    })
    vi.mocked(dependencies.encoder.prepareTransfer)
      .mockRejectedValueOnce(new RgbMissingAncestorError())
      .mockResolvedValueOnce({
        id: 'chained-send', psbt: 'cHNidP8=', toSignInputs: [],
        lockedOutpoints: [{ txid: 'b'.repeat(64), vout: 1 }],
      })

    await service.prepareSend({
      assetId, amount: '60', invoice: rgbInvoice(), feeRate: 2,
    })

    expect(dependencies.encoder.prepareTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        validationHistory: expect.objectContaining({
          consignments: expect.arrayContaining([
            expect.objectContaining({ payload: 'dmFsaWRhdGVkLXBlbmRpbmctcmVjZWl2ZQ==' }),
          ]),
        }),
      })
    )
    expect(dependencies.stateSource.getValidationHistory).toHaveBeenCalledTimes(2)
  })

  it('scopes completed local history validation to the newly broadcast operations', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    const genesis = encodeNiaGenesis({
      ticker: 'NIA', name: 'Parallel', precision: 0, timestamp: 1,
      network: 'mainnet', allocations: [{
        txid: 'a'.repeat(64), vout: 0, blinding: 1n, amount: 100n,
      }],
    })
    const assetId = encodeRgbContractId(genesis.assetId)
    const opId = 'd'.repeat(64)
    const payload = Buffer.from(encodeBfaTransferConsignment({
      genesis: genesis.strict,
      validatedWitnessBundles: [],
      witnessBundle: Uint8Array.of(1),
    })).toString('base64')
    const storeAcceptedBfaHistory = vi
      .spyOn(service as any, 'storeAcceptedBfaHistory')
      .mockResolvedValue(undefined)

    await (service as any).retainCompletedLocalHistory({
      txid: 'c'.repeat(64),
      consignments: [{ recipientId: 'recipient', payload, assetId, opIds: [opId] }],
    })

    expect(storeAcceptedBfaHistory).toHaveBeenCalledWith(
      assetId,
      payload,
      'c'.repeat(64),
      [],
      [opId]
    )
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
      expect.objectContaining({
        txid: completed.txid,
        rawTx: '',
        consignments: [expect.objectContaining({ payload: '' })],
      }),
      service.getSnapshot(),
      {
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60',
        createdAt: expect.any(Number),
        invoice: rgbInvoice(),
      }
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

  it('signs one immutable P2P buyer proposal with the seller Proxy key', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    const assetId = 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE'
    const invoice = encodeWitnessRgbInvoice({
      network: 'mainnet',
      scriptPubKey: '512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      assetId,
      amount: '60',
      transportEndpoints: [proxyEndpoint],
      proxyPublicKey: 'a09aa5f47a6759802ff955f8dc2d2a14a5c99d23be97f864127ff9383455a4f0',
    })
    await service.prepareSend(
      { assetId, amount: '60', invoice, feeRate: 2 },
      { providerOrigin: 'https://market.example' }
    )
    await service.publishSwap('transfer-1', 'maker-signed-psbt')

    const buyerSignedPsbtHash = '44'.repeat(32)
    const result = await service.signPublishedSwapBuyerCommitment(
      'transfer-1',
      'c'.repeat(64),
      buyerSignedPsbtHash
    )
    const privateKey = (service as any).state.pending['transfer-1'].proxySenderPrivateKey
    const senderPublicKey = proxyV1SenderPublicKey(privateKey)
    const proxyTransferId = proxyV1SenderTransferId(
      decodeRgbInvoice(invoice).proxyInvoiceId!,
      senderPublicKey
    )
    const message =
      `rgb-buy-swap/commit/v1:${proxyTransferId}:${'c'.repeat(64)}:${buyerSignedPsbtHash}`
    expect(result).toEqual({
      proxyTransferId,
      txid: 'c'.repeat(64),
      buyerSignedPsbtHash,
      commitment: signProxyV1SenderMessage(privateKey, message),
      signedAt: expect.any(Number),
    })
    await expect(service.signPublishedSwapBuyerCommitment(
      'transfer-1', 'c'.repeat(64), buyerSignedPsbtHash
    )).resolves.toEqual(result)
    await expect(service.signPublishedSwapBuyerCommitment(
      'transfer-1', 'c'.repeat(64), '55'.repeat(32)
    )).rejects.toThrow('already bound to a different buyer proposal')
    await expect(service.signPublishedSwapBuyerCommitment(
      'transfer-1', 'd'.repeat(64), buyerSignedPsbtHash
    )).rejects.toThrow('transaction ID does not match')

    const reopened = new RgbService(dependencies)
    await reopened.open(wallet)
    await expect(reopened.signPublishedSwapBuyerCommitment(
      'transfer-1', 'c'.repeat(64), buyerSignedPsbtHash
    )).resolves.toEqual(result)
    await expect(reopened.syncPublishedSwapAcknowledgement('transfer-1'))
      .resolves.toEqual({
        transferId: 'transfer-1',
        txid: 'c'.repeat(64),
        status: 'receiver_acked',
      })
    expect(reopened.getPendingTransfers()[0]?.delivery).toEqual(
      expect.objectContaining({
        acknowledgedAt: expect.any(Number),
        requiresCounterpartySignature: true,
        makerSignedPsbt: 'maker-signed-psbt',
        sellSwapAckStatus: 'receiver_acked',
      })
    )
    expect(reopened.getPendingTransfers()[0]?.delivery?.externalBroadcast).toBeUndefined()
    await reopened.completePublishedSwap('transfer-1', 'fully-signed-psbt', {
      externalBroadcast: true,
    })
    await expect(reopened.signPublishedSwapBuyerCommitment(
      'transfer-1', 'c'.repeat(64), buyerSignedPsbtHash
    )).resolves.toEqual(result)
  })

  it('synchronizes a signed receiver ACK without importing a final PSBT', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.prepareSend(
      {
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60',
        invoice: rgbInvoice(),
        feeRate: 2,
      },
      { providerOrigin: 'https://market.example' }
    )
    await service.publishSwap('transfer-1', 'maker-signed-psbt')

    const result = await service.syncPublishedSwapAcknowledgement('transfer-1')

    expect(result).toEqual({
      transferId: 'transfer-1',
      txid: 'c'.repeat(64),
      status: 'receiver_acked',
    })
    expect(dependencies.encoder.completeTransfer).toHaveBeenCalledTimes(1)
    expect(dependencies.broadcaster.broadcast).not.toHaveBeenCalled()
    expect(service.getPendingTransfers()).toEqual([
      expect.objectContaining({
        id: 'transfer-1',
        delivery: expect.objectContaining({
          acknowledgedAt: expect.any(Number),
          externalBroadcast: true,
          externalBroadcastController: 'backend',
          sellSwapAckStatus: 'receiver_acked',
        }),
      }),
    ])
    expect(service.getPendingTransfers()[0]?.delivery?.makerSignedPsbt).toBeUndefined()
    expect(service.getPendingTransfers()[0]?.delivery?.requiresCounterpartySignature).toBeUndefined()

    await expect(service.syncPublishedSwapAcknowledgement('transfer-1'))
      .resolves.toEqual(result)
    await expect(service.abortSend('transfer-1')).resolves.toEqual({
      aborted: false,
      reason: 'acknowledged_requires_agreement',
    })

    const reopened = new RgbService(dependencies)
    await reopened.open(wallet)
    await expect(reopened.syncPublishedSwapAcknowledgement('transfer-1'))
      .resolves.toEqual(result)

    await service.sync()
    expect(dependencies.broadcaster.broadcast).not.toHaveBeenCalled()
  })

  it('keeps a published seller swap valid when its recovery checkpoint advances', async () => {
    const dependencies = createDependencies()
    let generation = 7
    dependencies.onStatePersisted = vi.fn().mockImplementation(async () => ({
      saved: true,
      revision: `${++generation}`.padStart(24, '0'),
      generation,
      verified: true,
    }))
    vi.mocked(dependencies.transport.getAcknowledgement!).mockResolvedValue(undefined)
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    ;(service as any).recoveryBackupEnabled = true
    ;(service as any).state.recoveryRemoteStateKnown = true
    ;(service as any).state.recoveryCheckpointGeneration = generation
    ;(service as any).state.recoveryCheckpoint = { dirty: false, verified: true }

    await service.prepareSend(
      {
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60',
        invoice: rgbInvoice(),
        feeRate: 2,
      },
      { providerOrigin: 'https://market.example' }
    )
    await service.publishSwap('transfer-1', 'maker-signed-psbt')

    expect((service as any).state.recoveryCheckpointGeneration).toBeGreaterThan(7)
    expect(service.getPendingTransfers()).toEqual([
      expect.objectContaining({
        id: 'transfer-1',
        preparedCheckpointGeneration: 7,
        delivery: expect.objectContaining({
          requiresCounterpartySignature: true,
          makerSignedPsbt: 'maker-signed-psbt',
        }),
      }),
    ])
    await expect(service.syncPublishedSwapAcknowledgement('transfer-1')).resolves.toEqual({
      transferId: 'transfer-1',
      txid: 'c'.repeat(64),
      status: 'waiting_ack',
    })
  })

  it('records a negative seller swap ACK as rejected', async () => {
    const dependencies = createDependencies()
    vi.mocked(dependencies.transport.getAcknowledgement!).mockResolvedValue(false)
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

    await expect(service.syncPublishedSwapAcknowledgement('transfer-1')).resolves.toEqual({
      transferId: 'transfer-1',
      txid: 'c'.repeat(64),
      status: 'rejected',
    })
    expect(service.getPendingTransfers()).toEqual([])
    expect(service.getPendingSendHistory()).toEqual([
      expect.objectContaining({ transferId: 'transfer-1', status: 'rejected' }),
    ])
  })

  it('returns an idempotent expired status after a successful empty ACK query', async () => {
    const dependencies = createDependencies()
    let now = 1_000
    dependencies.now = () => now
    vi.mocked(dependencies.transport.getAcknowledgement!).mockResolvedValue(undefined)
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      invoice: `${rgbInvoice()}&expiry=2`,
      feeRate: 2,
    })
    await service.publishSwap('transfer-1', 'maker-signed-psbt')
    now = 3_000

    const expired = {
      transferId: 'transfer-1',
      txid: 'c'.repeat(64),
      status: 'expired' as const,
    }
    await expect(service.syncPublishedSwapAcknowledgement('transfer-1')).resolves.toEqual(expired)
    vi.mocked(dependencies.transport.getAcknowledgement!).mockRejectedValue(
      new Error('proxy unavailable')
    )
    await expect(service.syncPublishedSwapAcknowledgement('transfer-1')).resolves.toEqual(expired)
    expect(service.getPendingTransfers()).toHaveLength(1)
  })

  it('returns waiting_ack without unlocking or broadcasting before Proxy ACK', async () => {
    const dependencies = createDependencies()
    vi.mocked(dependencies.transport.getAcknowledgement!).mockResolvedValue(undefined)
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.prepareSend(
      {
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60',
        invoice: rgbInvoice(),
        feeRate: 2,
      }
    )
    await service.publishSwap('transfer-1', 'maker-signed-psbt')

    await expect(service.syncPublishedSwapAcknowledgement('transfer-1')).resolves.toEqual({
      transferId: 'transfer-1',
      txid: 'c'.repeat(64),
      status: 'waiting_ack',
    })
    expect(service.getPendingTransfers()[0]?.delivery).toEqual(expect.objectContaining({
      requiresCounterpartySignature: true,
      makerSignedPsbt: 'maker-signed-psbt',
      sellSwapAckStatus: 'waiting_ack',
    }))
    expect(dependencies.broadcaster.broadcast).not.toHaveBeenCalled()
  })

  it('releases a non-broadcast external swap through the acknowledged abort path', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.prepareSend(
      {
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60',
        invoice: rgbInvoice(),
        feeRate: 2,
      },
      { providerOrigin: 'https://dapp.example' }
    )
    await service.publishSwap('transfer-1', 'maker-signed-psbt')
    const completed = await service.completePublishedSwap('transfer-1', 'fully-signed-psbt', {
      externalBroadcast: true,
    })

    await expect(service.getTransferProviderOrigin(completed.txid)).resolves.toBe(
      'https://dapp.example'
    )
    await expect(service.abortSend('transfer-1')).resolves.toEqual({
      aborted: false,
      reason: 'acknowledged_requires_agreement',
    })
    await expect(service.abortAcknowledgedSwap('transfer-1')).resolves.toEqual({
      aborted: true,
      status: 'canceled',
    })
    expect(service.getPendingTransfers()).toEqual([])
    expect(service.getPendingSendHistory()).toEqual([
      expect.objectContaining({ transferId: 'transfer-1', status: 'canceled', txid: completed.txid }),
    ])
  })

  it('accepts a receive batch in one operation with shared validation caches', async () => {
    const service = new RgbService(createDependencies())
    await service.open(wallet)
    const acceptOnce = vi.spyOn(service as any, 'acceptReceiveOnce')
      .mockImplementation(async (_recipientId, _options, _caches, control: any) =>
        control?.stageOnly
          ? { accepted: false, status: 'staged' }
          : { accepted: true, status: 'accepted' }
      )

    await expect(service.acceptReceives(['recipient-1', 'recipient-2', 'recipient-1']))
      .resolves.toEqual([
        { recipientId: 'recipient-1', accepted: true, status: 'accepted' },
        { recipientId: 'recipient-2', accepted: true, status: 'accepted' },
      ])

    expect(acceptOnce).toHaveBeenCalledTimes(4)
    const firstCaches = acceptOnce.mock.calls[0]![2] as any
    const secondCaches = acceptOnce.mock.calls[1]![2] as any
    expect(firstCaches).toBe(secondCaches)
    expect(firstCaches.evmRpcCache).toBeInstanceOf(Map)
    expect(firstCaches.bitcoinStatusCache).toBeInstanceOf(Map)
    expect(firstCaches.consignments).toBeInstanceOf(Map)
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

  it('does not revalidate an unchanged staged receive during background polling', async () => {
    const dependencies = createDependencies()
    dependencies.transport.getConsignment = vi.fn()
    dependencies.transport.getConsignments = vi.fn().mockResolvedValue([{
      recipientId: 'recipient',
      payload: 'consignment',
      txid: 'c'.repeat(64),
      endpoint: proxyEndpoint,
      batch: true,
    }])
    dependencies.transport.getAcknowledgement = vi.fn()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [{
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
    }]
    const validateIncomingConsignment = vi.spyOn(service as any, 'validateIncomingConsignment')

    await expect(service.processClaimedReceives({ includeClaimed: false })).resolves.toMatchObject({
      received: 0,
    })

    expect(dependencies.transport.getConsignments).toHaveBeenCalledTimes(1)
    expect(dependencies.transport.getConsignment).not.toHaveBeenCalled()
    expect(dependencies.transport.getAcknowledgement).not.toHaveBeenCalled()
    expect(validateIncomingConsignment).not.toHaveBeenCalled()
    expect(service.getPendingReceives()[0]?.pendingAccept).toMatchObject({
      payload: 'consignment',
      batch: true,
    })
  })

  it('checks a v0 and v1 history merge before sending ACK', async () => {
    const dependencies = createDependencies()
    dependencies.transport.acknowledgeConsignment = vi.fn()
    dependencies.validateBfaConsignment = vi.fn().mockRejectedValue(new RgbServiceError('history conflict'))
    const service = new RgbService(dependencies)
    await service.open(wallet)
    const genesis = encodeNiaGenesis({
      ticker: 'NIA', name: 'Migration', precision: 0, timestamp: 1,
      network: 'mainnet', allocations: [{ txid: 'a'.repeat(64), vout: 0, blinding: 1n, amount: 100n }],
    })
    const assetId = encodeRgbContractId(genesis.assetId)
    const legacy = Buffer.from(encodeNiaContract(genesis).strict).toString('base64')
    const incoming = Buffer.from(encodeBfaTransferConsignment({
      genesis: genesis.strict, validatedWitnessBundles: [], witnessBundle: Uint8Array.of(1),
    })).toString('base64')
    ;(service as any).state.contracts = {
      [assetId]: { consignment: legacy, genesis: Buffer.from(genesis.strict).toString('base64'), createdAt: 1 },
    }
    ;(service as any).state.pendingReceives = [{
      invoice: rgbInvoice(), recipientId: 'recipient', assetId, amount: '60', createdAt: 1,
      seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
      pendingAccept: { payload: incoming, txid: 'c'.repeat(64), endpoint: proxyEndpoint,
        assetId, amount: '60', operationIds: ['d'.repeat(64)], precision: 0, discoveredAt: 1 },
    }]

    await expect(service.acceptReceive('recipient')).rejects.toThrow('history conflict')
    expect(dependencies.validateBfaConsignment).toHaveBeenCalledWith(expect.objectContaining({
      pendingWitnessTxid: 'c'.repeat(64),
      requiredOperationIds: ['d'.repeat(64)],
    }))
    expect(dependencies.transport.acknowledgeConsignment).not.toHaveBeenCalled()
    expect((service as any).state.pendingReceives[0].receivedConsignment).toBeUndefined()
  })

  it('broadcasts the signed witness when accepting a proxy v1 donation', async () => {
    const anchor = receiveAnchorTransaction()
    const dependencies = createDependencies()
    dependencies.broadcaster.broadcast = vi.fn().mockResolvedValue(anchor.txid)
    dependencies.transport.getAcknowledgement = vi.fn().mockResolvedValue(undefined)
    dependencies.transport.acknowledgeConsignment = vi.fn().mockRejectedValue(new RgbProxyOperationNotFoundError())
    dependencies.transport.markConsignmentRetrieved = vi.fn()
    dependencies.stateSource.getTransactionStatus = vi.fn().mockResolvedValue({ status: 'unknown', confirmations: 0 })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [{
      invoice: rgbInvoice(),
      recipientId: 'recipient',
      proxyPrivateKey: '44'.repeat(32),
      createdAt: 1,
      seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
      pendingAccept: {
        payload: 'validated-consignment',
        txid: anchor.txid,
        endpoint: proxyEndpoint,
        proxyTransferId: 'd'.repeat(64),
        signedRawTx: anchor.rawTx,
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60',
        discoveredAt: 1,
      },
    }]

    await expect(service.acceptReceive('recipient')).resolves.toEqual({ accepted: true, status: 'accepted' })
    expect((service as any).state.pendingReceives[0].receivedConsignment).toMatchObject({ accepted: true })
    expect((service as any).state.pendingReceives[0].receivedConsignment).not.toHaveProperty('acknowledgementPending')
    expect(dependencies.transport.acknowledgeConsignment).toHaveBeenCalledTimes(1)
    expect(dependencies.broadcaster.broadcast).toHaveBeenCalledWith(anchor.rawTx)
    expect(dependencies.transport.markConsignmentRetrieved).toHaveBeenCalledWith({
      endpoint: proxyEndpoint,
      proxyTransferId: 'd'.repeat(64),
      proxyPrivateKey: '44'.repeat(32),
    })
    expect((service as any).state.pendingReceives[0].receivedConsignment)
      .toMatchObject({ proxyDataReleasedAt: expect.any(Number) })
  })

  it('retries Proxy v1 payload release for an already durable accepted receive', async () => {
    const dependencies = createDependencies()
    dependencies.transport.getConsignment = vi.fn().mockResolvedValue(undefined)
    dependencies.transport.markConsignmentRetrieved = vi.fn()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [{
      invoice: rgbInvoice(), recipientId: 'recipient', proxyPrivateKey: '44'.repeat(32), createdAt: 1,
      receivedConsignment: {
        txid: 'c'.repeat(64), receivedAt: 1, accepted: true,
        payload: 'durable-consignment', endpoint: proxyEndpoint,
        proxyTransferId: 'd'.repeat(64), proxyDataReleasePending: true,
      },
    }]

    await service.processClaimedReceives({ includeClaimed: false })

    expect(dependencies.transport.markConsignmentRetrieved).toHaveBeenCalledOnce()
    expect((service as any).state.pendingReceives[0].receivedConsignment).toMatchObject({
      accepted: true, proxyDataReleasedAt: expect.any(Number),
    })
    expect((service as any).state.pendingReceives[0].receivedConsignment)
      .not.toHaveProperty('proxyDataReleasePending')
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

  it('reports sender cancellation when Accept finds a cleaned proxy v1 operation', async () => {
    const dependencies = createDependencies()
    dependencies.transport.acknowledgeConsignment = vi.fn().mockRejectedValue(
      new RgbProxyOperationNotFoundError()
    )
    dependencies.stateSource.getTransactionStatus = vi.fn().mockResolvedValue({
      status: 'unknown', confirmations: 0,
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [{
      invoice: rgbInvoice(),
      recipientId: 'recipient',
      proxyPrivateKey: '44'.repeat(32),
      createdAt: 1,
      seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
      pendingAccept: {
        payload: 'validated-consignment',
        txid: 'c'.repeat(64),
        endpoint: proxyEndpoint,
        proxyTransferId: 'd'.repeat(64),
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60',
        discoveredAt: 1,
      },
    }]

    await expect(service.acceptReceive('recipient')).resolves.toEqual({
      accepted: false,
      status: 'canceled',
    })
    expect(dependencies.broadcaster.broadcast).not.toHaveBeenCalled()
    expect(service.getPendingReceives()).toEqual([])
    expect(service.getPendingReceiveHistory()).toEqual([
      expect.objectContaining({
        transferId: 'receive:recipient',
        status: 'canceled',
        txid: 'c'.repeat(64),
      }),
    ])
  })

  it('reports sender cancellation when a single-recipient ACK has no signed transaction', async () => {
    const dependencies = createDependencies()
    dependencies.transport.acknowledgeConsignment = vi.fn().mockResolvedValue({
      releasePending: true,
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [{
      invoice: rgbInvoice(),
      recipientId: 'recipient',
      proxyPrivateKey: '44'.repeat(32),
      createdAt: 1,
      pendingAccept: {
        payload: 'validated-consignment',
        txid: 'c'.repeat(64),
        endpoint: proxyEndpoint,
        proxyTransferId: 'd'.repeat(64),
        batch: false,
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60',
        discoveredAt: 1,
      },
    }]

    await expect(service.acceptReceive('recipient')).resolves.toEqual({
      accepted: false,
      status: 'canceled',
    })
    expect(service.getPendingReceives()).toEqual([])
    expect(service.getPendingReceiveHistory()).toEqual([
      expect.objectContaining({
        transferId: 'receive:recipient',
        status: 'canceled',
      }),
    ])
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
    dependencies.stateSource.getTransactionStatus = vi.fn().mockResolvedValue({
      status: 'confirmed', confirmations: 1,
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
      false,
      { status: 'confirmed', confirmations: 1 }
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

  it('settles an existing pending witness allocation after chain confirmation', async () => {
    const dependencies = createDependencies()
    dependencies.stateSource.getTransactionStatus = vi.fn().mockResolvedValue({
      status: 'confirmed', confirmations: 1,
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    const txid = 'e'.repeat(64)
    const assetId = 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE'
    const allocation = {
      assetId, amount: '60', settled: false, spendable: false,
      opId: 'f'.repeat(64), assignmentIndex: 0, assignmentType: 4000,
    }
    ;(service as any).state.snapshot.utxos = [{
      outpoint: { txid, vout: 0 }, satoshis: 1000,
      scriptPubKey: `5120${'11'.repeat(32)}`, publicKey: `02${'22'.repeat(32)}`,
      chainStatus: 'mempool', confirmations: 0,
      allocations: [allocation],
    }]
    vi.spyOn(service as any, 'needsV1HistoryMerge').mockReturnValue(true)
    const storeAcceptedBfaHistory = vi
      .spyOn(service as any, 'storeAcceptedBfaHistory')
      .mockResolvedValue(undefined)
    const receive = {
      invoice: rgbInvoice(), recipientId: 'recipient', recipientType: 'witness', createdAt: 1,
      receivedConsignment: { txid, receivedAt: 1, accepted: true, assetId, amount: '60', precision: 0 },
    }

    const result = await (service as any).advanceAcceptedReceive(
      receive, { recipientId: 'recipient', payload: 'consignment' },
      {
        txid, vout: 0, assetId, amount: '60', opId: allocation.opId,
        assignmentIndex: 0,
        decoded: {
          genesis: { strict: new Uint8Array() },
          metadata: { ticker: 'TOK', name: 'Token', precision: 0, schema: 'NIA', issuedSupply: '60' },
        },
      }, false
    )

    expect(result).toBe(true)
    expect(storeAcceptedBfaHistory).toHaveBeenCalledWith(
      assetId,
      'consignment',
      undefined,
      [],
      [allocation.opId]
    )
    expect(service.getSnapshot().utxos[0]).toMatchObject({
      chainStatus: 'confirmed', confirmations: 1,
      allocations: [{ settled: true, spendable: true }],
    })
    expect(service.getLocalAssetBalance(assetId)).toMatchObject({
      settled: '60', spendable: '60', pending: '0',
    })
  })

  it('settles a self-donation without merging the sender-retained operation twice', async () => {
    const dependencies = createDependencies()
    dependencies.stateSource.getTransactionStatus = vi.fn().mockResolvedValue({
      status: 'confirmed', confirmations: 1,
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    const state = (service as any).state
    const txid = 'e'.repeat(64)
    const opId = 'f'.repeat(64)
    const assetId = 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE'
    const scriptPubKey = `5120${'11'.repeat(32)}`
    state.contracts = {
      [assetId]: {
        consignment: 'sender-retained-history',
        history: { payload: 'sender-retained-history', opIds: [opId], updatedAt: 1 },
        createdAt: 1,
      },
    }
    const storeAcceptedBfaHistory = vi.spyOn(service as any, 'storeAcceptedBfaHistory')
    const receive = {
      invoice: rgbInvoice(), recipientId: 'self', recipientType: 'witness', createdAt: 1,
      witnessScriptPubKey: scriptPubKey, witnessPublicKey: `02${'22'.repeat(32)}`,
      receivedConsignment: {
        txid, receivedAt: 1, accepted: true, assetId, amount: '5', precision: 0,
      },
    }

    const result = await (service as any).advanceAcceptedReceive(
      receive,
      { recipientId: 'self', payload: 'self-donation-consignment' },
      {
        txid, vout: 1, assetId, amount: '5', opId, assignmentIndex: 1,
        assignments: [{ txid, vout: 1, opId, assignmentIndex: 1, amount: '5' }],
        witness: { outputs: [undefined, { scriptPubKey, satoshis: 330 }] },
        decoded: {
          genesis: { strict: new Uint8Array() },
          metadata: { ticker: 'TOK', name: 'Token', precision: 0, schema: 'NIA', issuedSupply: '6' },
        },
        historyPayload: 'self-donation-consignment',
      },
      false
    )

    expect(result).toBe(true)
    expect(storeAcceptedBfaHistory).not.toHaveBeenCalled()
    expect(service.getSnapshot().utxos).toEqual([
      expect.objectContaining({
        outpoint: { txid, vout: 1 },
        chainStatus: 'confirmed',
        allocations: [expect.objectContaining({
          assetId, amount: '5', opId, assignmentIndex: 1,
          settled: true, spendable: true,
        })],
      }),
    ])
    expect(service.getPendingReceiveHistory()).toEqual([
      expect.objectContaining({ txid, assetId, amount: '5', status: 'settled' }),
    ])
  })

  it('reconciles a persisted ACK intent after restart without requiring the proxy payload', async () => {
    const anchor = receiveAnchorTransaction()
    const dependencies = createDependencies()
    dependencies.transport.getConsignment = vi.fn()
    dependencies.transport.getAcknowledgement = vi.fn().mockResolvedValue(true)
    dependencies.transport.acknowledgeConsignment = vi.fn().mockResolvedValue({
      signedRawTx: anchor.rawTx,
    })
    dependencies.broadcaster.broadcast = vi.fn().mockResolvedValue(anchor.txid)
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
          txid: anchor.txid,
          endpoint: proxyEndpoint,
          assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
          amount: '60',
          discoveredAt: 1,
        },
        receivedConsignment: {
          txid: anchor.txid,
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
      txid: anchor.txid,
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
    expect(dependencies.transport.acknowledgeConsignment).toHaveBeenCalled()
    expect(dependencies.broadcaster.broadcast).toHaveBeenCalledWith(anchor.rawTx)
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

  it('finishes a donation receive during background retry after its witness appears on Bitcoin', async () => {
    const dependencies = createDependencies()
    dependencies.transport.getConsignment = vi.fn()
    dependencies.transport.getAcknowledgement = vi.fn().mockResolvedValue(undefined)
    dependencies.transport.acknowledgeConsignment = vi.fn().mockRejectedValue(new RgbProxyOperationNotFoundError())
    dependencies.stateSource.getTransactionStatus = vi.fn().mockResolvedValue({ status: 'mempool', confirmations: 0 })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [{
      invoice: rgbInvoice(), recipientId: 'recipient', createdAt: 1,
      seal: { txid: 'a'.repeat(64), vout: 0, blinding: 1n },
      pendingAccept: {
        payload: 'validated-consignment', txid: 'c'.repeat(64), endpoint: proxyEndpoint,
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60', discoveredAt: 1,
      },
      receivedConsignment: {
        txid: 'c'.repeat(64), receivedAt: 1, acknowledgementPending: true,
        payload: 'validated-consignment', endpoint: proxyEndpoint,
      },
    }]
    ;(service as any).validateIncomingConsignment = vi.fn().mockReturnValue({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60', txid: 'c'.repeat(64),
      decoded: { metadata: { ticker: 'TOK', name: 'Token', precision: 0, schema: 'NIA', issuedSupply: '60' } },
    })
    vi.spyOn(service as any, 'advanceAcceptedReceive').mockResolvedValue(false)

    await service.processClaimedReceives({ includeClaimed: false })

    expect((service as any).state.pendingReceives[0].receivedConsignment).toMatchObject({ accepted: true })
    expect((service as any).state.pendingReceives[0]).not.toHaveProperty('pendingAccept')
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

  it('accepts an ordinary proxy v1 transfer whose signed transaction is released only after ACK', async () => {
    const anchor = receiveAnchorTransaction()
    const dependencies = createDependencies()
    dependencies.broadcaster.broadcast = vi.fn().mockResolvedValue(anchor.txid)
    dependencies.transport.acknowledgeConsignment = vi.fn().mockResolvedValue({
      signedRawTx: anchor.rawTx,
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [{
      invoice: rgbInvoice(), recipientId: 'recipient', proxyRecipientId: 'proxy-recipient',
      proxyPrivateKey: '11'.repeat(32), createdAt: 1,
      pendingAccept: {
        payload: 'consignment', txid: anchor.txid, endpoint: proxyEndpoint,
        proxyTransferId: 'd'.repeat(64), proxySenderPublicKey: '22'.repeat(32),
        proxySenderEndpoint: proxyEndpoint, proxyConsignmentHash: '33'.repeat(32),
        batch: false,
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60', discoveredAt: 1,
      },
    }]

    await expect(service.acceptReceive('proxy-recipient')).resolves.toEqual({
      accepted: true,
      status: 'accepted',
    })
    expect(dependencies.broadcaster.broadcast).toHaveBeenCalledWith(anchor.rawTx)
    expect(service.getPendingReceives()[0]?.receivedConsignment).toMatchObject({
      accepted: true,
      signedRawTx: anchor.rawTx,
    })
    expect(service.getPendingReceives()[0]).not.toHaveProperty('pendingAccept')
  })

  it('waits for a batched proxy v1 transaction release and broadcasts it on retry', async () => {
    const anchor = receiveAnchorTransaction()
    const dependencies = createDependencies()
    dependencies.broadcaster.broadcast = vi.fn().mockResolvedValue(anchor.txid)
    dependencies.transport.acknowledgeConsignment = vi.fn()
      .mockResolvedValueOnce({ releasePending: true })
      .mockResolvedValueOnce({ signedRawTx: anchor.rawTx })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [
      {
        invoice: rgbInvoice(),
        recipientId: 'recipient',
        proxyRecipientId: 'proxy-recipient',
        proxyPrivateKey: '11'.repeat(32),
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60',
        createdAt: 1,
        pendingAccept: {
          payload: 'consignment',
          txid: anchor.txid,
          endpoint: proxyEndpoint,
          batch: true,
          assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
          amount: '60',
          discoveredAt: 1,
          signedRawTx: anchor.rawTx,
        },
      },
    ]

    await expect(service.acceptReceive('proxy-recipient')).resolves.toEqual({
      accepted: false,
      status: 'pending',
    })
    expect(service.getPendingReceives()[0]?.receivedConsignment).toMatchObject({
      acknowledgementPending: true,
    })

    await expect(service.acceptReceive('proxy-recipient')).resolves.toEqual({
      accepted: true,
      status: 'accepted',
    })
    expect(dependencies.broadcaster.broadcast).toHaveBeenCalledWith(anchor.rawTx)
    expect(service.getPendingReceives()[0]?.receivedConsignment).toMatchObject({
      accepted: true,
      signedRawTx: anchor.rawTx,
    })
  })

  it('requires a backend-committed buy swap ACK and leaves broadcast to the sender', async () => {
    const anchor = receiveAnchorTransaction()
    const dependencies = createDependencies()
    dependencies.transport.acknowledgeConsignment = vi.fn().mockResolvedValue({
      signedRawTx: anchor.rawTx,
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [{
      invoice: rgbInvoice(), recipientId: 'recipient', proxyRecipientId: 'proxy-recipient',
      proxyPrivateKey: '11'.repeat(32), createdAt: 1,
      pendingAccept: {
        payload: 'consignment', txid: anchor.txid, endpoint: proxyEndpoint,
        proxyTransferId: 'd'.repeat(64), proxySenderPublicKey: '22'.repeat(32),
        proxySenderEndpoint: proxyEndpoint, proxyConsignmentHash: '33'.repeat(32),
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60', discoveredAt: 1, signedRawTx: anchor.rawTx,
      },
    }]

    await service.stageBuySwapIntent('proxy-recipient', {
      txid: anchor.txid,
      buyerSignedPsbtHash: '44'.repeat(32),
    })
    await expect(service.acceptReceive('proxy-recipient')).rejects.toThrow(
      'requires a verified backend commitment'
    )
    await expect(service.acceptReceive('proxy-recipient', {
      buySwapBackendCommitted: true,
    })).resolves.toEqual({ accepted: true, status: 'accepted' })

    expect(dependencies.broadcaster.broadcast).not.toHaveBeenCalled()
    expect(service.getPendingReceives()[0]).toMatchObject({
      buySwapIntent: { backendCommittedAt: expect.any(Number) },
      receivedConsignment: { accepted: true },
    })
    expect(service.getPendingReceives()[0]?.receivedConsignment).not.toHaveProperty('signedRawTx')
  })

  it('accepts a backend-committed buy swap when Proxy v1 reports release pending', async () => {
    const anchor = receiveAnchorTransaction()
    const dependencies = createDependencies()
    dependencies.transport.acknowledgeConsignment = vi.fn().mockResolvedValue({
      releasePending: true,
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [{
      invoice: rgbInvoice(), recipientId: 'recipient', proxyRecipientId: 'proxy-recipient',
      proxyPrivateKey: '11'.repeat(32), createdAt: 1,
      acceptancePolicy: 'buy_swap_backend_commit',
      pendingAccept: {
        payload: 'consignment', txid: anchor.txid, endpoint: proxyEndpoint,
        proxyTransferId: 'd'.repeat(64), proxySenderPublicKey: '22'.repeat(32),
        proxySenderEndpoint: proxyEndpoint, proxyConsignmentHash: '33'.repeat(32),
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60', discoveredAt: 1, signedRawTx: anchor.rawTx,
      },
    }]

    await expect(service.acceptReceive('proxy-recipient')).rejects.toThrow(
      'requires a verified backend commitment'
    )
    await service.stageBuySwapIntent('proxy-recipient', {
      txid: anchor.txid,
      buyerSignedPsbtHash: '44'.repeat(32),
    })
    await expect(service.acceptReceive('proxy-recipient', {
      buySwapBackendCommitted: true,
    })).resolves.toEqual({ accepted: true, status: 'accepted' })

    expect(dependencies.broadcaster.broadcast).not.toHaveBeenCalled()
    expect(service.getPendingReceives()[0]).toMatchObject({
      buySwapIntent: { backendCommittedAt: expect.any(Number) },
      receivedConsignment: { accepted: true },
    })
  })

  it('retains a released proxy transaction and retries its receiver broadcast after restart', async () => {
    const anchor = receiveAnchorTransaction()
    const dependencies = createDependencies()
    dependencies.transport.getConsignment = vi.fn().mockResolvedValue({
      recipientId: 'proxy-recipient',
      payload: 'consignment',
      txid: anchor.txid,
      endpoint: proxyEndpoint,
    })
    dependencies.stateSource.getTransactionStatus = vi.fn().mockResolvedValue({
      status: 'unknown', confirmations: 0,
    })
    dependencies.broadcaster.broadcast = vi.fn()
      .mockRejectedValueOnce(new Error('node unavailable'))
      .mockResolvedValueOnce(anchor.txid)
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [{
      invoice: rgbInvoice(), recipientId: 'recipient', proxyRecipientId: 'proxy-recipient',
      proxyPrivateKey: '11'.repeat(32), createdAt: 1,
      receivedConsignment: {
        txid: anchor.txid, receivedAt: 1, accepted: true,
        payload: 'consignment', endpoint: proxyEndpoint, signedRawTx: anchor.rawTx,
      },
    }]
    ;(service as any).validateIncomingConsignment = vi.fn().mockReturnValue({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60', txid: anchor.txid,
      decoded: { metadata: { ticker: 'TOK', name: 'Token', precision: 0, schema: 'NIA', issuedSupply: '60' } },
    })
    vi.spyOn(service as any, 'advanceAcceptedReceive').mockResolvedValue(false)

    await service.processClaimedReceives({ includeClaimed: false })
    await service.processClaimedReceives({ includeClaimed: false })

    expect(dependencies.broadcaster.broadcast).toHaveBeenCalledTimes(2)
    expect(dependencies.broadcaster.broadcast).toHaveBeenLastCalledWith(anchor.rawTx)
  })

  it('treats a sender-won duplicate broadcast race as receiver success', async () => {
    const anchor = receiveAnchorTransaction()
    const dependencies = createDependencies()
    dependencies.transport.acknowledgeConsignment = vi.fn().mockResolvedValue({
      signedRawTx: anchor.rawTx,
    })
    dependencies.stateSource.getTransactionStatus = vi.fn()
      .mockResolvedValueOnce({ status: 'unknown', confirmations: 0 })
      .mockResolvedValueOnce({ status: 'mempool', confirmations: 0 })
    dependencies.broadcaster.broadcast = vi.fn().mockRejectedValue(new Error('txn-already-known'))
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [{
      invoice: rgbInvoice(), recipientId: 'recipient', proxyRecipientId: 'proxy-recipient',
      proxyPrivateKey: '11'.repeat(32), createdAt: 1,
      pendingAccept: {
        payload: 'consignment', txid: anchor.txid, endpoint: proxyEndpoint,
        proxyTransferId: 'd'.repeat(64), proxySenderPublicKey: '22'.repeat(32),
        proxySenderEndpoint: proxyEndpoint, proxyConsignmentHash: '33'.repeat(32),
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60', discoveredAt: 1, signedRawTx: anchor.rawTx,
      },
    }]

    await expect(service.acceptReceive('proxy-recipient')).resolves.toEqual({
      accepted: true, status: 'accepted',
    })
    expect(service.getPendingReceives()[0]?.receivedConsignment).toMatchObject({
      accepted: true, signedRawTx: anchor.rawTx,
    })
  })

  it('rejects proxy-released witness bytes that differ from the validated consignment', async () => {
    const expected = receiveAnchorTransaction(7, 1)
    const released = receiveAnchorTransaction(7, 2)
    expect(released.txid).toBe(expected.txid)
    expect(released.rawTx).not.toBe(expected.rawTx)
    const dependencies = createDependencies()
    dependencies.transport.acknowledgeConsignment = vi.fn().mockResolvedValue({
      signedRawTx: released.rawTx,
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [{
      invoice: rgbInvoice(), recipientId: 'recipient', proxyRecipientId: 'proxy-recipient',
      proxyPrivateKey: '11'.repeat(32), createdAt: 1,
      pendingAccept: {
        payload: 'consignment', txid: expected.txid, endpoint: proxyEndpoint,
        proxyTransferId: 'd'.repeat(64), proxySenderPublicKey: '22'.repeat(32),
        proxySenderEndpoint: proxyEndpoint, proxyConsignmentHash: '33'.repeat(32),
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60', discoveredAt: 1, signedRawTx: expected.rawTx,
      },
    }]

    await expect(service.acceptReceive('proxy-recipient')).rejects.toThrow(
      'released a different signed transaction'
    )
    expect(dependencies.broadcaster.broadcast).not.toHaveBeenCalled()
    expect(service.getPendingReceives()[0]?.receivedConsignment).not.toHaveProperty('signedRawTx')
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
    dependencies.stateSource.getTransactionStatus = vi.fn().mockResolvedValue({
      status: 'confirmed', confirmations: 1,
    })
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
      encryption: 'required',
    })
    expect(advanceAcceptedReceive).toHaveBeenCalled()
  })

  it('does not checkpoint an accepted mempool receive again after recording its broadcast', async () => {
    const dependencies = createDependencies()
    dependencies.onStatePersisted = vi.fn().mockResolvedValue({ verified: true })
    dependencies.stateSource.getTransactionStatus = vi.fn().mockResolvedValue({
      status: 'mempool', confirmations: 0,
    })
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
    const validateIncomingConsignment = vi
      .spyOn(service as any, 'validateIncomingConsignment')
      .mockReturnValue({
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60',
        txid: 'c'.repeat(64),
        decoded: {
          metadata: { ticker: 'TOK', name: 'Token', precision: 0, schema: 'NIA', issuedSupply: '60' },
        },
      })
    const advanceAcceptedReceive = vi.spyOn(service as any, 'advanceAcceptedReceive')

    await service.processClaimedReceives({ includeClaimed: false })
    expect(dependencies.onStatePersisted).toHaveBeenCalledTimes(2)
    expect(validateIncomingConsignment).not.toHaveBeenCalled()
    expect(advanceAcceptedReceive).not.toHaveBeenCalled()

    await service.processClaimedReceives({ includeClaimed: false })
    expect(dependencies.onStatePersisted).toHaveBeenCalledTimes(2)
    expect(validateIncomingConsignment).not.toHaveBeenCalled()
    expect(dependencies.stateSource.getTransactionStatus).toHaveBeenCalledTimes(2)
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
    await expect(aborting).resolves.toEqual({ aborted: false, reason: 'already_broadcast' })
  })

  it('does not automatically retry a transport publication that exhausted a local budget', async () => {
    const dependencies = createDependencies()
    const error = Object.assign(new Error('RGB proxy proof of work exceeded the local work budget'), {
      automaticRetry: false,
    })
    dependencies.transport.publishConsignment = vi.fn().mockRejectedValue(error)
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60', invoice: rgbInvoice(), feeRate: 2,
    })

    await expect(service.completeSend('transfer-1', 'signed-psbt')).rejects.toThrow(
      'exceeded the local work budget'
    )
    expect(service.getPendingTransfers()[0]?.delivery?.publishError)
      .toContain('exceeded the local work budget')
    await service.syncPendingTransfers()
    await service.syncPendingTransfers()
    expect(dependencies.transport.publishConsignment).toHaveBeenCalledTimes(1)
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
    await expect(aborting).resolves.toEqual({
      aborted: false,
      reason: 'acknowledged_requires_agreement',
    })
    expect(dependencies.broadcaster.broadcast).not.toHaveBeenCalled()
  })

  it('retains a rejected receive recovery tombstone while keeping its proxy recipient ID single-use', async () => {
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
        proxyPrivateKey: '44'.repeat(32),
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

    await expect(service.rejectReceive('recipient')).resolves.toEqual({
      rejected: true,
      rejectionReason: 'Rejected by you',
    })

    expect(dependencies.transport.acknowledgeConsignment).toHaveBeenCalledWith(expect.objectContaining({
      recipientId: 'recipient',
      endpoints: [proxyEndpoint],
      acknowledged: false,
    }))
    expect(service.getPendingReceives()).toEqual([
      expect.objectContaining({
        proxyPrivateKey: '44'.repeat(32),
        rejection: expect.objectContaining({ kind: 'proxy_nack' }),
      }),
    ])
    expect(service.getPendingReceiveHistory()).toEqual([
      expect.objectContaining({
        transferId: 'receive:recipient',
        status: 'rejected',
        txid: 'c'.repeat(64),
      }),
    ])
  })

  it('retains an Any Amount invoice recovery tombstone after rejecting a consignment', async () => {
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

    expect(service.getPendingReceives()).toEqual([
      expect.objectContaining({ rejection: expect.objectContaining({ kind: 'proxy_nack' }) }),
    ])
  })

  it('persists a signed transfer without broadcasting until the proxy returns an acknowledgement', async () => {
    const dependencies = createDependencies()
    vi.mocked(dependencies.transport.getAcknowledgement!)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(true)
      // The Proxy may discard its immutable ACK operation after the sender
      // has durably observed it. Broadcasting must not depend on reading it again.
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

    await service.sync()

    expect(service.getPendingTransfers()[0]?.delivery?.acknowledgedAt).toEqual(expect.any(Number))
    expect(dependencies.broadcaster.broadcast).not.toHaveBeenCalled()
    await service.broadcastPendingSend('transfer-1')
    expect(dependencies.broadcaster.broadcast).toHaveBeenCalledTimes(1)
    expect(dependencies.transport.getAcknowledgement).toHaveBeenCalledTimes(2)
    expect(service.getPendingTransfers()).toEqual([])
  })

  it('observes a receiver-first broadcast after ACK without offering sender broadcast', async () => {
    const dependencies = createDependencies()
    vi.mocked(dependencies.transport.getAcknowledgement!)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(true)
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60', invoice: rgbInvoice(), feeRate: 2,
    })
    await expect(service.completeSend('transfer-1', 'signed-psbt')).rejects.toThrow(
      'awaiting recipient acknowledgement'
    )
    dependencies.stateSource.getTransactionStatus = vi.fn().mockResolvedValue({
      status: 'confirmed', confirmations: 1,
    })

    await service.syncPendingTransfers()

    expect(dependencies.broadcaster.broadcast).not.toHaveBeenCalled()
    expect(service.getPendingTransfers()).toEqual([])
    expect(service.getPendingSendHistory()).toEqual([
      expect.objectContaining({
        transferId: 'transfer-1', txid: 'c'.repeat(64), status: 'broadcasted',
      }),
    ])
  })

  it('preflights an already-broadcast transaction before sender retry', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60', invoice: rgbInvoice(), feeRate: 2,
    })
    await service.completeSend('transfer-1', 'signed-psbt')
    dependencies.stateSource.getTransactionStatus = vi.fn().mockResolvedValue({
      status: 'mempool', confirmations: 0,
    })

    await expect(service.broadcastPendingSend('transfer-1')).resolves.toMatchObject({
      txid: 'c'.repeat(64),
    })

    expect(dependencies.broadcaster.broadcast).not.toHaveBeenCalled()
    expect(service.getPendingTransfers()).toEqual([])
  })

  it('treats an already-confirmed node broadcast response as idempotent success', async () => {
    const dependencies = createDependencies()
    dependencies.broadcaster.broadcast = vi.fn().mockRejectedValue(
      { code: -1, msg: 'Error: Transaction outputs already in utxo set' }
    )
    dependencies.stateSource.getTransactionStatus = vi.fn().mockResolvedValue({
      status: 'unknown', confirmations: 0,
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60', invoice: rgbInvoice(), feeRate: 2,
    })
    await service.completeSend('transfer-1', 'signed-psbt')

    await expect(service.broadcastPendingSend('transfer-1')).resolves.toMatchObject({
      txid: 'c'.repeat(64),
    })

    expect(service.getPendingTransfers()).toEqual([])
    expect(service.getPendingSendHistory()).toEqual([
      expect.objectContaining({ status: 'broadcasted', txid: 'c'.repeat(64) }),
    ])
  })

  it('observes a rejection without re-publishing the immutable proxy operation', async () => {
    const dependencies = createDependencies()
    vi.mocked(dependencies.transport.getAcknowledgement!)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(false)
    vi.mocked(dependencies.transport.publishConsignment)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error('RGB proxy ack.prepare failed: Cannot change'))
    const service = new RgbService(dependencies)
    const assetId = 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE'
    const invoice = encodeWitnessRgbInvoice({
      network: 'mainnet',
      scriptPubKey: '512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      assetId,
      amount: '60',
      transportEndpoints: [proxyEndpoint],
      proxyPublicKey: 'ab'.repeat(32),
    })
    await service.open(wallet)
    await service.sync()
    await service.prepareSend({ assetId, amount: '60', invoice, feeRate: 2 })

    await expect(service.completeSend('transfer-1', 'signed-psbt')).rejects.toThrow(
      'awaiting recipient acknowledgement'
    )
    expect(service.getLocalAssetBalance(assetId)?.spendable).toBe('40')

    await expect(service.syncPendingTransfers()).resolves.toBeUndefined()

    expect(dependencies.transport.publishConsignment).toHaveBeenCalledTimes(1)
    expect(dependencies.transport.getAcknowledgement).toHaveBeenCalledTimes(2)
    expect(dependencies.broadcaster.broadcast).not.toHaveBeenCalled()
    expect(service.getPendingTransfers()).toEqual([])
    expect(service.getPendingSendHistory()).toEqual([
      expect.objectContaining({ transferId: 'transfer-1', status: 'rejected' }),
    ])
    expect(service.getLocalAssetBalance(assetId)).toMatchObject({ spendable: '100' })
    expect(service.getLocalAssetBalance(assetId)?.lockedAmount).toBeUndefined()
  })

  it('publishes a donation before broadcasting without requesting an ACK', async () => {
    const dependencies = createDependencies()
    const steps: string[] = []
    dependencies.transport.publishConsignment = vi.fn().mockImplementation(async input => {
      expect(input.donation).toBe(true)
      steps.push('publish')
    })
    dependencies.broadcaster.broadcast = vi.fn().mockImplementation(async () => {
      steps.push('broadcast')
      return 'c'.repeat(64)
    })
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60', invoice: rgbInvoice(), feeRate: 2, donation: true,
    })

    await expect(service.completeSend('transfer-1', 'signed-psbt')).resolves.toMatchObject({
      txid: 'c'.repeat(64),
    })
    expect(steps).toEqual(['publish', 'broadcast'])
    expect(dependencies.transport.getAcknowledgement).not.toHaveBeenCalled()
    expect(service.getPendingTransfers()).toEqual([])
  })

  it('records a late legacy NACK without releasing a broadcasted donation', async () => {
    const dependencies = createDependencies()
    dependencies.transport.getAcknowledgement = vi.fn().mockResolvedValue(false)
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60', invoice: rgbInvoice(), feeRate: 2, donation: true,
    })
    await service.completeSend('transfer-1', 'signed-psbt')
    expect(dependencies.transport.getAcknowledgement).not.toHaveBeenCalled()

    await service.syncBroadcastedSendAcknowledgements()
    expect(dependencies.transport.getAcknowledgement).toHaveBeenCalledWith(expect.objectContaining({
      recipientId: decodeRgbInvoice(rgbInvoice()).proxyRecipientId,
      endpoints: [proxyEndpoint],
    }))
    expect(service.getPendingSendHistory()[0]).toMatchObject({
      status: 'broadcasted', donation: true, recipientAckExpected: true,
      recipientAck: false, txid: 'c'.repeat(64),
    })
    await service.syncBroadcastedSendAcknowledgements()
    expect(dependencies.transport.getAcknowledgement).toHaveBeenCalledTimes(1)
  })

  it('keeps a published donation locked and retryable after broadcast failure', async () => {
    const dependencies = createDependencies()
    dependencies.broadcaster.broadcast = vi.fn()
      .mockRejectedValueOnce(new Error('Bitcoin node unavailable'))
      .mockResolvedValueOnce('c'.repeat(64))
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60', invoice: rgbInvoice(), feeRate: 2, donation: true,
    })

    await expect(service.completeSend('transfer-1', 'signed-psbt')).rejects.toThrow('Bitcoin node unavailable')
    expect(service.getPendingTransfers()[0]?.delivery).toMatchObject({
      donationReadyAt: expect.any(Number), broadcastError: 'Bitcoin node unavailable',
    })
    expect(dependencies.transport.getAcknowledgement).not.toHaveBeenCalled()
    await expect(service.abortSend('transfer-1')).resolves.toEqual({
      aborted: false,
      reason: 'donation_already_published',
    })
    const state = (service as any).state
    state.pending['transfer-2'] = {
      ...state.pending['transfer-1'],
      request: { ...state.pending['transfer-1'].request, donation: false },
      delivery: {
        ...state.pending['transfer-1'].delivery,
        broadcastError: undefined,
        donationReadyAt: undefined,
      },
    }
    await expect(service.syncPendingTransfers()).resolves.toBeUndefined()
    expect(dependencies.broadcaster.broadcast).toHaveBeenCalledTimes(1)
    expect(state.pending['transfer-1'].delivery.broadcastError).toBe('Bitcoin node unavailable')
    expect(state.pending['transfer-2'].delivery.acknowledgedAt).toEqual(expect.any(Number))
    await expect(service.broadcastPendingSend('transfer-1')).resolves.toMatchObject({ txid: 'c'.repeat(64) })
    expect(dependencies.broadcaster.broadcast).toHaveBeenCalledTimes(2)
    expect(service.getPendingTransfers().map(transfer => transfer.id)).toEqual(['transfer-2'])
  })

  it('allows rejecting a donation receive without a sender ACK operation', async () => {
    const dependencies = createDependencies()
    dependencies.transport.getConsignment = vi.fn().mockResolvedValue({
      recipientId: 'recipient', payload: 'consignment', endpoint: proxyEndpoint,
    })
    dependencies.transport.acknowledgeConsignment = vi.fn().mockRejectedValue(
      new RgbProxyOperationNotFoundError()
    )
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [{
      invoice: rgbInvoice(), recipientId: 'recipient',
      proxyPrivateKey: '44'.repeat(32),
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60', createdAt: 1,
      pendingAccept: {
        payload: 'consignment', txid: 'c'.repeat(64), endpoint: proxyEndpoint,
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60', discoveredAt: 1,
      },
    }]

    await expect(service.rejectReceive('recipient')).resolves.toEqual({
      rejected: true,
      rejectionReason: 'Rejected by you',
    })
    const validate = vi.spyOn(service as any, 'validateIncomingConsignment')
    await service.processClaimedReceives({ includeClaimed: false })

    expect(dependencies.transport.getConsignment).not.toHaveBeenCalled()
    expect(validate).not.toHaveBeenCalled()
    expect(service.getPendingReceives()).toEqual([
      expect.objectContaining({
        proxyPrivateKey: '44'.repeat(32),
        rejection: expect.objectContaining({ kind: 'local_donation_reject' }),
      }),
    ])
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

  it('re-reports an ACKed broadcast failure for cancellation review and applies the decision', async () => {
    const dependencies = createDependencies()
    dependencies.broadcaster.broadcast = vi.fn().mockRejectedValue(
      new Error('bad-txns-inputs-missingorspent')
    )
    dependencies.stateSource.reportBroadcastFailure = vi.fn().mockResolvedValue(undefined)
    dependencies.stateSource.getBroadcastCancellation = vi.fn().mockResolvedValue(false)
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
      'bad-txns-inputs-missingorspent'
    )
    await expect(service.requestBroadcastCancellationReview('transfer-1')).resolves.toEqual({
      requested: true,
      status: 'pending_review',
    })
    expect(dependencies.stateSource.reportBroadcastFailure).toHaveBeenLastCalledWith(
      wallet,
      expect.objectContaining({
        transferId: 'transfer-1',
        recipientId: expect.any(String),
        txid: 'c'.repeat(64),
        rawTx: '02000000000000000000',
        error: 'bad-txns-inputs-missingorspent',
      })
    )
    expect(service.getPendingTransfers()).toEqual([
      expect.objectContaining({
        delivery: expect.objectContaining({ cancellationReviewRequestedAt: expect.any(Number) }),
      }),
    ])

    vi.mocked(dependencies.stateSource.getBroadcastCancellation).mockResolvedValue(true)
    await expect(service.requestBroadcastCancellationReview('transfer-1')).resolves.toEqual({
      requested: true,
      status: 'canceled',
    })
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

  it('removes a staged receive before exposing it when cancellation review completed', async () => {
    const dependencies = createDependencies()
    dependencies.stateSource.getBroadcastCancellations = vi.fn().mockResolvedValue([{
      recipientId: 'recipient',
      txid: 'c'.repeat(64),
      canceled: true,
    }])
    const service = new RgbService(dependencies)
    await service.open(wallet)
    ;(service as any).state.pendingReceives = [{
      invoice: rgbInvoice(),
      recipientId: 'recipient',
      createdAt: 1,
      pendingAccept: {
        payload: 'consignment',
        txid: 'c'.repeat(64),
        assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
        amount: '60',
        discoveredAt: 1,
      },
    }]

    await expect(service.processClaimedReceives()).resolves.toEqual({
      received: 0,
      snapshotRequired: false,
    })
    expect(dependencies.stateSource.getBroadcastCancellations).toHaveBeenCalledWith(
      wallet,
      [{ recipientId: 'recipient', txid: 'c'.repeat(64) }]
    )
    expect(service.getPendingReceives()).toEqual([])
    expect(service.getPendingReceiveHistory()).toEqual([
      expect.objectContaining({ status: 'canceled', txid: 'c'.repeat(64) }),
    ])
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

  it('refuses an unsigned discard after the transfer has been delivered', async () => {
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
      aborted: false,
      reason: 'transfer_already_progressed',
    })
    expect(service.getPendingTransfers()).toEqual([
      expect.objectContaining({ id: 'transfer-1', delivery: expect.any(Object) }),
    ])
    expect(service.getPendingSendHistory()).toEqual([])
    expect(dependencies.broadcaster.broadcast).not.toHaveBeenCalled()

    await expect(service.abortSend('transfer-1')).resolves.toEqual({
      aborted: true,
      status: 'canceled',
    })
    expect(service.getPendingTransfers()).toEqual([])
    expect(service.getPendingSendHistory()).toEqual([
      expect.objectContaining({ transferId: 'transfer-1', status: 'canceled', amount: '60' }),
    ])
  })

  it('moves a remotely ACKed cancellation into reviewed recovery instead of calling it canceled', async () => {
    const dependencies = createDependencies()
    vi.mocked(dependencies.transport.getAcknowledgement!).mockResolvedValueOnce(undefined)
    dependencies.transport.cancelConsignment = vi.fn().mockRejectedValue(
      new RgbProxyAlreadyAcknowledgedError()
    )
    dependencies.stateSource.reportBroadcastFailure = vi.fn().mockResolvedValue(undefined)
    const service = new RgbService(dependencies)
    const assetId = 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE'
    const invoice = encodeWitnessRgbInvoice({
      network: 'mainnet',
      scriptPubKey: '512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      assetId,
      amount: '60',
      transportEndpoints: [proxyEndpoint],
      proxyPublicKey: 'ab'.repeat(32),
    })
    await service.open(wallet)
    await service.sync()
    await service.prepareSend({
      assetId,
      amount: '60',
      invoice,
      feeRate: 2,
    })
    await expect(service.completeSend('transfer-1', 'signed-psbt')).rejects.toThrow(
      'awaiting recipient acknowledgement'
    )

    await expect(service.abortSend('transfer-1')).resolves.toEqual({
      aborted: false,
      reason: 'cancellation_review_requested',
      reviewRequested: true,
    })
    expect(service.getPendingTransfers()).toEqual([
      expect.objectContaining({
        id: 'transfer-1',
        delivery: expect.objectContaining({
          acknowledgedAt: expect.any(Number),
          broadcastError: expect.stringContaining('acknowledged before cancellation'),
          failureReportedAt: expect.any(Number),
          cancellationReviewRequestedAt: expect.any(Number),
        }),
      }),
    ])
    expect(dependencies.stateSource.reportBroadcastFailure).toHaveBeenCalledWith(
      wallet,
      expect.objectContaining({ transferId: 'transfer-1', txid: 'c'.repeat(64) })
    )
    expect(service.getPendingSendHistory()).toEqual([])
  })

  it('refuses to cancel a delivery that another party already broadcast', async () => {
    const dependencies = createDependencies()
    dependencies.transport.cancelConsignment = vi.fn()
    dependencies.stateSource.getTransactionStatus = vi.fn().mockResolvedValue({
      status: 'mempool',
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

    await expect(service.abortSend('transfer-1')).resolves.toEqual({
      aborted: false,
      reason: 'already_broadcast',
    })
    expect(service.getPendingTransfers()).toEqual([])
    expect(service.getPendingSendHistory()).toEqual([
      expect.objectContaining({ transferId: 'transfer-1', status: 'broadcasted' }),
    ])
    expect(dependencies.transport.cancelConsignment).not.toHaveBeenCalled()
  })

  it('rejects signing after the recovery checkpoint generation changes', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    ;(service as any).state.recoveryCheckpointGeneration = 7
    await service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      invoice: rgbInvoice(),
      feeRate: 2,
    })
    await service.setRecoveryCheckpointGeneration(8)

    await expect(service.completeSend('transfer-1', 'signed-psbt')).rejects.toThrow(
      'RGB wallet state changed; prepare the transfer again'
    )
    expect(dependencies.encoder.completeTransfer).not.toHaveBeenCalled()
  })

  it('keeps a prepared send valid when this installation publishes its reservation', async () => {
    const dependencies = createDependencies()
    type CheckpointResult = {
      saved: boolean
      revision: string
      generation: number
      verified: boolean
    }
    let finishEarlierCheckpoint: ((result: CheckpointResult) => void) | undefined
    let finishPreparedCheckpoint: ((result: CheckpointResult) => void) | undefined
    dependencies.onStatePersisted = vi
      .fn()
      .mockImplementationOnce(() => new Promise<CheckpointResult>(resolve => {
        finishEarlierCheckpoint = resolve
      }))
      .mockImplementationOnce(() => new Promise<CheckpointResult>(resolve => {
        finishPreparedCheckpoint = resolve
      }))
    const service = new RgbService(dependencies)
    await service.open(wallet)
    await service.sync()
    ;(service as any).recoveryBackupEnabled = true
    ;(service as any).state.recoveryRemoteStateKnown = true
    ;(service as any).state.recoveryCheckpointGeneration = 7
    ;(service as any).state.recoveryCheckpoint = { dirty: false, verified: true }

    // Start an older asynchronous publication before the reservation exists.
    await (service as any).persist()
    const preparing = service.prepareSend({
      assetId: 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE',
      amount: '60',
      invoice: rgbInvoice(),
      feeRate: 2,
    })
    await vi.waitFor(() => expect(dependencies.onStatePersisted).toHaveBeenCalledTimes(2))

    finishEarlierCheckpoint?.({
      saved: true,
      revision: 'a'.repeat(24),
      generation: 8,
      verified: true,
    })
    await vi.waitFor(() => {
      expect((service as any).state.recoveryCheckpointGeneration).toBe(8)
    })
    // The older checkpoint did not contain this reservation and must not
    // silently bless it with its generation.
    expect(service.getPendingTransfers()).toEqual([
      expect.objectContaining({ id: 'transfer-1', preparedCheckpointGeneration: 7 }),
    ])

    finishPreparedCheckpoint?.({
      saved: true,
      revision: 'b'.repeat(24),
      generation: 9,
      verified: true,
    })
    await preparing

    expect(service.getPendingTransfers()).toEqual([
      expect.objectContaining({ id: 'transfer-1', preparedCheckpointGeneration: 9 }),
    ])
    await expect(service.completeSend('transfer-1', 'signed-psbt')).resolves.toEqual(
      expect.objectContaining({ txid: 'c'.repeat(64) })
    )
    expect(dependencies.encoder.completeTransfer).toHaveBeenCalledOnce()
  })

  it('completes a broadcast locally and retries backend indexing without rebroadcasting', async () => {
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
    await expect(service.broadcastPendingSend('transfer-1')).resolves.toEqual(
      expect.objectContaining({ txid: 'c'.repeat(64) })
    )
    expect(service.getPendingTransfers()).toEqual([])
    expect(service.getPendingSendHistory()).toEqual([
      expect.objectContaining({ transferId: 'transfer-1', status: 'broadcasted' }),
    ])
    await expect(service.abortSend('transfer-1')).resolves.toEqual({
      aborted: false,
      reason: 'already_broadcast',
    })

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
    vi.mocked(dependencies.stateSource.testTransactionAcceptance).mockResolvedValue({
      txid: 'e'.repeat(64), allowed: true,
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
    ;((service as any).state.contracts ||= {})['rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE'] = {
      consignment: 'AA==', createdAt: 1,
      history: { payload: 'AA==', opIds: ['d'.repeat(64)], updatedAt: 1 },
    }
    await service.completeSend('transfer-1', 'signed-psbt')
    await service.broadcastPendingSend('transfer-1')
    await service.markSendHistoryConfirmed('transfer-1')

    expect(service.getSnapshot().utxos.map(utxo => utxo.outpoint)).toEqual([
      { txid: 'a'.repeat(64), vout: 0 },
      { txid: 'e'.repeat(64), vout: 1 },
    ])
    expect(service.getPendingSendHistory()).toEqual([
      expect.objectContaining({ transferId: 'transfer-1', backendConfirmed: true }),
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

    // Activity can confirm before the UTXO index has inserted the RGB change.
    // Removing the old input alone is not enough to discard the local output.
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
      ],
    })
    await service.sync()
    expect(service.getSnapshot().utxos.map(utxo => utxo.outpoint)).toEqual([
      { txid: 'a'.repeat(64), vout: 0 },
      { txid: 'e'.repeat(64), vout: 1 },
    ])
    expect(service.getPendingSendHistory()).toHaveLength(1)

    // Compact the local tombstone only after activity is confirmed and the
    // UTXO index has both removed the input and inserted the retained output.
    vi.mocked(dependencies.stateSource.getSnapshot).mockResolvedValue({
      syncedAt: 3,
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
    expect(service.getSnapshot().syncedAt).toBe(3)
    expect(service.getPendingSendHistory()).toEqual([])
    expect(service.getLocalAssetBalance('rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE')).toMatchObject({ balance: '80' })
  })

  it('keeps the complete broadcast payload when RGB change history cannot be retained', async () => {
    const dependencies = createDependencies()
    const service = new RgbService(dependencies)
    await service.open(wallet)
    const assetId = 'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE'
    const completed = {
      txid: 'e'.repeat(64),
      rawTx: '02000000000000000000',
      consignments: [{
        recipientId: 'recipient', payload: 'complete-recovery-payload', assetId,
        opIds: ['d'.repeat(64)],
      }],
      fundingUpdate: {
        spentOutpoints: [{ txid: 'b'.repeat(64), vout: 1 }],
        createdUtxo: {
          outpoint: { txid: 'e'.repeat(64), vout: 1 }, satoshis: 700,
          scriptPubKey: `5120${'11'.repeat(32)}`, publicKey: `02${'22'.repeat(32)}`,
          allocations: [{ assetId, amount: '40', settled: true, spendable: true,
            opId: 'd'.repeat(64), assignmentIndex: 1, assignmentType: 4000 }],
        },
      },
    }
    const state = (service as any).state
    state.pending['transfer-with-unretained-history'] = {
      prepared: { id: 'prepared', psbt: '', toSignInputs: [], lockedOutpoints: [] },
      request: { assetId, amount: '60', invoice: rgbInvoice(), feeRate: 1 },
      createdAt: 1,
      broadcast: { completed, broadcastAt: 2 },
    }

    await expect((service as any).syncBroadcastedTransfer(
      'transfer-with-unretained-history',
      state.pending['transfer-with-unretained-history']
    )).rejects.toThrow('complete transfer remains pending for recovery')

    expect(state.pending['transfer-with-unretained-history'].broadcast.completed)
      .toEqual(completed)
    expect(state.pendingSendHistory).toBeUndefined()
    expect(state.pendingBroadcastSyncs).toBeUndefined()
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
