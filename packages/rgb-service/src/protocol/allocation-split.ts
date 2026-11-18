import { Psbt, Transaction } from 'bitcoinjs-lib'
import { RgbServiceError } from '../errors'
import type {
  RgbCompletedTransfer,
  RgbFeeFunding,
  RgbPendingTransfer,
  RgbPreparedTransfer,
  RgbUtxo,
  RgbWalletRef,
} from '../types'
import { encodeBfaTransferConsignment } from './bfa-consignment'
import { createRgbAllocationSplitPsbt } from './bitcoin'
import { transitionBundleId } from './bundle'
import { completeRgbOpretPsbt } from './complete'
import { serializeBfaOpretWitnessBundle, serializeNiaOpretWitnessBundle } from './consignment'
import { encodeNiaTransferConsignment } from './nia-contract'
import { convertNiaV0ConsignmentToV1 } from './nia-v0-migration'
import { encodeNiaTransition, niaInputFromAllocation } from './nia'
import { commitOpretRgbPsbt } from './psbt-commit'

export interface AllocationSplitHistory {
  assetId: string
  format: 'v0' | 'v1'
  genesis: Uint8Array
  witnessBundles: Uint8Array[]
}

type PreparedAsset = {
  assetId: string
  amount: string
  vout: number
  transitionId: string
  transition: string
  bundleId: string
  inputs: Array<{ opId: string; assignmentType: number; assignmentIndex: number }>
  format: 'v0' | 'v1'
  genesis: string
  historyWitnessBundles: string[]
}

function randomU64() {
  if (!globalThis.crypto?.getRandomValues)
    throw new RgbServiceError('Secure RGB random generation is unavailable')
  const value = new Uint8Array(8)
  globalThis.crypto.getRandomValues(value)
  return value.reduce((total, byte, index) => total | (BigInt(byte) << BigInt(index * 8)), 0n)
}

function findInputIndex(psbtHex: string, txid: string, vout: number) {
  const psbt = Psbt.fromHex(psbtHex)
  const transaction = ((psbt.data.globalMap.unsignedTx as any).tx ||
    psbt.data.globalMap.unsignedTx) as any
  const index = transaction.ins.findIndex((input: any) =>
    Buffer.from(input.hash).reverse().toString('hex') === txid && input.index === vout
  )
  if (index < 0) throw new RgbServiceError('RGB allocation split PSBT is missing an input')
  return index
}

function parseAssets(value: string | undefined): PreparedAsset[] {
  try {
    const assets = JSON.parse(value || '')
    if (!Array.isArray(assets) || assets.length < 2) throw new Error('invalid')
    return assets
  } catch {
    throw new RgbServiceError('RGB allocation split metadata is invalid')
  }
}

/** Construct one transition per contract and commit all of them to one Bitcoin witness. */
export function prepareAllocationSplit(input: {
  wallet: RgbWalletRef
  selectedUtxo: RgbUtxo
  feeRate: number
  feeFunding?: RgbFeeFunding
  histories: AllocationSplitHistory[]
}): RgbPreparedTransfer {
  const groups = new Map<string, typeof input.selectedUtxo.allocations>()
  for (const allocation of input.selectedUtxo.allocations) {
    if (!allocation.settled || !allocation.spendable || !allocation.opId ||
      allocation.assignmentIndex === undefined || allocation.assignmentType === undefined) {
      throw new RgbServiceError('RGB allocation split contains an unavailable allocation')
    }
    const group = groups.get(allocation.assetId) || []
    group.push(allocation)
    groups.set(allocation.assetId, group)
  }
  if (groups.size < 2) throw new RgbServiceError('RGB UTXO does not contain multiple assets')
  const assets = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
  const historyByAsset = new Map(input.histories.map(history => [history.assetId, history]))
  const bitcoin = createRgbAllocationSplitPsbt({
    network: input.wallet.network,
    selectedUtxo: input.selectedUtxo,
    outputCount: assets.length,
    feeRate: input.feeRate,
    ...(input.feeFunding ? { feeFunding: input.feeFunding } : {}),
  })
  const entropy = randomU64()
  const preparedAssets: PreparedAsset[] = assets.map(([assetId, allocations], index) => {
    const history = historyByAsset.get(assetId)
    if (!history) throw new RgbServiceError(`RGB allocation split history is missing for ${assetId}`)
    const amount = allocations.reduce((total, allocation) => total + BigInt(allocation.amount), 0n)
    const transition = encodeNiaTransition({
      contractId: assetId,
      nonce: randomU64(),
      inputs: allocations.map(niaInputFromAllocation),
      assignments: [{
        amount,
        seal: { txid: null, vout: bitcoin.assetVouts[index]!, blinding: randomU64() },
      }],
    })
    const parents = allocations.map(allocation => ({
      opId: allocation.opId!,
      assignmentType: allocation.assignmentType!,
      assignmentIndex: allocation.assignmentIndex!,
    }))
    const bundleId = transitionBundleId(parents.map(parent => ({
      ...parent,
      transitionId: transition.opId,
    })))
    return {
      assetId,
      amount: amount.toString(),
      vout: bitcoin.assetVouts[index]!,
      transitionId: Buffer.from(transition.opId).toString('hex'),
      transition: Buffer.from(transition.strict).toString('hex'),
      bundleId: Buffer.from(bundleId).toString('hex'),
      inputs: parents,
      format: history.format,
      genesis: Buffer.from(history.genesis).toString('base64'),
      historyWitnessBundles: history.witnessBundles.map(bundle => Buffer.from(bundle).toString('base64')),
    }
  })
  const messages = preparedAssets.map(asset => ({
    protocolId: Uint8Array.from(Buffer.from(asset.transition, 'hex')).slice(2, 34),
    message: Uint8Array.from(Buffer.from(asset.bundleId, 'hex')),
  }))
  const committed = commitOpretRgbPsbt({
    psbtHex: bitcoin.psbtHex,
    hostVout: bitcoin.hostVout,
    entropy,
    messages,
    transitions: preparedAssets.map(asset => ({
      transitionId: Uint8Array.from(Buffer.from(asset.transitionId, 'hex')),
      transition: Uint8Array.from(Buffer.from(asset.transition, 'hex')),
    })),
  })
  const feeByOutpoint = new Map(input.feeFunding?.utxos.map(utxo => [
    `${utxo.outpoint.txid}:${utxo.outpoint.vout}`, utxo,
  ]) || [])
  return {
    id: preparedAssets[0]!.transitionId,
    psbt: committed.psbtHex,
    toSignInputs: [{
      index: findInputIndex(committed.psbtHex, input.selectedUtxo.outpoint.txid, input.selectedUtxo.outpoint.vout),
      publicKey: input.selectedUtxo.publicKey,
      useTweakedSigner: true,
    }, ...bitcoin.feeOutpoints.map(outpoint => {
      const fee = feeByOutpoint.get(`${outpoint.txid}:${outpoint.vout}`)
      if (!fee) throw new RgbServiceError('RGB allocation split fee input is missing')
      return { index: findInputIndex(committed.psbtHex, outpoint.txid, outpoint.vout), publicKey: fee.publicKey }
    })],
    lockedOutpoints: [input.selectedUtxo.outpoint],
    feeOutpoints: bitcoin.feeOutpoints,
    metadata: {
      schema: 'ALLOCATION_SPLIT',
      preparedPsbt: committed.psbtHex,
      hostVout: String(bitcoin.hostVout),
      commitment: Buffer.from(committed.commitment).toString('hex'),
      entropy: entropy.toString(),
      fundingScript: input.selectedUtxo.scriptPubKey,
      fundingPublicKey: input.selectedUtxo.publicKey,
      assets: JSON.stringify(preparedAssets),
    },
  }
}

export function completeAllocationSplit(input: {
  pending: RgbPendingTransfer
  signedPsbt: string
}): RgbCompletedTransfer {
  const data = input.pending.prepared.metadata
  if (data?.['schema'] !== 'ALLOCATION_SPLIT')
    throw new RgbServiceError('Pending transfer is not an RGB allocation split')
  const assets = parseAssets(data['assets'])
  const completed = completeRgbOpretPsbt({
    preparedPsbt: data['preparedPsbt'] || '',
    signedPsbt: input.signedPsbt,
    hostVout: Number(data['hostVout']),
    commitment: Uint8Array.from(Buffer.from(data['commitment'] || '', 'hex')),
  })
  const entropy = BigInt(data['entropy'] || '')
  const messages = assets.map(asset => ({
    protocolId: Uint8Array.from(Buffer.from(asset.transition, 'hex')).slice(2, 34),
    message: Uint8Array.from(Buffer.from(asset.bundleId, 'hex')),
  }))
  const tx = Transaction.fromHex(completed.rawTx)
  const consignments = assets.map(asset => {
    const bundleInput = {
      witnessTx: Uint8Array.from(Buffer.from(completed.rawTx, 'hex')),
      contractId: asset.assetId,
      transitionId: Uint8Array.from(Buffer.from(asset.transitionId, 'hex')),
      transition: Uint8Array.from(Buffer.from(asset.transition, 'hex')),
      inputs: asset.inputs,
      entropy,
      mpcMessages: messages,
    }
    const witnessBundle = asset.format === 'v1'
      ? serializeBfaOpretWitnessBundle(bundleInput)
      : serializeNiaOpretWitnessBundle(bundleInput)
    if (Buffer.from(witnessBundle.bundleId).toString('hex') !== asset.bundleId) {
      throw new RgbServiceError('RGB allocation split WitnessBundle does not match its transition')
    }
    const genesis = Uint8Array.from(Buffer.from(asset.genesis, 'base64'))
    const history = asset.historyWitnessBundles.map(value => Uint8Array.from(Buffer.from(value, 'base64')))
    const consignment = asset.format === 'v1'
      ? encodeBfaTransferConsignment({
          genesis,
          validatedWitnessBundles: history,
          witnessBundle: witnessBundle.strict,
        })
      : convertNiaV0ConsignmentToV1(encodeNiaTransferConsignment({
          genesis: { strict: genesis },
          priorWitnessBundles: history,
          witnessBundle: witnessBundle.strict,
          terminals: [],
        }))
    return {
      recipientId: '',
      payload: Buffer.from(consignment).toString('base64'),
      assetId: asset.assetId,
      opIds: [asset.transitionId],
    }
  })
  return {
    txid: completed.txid,
    rawTx: completed.rawTx,
    consignments,
    fundingUpdate: {
      spentOutpoints: input.pending.prepared.lockedOutpoints,
      createdUtxos: assets.map(asset => {
        const output = tx.outs[asset.vout]
        if (!output || output.script.toString('hex') !== data['fundingScript']) {
          throw new RgbServiceError('RGB allocation split output does not belong to the wallet')
        }
        return {
          outpoint: { txid: completed.txid, vout: asset.vout },
          satoshis: output.value,
          scriptPubKey: data['fundingScript'] || '',
          publicKey: data['fundingPublicKey'] || '',
          allocations: [{
            assetId: asset.assetId,
            amount: asset.amount,
            settled: true,
            spendable: true,
            opId: asset.transitionId,
            assignmentIndex: 0,
            assignmentType: 4000,
          }],
        }
      }),
    },
  }
}
