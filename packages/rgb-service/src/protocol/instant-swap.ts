import { schnorr } from '@noble/curves/secp256k1'
import { Psbt, Transaction } from 'bitcoinjs-lib'
import { RgbServiceError } from '../errors'
import { serializeBfaOpretWitnessBundle, serializeNiaOpretWitnessBundle } from './consignment'
import { encodeBfaTransferConsignment, isSupportedV1TransferConsignment } from './bfa-consignment'
import { normalizeRgbAssetId } from './contract-id'
import { encodeNiaTransferConsignment } from './nia-contract'
import { convertNiaV0ConsignmentToV1 } from './nia-v0-migration'

export interface RgbInstantSwapListingPackage {
  version: 1
  transferId: string
  assetId: string
  amount: string
  priceSats: string
  psbt: string
  consignment: string
  templateTxid: string
  sellerOutpoint: { txid: string; vout: number }
  sellerInputIndex: 1
  sellerPayoutVout: 1
  receiverVout: 2
  protocolState: string
}

type ProtocolState = {
  version: 1
  assetId: string
  amount: string
  transitionId: string
  transition: string
  bundleId: string
  entropy: string
  genesis: string
  historyWitnessBundles: string
  inputs: string
  recipientVout: 2
}

function parsePsbt(value: string) {
  try {
    return /^[0-9a-f]+$/i.test(value) ? Psbt.fromHex(value) : Psbt.fromBase64(value)
  } catch {
    throw new RgbServiceError('RGB Instant Swap PSBT is invalid')
  }
}

function unsignedTransaction(psbt: Psbt): Transaction {
  const transaction = (psbt.data.globalMap.unsignedTx as any).tx || psbt.data.globalMap.unsignedTx
  if (!transaction?.toBuffer || !transaction?.getId) {
    throw new RgbServiceError('RGB Instant Swap PSBT is missing its unsigned transaction')
  }
  return transaction
}

function bytes32(value: string, name: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new RgbServiceError(`${name} is invalid`)
  return Uint8Array.from(Buffer.from(value, 'hex'))
}

function protocolState(listing: RgbInstantSwapListingPackage): ProtocolState {
  try {
    const parsed = JSON.parse(Buffer.from(listing.protocolState, 'base64').toString('utf8'))
    if (
      parsed?.version !== 1 || parsed?.recipientVout !== 2 ||
      normalizeRgbAssetId(parsed.assetId) !== normalizeRgbAssetId(listing.assetId) ||
      parsed.amount !== listing.amount
    ) throw new Error('mismatch')
    bytes32(parsed.transitionId, 'RGB Instant transition ID')
    bytes32(parsed.bundleId, 'RGB Instant bundle ID')
    if (!/^[0-9a-f]+$/i.test(parsed.transition) || !parsed.transition.length) throw new Error('transition')
    BigInt(parsed.entropy)
    JSON.parse(parsed.inputs)
    JSON.parse(parsed.historyWitnessBundles)
    return parsed
  } catch (error) {
    if (error instanceof RgbServiceError) throw error
    throw new RgbServiceError('RGB Instant Swap protocol state is invalid')
  }
}

function buildConsignment(state: ProtocolState, transaction: Transaction, nativeV1: boolean) {
  const inputs = JSON.parse(state.inputs) as Array<{
    opId: string
    assignmentType: number
    assignmentIndex: number
  }>
  const bundleInput = {
    witnessTx: Uint8Array.from(transaction.toBuffer()),
    contractId: state.assetId,
    transitionId: bytes32(state.transitionId, 'RGB Instant transition ID'),
    transition: Uint8Array.from(Buffer.from(state.transition, 'hex')),
    inputs,
    entropy: BigInt(state.entropy),
  }
  const bundle = nativeV1
    ? serializeBfaOpretWitnessBundle(bundleInput)
    : serializeNiaOpretWitnessBundle(bundleInput)
  if (Buffer.from(bundle.bundleId).toString('hex') !== state.bundleId.toLowerCase()) {
    throw new RgbServiceError('RGB Instant Swap transition does not match its bundle')
  }
  const history = (JSON.parse(state.historyWitnessBundles) as string[])
    .map(item => Uint8Array.from(Buffer.from(item, 'base64')))
  if (nativeV1) {
    return Buffer.from(encodeBfaTransferConsignment({
      genesis: Uint8Array.from(Buffer.from(state.genesis, 'base64')),
      validatedWitnessBundles: history,
      witnessBundle: bundle.strict,
    })).toString('base64')
  }
  const legacy = encodeNiaTransferConsignment({
    genesis: { strict: Uint8Array.from(Buffer.from(state.genesis, 'base64')) },
    priorWitnessBundles: history,
    witnessBundle: bundle.strict,
    terminals: [],
  })
  return Buffer.from(convertNiaV0ConsignmentToV1(legacy)).toString('base64')
}

/** Validate the public seller authorization and bind RGB to the buyer's final transaction. */
export function completeInstantSwapTemplate(input: {
  listing: RgbInstantSwapListingPackage
  finalPsbt: string
  receiverScriptPubKey: string
}) {
  const { listing } = input
  if (listing.version !== 1 || listing.sellerInputIndex !== 1 || listing.sellerPayoutVout !== 1 || listing.receiverVout !== 2) {
    throw new RgbServiceError('RGB Instant Swap listing layout is unsupported')
  }
  if (!/^[1-9][0-9]*$/.test(listing.amount) || !/^[1-9][0-9]*$/.test(listing.priceSats)) {
    throw new RgbServiceError('RGB Instant Swap amount or price is invalid')
  }
  if (!/^(5120)[0-9a-f]{64}$/i.test(input.receiverScriptPubKey)) {
    throw new RgbServiceError('RGB Instant Swap receiver must be P2TR')
  }
  const template = parsePsbt(listing.psbt)
  const final = parsePsbt(input.finalPsbt)
  const templateTx = unsignedTransaction(template)
  const finalTx = unsignedTransaction(final)
  if (templateTx.getId() !== listing.templateTxid.toLowerCase()) {
    throw new RgbServiceError('RGB Instant Swap template transaction ID is invalid')
  }
  if (template.inputCount < 2 || template.txOutputs.length !== 3 || final.inputCount < 2 || final.txOutputs.length < 3) {
    throw new RgbServiceError('RGB Instant Swap transaction layout is invalid')
  }
  if (finalTx.locktime !== 0 || finalTx.ins.some(item => item.sequence !== 0xffff_ffff)) {
    throw new RgbServiceError('RGB Instant Swap must disable RBF and locktime')
  }
  const sellerTemplateInput = template.data.inputs[1]
  const sellerFinalInput = final.data.inputs[1]
  const sellerTxIn = finalTx.ins[1]
  const sighash = Transaction.SIGHASH_SINGLE | Transaction.SIGHASH_ANYONECANPAY
  if (
    !sellerTemplateInput?.witnessUtxo || !sellerTemplateInput.tapKeySig ||
    sellerTemplateInput.sighashType !== sighash || sellerTemplateInput.tapKeySig.length !== 65 ||
    sellerTemplateInput.tapKeySig[64] !== sighash || !sellerFinalInput?.witnessUtxo ||
    !sellerFinalInput.tapKeySig?.equals(sellerTemplateInput.tapKeySig) ||
    sellerFinalInput.sighashType !== sighash || !sellerTxIn
  ) throw new RgbServiceError('RGB Instant Swap seller authorization is missing or changed')
  const sellerTxid = Buffer.from(sellerTxIn.hash).reverse().toString('hex')
  if (sellerTxid !== listing.sellerOutpoint.txid.toLowerCase() || sellerTxIn.index !== listing.sellerOutpoint.vout) {
    throw new RgbServiceError('RGB Instant Swap seller outpoint was changed')
  }
  if (
    !sellerFinalInput.witnessUtxo.script.equals(sellerTemplateInput.witnessUtxo.script) ||
    sellerFinalInput.witnessUtxo.value !== sellerTemplateInput.witnessUtxo.value
  ) throw new RgbServiceError('RGB Instant Swap seller UTXO metadata was changed')
  if (finalTx.ins.some((item, index) => index !== 1 &&
      Buffer.from(item.hash).reverse().toString('hex') === sellerTxid &&
      item.index === listing.sellerOutpoint.vout)) {
    throw new RgbServiceError('RGB Instant Swap repeats the seller outpoint')
  }
  const placeholder = templateTx.ins[0]
  const buyerFirst = finalTx.ins[0]
  if (!placeholder || !buyerFirst ||
      (placeholder.hash.equals(buyerFirst.hash) && placeholder.index === buyerFirst.index)) {
    throw new RgbServiceError('RGB Instant Swap buyer did not replace the placeholder input')
  }
  for (const index of [0, 1]) {
    const expected = template.txOutputs[index]
    const actual = final.txOutputs[index]
    if (!expected || !actual || expected.value !== actual.value || !expected.script.equals(actual.script)) {
      throw new RgbServiceError(`RGB Instant Swap protected output ${index} was changed`)
    }
  }
  if (BigInt(final.txOutputs[1]!.value) !==
      BigInt(listing.priceSats) + BigInt(sellerFinalInput.witnessUtxo.value)) {
    throw new RgbServiceError('RGB Instant Swap seller payout does not match the listing price')
  }
  const receiver = final.txOutputs[2]
  if (!receiver || receiver.value < 330 || receiver.script.toString('hex') !== input.receiverScriptPubKey.toLowerCase()) {
    throw new RgbServiceError('RGB Instant Swap final receiver output is invalid')
  }
  if (final.txOutputs.slice(1).some(output => output.script[0] === 0x6a)) {
    throw new RgbServiceError('RGB Instant Swap contains an additional OP_RETURN')
  }
  const prevScripts = final.data.inputs.map(item => {
    if (!item.witnessUtxo) throw new RgbServiceError('RGB Instant Swap input is missing witness UTXO data')
    return item.witnessUtxo.script
  })
  const values = final.data.inputs.map(item => item.witnessUtxo!.value)
  const hash = finalTx.hashForWitnessV1(1, prevScripts, values, sighash)
  const outputKey = sellerFinalInput.witnessUtxo.script.subarray(2)
  if (!schnorr.verify(sellerFinalInput.tapKeySig.subarray(0, 64), hash, outputKey)) {
    throw new RgbServiceError('RGB Instant Swap seller signature is invalid')
  }
  const state = protocolState(listing)
  const listingPayload = Uint8Array.from(Buffer.from(listing.consignment, 'base64'))
  const nativeV1 = isSupportedV1TransferConsignment(listingPayload)
  if (buildConsignment(state, templateTx, nativeV1) !== listing.consignment) {
    throw new RgbServiceError('RGB Instant Swap template consignment does not match its proof')
  }
  const consignment = buildConsignment(state, finalTx, nativeV1)
  return {
    txid: finalTx.getId(),
    psbt: final.toHex(),
    consignment,
    assetId: normalizeRgbAssetId(listing.assetId),
    amount: listing.amount,
    receiverVout: 2 as const,
  }
}
