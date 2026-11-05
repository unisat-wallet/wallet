import { Psbt, Transaction } from 'bitcoinjs-lib'
import { RgbServiceError } from '../errors'
import type {
  RgbCompletedTransfer,
  RgbFeeFunding,
  RgbPendingTransfer,
  RgbPreparedTransfer,
  RgbProtocolEncoder,
  RgbServiceDependencies,
  RgbTransferIntent,
  RgbUtxo,
  RgbWalletRef,
} from '../types'
import { encodeBfaTransferConsignment, BFA_SCHEMA_ID, NIA_V1_SCHEMA_ID } from './bfa-consignment'
import { createRgbOpretPsbt } from './bitcoin'
import { normalizeBfaBurnDestination } from './bfa-burn-destination'
import { transitionBundleId } from './bundle'
import { isSupportedV1ContractConsignment, isSupportedV1TransferConsignment } from './bfa-consignment'
import {
  cacheValidatedBfaHistory,
  mergeBfaValidatedHistories,
  restoreValidatedBfaHistory,
  selectBfaSpendHistory,
} from './bfa-validator'
import { completeRgbOpretPsbt } from './complete'
import { normalizeRgbAssetId } from './contract-id'
import { serializeBfaOpretWitnessBundle } from './consignment'
import { prepareNiaOpretTransfer } from './opret-transfer'
import { encodeBfaBurnTransition, niaInputFromAllocation } from './nia'
import { commitOpretRgbPsbt } from './psbt-commit'
import { deriveProxyV1SealBlinding } from './proxy-v1'
import { localNiaProtocolEncoder } from './local-nia-encoder'
import { convertNiaV0ConsignmentToV1 } from './nia-v0-migration'
import { witnessSealDustLimit } from './witness'

export interface ValidatedBfaTransferHistory {
  assetId: string
  /** Exact strict Genesis and ancestor v1 bundles returned after local TypeScript validation. */
  genesis: Uint8Array
  witnessBundles: Uint8Array[]
  /** Spendable OS_ASSET operation outputs proved by that history. */
  allocations: Array<{ txid: string; vout: number; opId: string; assignmentIndex: number; amount: string; scriptPubKey?: string }>
}

function hex(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('hex')
}

/** Allow only the exact mempool witness whose allocation is being spent. */
function selectedPendingWitnessTxid(selectedUtxos: RgbUtxo[]): string | undefined {
  const txids = new Set(
    selectedUtxos
      .filter(utxo => utxo.chainStatus === 'mempool')
      .map(utxo => utxo.outpoint.txid.toLowerCase())
  )
  if (txids.size > 1) {
    throw new RgbServiceError(
      'RGB transfer cannot spend allocations from multiple unconfirmed witnesses'
    )
  }
  return txids.values().next().value
}

function randomU64() {
  const value = new Uint8Array(8)
  if (!globalThis.crypto?.getRandomValues)
    throw new RgbServiceError('Secure BFA random generation is unavailable')
  globalThis.crypto.getRandomValues(value)
  return value.reduce((total, byte, index) => total | (BigInt(byte) << BigInt(index * 8)), 0n)
}

function parseU64(value: string | undefined, name: string) {
  try {
    const parsed = BigInt(value || '')
    if (parsed < 0n || parsed > 0xffff_ffff_ffff_ffffn) throw new Error('range')
    return parsed
  } catch {
    throw new RgbServiceError(`${name} is invalid`)
  }
}

function parseHex32(value: string | undefined, name: string) {
  if (!value || !/^[0-9a-f]{64}$/i.test(value))
    throw new RgbServiceError(`${name} is invalid`)
  return Uint8Array.from(Buffer.from(value, 'hex'))
}

function findInputIndex(psbtHex: string, txid: string, vout: number) {
  const psbt = Psbt.fromHex(psbtHex)
  const transaction = ((psbt.data.globalMap.unsignedTx as any).tx || psbt.data.globalMap.unsignedTx) as any
  const index = transaction.ins.findIndex(
    (item: any) => Buffer.from(item.hash).reverse().toString('hex') === txid && item.index === vout
  )
  if (index < 0) throw new RgbServiceError('BFA PSBT is missing a selected input')
  return index
}

/**
 * Build and commit a BFA transfer entirely in the extension. The validated
 * history is an input to this encoder; it is never used to generate a PSBT or
 * transition outside the extension.
 */
export function prepareBfaTransfer(input: {
  wallet: RgbWalletRef
  intent: RgbTransferIntent
  selectedUtxos: RgbUtxo[]
  history: ValidatedBfaTransferHistory
  feeRate: number
  feeFunding?: RgbFeeFunding
  swapPsbt?: string
}): RgbPreparedTransfer {
  const schemaId = hex(input.history.genesis.slice(2, 34))
  if (schemaId !== BFA_SCHEMA_ID && schemaId !== NIA_V1_SCHEMA_ID)
    throw new RgbServiceError('RGB v1 transfer history has another schema')
  const schema = schemaId === NIA_V1_SCHEMA_ID ? 'NIA_V1' : 'BFA'
  const expectedAssetId = normalizeRgbAssetId(input.intent.assetId)
  if (normalizeRgbAssetId(input.history.assetId) !== expectedAssetId)
    throw new RgbServiceError('BFA validated history belongs to another asset')
  const proved = new Map(input.history.allocations.map(item => [
    `${item.txid}:${item.vout}:${item.opId.toLowerCase()}:${item.assignmentIndex}`,
    item,
  ]))
  const allocations = input.selectedUtxos.flatMap(utxo =>
    utxo.allocations.map(allocation => ({ utxo, allocation }))
  )
  if (!allocations.length || input.intent.transition.preservedAllocations.length)
    throw new RgbServiceError('BFA transfer requires isolated, validated asset allocations')
  for (const { utxo, allocation } of allocations) {
    if (
      normalizeRgbAssetId(allocation.assetId) !== expectedAssetId ||
      allocation.assignmentType !== 4000 ||
      !allocation.opId ||
      allocation.assignmentIndex === undefined ||
      !allocation.settled ||
      !allocation.spendable
    ) throw new RgbServiceError('BFA transfer includes an unsupported allocation')
    const key = `${utxo.outpoint.txid}:${utxo.outpoint.vout}:${allocation.opId.toLowerCase()}:${allocation.assignmentIndex}`
    const proof = proved.get(key)
    if (!proof || proof.amount !== allocation.amount ||
      (proof.scriptPubKey && proof.scriptPubKey.toLowerCase() !== utxo.scriptPubKey.toLowerCase()))
      throw new RgbServiceError('BFA allocation is absent from validated history')
  }
  const nonce = randomU64()
  const entropy = randomU64()
  let recipientBlinding = randomU64()
  if (input.intent.invoice.seal.type === 'witness' && input.intent.invoice.proxyPublicKey) {
    if (!input.intent.proxySenderPrivateKey)
      throw new RgbServiceError('RGB proxy sender operation key is missing')
    recipientBlinding = deriveProxyV1SealBlinding(
      input.intent.proxySenderPrivateKey,
      input.intent.invoice.proxyPublicKey
    )
  }
  const prepared = prepareNiaOpretTransfer({
    network: input.wallet.network,
    assetId: input.intent.assetId,
    amount: input.intent.amount,
    selectedUtxos: input.selectedUtxos,
    recipientSeal: input.intent.invoice.seal,
    feeRate: input.feeRate,
    ...(input.intent.invoice.seal.type === 'witness'
      ? { witnessAmountSat: Math.max(330, witnessSealDustLimit(input.intent.invoice.seal)) }
      : {}),
    nonce,
    entropy,
    recipientBlinding,
    changeBlinding: randomU64(),
    ...(input.feeFunding ? { feeFunding: input.feeFunding } : {}),
    ...(input.swapPsbt ? { swapPsbt: input.swapPsbt } : {}),
  })
  const feeUtxos = new Map(input.feeFunding?.utxos.map(utxo => [
    `${utxo.outpoint.txid}:${utxo.outpoint.vout}`, utxo,
  ]) || [])
  const selectedAmount = allocations.reduce((total, item) => total + BigInt(item.allocation.amount), 0n)
  const changeAmount = selectedAmount - BigInt(input.intent.amount)
  return {
    id: hex(prepared.transitionId),
    psbt: prepared.psbtHex,
    toSignInputs: [
      ...input.selectedUtxos.map(utxo => ({
        index: findInputIndex(prepared.psbtHex, utxo.outpoint.txid, utxo.outpoint.vout),
        publicKey: utxo.publicKey,
        useTweakedSigner: true,
      })),
      ...prepared.feeOutpoints.map(outpoint => {
        const fee = feeUtxos.get(`${outpoint.txid}:${outpoint.vout}`)
        if (!fee) throw new RgbServiceError('BFA fee input is missing from funding')
        return {
          index: findInputIndex(prepared.psbtHex, outpoint.txid, outpoint.vout),
          publicKey: fee.publicKey,
        }
      }),
    ],
    lockedOutpoints: input.selectedUtxos.map(utxo => utxo.outpoint),
    feeOutpoints: prepared.feeOutpoints,
    metadata: {
      schema,
      preparedPsbt: prepared.psbtHex,
      hostVout: String(prepared.hostVout),
      commitment: hex(prepared.commitment),
      transitionId: hex(prepared.transitionId),
      // The shared builder's final zero is a v0 empty valencies field. In
      // RGB v1 it encodes the replacement Option<Signature>::None field.
      transition: hex(prepared.transition),
      bundleId: hex(prepared.bundleId),
      entropy: entropy.toString(),
      genesis: Buffer.from(input.history.genesis).toString('base64'),
      historyWitnessBundles: JSON.stringify(input.history.witnessBundles.map(bundle => Buffer.from(bundle).toString('base64'))),
      recipientId: input.intent.invoice.recipientId,
      recipientType: input.intent.invoice.recipientType,
      ...(input.intent.invoice.seal.type === 'confidential'
        ? { recipientSecretSeal: hex(input.intent.invoice.seal.secretSeal) }
        : {}),
      fundingScript: input.selectedUtxos[0]!.scriptPubKey,
      fundingPublicKey: input.selectedUtxos[0]!.publicKey,
      changeVout: prepared.changeVout === undefined ? '' : String(prepared.changeVout),
      changeAmount: changeAmount.toString(),
      inputs: JSON.stringify(allocations.map(({ allocation }) => ({
        opId: allocation.opId,
        assignmentType: 4000,
        assignmentIndex: allocation.assignmentIndex,
      }))),
    },
  }
}

/** Prepare a BFA burn without an invoice or proxy recipient. */
export function prepareBfaBurn(input: {
  wallet: RgbWalletRef
  assetId: string
  amount: string
  burnReason?: string
  selectedUtxos: RgbUtxo[]
  history: ValidatedBfaTransferHistory
  feeRate: number
  feeFunding?: RgbFeeFunding
}): RgbPreparedTransfer {
  if (hex(input.history.genesis.slice(2, 34)) !== BFA_SCHEMA_ID)
    throw new RgbServiceError('Only BFA assets support this burn operation')
  if (normalizeRgbAssetId(input.history.assetId) !== normalizeRgbAssetId(input.assetId))
    throw new RgbServiceError('BFA burn history belongs to another asset')
  const amount = parseU64(input.amount, 'BFA burn amount')
  if (!amount) throw new RgbServiceError('BFA burn amount must be positive')
  const proved = new Map(input.history.allocations.map(item => [
    `${item.txid}:${item.vout}:${item.opId.toLowerCase()}:${item.assignmentIndex}`, item,
  ]))
  const allocations = input.selectedUtxos.flatMap(utxo => utxo.allocations.map(allocation => ({ utxo, allocation })))
  if (!allocations.length) throw new RgbServiceError('BFA burn requires validated allocations')
  for (const { utxo, allocation } of allocations) {
    if (normalizeRgbAssetId(allocation.assetId) !== normalizeRgbAssetId(input.assetId) ||
      allocation.assignmentType !== 4000 || !allocation.opId || allocation.assignmentIndex === undefined ||
      !allocation.settled || !allocation.spendable) throw new RgbServiceError('BFA burn includes an unsupported allocation')
    const proof = proved.get(`${utxo.outpoint.txid}:${utxo.outpoint.vout}:${allocation.opId.toLowerCase()}:${allocation.assignmentIndex}`)
    if (!proof || proof.amount !== allocation.amount ||
      (proof.scriptPubKey && proof.scriptPubKey.toLowerCase() !== utxo.scriptPubKey.toLowerCase()))
      throw new RgbServiceError('BFA burn allocation is absent from validated history')
  }
  const selectedAmount = allocations.reduce((total, item) => total + BigInt(item.allocation.amount), 0n)
  if (amount > selectedAmount) throw new RgbServiceError('BFA burn exceeds selected balance')
  const changeAmount = selectedAmount - amount
  const nonce = randomU64()
  const entropy = randomU64()
  const bitcoin = createRgbOpretPsbt({
    network: input.wallet.network, selectedUtxos: input.selectedUtxos,
    feeRate: input.feeRate, preserveFundingOutput: changeAmount > 0n,
    ...(input.feeFunding ? { feeFunding: input.feeFunding } : {}),
  })
  if (changeAmount && bitcoin.changeVout === undefined)
    throw new RgbServiceError('BFA burn change output is missing')
  const transition = encodeBfaBurnTransition({
    contractId: input.assetId, nonce,
    inputs: allocations.map(item => niaInputFromAllocation(item.allocation)),
    burnedAmount: amount,
    ...(changeAmount ? { change: {
      amount: changeAmount,
      seal: { txid: null, vout: bitcoin.changeVout!, blinding: randomU64() },
    } } : {}),
    burnReason: normalizeBfaBurnDestination(input.burnReason),
  })
  const parents = allocations.map(({ allocation }) => ({
    opId: allocation.opId!, assignmentType: 4000, assignmentIndex: allocation.assignmentIndex!,
  }))
  const bundleId = transitionBundleId(parents.map(parent => ({ ...parent, transitionId: transition.opId })))
  const committed = commitOpretRgbPsbt({
    psbtHex: bitcoin.psbtHex, hostVout: bitcoin.hostVout, entropy,
    messages: [{ protocolId: transition.strict.slice(2, 34), message: bundleId }],
    transitionId: transition.opId, transition: transition.strict,
  })
  const feeUtxos = new Map(input.feeFunding?.utxos.map(utxo => [`${utxo.outpoint.txid}:${utxo.outpoint.vout}`, utxo]) || [])
  return {
    id: hex(transition.opId), psbt: committed.psbtHex,
    toSignInputs: [
      ...input.selectedUtxos.map(utxo => ({
        index: findInputIndex(committed.psbtHex, utxo.outpoint.txid, utxo.outpoint.vout),
        publicKey: utxo.publicKey, useTweakedSigner: true,
      })),
      ...bitcoin.feeOutpoints.map(outpoint => {
        const fee = feeUtxos.get(`${outpoint.txid}:${outpoint.vout}`)
        if (!fee) throw new RgbServiceError('BFA burn fee input is missing')
        return { index: findInputIndex(committed.psbtHex, outpoint.txid, outpoint.vout), publicKey: fee.publicKey }
      }),
    ],
    lockedOutpoints: input.selectedUtxos.map(utxo => utxo.outpoint),
    feeOutpoints: bitcoin.feeOutpoints,
    metadata: {
      schema: 'BFA_BURN', preparedPsbt: committed.psbtHex,
      hostVout: String(bitcoin.hostVout), commitment: hex(committed.commitment),
      transitionId: hex(transition.opId), transition: hex(transition.strict),
      bundleId: hex(bundleId), entropy: entropy.toString(),
      genesis: Buffer.from(input.history.genesis).toString('base64'),
      historyWitnessBundles: JSON.stringify(input.history.witnessBundles.map(bundle => Buffer.from(bundle).toString('base64'))),
      fundingScript: input.selectedUtxos[0]!.scriptPubKey,
      fundingPublicKey: input.selectedUtxos[0]!.publicKey,
      changeVout: bitcoin.changeVout === undefined ? '' : String(bitcoin.changeVout),
      changeAmount: changeAmount.toString(), inputs: JSON.stringify(parents),
      burnReason: normalizeBfaBurnDestination(input.burnReason),
    },
  }
}

/** Finish the signed PSBT and encode the v1 BFA consignment on this device. */
export function completeBfaTransfer(input: {
  pending: RgbPendingTransfer
  signedPsbt: string
  allowIncomplete?: boolean
}): RgbCompletedTransfer {
  const data = input.pending.prepared.metadata
  if (data?.['schema'] !== 'BFA' && data?.['schema'] !== 'NIA_V1')
    throw new RgbServiceError('Pending transfer is not a supported RGB v1 asset')
  const hostVout = Number(data['hostVout'])
  if (!Number.isInteger(hostVout) || hostVout < 0)
    throw new RgbServiceError('BFA Opret host output is invalid')
  const completed = completeRgbOpretPsbt({
    preparedPsbt: data['preparedPsbt'] || '',
    signedPsbt: input.signedPsbt,
    hostVout,
    commitment: parseHex32(data['commitment'], 'BFA commitment'),
    allowIncomplete: input.allowIncomplete,
  })
  let parents: Array<{ opId: string; assignmentType: number; assignmentIndex: number }>
  let historyBundles: Uint8Array[]
  try {
    parents = JSON.parse(data['inputs'] || '')
    historyBundles = JSON.parse(data['historyWitnessBundles'] || '').map((value: string) =>
      Uint8Array.from(Buffer.from(value, 'base64'))
    )
  } catch {
    throw new RgbServiceError('BFA pending transfer has invalid local history')
  }
  if (!Array.isArray(parents) || !parents.length || !Array.isArray(historyBundles))
    throw new RgbServiceError('BFA pending transfer has incomplete local history')
  const witnessBundle = serializeBfaOpretWitnessBundle({
    witnessTx: Uint8Array.from(Buffer.from(completed.rawTx, 'hex')),
    contractId: input.pending.request.assetId,
    transitionId: parseHex32(data['transitionId'], 'BFA transition ID'),
    // The builder's final zero already encodes RGB v1's unsigned signature
    // option. Appending another zero would corrupt the following bundle data.
    transition: Uint8Array.from(Buffer.from(data['transition'] || '', 'hex')),
    inputs: parents,
    entropy: parseU64(data['entropy'], 'BFA MPC entropy'),
  })
  if (hex(witnessBundle.bundleId) !== data['bundleId'])
    throw new RgbServiceError('BFA WitnessBundle does not match the transition')
  if (data['recipientType'] !== 'blind' && data['recipientType'] !== 'witness')
    throw new RgbServiceError('BFA recipient type is invalid')
  const consignment = encodeBfaTransferConsignment({
    genesis: Uint8Array.from(Buffer.from(data['genesis'] || '', 'base64')),
    validatedWitnessBundles: historyBundles,
    witnessBundle: witnessBundle.strict,
  })
  const changeVout = data['changeVout'] === '' ? undefined : Number(data['changeVout'])
  if (changeVout !== undefined && (!Number.isInteger(changeVout) || changeVout < 0))
    throw new RgbServiceError('BFA change output is invalid')
  const tx = Transaction.fromHex(completed.rawTx)
  const change = changeVout === undefined ? undefined : tx.outs[changeVout]
  if (changeVout !== undefined && !change)
    throw new RgbServiceError('BFA change output is missing from the signed transaction')
  if (change && change.script.toString('hex') !== data['fundingScript'])
    throw new RgbServiceError('BFA change script does not match the funding address')
  return {
    txid: completed.txid,
    rawTx: completed.rawTx,
    consignments: [{
      recipientId: data['recipientId'] || '',
      payload: Buffer.from(consignment).toString('base64'),
      assetId: input.pending.request.assetId,
      opIds: [data['transitionId'] || ''],
    }],
    fundingUpdate: {
      spentOutpoints: input.pending.prepared.lockedOutpoints,
      ...(change && changeVout !== undefined ? { createdUtxo: {
        outpoint: { txid: completed.txid, vout: changeVout },
        satoshis: change.value,
        scriptPubKey: data['fundingScript'] || '',
        publicKey: data['fundingPublicKey'] || '',
        allocations: [{
          assetId: input.pending.request.assetId,
          amount: data['changeAmount'] || '',
          settled: true,
          spendable: true,
          opId: data['transitionId'],
          assignmentIndex: 1,
          assignmentType: 4000,
        }],
      } } : {}),
    },
  }
}

/** Complete the signed Bitcoin witness and retain a portable, terminal-free burn proof. */
export function completeBfaBurn(input: { pending: RgbPendingTransfer; signedPsbt: string }): RgbCompletedTransfer {
  const data = input.pending.prepared.metadata
  if (data?.['schema'] !== 'BFA_BURN') throw new RgbServiceError('Pending transfer is not a BFA burn')
  const hostVout = Number(data['hostVout'])
  if (!Number.isInteger(hostVout) || hostVout < 0) throw new RgbServiceError('BFA burn host output is invalid')
  const completed = completeRgbOpretPsbt({
    preparedPsbt: data['preparedPsbt'] || '', signedPsbt: input.signedPsbt,
    hostVout, commitment: parseHex32(data['commitment'], 'BFA burn commitment'),
  })
  let parents: Array<{ opId: string; assignmentType: number; assignmentIndex: number }>
  let historyBundles: Uint8Array[]
  try {
    parents = JSON.parse(data['inputs'] || '')
    historyBundles = JSON.parse(data['historyWitnessBundles'] || '').map((value: string) =>
      Uint8Array.from(Buffer.from(value, 'base64')))
  } catch { throw new RgbServiceError('BFA burn has invalid local history') }
  if (!Array.isArray(parents) || !parents.length || !Array.isArray(historyBundles))
    throw new RgbServiceError('BFA burn has incomplete local history')
  const witnessBundle = serializeBfaOpretWitnessBundle({
    witnessTx: Uint8Array.from(Buffer.from(completed.rawTx, 'hex')),
    contractId: input.pending.request.assetId,
    transitionId: parseHex32(data['transitionId'], 'BFA burn transition ID'),
    transition: Uint8Array.from(Buffer.from(data['transition'] || '', 'hex')),
    inputs: parents, entropy: parseU64(data['entropy'], 'BFA burn MPC entropy'),
  })
  if (hex(witnessBundle.bundleId) !== data['bundleId'])
    throw new RgbServiceError('BFA burn WitnessBundle does not match the transition')
  const consignment = encodeBfaTransferConsignment({
    genesis: Uint8Array.from(Buffer.from(data['genesis'] || '', 'base64')),
    validatedWitnessBundles: historyBundles,
    witnessBundle: witnessBundle.strict,
  })
  const changeVout = data['changeVout'] === '' ? undefined : Number(data['changeVout'])
  if (changeVout !== undefined && (!Number.isInteger(changeVout) || changeVout < 0))
    throw new RgbServiceError('BFA burn change output is invalid')
  const tx = Transaction.fromHex(completed.rawTx)
  const change = changeVout === undefined ? undefined : tx.outs[changeVout]
  if (changeVout !== undefined && !change) throw new RgbServiceError('BFA burn change output is missing')
  if (change && change.script.toString('hex') !== data['fundingScript'])
    throw new RgbServiceError('BFA burn change script does not match the funding address')
  return {
    txid: completed.txid, rawTx: completed.rawTx,
    consignments: [{
      recipientId: '', payload: Buffer.from(consignment).toString('base64'),
      assetId: input.pending.request.assetId, opIds: [data['transitionId'] || ''],
    }],
    fundingUpdate: {
      spentOutpoints: input.pending.prepared.lockedOutpoints,
      ...(change && changeVout !== undefined ? { createdUtxo: {
        outpoint: { txid: completed.txid, vout: changeVout }, satoshis: change.value,
        scriptPubKey: data['fundingScript'] || '', publicKey: data['fundingPublicKey'] || '',
        allocations: [{ assetId: input.pending.request.assetId,
          amount: data['changeAmount'] || '', settled: true, spendable: true,
          opId: data['transitionId'], assignmentIndex: 0, assignmentType: 4000,
        }],
      } } : {}),
    },
  }
}

/** Route ordinary RGB transfers by the version and schema of locally verified history. */
export function createLocalRgbProtocolEncoder(
  validateBfa: NonNullable<RgbServiceDependencies['validateBfaConsignment']>
): RgbProtocolEncoder {
  return {
    async prepareBurn(input) {
      const payloads = input.validationHistory.consignments.map(item =>
        Uint8Array.from(Buffer.from(item.payload, 'base64'))
      )
      const transfers = payloads.filter(isSupportedV1TransferConsignment)
      if (!transfers.length) {
        throw new RgbServiceError('BFA burn requires a validated v1 transfer history')
      }
      const knownBlindSeals = input.validationHistory.knownBlindSeals || []
      const pendingWitnessTxid = selectedPendingWitnessTxid(input.selectedUtxos)
      const evmRpcCache = new Map<string, Promise<unknown>>()
      const bitcoinStatusCache = new Map<string, Promise<boolean>>()
      const histories = await Promise.all(transfers.map(payload => validateBfa({
        wallet: input.wallet, payload, knownBlindSeals, evmRpcCache, bitcoinStatusCache,
        confirmedBitcoinWitnesses: input.validationHistory.confirmedBitcoinWitnesses,
        ...(pendingWitnessTxid ? { pendingWitnessTxid } : {}),
      })))
      const merged = mergeBfaValidatedHistories(histories)
      const history = await validateBfa({
        wallet: input.wallet, payload: merged, knownBlindSeals, evmRpcCache, bitcoinStatusCache,
        confirmedBitcoinWitnesses: input.validationHistory.confirmedBitcoinWitnesses,
        ...(pendingWitnessTxid ? { pendingWitnessTxid } : {}),
      })
      if (hex(history.genesis.slice(2, 34)) !== BFA_SCHEMA_ID)
        throw new RgbServiceError('Only BFA assets can be burned')
      const spendHistory = selectBfaSpendHistory(history, input.selectedUtxos.flatMap(utxo =>
        utxo.allocations.map(allocation => allocation.opId || '')
      ))
      return prepareBfaBurn({
        wallet: input.wallet, assetId: input.request.assetId, amount: input.request.amount,
        ...(input.request.burnReason ? { burnReason: input.request.burnReason } : {}),
        selectedUtxos: input.selectedUtxos, history: spendHistory,
        feeRate: input.request.feeRate,
        ...(input.feeFunding ? { feeFunding: input.feeFunding } : {}),
      })
    },
    async prepareTransfer(input) {
      const payloads = input.validationHistory.consignments.map(item =>
        Uint8Array.from(Buffer.from(item.payload, 'base64'))
      )
      const hasV1 = payloads.some(payload =>
        isSupportedV1TransferConsignment(payload) || isSupportedV1ContractConsignment(payload)
      )
      if (!hasV1) return localNiaProtocolEncoder.prepareTransfer(input)
      const compatiblePayloads = payloads.map(payload =>
        isSupportedV1TransferConsignment(payload) || isSupportedV1ContractConsignment(payload)
          ? payload
          : convertNiaV0ConsignmentToV1(payload)
      )
      const knownBlindSeals = input.validationHistory.knownBlindSeals || []
      const transferPayloads = compatiblePayloads.filter(isSupportedV1TransferConsignment)
      if (!transferPayloads.length) throw new RgbServiceError('RGB v1 history has no transfer')
      const requiredOperationIds = input.selectedUtxos.flatMap(utxo =>
        utxo.allocations.map(allocation => allocation.opId || '')
      )
      const singlePayload = transferPayloads.length === 1 ? transferPayloads[0] : undefined
      const confirmedBitcoinWitnesses = input.validationHistory.confirmedBitcoinWitnesses
      const pendingWitnessTxid = selectedPendingWitnessTxid(input.selectedUtxos)
      const cachedHistories = input.validationHistory.validatedV1SendHistories
      const network = input.wallet.network === 'mainnet' || input.wallet.network === 'fractal-mainnet' ||
        input.wallet.network === 'fractal-test' ? 0 : input.wallet.network === 'testnet' ? 1 :
          input.wallet.network === 'testnet4' ? 2 : 3
      let history = singlePayload && cachedHistories?.[input.intent.assetId]
        ? restoreValidatedBfaHistory(singlePayload, network, knownBlindSeals, cachedHistories[input.intent.assetId]!)
        : undefined
      if (!history) {
        const evmRpcCache = new Map<string, Promise<unknown>>()
        const bitcoinStatusCache = new Map<string, Promise<boolean>>()
        const checked = await Promise.all(transferPayloads.map(payload => validateBfa({
          wallet: input.wallet, payload, knownBlindSeals, evmRpcCache, bitcoinStatusCache, confirmedBitcoinWitnesses,
          requiredOperationIds,
          ...(pendingWitnessTxid ? { pendingWitnessTxid } : {}),
        })))
        const merged = mergeBfaValidatedHistories(checked)
        const validated = await validateBfa({
          wallet: input.wallet, payload: merged, knownBlindSeals, evmRpcCache, bitcoinStatusCache, confirmedBitcoinWitnesses,
          requiredOperationIds,
          ...(pendingWitnessTxid ? { pendingWitnessTxid } : {}),
        })
        history = validated
        // Only a fully verified, deeply confirmed local history can bypass
        // repeat RGB/EVM validation on a later send.
        const cacheSource = singlePayload ? checked[0] : undefined
        if (singlePayload && cacheSource && !cacheSource.hasDynamicRejectList && cachedHistories && confirmedBitcoinWitnesses &&
          cacheSource.bundles.every(bundle =>
            (confirmedBitcoinWitnesses[bundle.txid.toLowerCase()]?.confirmations || 0) >= 3)) {
          cachedHistories[input.intent.assetId] = cacheValidatedBfaHistory(
            singlePayload, knownBlindSeals, cacheSource
          )
        }
      }
      const spendHistory = selectBfaSpendHistory(history, requiredOperationIds)
      return prepareBfaTransfer({
        wallet: input.wallet, intent: input.intent, selectedUtxos: input.selectedUtxos,
        history: spendHistory, feeRate: input.request.feeRate,
        ...(input.feeFunding ? { feeFunding: input.feeFunding } : {}),
        ...(input.request.swapPsbt ? { swapPsbt: input.request.swapPsbt } : {}),
      })
    },
    async completeTransfer(input) {
      return input.pending.prepared.metadata?.['schema'] === 'BFA_BURN'
        ? completeBfaBurn(input)
        : ['BFA', 'NIA_V1'].includes(input.pending.prepared.metadata?.['schema'] || '')
          ? completeBfaTransfer(input)
          : localNiaProtocolEncoder.completeTransfer(input)
    },
  }
}
