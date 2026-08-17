import { RgbServiceError } from '../errors'
import type { RgbAllocation, RgbOutpoint, RgbUtxo } from '../types'

export interface RgbTransitionAllocation {
  outpoint: RgbOutpoint
  assetId: string
  amount: string
}

/**
 * Protocol-neutral transition plan. It is deliberately not serialized here:
 * strict RGB encoding must later turn each item into a schema-valid owned
 * state, seal and transition before `rgb_commit` is performed.
 */
export interface RgbFungibleTransitionPlan {
  assetId: string
  inputAmount: string
  recipientAmount: string
  changeAmount: string
  recipientId: string
  inputs: RgbTransitionAllocation[]
  preservedAllocations: RgbTransitionAllocation[]
}

function allocationToPlan(
  outpoint: RgbOutpoint,
  allocation: RgbAllocation
): RgbTransitionAllocation {
  return { outpoint, assetId: allocation.assetId, amount: allocation.amount }
}

/**
 * Plan the value conservation rules for a fungible RGB transfer. A colored
 * UTXO can contain multiple allocations; none are silently discarded.
 */
export function planFungibleTransition(input: {
  assetId: string
  amount: string
  recipientId: string
  selectedUtxos: RgbUtxo[]
}): RgbFungibleTransitionPlan {
  let requested: bigint
  try {
    requested = BigInt(input.amount)
  } catch {
    throw new RgbServiceError('RGB amount must be an unsigned integer')
  }
  if (requested <= 0n) throw new RgbServiceError('RGB amount must be positive')

  const inputs: RgbTransitionAllocation[] = []
  const preservedAllocations: RgbTransitionAllocation[] = []
  let total = 0n
  for (const utxo of input.selectedUtxos) {
    for (const allocation of utxo.allocations) {
      if (!allocation.settled || !allocation.spendable) {
        throw new RgbServiceError(
          `RGB allocation ${allocation.assetId} on ${utxo.outpoint.txid}:${utxo.outpoint.vout} is not spendable`
        )
      }
      if (allocation.assetId === input.assetId) {
        total += BigInt(allocation.amount)
        inputs.push(allocationToPlan(utxo.outpoint, allocation))
      } else {
        // Spending this UTXO also consumes its other RGB assignments. The
        // encoder must build preservation transitions for these allocations.
        preservedAllocations.push(allocationToPlan(utxo.outpoint, allocation))
      }
    }
  }
  if (total < requested) throw new RgbServiceError('Selected RGB UTXOs do not cover the transfer')

  return {
    assetId: input.assetId,
    inputAmount: total.toString(),
    recipientAmount: requested.toString(),
    changeAmount: (total - requested).toString(),
    recipientId: input.recipientId,
    inputs,
    preservedAllocations,
  }
}
