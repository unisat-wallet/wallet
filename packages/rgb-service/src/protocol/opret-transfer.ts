import { Psbt } from 'bitcoinjs-lib'
import { RgbFundingOutputRequiredError, RgbServiceError } from '../errors'
import type { RgbFeeFunding, RgbNetwork, RgbUtxo } from '../types'
import { createRgbOpretPsbt } from './bitcoin'
import { transitionBundleId } from './bundle'
import { serializeOpretFascia } from './fascia'
import type { RgbInvoiceSeal } from './invoice'
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

  const bitcoin = createRgbOpretPsbt({
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
  }
}
