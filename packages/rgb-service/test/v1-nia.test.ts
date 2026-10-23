import { Psbt, Transaction } from 'bitcoinjs-lib'
import { describe, expect, it, vi } from 'vitest'
import { encodeNiaGenesis } from '../src/protocol/nia-genesis'
import { prepareNiaOpretTransfer } from '../src/protocol/opret-transfer'
import { serializeBfaOpretWitnessBundle, serializeNiaOpretWitnessBundle } from '../src/protocol/consignment'
import {
  encodeBfaContractConsignment,
  encodeBfaTransferConsignment,
  isSupportedV1ContractConsignment,
  isSupportedV1TransferConsignment,
  unwrapRgbContractConsignment,
} from '../src/protocol/bfa-consignment'
import { mergeBfaValidatedHistories, restoreValidatedBfaHistory, selectBfaSpendHistory, validateBfaTransferConsignment } from '../src/protocol/bfa-validator'
import { decodeRgbInvoice } from '../src/protocol/invoice'
import { encodeRgbContractId } from '../src/protocol/contract-id'
import { createLocalRgbProtocolEncoder } from '../src/protocol/local-bfa-encoder'
import { encodeNiaTransferConsignment } from '../src/protocol/nia-contract'
import { encodeNiaContract } from '../src/protocol/nia-contract'
import { convertNiaV0ConsignmentToV1 } from '../src/protocol/nia-v0-migration'
import { serializeStrictBitcoinTransaction } from '../src/protocol/fascia'
import { StrictWriter } from '../src/protocol/strict'
import { wrapRgbTransferConsignment } from '../src/protocol/consignment'

const genesisTxid = '8d54c98d4c29a1ec4fd90635f543f0f7a871a78eb6a6e706342f831d92e3ba19'

function fixture() {
  const genesis = encodeNiaGenesis({
    ticker: 'NIA', name: 'V1 NIA', precision: 0, timestamp: 1_713_261_744,
    network: 'mainnet', allocations: [{ txid: genesisTxid, vout: 0, blinding: 1n, amount: 100n }],
  })
  const assetId = `rgb:${Buffer.from(genesis.assetId).toString('hex')}`
  const invoice = decodeRgbInvoice(
    `rgb:${assetId.slice(4)}/schema/~/bc:utxob:xDfmDF9g-yNOjriV-6Anbe6H-MLJ__g6-lo7Dd4f-dhWBW8S-XYGBm?amount=60`
  )
  const prepared = prepareNiaOpretTransfer({
    network: 'mainnet', assetId, amount: '60',
    selectedUtxos: [{
      outpoint: { txid: genesisTxid, vout: 0 }, satoshis: 10_000,
      scriptPubKey: `5120${'11'.repeat(32)}`, publicKey: `02${'22'.repeat(32)}`,
      allocations: [{ assetId, amount: '100', settled: true, spendable: true,
        opId: assetId.slice(4), assignmentIndex: 0, assignmentType: 4000 }],
    }],
    recipientSeal: invoice.seal, feeRate: 2,
    feeFunding: { utxos: [{
      outpoint: { txid: 'cc'.repeat(32), vout: 1 }, satoshis: 10_000,
      scriptPubKey: `5120${'11'.repeat(32)}`, publicKey: `02${'22'.repeat(32)}`,
    }], changeScriptPubKey: `5120${'11'.repeat(32)}`, changeDustLimit: 330 },
    nonce: 1n, entropy: 2n, recipientBlinding: 3n, changeBlinding: 4n,
  })
  const psbt = Psbt.fromHex(prepared.psbtHex)
  const transaction = ((psbt.data.globalMap.unsignedTx as any).tx || psbt.data.globalMap.unsignedTx).toBuffer()
  const bundle = serializeBfaOpretWitnessBundle({
    witnessTx: transaction, contractId: assetId, transitionId: prepared.transitionId,
    transition: prepared.transition,
    inputs: [{ opId: assetId.slice(4), assignmentType: 4000, assignmentIndex: 0 }], entropy: 2n,
  })
  const consignment = encodeBfaTransferConsignment({
    genesis: genesis.strict, validatedWitnessBundles: [], witnessBundle: bundle.strict,
    terminals: [{ bundleId: bundle.bundleId, secretSeals: [
      invoice.seal.type === 'confidential' ? invoice.seal.secretSeal : new Uint8Array(32),
    ] }],
  })
  const v0Bundle = serializeNiaOpretWitnessBundle({
    witnessTx: transaction, contractId: assetId, transitionId: prepared.transitionId,
    transition: prepared.transition,
    inputs: [{ opId: assetId.slice(4), assignmentType: 4000, assignmentIndex: 0 }], entropy: 2n,
  })
  const v0Consignment = encodeNiaTransferConsignment({
    genesis, priorWitnessBundles: [], witnessBundle: v0Bundle.strict,
    terminals: [{ bundleId: v0Bundle.bundleId, secretSeals: [
      invoice.seal.type === 'confidential' ? invoice.seal.secretSeal : new Uint8Array(32),
    ] }],
  })
  return { consignment, v0Consignment, assetId, prepared, invoice, genesis, bundle, transaction: Transaction.fromBuffer(transaction) }
}

describe('NIA v1 transfer', () => {
  it('migrates a v0 NIA transfer without changing its asset, operation, or recipient', async () => {
    const { v0Consignment, consignment, prepared } = fixture()
    const migrated = convertNiaV0ConsignmentToV1(v0Consignment)
    expect(migrated).toEqual(consignment)
    const checked = await validateBfaTransferConsignment(migrated, {
      network: 0, isBitcoinTxConfirmed: async () => true, allowPendingLastWitness: true,
    })
    expect(checked.terminalAssignments).toContainEqual(expect.objectContaining({
      amount: '60', opId: Buffer.from(prepared.transitionId).toString('hex'),
    }))
  })

  it('converts a v0 root contract while retaining its exact Genesis', () => {
    const { genesis, v0Consignment } = fixture()
    const root = encodeNiaContract(genesis).strict
    expect(isSupportedV1ContractConsignment(v0Consignment)).toBe(false)
    expect(convertNiaV0ConsignmentToV1(root)).toEqual(encodeBfaContractConsignment(genesis.strict))
    const wrapped = Uint8Array.from([0x52, 0x47, 0x42, 0, 0x43, 0x4f, 0x4e, ...root])
    expect(convertNiaV0ConsignmentToV1(wrapped)).toEqual(encodeBfaContractConsignment(genesis.strict))
  })
  it('recognizes Rust NIA v1 contract files and exports their strict body', () => {
    const { genesis } = fixture()
    const body = encodeBfaContractConsignment(genesis.strict)
    const file = Uint8Array.from([0x52, 0x47, 0x42, 0, 0x43, 0x4f, 0x4e, ...body])
    expect(isSupportedV1TransferConsignment(file)).toBe(false)
    expect(isSupportedV1ContractConsignment(file)).toBe(true)
    expect(unwrapRgbContractConsignment(file)).toEqual(body)
  })

  it('validates the Genesis, parent spend, Bitcoin witness and recipient allocation', async () => {
    const { consignment, assetId, prepared } = fixture()
    expect(isSupportedV1TransferConsignment(consignment)).toBe(true)
    const result = await validateBfaTransferConsignment(consignment, {
      network: 0, isBitcoinTxConfirmed: async () => true, allowPendingLastWitness: true,
    })
    expect(result.assetId).toBe(encodeRgbContractId(Uint8Array.from(Buffer.from(assetId.slice(4), 'hex'))))
    expect(result.metadata).toMatchObject({ schema: 'NIA', issuedSupply: '100' })
    expect(result.terminalAssignments).toContainEqual(expect.objectContaining({
      amount: '60', opId: Buffer.from(prepared.transitionId).toString('hex'),
    }))
  })

  it('rejects a changed NIA issued supply', async () => {
    const { consignment } = fixture()
    const tampered = Uint8Array.from(consignment)
    const supply = Buffer.from('da07010008006400000000000000', 'hex')
    const offset = Buffer.from(tampered).indexOf(supply)
    expect(offset).toBeGreaterThan(0)
    tampered[offset + supply.length - 8] ^= 1
    await expect(validateBfaTransferConsignment(tampered, {
      network: 0, isBitcoinTxConfirmed: async () => true, allowPendingLastWitness: true,
    })).rejects.toThrow('NIA Genesis allocations do not match issued supply')
  })

  it('parses ancestor SPV proofs without relying on them for chain confirmation', async () => {
    const { assetId, genesis, bundle, transaction } = fixture()
    const txLength = serializeStrictBitcoinTransaction(Uint8Array.from(transaction.toBuffer())).length
    const withProof = Uint8Array.from([
      ...bundle.strict.slice(0, txLength),
      1, // Some(SpvProof)
      1, 0, 0, 0, // block height
      0, 0, 0, 0, // transaction position
      0, // zero merkle siblings
      ...bundle.strict.slice(txLength + 1),
    ])
    const payload = encodeBfaTransferConsignment({
      genesis: genesis.strict, validatedWitnessBundles: [], witnessBundle: withProof,
      terminals: [],
    })
    const result = await validateBfaTransferConsignment(payload, {
      network: 0, isBitcoinTxConfirmed: async txid => txid === transaction.getId(),
    })
    expect(result.assetId).toBe(encodeRgbContractId(Uint8Array.from(Buffer.from(assetId.slice(4), 'hex'))))
  })

  it('accepts a revealed v1 terminal seal for a witness recipient', async () => {
    const { genesis, bundle, prepared } = fixture()
    const terminal = new StrictWriter()
      .writeU8(1).writeU8(1).writeU16(1)
      .writeFixedBytes(bundle.bundleId, 32).writeU16(1)
      .writeU8(0).writeU8(0).writeU32(prepared.changeVout!).writeU64(4n)
      .toBytes()
    const payload = wrapRgbTransferConsignment(Uint8Array.from([
      ...terminal, ...genesis.strict, ...new StrictWriter().writeU32(1).toBytes(), ...bundle.strict,
    ]))
    const result = await validateBfaTransferConsignment(payload, {
      network: 0, isBitcoinTxConfirmed: async () => true, allowPendingLastWitness: true,
    })
    expect(result.terminals).toHaveLength(1)
    expect(result.terminalAssignments).toContainEqual(expect.objectContaining({ amount: '40' }))
  })

  it('uses validated v1 history when preparing a subsequent NIA send', async () => {
    const { consignment, v0Consignment, assetId, prepared: first, transaction } = fixture()
    const validate = async (input: Parameters<NonNullable<import('../src/types').RgbServiceDependencies['validateBfaConsignment']>>[0]) =>
      validateBfaTransferConsignment(input.payload, {
        network: 0, isBitcoinTxConfirmed: async () => true,
        ...(input.pendingWitnessTxid ? { pendingWitnessTxid: input.pendingWitnessTxid } : {}),
        ...(input.allowPendingLastWitness ? { allowPendingLastWitness: true } : {}),
        knownBlindSeals: input.knownBlindSeals,
      })
    const history = await validate({
      wallet: { walletId: 'test', fundingAddress: 'bc1p-test', network: 'mainnet' },
      payload: consignment, knownBlindSeals: [], allowPendingLastWitness: true,
    })
    expect(isSupportedV1TransferConsignment(mergeBfaValidatedHistories([history]))).toBe(true)
    const changeVout = first.changeVout!
    const change = transaction.outs[changeVout]!
    const utxo = {
      outpoint: { txid: transaction.getId(), vout: changeVout }, satoshis: change.value,
      scriptPubKey: change.script.toString('hex'), publicKey: `02${'22'.repeat(32)}`,
      allocations: [{
        assetId, amount: '40', settled: true, spendable: true,
        opId: Buffer.from(first.transitionId).toString('hex'), assignmentIndex: 1, assignmentType: 4000,
      }],
    }
    const invoice = decodeRgbInvoice(
      `rgb:${assetId.slice(4)}/schema/~/bc:utxob:xDfmDF9g-yNOjriV-6Anbe6H-MLJ__g6-lo7Dd4f-dhWBW8S-XYGBm?amount=10`
    )
    const validateForSend = vi.fn(validate)
    const encoder = createLocalRgbProtocolEncoder(validateForSend)
    const validatedV1SendHistories: NonNullable<import('../src/types').RgbValidationHistory['validatedV1SendHistories']> = {}
    const sendInput: Parameters<typeof encoder.prepareTransfer>[0] = {
      wallet: { walletId: 'test', fundingAddress: 'bc1p-test', network: 'mainnet' },
      snapshot: { utxos: [utxo], syncedAt: 1 },
      request: { assetId, amount: '10', invoice: invoice.raw, feeRate: 2 },
      intent: { assetId, amount: '10', invoice, transition: {
        assetId, inputAmount: '40', recipientAmount: '10', changeAmount: '30',
        recipientId: invoice.recipientId, inputs: [{ outpoint: utxo.outpoint, assetId, amount: '40' }],
        preservedAllocations: [],
      } },
      selectedUtxos: [utxo],
      feeFunding: { utxos: [{
        outpoint: { txid: 'cc'.repeat(32), vout: 1 }, satoshis: 10_000,
        scriptPubKey: utxo.scriptPubKey, publicKey: utxo.publicKey,
      }], changeScriptPubKey: utxo.scriptPubKey, changeDustLimit: 330 },
      validationHistory: { assetId, consignments: [
        { opId: assetId.slice(4), payload: Buffer.from(consignment).toString('base64') },
      ], confirmedBitcoinWitnesses: {
        [transaction.getId()]: { checkedAt: Date.now(), confirmations: 3 },
      }, validatedV1SendHistories },
    }
    const prepared = await encoder.prepareTransfer(sendInput)
    expect(prepared.metadata?.['schema']).toBe('NIA_V1')
    expect(prepared.psbt).toMatch(/^70736274ff/i)
    expect(Object.keys(validatedV1SendHistories)).toHaveLength(1)
    const saved = validatedV1SendHistories[assetId]!
    expect(restoreValidatedBfaHistory(consignment, 0, [], saved)).toBeDefined()
    expect(restoreValidatedBfaHistory(consignment, 0,
      [{ txid: genesisTxid, vout: 0, blinding: 99n }], saved)).toBeUndefined()
    const changedPayload = Uint8Array.from(consignment)
    changedPayload[changedPayload.length - 1] ^= 1
    expect(restoreValidatedBfaHistory(changedPayload, 0, [], saved)).toBeUndefined()
    const checksAfterFirstSend = validateForSend.mock.calls.length
    sendInput.validationHistory.validatedV1SendHistories = JSON.parse(JSON.stringify(validatedV1SendHistories))
    await encoder.prepareTransfer(sendInput)
    expect(validateForSend).toHaveBeenCalledTimes(checksAfterFirstSend)
    const completed = await encoder.completeTransfer({
      wallet: { walletId: 'test', fundingAddress: 'bc1p-test', network: 'mainnet' },
      pending: {
        prepared,
        request: { assetId, amount: '10', invoice: invoice.raw, feeRate: 2 },
        createdAt: 1,
      },
      signedPsbt: prepared.psbt, allowIncomplete: true,
    })
    const next = await validate({
      wallet: { walletId: 'test', fundingAddress: 'bc1p-test', network: 'mainnet' },
      payload: Uint8Array.from(Buffer.from(completed.consignments[0]!.payload, 'base64')),
      knownBlindSeals: [], pendingWitnessTxid: completed.txid,
    })
    expect(next.metadata.schema).toBe('NIA')
    expect(next.terminalAssignments).toContainEqual(expect.objectContaining({ amount: '10' }))
  })

  it('allows the exact selected mempool witness when preparing a chained send', async () => {
    const { consignment, assetId, prepared: first, transaction } = fixture()
    const witnessTxid = transaction.getId()
    const validateForSend = vi.fn(async (
      input: Parameters<NonNullable<import('../src/types').RgbServiceDependencies['validateBfaConsignment']>>[0]
    ) => validateBfaTransferConsignment(input.payload, {
      network: 0,
      isBitcoinTxConfirmed: async () => false,
      ...(input.pendingWitnessTxid ? { pendingWitnessTxid: input.pendingWitnessTxid } : {}),
      knownBlindSeals: input.knownBlindSeals,
    }))
    const encoder = createLocalRgbProtocolEncoder(validateForSend)
    const changeVout = first.changeVout!
    const change = transaction.outs[changeVout]!
    const utxo = {
      outpoint: { txid: witnessTxid, vout: changeVout },
      satoshis: change.value,
      scriptPubKey: change.script.toString('hex'),
      publicKey: `02${'22'.repeat(32)}`,
      chainStatus: 'mempool' as const,
      allocations: [{
        assetId,
        amount: '40',
        settled: true,
        spendable: true,
        opId: Buffer.from(first.transitionId).toString('hex'),
        assignmentIndex: 1,
        assignmentType: 4000,
      }],
    }
    const invoice = decodeRgbInvoice(
      `rgb:${assetId.slice(4)}/schema/~/bc:utxob:xDfmDF9g-yNOjriV-6Anbe6H-MLJ__g6-lo7Dd4f-dhWBW8S-XYGBm?amount=10`
    )

    await expect(encoder.prepareTransfer({
      wallet: { walletId: 'test', fundingAddress: 'bc1p-test', network: 'mainnet' },
      snapshot: { utxos: [utxo], syncedAt: 1 },
      request: { assetId, amount: '10', invoice: invoice.raw, feeRate: 2 },
      intent: { assetId, amount: '10', invoice, transition: {
        assetId,
        inputAmount: '40',
        recipientAmount: '10',
        changeAmount: '30',
        recipientId: invoice.recipientId,
        inputs: [{ outpoint: utxo.outpoint, assetId, amount: '40' }],
        preservedAllocations: [],
      } },
      selectedUtxos: [utxo],
      feeFunding: {
        utxos: [{
          outpoint: { txid: 'cc'.repeat(32), vout: 1 },
          satoshis: 10_000,
          scriptPubKey: utxo.scriptPubKey,
          publicKey: utxo.publicKey,
        }],
        changeScriptPubKey: utxo.scriptPubKey,
        changeDustLimit: 330,
      },
      validationHistory: {
        assetId,
        consignments: [{
          opId: assetId.slice(4),
          payload: Buffer.from(consignment).toString('base64'),
        }],
      },
    })).resolves.toMatchObject({ metadata: { schema: 'NIA_V1' } })

    expect(validateForSend).toHaveBeenCalled()
    expect(validateForSend.mock.calls.every(([input]) =>
      input.pendingWitnessTxid === witnessTxid
    )).toBe(true)
  })

  it('keeps only the selected branch in a consignment for the next recipient', async () => {
    const genesis = encodeNiaGenesis({
      ticker: 'NIA', name: 'Two branches', precision: 0, timestamp: 1_713_261_744,
      network: 'mainnet', allocations: [
        { txid: genesisTxid, vout: 0, blinding: 1n, amount: 100n },
        { txid: genesisTxid, vout: 1, blinding: 2n, amount: 100n },
      ],
    })
    const assetId = `rgb:${Buffer.from(genesis.assetId).toString('hex')}`
    const invoice = decodeRgbInvoice(
      `rgb:${assetId.slice(4)}/schema/~/bc:utxob:xDfmDF9g-yNOjriV-6Anbe6H-MLJ__g6-lo7Dd4f-dhWBW8S-XYGBm?amount=60`
    )
    const makeBranch = (vout: number) => {
      const assignmentIndex = genesis.allocationIndexes.indexOf(vout)
      const prepared = prepareNiaOpretTransfer({
        network: 'mainnet', assetId, amount: '60',
        selectedUtxos: [{
          outpoint: { txid: genesisTxid, vout }, satoshis: 10_000,
          scriptPubKey: `5120${'11'.repeat(32)}`, publicKey: `02${'22'.repeat(32)}`,
          allocations: [{ assetId, amount: '100', settled: true, spendable: true,
            opId: assetId.slice(4), assignmentIndex, assignmentType: 4000 }],
        }],
        recipientSeal: invoice.seal, feeRate: 2,
        feeFunding: { utxos: [{
          outpoint: { txid: (vout ? 'dd' : 'cc').repeat(32), vout: 1 }, satoshis: 10_000,
          scriptPubKey: `5120${'11'.repeat(32)}`, publicKey: `02${'22'.repeat(32)}`,
        }], changeScriptPubKey: `5120${'11'.repeat(32)}`, changeDustLimit: 330 },
        nonce: BigInt(vout + 1), entropy: BigInt(vout + 2), recipientBlinding: 3n, changeBlinding: 4n,
      })
      const psbt = Psbt.fromHex(prepared.psbtHex)
      const tx = ((psbt.data.globalMap.unsignedTx as any).tx || psbt.data.globalMap.unsignedTx).toBuffer()
      const bundle = serializeBfaOpretWitnessBundle({
        witnessTx: tx, contractId: assetId, transitionId: prepared.transitionId,
        transition: prepared.transition,
        inputs: [{ opId: assetId.slice(4), assignmentType: 4000, assignmentIndex }],
        entropy: BigInt(vout + 2),
      })
      return { ...bundle, transitionId: prepared.transitionId }
    }
    const left = makeBranch(0)
    const right = makeBranch(1)
    const validate = (bundle: typeof left) => validateBfaTransferConsignment(
      encodeBfaTransferConsignment({
        genesis: genesis.strict, validatedWitnessBundles: [], witnessBundle: bundle.strict, terminals: [],
      }), { network: 0, isBitcoinTxConfirmed: async () => true }
    )
    const merged = mergeBfaValidatedHistories(await Promise.all([validate(left), validate(right)]))
    const complete = await validateBfaTransferConsignment(merged, {
      network: 0, isBitcoinTxConfirmed: async () => true,
    })
    const leftOpId = Buffer.from(left.transitionId).toString('hex')
    const selected = selectBfaSpendHistory(complete, [leftOpId])
    expect(selected.witnessBundles).toHaveLength(1)
    const portable = encodeBfaTransferConsignment({
      genesis: selected.genesis, validatedWitnessBundles: [],
      witnessBundle: selected.witnessBundles[0]!, terminals: [],
    })
    const recipientCheck = await validateBfaTransferConsignment(portable, {
      network: 0, isBitcoinTxConfirmed: async () => true,
    })
    expect(recipientCheck.bundles).toHaveLength(1)
    expect(recipientCheck.bundles[0]?.operationIds).toContain(leftOpId)
  })
})
