import { sha256 } from '@noble/hashes/sha256'
import { RgbServiceError } from '../errors'
import { normalizeRgbAssetId, rgbContractIdHex } from './contract-id'
import {
  decodeNiaConsignment,
  revealNiaConsignmentBlindSeals,
  validateNiaConsignmentParentState,
  type DecodedNiaConsignment,
} from './nia-consignment'
import type { EncodedNiaGenesis } from './nia-genesis'
import type { RgbBlindSeal } from './receive'

function hex(value: Uint8Array): string {
  return Buffer.from(value).toString('hex')
}

function same(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function normalizeAssetId(value: string): string {
  try {
    return normalizeRgbAssetId(value)
  } catch {
    throw new RgbServiceError('RGB history asset ID is invalid')
  }
}

function parsePayload(value: string): DecodedNiaConsignment {
  try {
    const bytes = Uint8Array.from(Buffer.from(value, 'base64'))
    if (!bytes.length) throw new Error('empty')
    return decodeNiaConsignment(bytes)
  } catch (error) {
    if (error instanceof RgbServiceError) throw error
    throw new RgbServiceError('RGB history contains an invalid base64 Consignment')
  }
}

interface HistoryBundle {
  id: string
  strict: Uint8Array
  witnessBundle: DecodedNiaConsignment['witnessBundles'][number]
}

export interface MergedNiaHistory {
  assetId: string
  genesis: EncodedNiaGenesis
  /** WitnessBundles ordered so all external parent transitions precede their children. */
  witnessBundles: Uint8Array[]
  transitionIds: string[]
}

/**
 * Merge independently transported standard NIA consignments into the witness
 * history required for a subsequent local spend. All parent operations must
 * be present locally; incomplete or cyclic histories are rejected.
 */
export function mergeNiaConsignmentHistory(input: {
  assetId: string
  consignments: Array<{ opId: string; payload: string }>
  requiredOpIds: string[]
  knownBlindSeals?: RgbBlindSeal[]
}): MergedNiaHistory {
  const assetId = normalizeAssetId(input.assetId)
  if (!input.consignments.length) throw new RgbServiceError('RGB history has no Consignments')
  const decoded = input.consignments.map(item =>
    revealNiaConsignmentBlindSeals(parsePayload(item.payload), input.knownBlindSeals)
  )
  const [firstConsignment] = decoded
  if (!firstConsignment) throw new RgbServiceError('RGB history has no Consignments')
  if (decoded.some(consignment => consignment.assetId !== assetId)) {
    throw new RgbServiceError('RGB history Consignment asset does not match the selected asset')
  }
  const genesis = firstConsignment.genesis
  if (decoded.some(consignment => !same(consignment.genesis.strict, genesis.strict))) {
    throw new RgbServiceError('RGB history Consignments disagree on Genesis')
  }

  const transitions = new Map<string, DecodedNiaConsignment['transitions'][number]>()
  const bundles = new Map<string, HistoryBundle>()
  for (const consignment of decoded) {
    for (const witnessBundle of consignment.witnessBundles) {
      const id = hex(sha256(witnessBundle.strict))
      const existing = bundles.get(id)
      if (existing && !same(existing.strict, witnessBundle.strict))
        throw new RgbServiceError('RGB history has a conflicting WitnessBundle')
      if (!existing) {
        bundles.set(id, {
          id,
          strict: witnessBundle.strict,
          witnessBundle,
        })
      }
      for (const transition of witnessBundle.transitions) {
        const previous = transitions.get(transition.opId)
        if (previous && !same(previous.strict, transition.strict)) {
          throw new RgbServiceError('RGB history has conflicting Transition data')
        }
        transitions.set(transition.opId, transition)
      }
    }
  }

  validateNiaConsignmentParentState({
    ...firstConsignment,
    transitions: [...transitions.values()],
    witnessBundles: [...bundles.values()].map(bundle => bundle.witnessBundle),
  })

  const rootId = rgbContractIdHex(assetId)
  const required = input.requiredOpIds.map(value => value.replace(/^rgb:/, '').toLowerCase())
  if (required.some(value => !/^[0-9a-f]{64}$/.test(value)))
    throw new RgbServiceError('RGB history required operation ID is invalid')
  if (required.some(value => value !== rootId && !transitions.has(value))) {
    throw new RgbServiceError('RGB history is missing an allocation parent Transition')
  }

  const bundleForTransition = new Map<string, string>()
  for (const bundle of bundles.values()) {
    for (const transition of bundle.witnessBundle.transitions)
      bundleForTransition.set(transition.opId, bundle.id)
  }
  const dependencies = new Map<string, Set<string>>()
  for (const bundle of bundles.values()) {
    const parents = new Set<string>()
    for (const transition of bundle.witnessBundle.transitions) {
      for (const parent of transition.parentOpIds) {
        if (parent === rootId) continue
        const parentBundle = bundleForTransition.get(parent)
        if (!parentBundle) throw new RgbServiceError('RGB history is missing a parent Transition')
        if (parentBundle !== bundle.id) parents.add(parentBundle)
      }
    }
    dependencies.set(bundle.id, parents)
  }

  const ordered: HistoryBundle[] = []
  const pending = new Map([...bundles.keys()].map(id => [id, new Set(dependencies.get(id))]))
  while (pending.size) {
    const ready = [...pending.entries()]
      .filter(([, parents]) => parents.size === 0)
      .map(([id]) => id)
      .sort()
    if (!ready.length)
      throw new RgbServiceError('RGB history contains a cyclic WitnessBundle dependency')
    for (const id of ready) {
      pending.delete(id)
      const bundle = bundles.get(id)
      if (!bundle) throw new RgbServiceError('RGB history is missing a WitnessBundle')
      ordered.push(bundle)
      for (const parents of pending.values()) parents.delete(id)
    }
  }

  return {
    assetId,
    genesis,
    witnessBundles: ordered.map(bundle => bundle.strict),
    transitionIds: [...transitions.keys()].sort(),
  }
}
