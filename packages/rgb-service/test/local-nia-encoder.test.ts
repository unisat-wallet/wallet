import { Psbt } from 'bitcoinjs-lib'
import { describe, expect, it } from 'vitest'
import {
  concealBlindSeal,
  createLocalRgbProtocolEncoder,
  decodeRgbInvoice,
  encodeBfaTransferConsignment,
  encodeBlindRgbInvoice,
  encodeNiaContract,
  encodeNiaGenesis,
  isSupportedV1TransferConsignment,
  localNiaProtocolEncoder,
  mergeBfaValidatedHistories,
  serializeBfaOpretWitnessBundle,
  validateBfaTransferConsignment,
} from '../src'

const txid = '8d54c98d4c29a1ec4fd90635f543f0f7a871a78eb6a6e706342f831d92e3ba19'

function rootTransferInput({ witness = false } = {}) {
  const genesis = encodeNiaGenesis({
    ticker: 'LOCAL',
    name: 'Local NIA',
    precision: 0,
    timestamp: 1_713_261_744,
    network: 'mainnet',
    allocations: [{ txid, vout: 0, blinding: 1n, amount: 100n }],
  })
  const assetId = `rgb:${Buffer.from(genesis.assetId).toString('hex')}`
  const contract = Buffer.from(encodeNiaContract(genesis).strict).toString('base64')
  const invoice = decodeRgbInvoice(
    witness
      ? `rgb:${assetId.slice(4)}/~/~/bc:wvout:A8cJ7Ww3-NIzADo3-Tzp_5aD-7CTBWmA-AAAAAAA-AAAAAAA-ALSQkcw?amount=60`
      : `rgb:${assetId.slice(4)}/~/~/bc:utxob:xDfmDF9g-yNOjriV-6Anbe6H-MLJ__g6-lo7Dd4f-dhWBW8S-XYGBm?amount=60`
  )
  const utxo = {
    outpoint: { txid, vout: 0 },
    satoshis: 10_000,
    scriptPubKey: `5120${'11'.repeat(32)}`,
    publicKey: `02${'22'.repeat(32)}`,
    allocations: [
      {
        assetId,
        amount: '100',
        settled: true,
        spendable: true,
        opId: assetId.slice(4),
        assignmentIndex: 0,
        assignmentType: 4000,
      },
    ],
  }
  return {
    wallet: { walletId: 'local', fundingAddress: 'bc1p-local', network: 'mainnet' as const },
    snapshot: { utxos: [utxo], syncedAt: 1 },
    request: { assetId, amount: '60', invoice: invoice.raw, feeRate: 2 },
    intent: {
      assetId,
      amount: '60',
      invoice,
      transition: {
        assetId,
        inputAmount: '100',
        recipientAmount: '60',
        changeAmount: '40',
        recipientId: invoice.recipientId,
        inputs: [{ outpoint: utxo.outpoint, assetId, amount: '100' }],
        preservedAllocations: [],
      },
    },
    selectedUtxos: [utxo],
    feeFunding: {
      utxos: [
        {
          outpoint: { txid: 'cc'.repeat(32), vout: 1 },
          satoshis: 10_000,
          scriptPubKey: utxo.scriptPubKey,
          publicKey: utxo.publicKey,
        },
      ],
      changeScriptPubKey: utxo.scriptPubKey,
      changeDustLimit: 330,
    },
    validationHistory: {
      assetId,
      consignments: [{ opId: assetId.slice(4), payload: contract }],
      localContract: contract,
      localGenesis: Buffer.from(genesis.strict).toString('base64'),
    },
  }
}

describe('localNiaProtocolEncoder', () => {
  it('creates a locally committed first transfer for a self-issued NIA root', async () => {
    const prepared = await localNiaProtocolEncoder.prepareTransfer(rootTransferInput())

    expect(prepared.id).toHaveLength(64)
    expect(prepared.psbt).toMatch(/^70736274ff/i)
    expect(prepared.lockedOutpoints).toEqual([{ txid, vout: 0 }])
    expect(prepared.metadata).toMatchObject({
      recipientId: expect.stringContaining('utxob:'),
      genesis: expect.any(String),
    })
  })

  it('accepts a complete imported NIA history without local issuer metadata', async () => {
    const input = rootTransferInput()
    delete input.validationHistory.localContract
    delete input.validationHistory.localGenesis

    await expect(localNiaProtocolEncoder.prepareTransfer(input)).resolves.toMatchObject({
      id: expect.any(String),
      psbt: expect.stringMatching(/^70736274ff/i),
    })
  })

  it('prepares a witness recipient with a dust-safe Bitcoin output', async () => {
    const prepared = await localNiaProtocolEncoder.prepareTransfer(
      rootTransferInput({ witness: true })
    )
    const psbt = Psbt.fromHex(prepared.psbt)

    expect(prepared.metadata).toMatchObject({ recipientType: 'witness' })
    expect(prepared.metadata).not.toHaveProperty('recipientSecretSeal')
    expect(psbt.txOutputs[1]).toMatchObject({
      script: Buffer.from('0014c709ed6c37348cc00e8dd3ce9fb9683ec24c15a6', 'hex'),
      value: 330,
    })
  })

  it('completes a witness transfer without a blind consignment terminal', async () => {
    const input = rootTransferInput({ witness: true })
    const prepared = await localNiaProtocolEncoder.prepareTransfer(input)
    const signed = Psbt.fromHex(prepared.psbt)
    const finalWitness = Buffer.concat([Buffer.from([1, 64]), Buffer.alloc(64)])
    signed.data.inputs.forEach((_, index) => {
      signed.updateInput(index, { finalScriptWitness: finalWitness })
    })

    const completed = await localNiaProtocolEncoder.completeTransfer({
      wallet: input.wallet,
      pending: {
        prepared,
        request: { ...input.request, amount: '60' },
        createdAt: 1,
      },
      signedPsbt: signed.toHex(),
    })
    const payload = Uint8Array.from(Buffer.from(completed.consignments[0]!.payload, 'base64'))
    expect(isSupportedV1TransferConsignment(payload)).toBe(true)
    const decoded = await validateBfaTransferConsignment(payload, {
      network: 0, isBitcoinTxConfirmed: async () => true, allowPendingLastWitness: true,
    })
    const recipientAssignment = decoded.terminalAssignments.find(
      assignment => assignment.vout === 1
    )
    expect(recipientAssignment).toMatchObject({
      amount: '60', vout: 1,
    })
  })

  it('carries a locally known blind parent seal when spending a received allocation', async () => {
    const first = rootTransferInput()
    const receiveSeal = { txid: 'aa'.repeat(32), vout: 1, blinding: 7n }
    const firstInvoice = decodeRgbInvoice(
      encodeBlindRgbInvoice({
        network: 'mainnet',
        seal: receiveSeal,
        assetId: first.request.assetId,
        amount: '60',
        transportEndpoints: ['rpc://proxy.example'],
      })
    )
    first.request.invoice = firstInvoice.raw
    first.intent.invoice = firstInvoice
    first.intent.transition.recipientId = firstInvoice.recipientId

    const firstPrepared = await localNiaProtocolEncoder.prepareTransfer(first)
    const firstSigned = Psbt.fromHex(firstPrepared.psbt)
    const finalWitness = Buffer.concat([Buffer.from([1, 64]), Buffer.alloc(64)])
    firstSigned.data.inputs.forEach((_, index) => {
      firstSigned.updateInput(index, { finalScriptWitness: finalWitness })
    })
    const firstCompleted = await localNiaProtocolEncoder.completeTransfer({
      wallet: first.wallet,
      pending: { prepared: firstPrepared, request: first.request, createdAt: 1 },
      signedPsbt: firstSigned.toHex(),
    })
    const firstPayload = firstCompleted.consignments[0]!.payload
    const firstPayloadBytes = Uint8Array.from(Buffer.from(firstPayload, 'base64'))
    expect(isSupportedV1TransferConsignment(firstPayloadBytes)).toBe(true)
    const firstConsignment = await validateBfaTransferConsignment(firstPayloadBytes, {
      network: 0, isBitcoinTxConfirmed: async () => true,
      allowPendingLastWitness: true, knownBlindSeals: [receiveSeal],
    })
    const secretSeal = Buffer.from(concealBlindSeal(receiveSeal)).toString('hex')
    const firstTransition = firstConsignment.terminalAssignments.find(
      assignment => assignment.secretSeal === secretSeal
    )
    expect(firstTransition).toBeDefined()
    const firstMetadata = firstPrepared.metadata!
    const firstUnsignedPsbt = Psbt.fromHex(firstPrepared.psbt)
    const firstUnsignedTx = ((firstUnsignedPsbt.data.globalMap.unsignedTx as any).tx ||
      firstUnsignedPsbt.data.globalMap.unsignedTx).toBuffer()
    const firstUnsignedBundle = serializeBfaOpretWitnessBundle({
      witnessTx: firstUnsignedTx,
      contractId: first.request.assetId,
      transitionId: Uint8Array.from(Buffer.from(firstMetadata['transitionId']!, 'hex')),
      transition: Uint8Array.from(Buffer.from(firstMetadata['transition']!, 'hex')),
      inputs: JSON.parse(firstMetadata['inputs']!),
      entropy: BigInt(firstMetadata['entropy']!),
    })
    const firstUnsignedPayload = Buffer.from(encodeBfaTransferConsignment({
      genesis: Uint8Array.from(Buffer.from(firstMetadata['genesis']!, 'base64')),
      validatedWitnessBundles: [],
      witnessBundle: firstUnsignedBundle.strict,
    })).toString('base64')

    const nextInvoice = decodeRgbInvoice(
      encodeBlindRgbInvoice({
        network: 'mainnet',
        seal: { txid: 'bb'.repeat(32), vout: 2, blinding: 8n },
        assetId: first.request.assetId,
        amount: '50',
        transportEndpoints: ['rpc://next-proxy.example'],
      })
    )
    const receivedUtxo = {
      ...first.selectedUtxos[0],
      outpoint: { txid: receiveSeal.txid, vout: receiveSeal.vout },
      allocations: [
        {
          assetId: first.request.assetId,
          amount: '60',
          settled: true,
          spendable: true,
          opId: firstTransition!.opId,
          assignmentIndex: firstTransition!.assignmentIndex,
          assignmentType: 4000,
        },
      ],
    }
    const second = {
      ...first,
      snapshot: { utxos: [receivedUtxo], syncedAt: 2 },
      request: { ...first.request, amount: '50', invoice: nextInvoice.raw },
      intent: {
        assetId: first.request.assetId,
        amount: '50',
        invoice: nextInvoice,
        transition: {
          assetId: first.request.assetId,
          inputAmount: '60',
          recipientAmount: '50',
          changeAmount: '10',
          recipientId: nextInvoice.recipientId,
          inputs: [{ outpoint: receivedUtxo.outpoint, assetId: first.request.assetId, amount: '60' }],
          preservedAllocations: [],
        },
      },
      selectedUtxos: [receivedUtxo],
      validationHistory: {
        ...first.validationHistory,
        consignments: [
          first.validationHistory.consignments[0]!,
          { opId: firstTransition!.opId, payload: firstUnsignedPayload },
        ],
        knownBlindSeals: [receiveSeal],
      },
    }

    const encoder = createLocalRgbProtocolEncoder(input => validateBfaTransferConsignment(
      input.payload,
      {
        network: 0,
        isBitcoinTxConfirmed: async () => true,
        knownBlindSeals: input.knownBlindSeals,
        ...(input.pendingWitnessTxid ? { pendingWitnessTxid: input.pendingWitnessTxid } : {}),
        ...(input.allowPendingLastWitness ? { allowPendingLastWitness: true } : {}),
        ...(input.requiredOperationIds ? { requiredOperationIds: input.requiredOperationIds } : {}),
      }
    ))
    const secondPrepared = await encoder.prepareTransfer(second)
    const secondSigned = Psbt.fromHex(secondPrepared.psbt)
    secondSigned.data.inputs.forEach((_, index) => {
      secondSigned.updateInput(index, { finalScriptWitness: finalWitness })
    })
    const secondCompleted = await encoder.completeTransfer({
      wallet: second.wallet,
      pending: { prepared: secondPrepared, request: second.request, createdAt: 2 },
      signedPsbt: secondSigned.toHex(),
    })
    const secondPayload = Uint8Array.from(
      Buffer.from(secondCompleted.consignments[0]!.payload, 'base64')
    )
    expect(isSupportedV1TransferConsignment(secondPayload)).toBe(true)
    const secondConsignment = await validateBfaTransferConsignment(secondPayload, {
      network: 0, isBitcoinTxConfirmed: async () => true,
      allowPendingLastWitness: true, knownBlindSeals: [receiveSeal],
    })
    expect(secondConsignment.bundles).toHaveLength(2)
    expect(secondConsignment.bundles.at(-1)?.parentOpIds).toContain(firstTransition!.opId)
    const nextSecretSeal = nextInvoice.seal.type === 'confidential'
      ? Buffer.from(nextInvoice.seal.secretSeal).toString('hex')
      : ''
    expect(secondConsignment.terminalAssignments).toContainEqual(expect.objectContaining({
      amount: '50', secretSeal: nextSecretSeal,
    }))
    const concealedSignedParent = await validateBfaTransferConsignment(firstPayloadBytes, {
      network: 0, isBitcoinTxConfirmed: async () => true, allowPendingLastWitness: true,
    })
    const merged = mergeBfaValidatedHistories([concealedSignedParent, secondConsignment])
    await expect(validateBfaTransferConsignment(merged, {
      network: 0, isBitcoinTxConfirmed: async () => true, allowPendingLastWitness: true,
    })).resolves.toMatchObject({ assetId: concealedSignedParent.assetId })
  })

  it('refuses malformed history before constructing a PSBT', async () => {
    const input = rootTransferInput()
    input.validationHistory.consignments.push({ opId: 'ff'.repeat(32), payload: 'remote-history' })

    await expect(localNiaProtocolEncoder.prepareTransfer(input)).rejects.toThrow(
      'RGB Consignment version is unsupported'
    )
  })
})
