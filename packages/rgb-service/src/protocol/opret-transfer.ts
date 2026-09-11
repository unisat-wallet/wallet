import { Psbt } from 'bitcoinjs-lib'
import { RgbFundingOutputRequiredError, RgbServiceError } from '../errors'
import type { RgbFeeFunding, RgbNetwork, RgbOutpoint, RgbUtxo } from '../types'
import { createRgbOpretPsbt } from './bitcoin'
import { transitionBundleId } from './bundle'
import { serializeOpretFascia } from './fascia'
import type { RgbInvoiceSeal } from './invoice'
import { invoiceSealToScriptPubKey } from './witness'
import { encodeNiaTransition, niaInputFromAllocation, type NiaFungibleAssignment } from './nia'
import { commitOpretRgbPsbt } from './psbt-commit'

export interface NiaOpretTransferRequest {
  network: RgbNetwork
  assetId: string
  amount: string
  selectedUtxos: RgbUtxo[]
  recipientSeal: RgbInvoiceSeal
  feeRate: number
  witnessAmountSat?: number
  nonce: bigint
  entropy: bigint
  recipientBlinding: bigint
  changeBlinding: bigint
  feeFunding?: RgbFeeFunding
  /** Constrained external template used by an RGB/BTC atomic swap. */
  swapPsbt?: string
}

export interface PreparedNiaOpretTransfer {
  psbtHex: string
  hostVout: number
  recipientVout?: number
  changeVout?: number
  transitionId: Uint8Array
  transition: Uint8Array
  bundleId: Uint8Array
  commitment: Uint8Array
  fascia: Uint8Array
  fee: number
  feeInputCount: number
  feeOutpoints: RgbOutpoint[]
}

function hex(value: Uint8Array) {
  return [...value].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function parseAmount(value: string, name: string) {
  try {
    const amount = BigInt(value)
    if (amount <= 0n) throw new Error('not positive')
    return amount
  } catch {
    throw new RgbServiceError(`${name} must be a positive unsigned integer`)
  }
}

function assertBlinding(value: bigint, name: string) {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new RgbServiceError(`${name} must be a u64 value`)
  }
}

function parsePsbt(value: string) {
  try {
    return Psbt.fromHex(value)
  } catch {
    try {
      return Psbt.fromBase64(value)
    } catch {
      throw new RgbServiceError('RGB swap PSBT is invalid')
    }
  }
}

function outpointKey(txid: string, vout: number) {
  return `${txid}:${vout}`
}

/**
 * Validate the Bitcoin side of a swap before RGB commits to it. This does not
 * interpret maker business metadata: wallet-owned RGB inputs, the Opret host,
 * recipient seal and RGB change are all derived from local state instead.
 */
function prepareExternalSwapPsbt(input: NiaOpretTransferRequest, hasRgbChange: boolean) {
  const psbt = parsePsbt(input.swapPsbt || '')
  if (
    psbt.data.inputs.some(
      item =>
        item.partialSig?.length ||
        item.tapKeySig ||
        item.tapScriptSig?.length ||
        item.finalScriptSig ||
        item.finalScriptWitness
    )
  ) {
    throw new RgbServiceError('RGB swap PSBT must be unsigned when prepared')
  }
  if (psbt.data.inputs.some(item => item.sighashType !== undefined && item.sighashType !== 0 && item.sighashType !== 1)) {
    throw new RgbServiceError('RGB swap PSBT must use SIGHASH_ALL')
  }
  if (psbt.txOutputs.length === 0 || !psbt.txOutputs[0]!.script.equals(Buffer.from([0x6a]))) {
    throw new RgbServiceError('RGB swap PSBT must have an empty OP_RETURN at vout 0')
  }
  if (psbt.txOutputs.slice(1).some(output => output.script[0] === 0x6a)) {
    throw new RgbServiceError('RGB swap PSBT must not contain an additional OP_RETURN output')
  }
  const transaction = ((psbt.data.globalMap.unsignedTx as any).tx || psbt.data.globalMap.unsignedTx) as any
  if (transaction.locktime !== 0 || transaction.ins.some((txin: any) => txin.sequence !== 0xffff_ffff)) {
    throw new RgbServiceError('RGB swap PSBT must disable RBF and locktime')
  }
  const expectedInputs = new Set(
    input.selectedUtxos.map(utxo => outpointKey(utxo.outpoint.txid, utxo.outpoint.vout))
  )
  const actualInputs = new Set(
    transaction.ins.map((txin: any) => outpointKey(Buffer.from(txin.hash).reverse().toString('hex'), txin.index))
  )
  if (![...expectedInputs].every(key => actualInputs.has(key))) {
    throw new RgbServiceError('RGB swap PSBT does not contain every reserved RGB input')
  }
  for (const utxo of input.selectedUtxos) {
    const index = transaction.ins.findIndex((txin: any) =>
      outpointKey(Buffer.from(txin.hash).reverse().toString('hex'), txin.index) ===
      outpointKey(utxo.outpoint.txid, utxo.outpoint.vout)
    )
    const witnessUtxo = psbt.data.inputs[index]?.witnessUtxo
    if (!witnessUtxo || witnessUtxo.value !== utxo.satoshis || !witnessUtxo.script.equals(Buffer.from(utxo.scriptPubKey, 'hex'))) {
      throw new RgbServiceError('RGB swap PSBT reserved input does not match local UTXO data')
    }
  }
  const recipientScript = invoiceSealToScriptPubKey(input.recipientSeal)
  const recipientVout = recipientScript
    ? psbt.txOutputs.findIndex((output, index) =>
        index > 0 && output.script.equals(Buffer.from(recipientScript)) && output.value >= (input.witnessAmountSat || 0)
      )
    : undefined
  if (recipientScript && recipientVout === -1) {
    throw new RgbServiceError('RGB swap PSBT does not pay the witness recipient seal')
  }
  const fundingScript = Buffer.from(input.selectedUtxos[0]!.scriptPubKey, 'hex')
  const changeVout = hasRgbChange
    ? psbt.txOutputs.findIndex((output, index) => index > 0 && output.script.equals(fundingScript))
    : undefined
  if (hasRgbChange && changeVout === -1) {
    throw new RgbFundingOutputRequiredError()
  }
  return {
    psbtHex: psbt.toHex(),
    hostVout: 0,
    ...(recipientVout === undefined ? {} : { recipientVout }),
    ...(changeVout === undefined ? {} : { changeVout }),
    fee: 0,
    feeInputCount: 0,
    feeOutpoints: [],
  }
}

/**
 * Construct a complete unsigned NIA OpretFirst transfer locally. It is safe
 * to persist or hand to the signing layer, but its Fascia and consignment can
 * only be finalized against the returned, signed PSBT.
 */
export function prepareNiaOpretTransfer(input: NiaOpretTransferRequest): PreparedNiaOpretTransfer {
  const amount = parseAmount(input.amount, 'RGB transfer amount')
  assertBlinding(input.nonce, 'RGB transition nonce')
  assertBlinding(input.entropy, 'RGB MPC entropy')
  assertBlinding(input.recipientBlinding, 'RGB recipient blinding')
  assertBlinding(input.changeBlinding, 'RGB change blinding')

  const allocations = input.selectedUtxos.flatMap(utxo =>
    utxo.allocations.map(allocation => ({ utxo, allocation }))
  )
  if (!allocations.length) throw new RgbServiceError('RGB transfer has no indexed allocations')
  if (allocations.some(({ allocation }) => !allocation.settled || !allocation.spendable)) {
    throw new RgbServiceError('RGB transfer includes an allocation that is not spendable')
  }
  if (allocations.some(({ allocation }) => allocation.assetId !== input.assetId)) {
    throw new RgbServiceError(
      'Local NIA Opret transfer cannot consume allocations from another asset'
    )
  }
  const inputAmount = allocations.reduce(
    (total, { allocation }) => total + BigInt(allocation.amount),
    0n
  )
  if (inputAmount < amount)
    throw new RgbServiceError('RGB selected allocations do not cover the transfer amount')

  const bitcoin = input.swapPsbt
    ? prepareExternalSwapPsbt(input, inputAmount > amount)
    : createRgbOpretPsbt({
        network: input.network,
        selectedUtxos: input.selectedUtxos,
        recipientSeal: input.recipientSeal,
        feeRate: input.feeRate,
        preserveFundingOutput: inputAmount > amount,
        ...(input.feeFunding === undefined ? {} : { feeFunding: input.feeFunding }),
        ...(input.witnessAmountSat === undefined ? {} : { witnessAmountSat: input.witnessAmountSat }),
      })
  const recipientSeal: NiaFungibleAssignment['seal'] =
    input.recipientSeal.type === 'confidential'
      ? { secretSeal: hex(input.recipientSeal.secretSeal) }
      : { txid: null, vout: bitcoin.recipientVout!, blinding: input.recipientBlinding }
  const assignments: NiaFungibleAssignment[] = [{ amount, seal: recipientSeal }]
  if (inputAmount > amount) {
    if (bitcoin.changeVout === undefined) {
      throw new RgbFundingOutputRequiredError()
    }
    assignments.push({
      amount: inputAmount - amount,
      seal: { txid: null, vout: bitcoin.changeVout, blinding: input.changeBlinding },
    })
  }

  const transition = encodeNiaTransition({
    contractId: input.assetId,
    nonce: input.nonce,
    inputs: allocations.map(({ allocation }) => niaInputFromAllocation(allocation)),
    assignments,
  })
  const bundleId = transitionBundleId(
    allocations.map(({ allocation }) => {
      const parent = niaInputFromAllocation(allocation)
      return {
        opId: parent.opId,
        assignmentType: allocation.assignmentType ?? 4000,
        assignmentIndex: parent.assignmentIndex,
        transitionId: transition.opId,
      }
    })
  )
  const committed = commitOpretRgbPsbt({
    psbtHex: bitcoin.psbtHex,
    hostVout: bitcoin.hostVout,
    entropy: input.entropy,
    messages: [{ protocolId: transition.strict.slice(2, 34), message: bundleId }],
    transitionId: transition.opId,
    transition: transition.strict,
  })
  const committedPsbt = Psbt.fromHex(committed.psbtHex)
  const unsignedTransaction = ((committedPsbt.data.globalMap.unsignedTx as any).tx ||
    committedPsbt.data.globalMap.unsignedTx) as { toBuffer(): Buffer }
  const fascia = serializeOpretFascia({
    witnessTx: unsignedTransaction.toBuffer(),
    contractId: transition.strict.slice(2, 34),
    transitionId: transition.opId,
    transition: transition.strict,
    inputs: allocations.map(({ allocation }) => {
      const parent = niaInputFromAllocation(allocation)
      return {
        opId: Uint8Array.from(Buffer.from(parent.opId.replace(/^rgb:/, ''), 'hex')),
        assignmentType: allocation.assignmentType ?? 4000,
        assignmentIndex: parent.assignmentIndex,
      }
    }),
    mpcMessages: [{ protocolId: transition.strict.slice(2, 34), message: bundleId }],
    entropy: input.entropy,
  })

  return {
    psbtHex: committed.psbtHex,
    hostVout: bitcoin.hostVout,
    recipientVout: bitcoin.recipientVout,
    changeVout: bitcoin.changeVout,
    transitionId: transition.opId,
    transition: transition.strict,
    bundleId,
    commitment: committed.commitment,
    fascia,
    fee: bitcoin.fee,
    feeInputCount: bitcoin.feeInputCount,
    feeOutpoints: bitcoin.feeOutpoints,
  }
}
