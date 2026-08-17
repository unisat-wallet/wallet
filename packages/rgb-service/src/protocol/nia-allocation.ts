import { RgbServiceError } from '../errors'
import type { RgbUtxo } from '../types'
import type { DecodedNiaConsignment } from './nia-consignment'
import { concealBlindSeal, type RgbBlindSeal } from './receive'

/**
 * Verify revealed NIA assignments against the exact Bitcoin witness output
 * they point to. Confidential assignments require a locally stored blind seal
 * and are intentionally not accepted by this revealed-output verifier.
 */
export function verifyRevealedNiaAllocations(input: {
  consignments: DecodedNiaConsignment[]
  utxos: RgbUtxo[]
  assetId: string
  /** Locally encrypted blind receive seals. These are never sent to the API. */
  knownBlindSeals?: RgbBlindSeal[]
}) {
  const assetId = input.assetId.replace(/^rgb:/, '').toLowerCase()
  const rootId = assetId
  const transitions = new Map<
    string,
    { assignment: any; txid: string; output?: { scriptPubKey: string } }
  >()
  for (const consignment of input.consignments) {
    if (consignment.assetId.replace(/^rgb:/, '') !== assetId)
      throw new RgbServiceError('RGB allocation history asset mismatch')
    for (const bundle of consignment.witnessBundles) {
      for (const transition of bundle.transitions) {
        transition.assignments.forEach((assignment, assignmentIndex) => {
          if ('secretSeal' in assignment.seal) {
            transitions.set(`${transition.opId}:${assignmentIndex}`, {
              assignment,
              txid: bundle.txid,
            })
            return
          }
          if (assignment.seal.txid !== null) return
          const output = bundle.outputs[assignment.seal.vout]
          if (output)
            transitions.set(`${transition.opId}:${assignmentIndex}`, {
              assignment,
              txid: bundle.txid,
              output,
            })
        })
      }
    }
  }
  for (const utxo of input.utxos) {
    for (const allocation of utxo.allocations) {
      if (
        allocation.assetId.replace(/^rgb:/, '') !== assetId ||
        !allocation.opId ||
        allocation.assignmentIndex === undefined
      )
        continue
      if (allocation.opId.replace(/^rgb:/, '').toLowerCase() === rootId) {
        const genesis = input.consignments.find(
          consignment => consignment.assetId.replace(/^rgb:/, '') === rootId
        )
        const expected = genesis?.genesisAllocations[allocation.assignmentIndex]
        if (
          !expected ||
          expected.txid.toLowerCase() !== utxo.outpoint.txid.toLowerCase() ||
          expected.vout !== utxo.outpoint.vout ||
          BigInt(allocation.amount) !== expected.amount
        ) {
          throw new RgbServiceError('RGB Genesis allocation does not match the indexed UTXO')
        }
        continue
      }
      const revealed = transitions.get(
        `${allocation.opId.replace(/^rgb:/, '')}:${allocation.assignmentIndex}`
      )
      if (!revealed)
        throw new RgbServiceError('RGB allocation parent Transition is missing from local history')
      if ('secretSeal' in revealed.assignment.seal) {
        const matchingSeal = (input.knownBlindSeals || []).find(
          seal =>
            Buffer.from(concealBlindSeal(seal)).toString('hex') ===
            revealed.assignment.seal.secretSeal
        )
        if (
          !matchingSeal ||
          matchingSeal.txid.toLowerCase() !== utxo.outpoint.txid.toLowerCase() ||
          matchingSeal.vout !== utxo.outpoint.vout ||
          BigInt(allocation.amount) !== revealed.assignment.amount
        ) {
          throw new RgbServiceError(
            'RGB confidential allocation does not match a local blind receive seal'
          )
        }
      } else if (
        !revealed.output ||
        utxo.outpoint.txid.toLowerCase() !== revealed.txid.toLowerCase() ||
        utxo.outpoint.vout !== revealed.assignment.seal.vout ||
        utxo.scriptPubKey.toLowerCase() !== revealed.output.scriptPubKey.toLowerCase() ||
        BigInt(allocation.amount) !== revealed.assignment.amount
      ) {
        throw new RgbServiceError(
          'RGB revealed allocation does not match its witness transaction output'
        )
      }
    }
  }
}
