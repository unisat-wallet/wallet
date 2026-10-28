import { sha256 } from '@noble/hashes/sha256'
import { Transaction } from 'bitcoinjs-lib'
import {
  RgbBfaValidationUnavailableError,
  RgbMissingAncestorError,
  RgbServiceError,
} from '../errors'
import { verifyBfaRejectList } from './bfa-reject-list'
import { transitionBundleId } from './bundle'
import { BFA_SCHEMA_ID, NIA_V1_SCHEMA_ID, encodeBfaTransferConsignment } from './bfa-consignment'
import { unwrapRgbTransferConsignment, wrapRgbTransferConsignment } from './consignment'
import { encodeRgbContractId, rgbContractIdHex } from './contract-id'
import { verifyMpcMerkleProof } from './mpc'
import { concealBlindSeal, type RgbBlindSeal } from './receive'
import { StrictReader, StrictWriter } from './strict'
import type { RgbContractMetadata } from '../types'
import type { ValidatedBfaTransferHistory } from './local-bfa-encoder'

const TAG_NODE = 'urn:ubideco:merkle:node#2024-01-31'
const TAG_STRICT = 'urn:ubideco:strict-types:value-hash#2024-02-10'
const TAG_SEAL = 'urn:lnp-bp:seals:secret#2024-02-03'
const TAG_OPERATION = 'urn:lnp-bp:rgb:operation#2024-02-03'
const FUNDS_IN_TOPIC = '0xf1a18caea297591892fc07ea412a5e617d8e51e1155912d8871793e1d4e70f87'
const VIRTUAL_LEAF = new Uint8Array(32).fill(0xff)
const OS_ASSET = 4000
const OS_MINT = 4013
const TS_MINT = 8013
const TS_BURN = 8010
const TS_TRANSFER = 10000

type Seal = { txid: string | null; vout: number; secret: string }
type Assignment = { type: number; index: number; seal: Seal | null; amount: bigint }
type Input = { opId: string; type: number; index: number }
type Operation = {
  id: string
  type: number
  inputs: Input[]
  assignments: Assignment[]
  amount: bigint
  afterBlock?: bigint
}
type Bundle = { strict: Uint8Array; txid: string; tx: Transaction; id: string; operations: Operation[] }
type SealPatch = { start: number; end: number; replacement: Uint8Array }

export interface ValidatedBfaConsignment extends ValidatedBfaTransferHistory {
  metadata: RgbContractMetadata
  hasDynamicRejectList: boolean
  witnessOutputScripts: string[]
  terminals: Array<{ bundleId: string; secretSeals: string[] }>
  terminalAssignments: Array<{
    opId: string; assignmentIndex: number; amount: string; bundleId: string
    txid: string; vout: number; secretSeal: string
    output?: { scriptPubKey: string; satoshis: number }
  }>
  bundles: Array<{ id: string; txid: string; strict: Uint8Array; operationIds: string[]; parentOpIds: string[] }>
}

/** Local-only validation summary; the canonical consignment remains the source of bundle bytes. */
export interface CachedValidatedBfaHistory {
  version: 1
  fingerprint: string
  assetId: string
  allocations: ValidatedBfaTransferHistory['allocations']
  bundles: Array<{ id: string; txid: string; operationIds: string[]; parentOpIds: string[] }>
}

export const BFA_VALIDATOR_VERSION = 'bfa-v1-2026-10-26'

export interface BfaValidationAttestationPayload {
  version: 1
  validatorVersion: typeof BFA_VALIDATOR_VERSION
  network: BfaValidationOptions['network']
  payloadHash: string
  assetId: string
  genesisHash: string
  hasDynamicRejectList: boolean
  bundles: Array<{ id: string; txid: string; operationIds: string[]; parentOpIds: string[] }>
  expiresAt: number
}

export interface SignedBfaValidationAttestation {
  payload: BfaValidationAttestationPayload
  publicKey: string
  signature: string
}

/** Stable byte representation used by both the API signer and wallet verifier. */
export function serializeBfaValidationAttestation(payload: BfaValidationAttestationPayload): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload))
}

export function createBfaValidationAttestationPayload(
  value: Uint8Array,
  network: BfaValidationOptions['network'],
  history: ValidatedBfaConsignment,
  expiresAt: number
): BfaValidationAttestationPayload {
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) fail('invalid validation attestation expiry')
  return {
    version: 1, validatorVersion: BFA_VALIDATOR_VERSION, network,
    payloadHash: hex(sha256(value)), assetId: history.assetId,
    genesisHash: hex(sha256(history.genesis)), hasDynamicRejectList: history.hasDynamicRejectList,
    bundles: history.bundles.map(({ id, txid, operationIds, parentOpIds }) =>
      ({ id, txid, operationIds, parentOpIds })),
    expiresAt,
  }
}

function validatedHistoryFingerprint(payload: Uint8Array, knownBlindSeals: RgbBlindSeal[]): string {
  const sealKeys = knownBlindSeals.map(seal =>
    `${seal.txid.toLowerCase()}:${seal.vout}:${seal.blinding.toString()}`
  ).sort()
  return hex(sha256(new TextEncoder().encode(`${hex(sha256(payload))}|${sealKeys.join('|')}`)))
}

export function cacheValidatedBfaHistory(
  payload: Uint8Array,
  knownBlindSeals: RgbBlindSeal[],
  history: ValidatedBfaConsignment
): CachedValidatedBfaHistory {
  return {
    version: 1,
    fingerprint: validatedHistoryFingerprint(payload, knownBlindSeals),
    assetId: history.assetId,
    allocations: history.allocations,
    bundles: history.bundles.map(({ id, txid, operationIds, parentOpIds }) =>
      ({ id, txid, operationIds, parentOpIds })),
  }
}

/** Parse the same bytes again, while reusing the prior chain and RGB-state validation. */
export function restoreValidatedBfaHistory(
  payload: Uint8Array,
  network: BfaValidationOptions['network'],
  knownBlindSeals: RgbBlindSeal[],
  cached: CachedValidatedBfaHistory
): (ValidatedBfaTransferHistory & { bundles: ValidatedBfaConsignment['bundles'] }) | undefined {
  if (cached?.version !== 1 ||
    cached.fingerprint !== validatedHistoryFingerprint(payload, knownBlindSeals) ||
    !Array.isArray(cached.bundles) || !Array.isArray(cached.allocations)) return undefined
  const disclosed = revealBfaConsignmentBlindSeals(payload, network, knownBlindSeals)
  const parsed = parseConsignment(disclosed, network)
  const assetId = encodeRgbContractId(bytes(parsed.genesis.id))
  if (assetId !== cached.assetId || parsed.bundles.length !== cached.bundles.length) return undefined
  const bundles = parsed.bundles.map((bundle, index) => {
    const saved = cached.bundles[index]
    if (!saved || saved.id !== bundle.id || saved.txid !== bundle.txid ||
      !Array.isArray(saved.operationIds) || !Array.isArray(saved.parentOpIds) ||
      saved.operationIds.join(',') !== bundle.operations.map(operation => operation.id).join(',') ||
      saved.parentOpIds.join(',') !== bundle.operations.flatMap(operation => operation.inputs.map(input => input.opId)).join(','))
      return undefined
    return { ...saved, strict: bundle.strict }
  })
  if (bundles.some(bundle => !bundle)) return undefined
  return {
    assetId, genesis: parsed.genesis.strict,
    witnessBundles: parsed.bundles.map(bundle => bundle.strict),
    allocations: cached.allocations,
    bundles: bundles as ValidatedBfaConsignment['bundles'],
  }
}

/** Carry only the ancestors of the allocations being spent to the next recipient. */
export function selectBfaSpendHistory(
  history: ValidatedBfaTransferHistory & { bundles: ValidatedBfaConsignment['bundles'] },
  selectedOpIds: string[]
): ValidatedBfaTransferHistory {
  if (history.bundles.length !== history.witnessBundles.length)
    fail('validated history bundle count mismatch')
  const byOperation = new Map<string, number>()
  history.bundles.forEach((bundle, index) => {
    for (const opId of bundle.operationIds) byOperation.set(opId.toLowerCase(), index)
  })
  const needed = new Set<number>()
  const visiting = new Set<number>()
  const rootId = rgbContractIdHex(history.assetId)
  const include = (opId: string): void => {
    if (opId.toLowerCase() === rootId) return
    const index = byOperation.get(opId.toLowerCase())
    if (index === undefined) throw new RgbMissingAncestorError()
    if (needed.has(index)) return
    if (visiting.has(index)) fail('cyclic witness history')
    visiting.add(index)
    for (const parent of history.bundles[index]!.parentOpIds) {
      if (byOperation.get(parent.toLowerCase()) !== index) include(parent)
    }
    visiting.delete(index)
    needed.add(index)
  }
  for (const opId of selectedOpIds) include(opId)
  return {
    assetId: history.assetId,
    genesis: history.genesis,
    witnessBundles: history.witnessBundles.filter((_, index) => needed.has(index)),
    allocations: history.allocations,
  }
}

export interface BfaValidationOptions {
  /** The selected Bitcoin network's chain-net byte (mainnet=0, testnet=1, testnet4=2, signet=3). */
  network: 0 | 1 | 2 | 3
  /** Trusted chain status provider. A failed or unconfirmed witness aborts validation. */
  isBitcoinTxConfirmed: (txid: string) => Promise<boolean>
  /** JSON-RPC transport for the configured EVM chain. */
  evmRpc?: (method: string, params: unknown[]) => Promise<unknown>
  getEvmRpc?: (chainId: bigint) => (method: string, params: unknown[]) => Promise<unknown>
  /** Bound the number of finalized EVM blocks scanned per RPC call. */
  evmLogRange?: number
  /** The sender witness is not broadcast until the receiver ACKs it. */
  pendingWitnessTxid?: string
  allowPendingLastWitness?: boolean
  /** Check Bitcoin confirmation only for witness branches needed by these operations. */
  requiredOperationIds?: string[]
  /** Locally known blind seals used to disclose spendable ancestors. */
  knownBlindSeals?: RgbBlindSeal[]
}

export type BfaHttpTransport = (url: string, init: {
  method: 'POST'
  headers: { 'content-type': string }
  body: string
}) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

/** Build the JSON-RPC transport from a URL selected in wallet-shared common.ts. */
export function createBfaEvmRpc(url: string, transport: BfaHttpTransport): NonNullable<BfaValidationOptions['evmRpc']> {
  if (!/^https?:\/\//i.test(url)) throw new RgbBfaValidationUnavailableError('BFA EVM RPC URL must use HTTP or HTTPS')
  let id = 0
  return async (method, params) => {
    try {
      const response = await transport(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = await response.json() as { result?: unknown; error?: { message?: string } }
      if (body.error) throw new Error(body.error.message || 'unknown RPC error')
      if (body.result === undefined || body.result === null) throw new Error('empty RPC result')
      return body.result
    } catch (error) {
      throw new RgbBfaValidationUnavailableError(`BFA EVM RPC ${method}: ${String(error)}`)
    }
  }
}

/** Deduplicate identical EVM reads while one wallet operation validates its histories. */
export function cacheBfaEvmRpc(
  rpc: NonNullable<BfaValidationOptions['evmRpc']>,
  cache: Map<string, Promise<unknown>>,
  url: string
): NonNullable<BfaValidationOptions['evmRpc']> {
  return (method, params) => {
    const key = JSON.stringify([url, method, params])
    const existing = cache.get(key)
    if (existing) return existing
    const request = Promise.resolve().then(() => rpc(method, params))
    cache.set(key, request)
    void request.catch(() => {
      if (cache.get(key) === request) cache.delete(key)
    })
    return request
  }
}

/** A witness is checked once per operation even when multiple histories contain it. */
export function cacheBfaBitcoinStatus(
  isConfirmed: BfaValidationOptions['isBitcoinTxConfirmed'],
  cache: Map<string, Promise<boolean>>
): BfaValidationOptions['isBitcoinTxConfirmed'] {
  return txid => {
    const key = txid.toLowerCase()
    const existing = cache.get(key)
    if (existing) return existing
    const request = Promise.resolve().then(() => isConfirmed(txid))
    cache.set(key, request)
    void request.catch(() => {
      if (cache.get(key) === request) cache.delete(key)
    })
    return request
  }
}

const MIN_CACHED_WITNESS_CONFIRMATIONS = 3
const MAX_CACHED_WITNESSES = 4096

/** Remove malformed entries and bound encrypted local state, including on wallet open. */
export function pruneConfirmedBfaWitnesses(
  observations: Record<string, { checkedAt: number; confirmations: number }>
): void {
  for (const [txid, entry] of Object.entries(observations)) {
    if (!/^[0-9a-f]{64}$/.test(txid) || !entry ||
      !Number.isSafeInteger(entry.checkedAt) || !Number.isSafeInteger(entry.confirmations) ||
      entry.checkedAt < 0 || entry.confirmations < MIN_CACHED_WITNESS_CONFIRMATIONS)
      delete observations[txid]
  }
  const entries = Object.entries(observations)
  if (entries.length > MAX_CACHED_WITNESSES) {
    for (const [txid] of entries.sort((a, b) => a[1].checkedAt - b[1].checkedAt)
      .slice(0, entries.length - MAX_CACHED_WITNESSES)) delete observations[txid]
  }
}

/** Treat three-confirmation witnesses as final. A missing/replaced witness is never cached. */
export function cacheConfirmedBfaWitnesses(
  getStatus: (txid: string) => Promise<{ status: string; confirmations: number }>,
  observations: Record<string, { checkedAt: number; confirmations: number }>,
  now: () => number = Date.now
): BfaValidationOptions['isBitcoinTxConfirmed'] {
  pruneConfirmedBfaWitnesses(observations)
  return async txid => {
    const key = txid.toLowerCase()
    const current = now()
    const cached = Object.prototype.hasOwnProperty.call(observations, key) ? observations[key] : undefined
    if (cached && Number.isSafeInteger(cached.checkedAt) && cached.checkedAt >= 0 &&
      Number.isSafeInteger(cached.confirmations) && cached.confirmations >= MIN_CACHED_WITNESS_CONFIRMATIONS)
      return true
    const status = await getStatus(txid)
    if (status.status === 'confirmed' && Number.isSafeInteger(status.confirmations) &&
      status.confirmations >= MIN_CACHED_WITNESS_CONFIRMATIONS) {
      observations[key] = { checkedAt: current, confirmations: status.confirmations }
      if (Object.keys(observations).length > MAX_CACHED_WITNESSES) {
        const oldest = Object.entries(observations)
          .sort((a, b) => a[1].checkedAt - b[1].checkedAt)
          .slice(0, Object.keys(observations).length - MAX_CACHED_WITNESSES)
        for (const [oldKey] of oldest) delete observations[oldKey]
      }
    } else delete observations[key]
    return status.status === 'confirmed'
  }
}

function fail(message: string): never { throw new RgbServiceError(`RGB v1: ${message}`) }
function hex(bytes: Uint8Array): string { return Buffer.from(bytes).toString('hex') }
function bytes(value: string): Uint8Array { return Uint8Array.from(Buffer.from(value, 'hex')) }
function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) { result.set(part, offset); offset += part.length }
  return result
}
function hash(tag: string, data: Uint8Array): Uint8Array {
  const prefix = sha256(new TextEncoder().encode(tag))
  return sha256(concat(prefix, prefix, data))
}
function u256(value: number): Uint8Array {
  const result = new Uint8Array(32)
  let remaining = BigInt(value)
  for (let index = 0; index < 32; index++) { result[index] = Number(remaining & 255n); remaining >>= 8n }
  return result
}
function merkle(leaves: Uint8Array[], depth = 0, width = leaves.length): Uint8Array {
  const node = (branch: number, left: Uint8Array, right: Uint8Array) =>
    hash(TAG_NODE, concat(Uint8Array.from([branch, depth]), u256(width), left, right))
  if (!leaves.length) return node(0, VIRTUAL_LEAF, VIRTUAL_LEAF)
  if (leaves.length === 1) return depth === 0 ? leaves[0]! : node(1, leaves[0]!, VIRTUAL_LEAF)
  if (leaves.length === 2) return node(2, leaves[0]!, leaves[1]!)
  const split = Math.ceil(leaves.length / 2)
  return node(2, merkle(leaves.slice(0, split), depth + 1, width), merkle(leaves.slice(split), depth + 1, width))
}
function sealed(reader: StrictReader, genesis: boolean, known: Map<string, RgbBlindSeal>, patches: SealPatch[]): Seal | null {
  const sealStart = reader.position
  const kind = reader.readU8()
  if (kind === 1) {
    const secret = hex(reader.readFixedBytes(32))
    const revealed = known.get(secret)
    if (revealed) {
      const writer = new StrictWriter().writeU8(0)
      if (!genesis) writer.writeU8(1)
      writer.writeFixedBytes(bytes(revealed.txid).reverse(), 32).writeU32(revealed.vout).writeU64(revealed.blinding)
      patches.push({ start: sealStart, end: reader.position, replacement: writer.toBytes() })
    }
    return { txid: null, vout: -1, secret }
  }
  if (kind !== 0) fail('invalid assignment seal')
  const revealedStart = reader.position
  let txid: string | null
  if (genesis) txid = hex(reader.readFixedBytes(32).reverse())
  else {
    const pointer = reader.readU8()
    if (pointer !== 0 && pointer !== 1) fail('invalid graph seal transaction pointer')
    txid = pointer === 1 ? hex(reader.readFixedBytes(32).reverse()) : null
  }
  const vout = reader.readU32()
  reader.readU64()
  return { txid, vout, secret: hex(hash(TAG_SEAL, reader.slice(revealedStart))) }
}
function readAssignments(reader: StrictReader, genesis: boolean, known: Map<string, RgbBlindSeal>, patches: SealPatch[], schema = BFA_SCHEMA_ID): Assignment[] {
  const count = reader.readU16()
  const result: Assignment[] = []
  let previous = -1
  for (let group = 0; group < count; group++) {
    const type = reader.readU16()
    if (type <= previous || (type !== OS_ASSET && type !== OS_MINT)) fail('unsupported or unordered assignment type')
    if (genesis && type !== (schema === NIA_V1_SCHEMA_ID ? OS_ASSET : OS_MINT))
      fail('Genesis contains an unsupported assignment')
    previous = type
    const stateType = reader.readU8()
    if (stateType !== (type === OS_ASSET ? 1 : 0)) fail('invalid assignment state type')
    const size = reader.readU16()
    if (!size) fail('empty assignment group')
    for (let index = 0; index < size; index++) {
      const seal = sealed(reader, genesis, known, patches)
      let amount = 0n
      if (type === OS_ASSET) {
        if (reader.readU8() !== 8) fail('unsupported fungible state')
        amount = reader.readU64()
      }
      result.push({ type, index, seal, amount })
    }
  }
  return result
}
function assignmentsRoot(assignments: Assignment[]): Uint8Array {
  return merkle(assignments.map(item => hash(TAG_NODE, concat(
    new StrictWriter().writeU16(item.type).toBytes(),
    item.type === OS_ASSET ? new StrictWriter().writeU8(8).writeU64(item.amount).toBytes() : new Uint8Array(),
    bytes(item.seal!.secret)
  ))))
}
function readGlobals(reader: StrictReader): { root: Uint8Array; states: Map<number, Uint8Array[]> } {
  const groups = reader.readU8()
  const leaves: Uint8Array[] = []
  const states = new Map<number, Uint8Array[]>()
  let previous = -1
  for (let index = 0; index < groups; index++) {
    const type = reader.readU16()
    if (type <= previous) fail('unordered or duplicate global type')
    previous = type
    const count = reader.readU16()
    if (!count) fail('empty global state')
    const values = []
    for (let item = 0; item < count; item++) {
      const raw = reader.readConfinedBytes(65535)
      values.push(raw)
      leaves.push(hash(TAG_NODE, new StrictWriter().writeU16(type).writeConfinedBytes(raw, 65535).toBytes()))
    }
    states.set(type, values)
  }
  return { root: merkle(leaves), states }
}
function readMetadata(reader: StrictReader): { hash: Uint8Array; values: Map<number, Uint8Array> } {
  const start = reader.position
  const count = reader.readU8()
  const values = new Map<number, Uint8Array>()
  let previous = -1
  for (let index = 0; index < count; index++) {
    const type = reader.readU16()
    if (type <= previous) fail('unordered or duplicate metadata type')
    previous = type
    values.set(type, reader.readConfinedBytes(65535))
  }
  return { hash: hash(TAG_STRICT, reader.slice(start)), values }
}
function operationId(input: { nonce: bigint; kind: Uint8Array; metadata: Uint8Array; globals: Uint8Array; inputs: Uint8Array; assignments: Uint8Array }): string {
  const commitment = concat(
    new StrictWriter().writeU16(0).writeU64(input.nonce).toBytes(),
    input.kind, input.metadata, input.globals, input.inputs, input.assignments
  )
  return hex(hash(TAG_OPERATION, commitment))
}
function readGenesis(reader: StrictReader, network: number, known: Map<string, RgbBlindSeal>, patches: SealPatch[]) {
  const start = reader.position
  if (reader.readU16() !== 0) fail('unsupported Genesis version')
  const schemaId = hex(reader.readFixedBytes(32))
  if (schemaId !== BFA_SCHEMA_ID && schemaId !== NIA_V1_SCHEMA_ID) fail('unsupported Genesis schema')
  const schema = bytes(schemaId)
  const nia = schemaId === NIA_V1_SCHEMA_ID
  const timestamp = reader.readU64()
  const issuerStart = reader.position
  const issuer = new TextDecoder().decode(reader.readConfinedBytes(4096))
  if (issuer !== 'ssi:anonymous') fail('unsupported issuer')
  const issuerHash = hash(TAG_STRICT, reader.slice(issuerStart))
  const chainNet = reader.readU8()
  if (chainNet !== network) fail('Genesis Bitcoin network does not match the wallet')
  if (reader.readU8() !== 0) fail('unsupported seal closing strategy')
  const metadata = readMetadata(reader)
  if (metadata.values.size) fail('unsupported Genesis metadata')
  const globals = readGlobals(reader)
  if ([...globals.states.keys()].some(type => type !== 2000 && type !== 2001 && type !== (nia ? 2010 : 3008) && (nia || type !== 3010)) ||
    globals.states.get(2000)?.length !== 1 || globals.states.get(2001)?.length !== 1)
    fail(`unsupported Genesis global state or external link rule (${[...globals.states.keys()].join(', ')})`)
  let chainId = 0n
  let address = ''
  let rejectListAddress: string | undefined
  let issuedSupply = 0n
  if (nia) {
    const supply = globals.states.get(2010)
    if (!supply || supply.length !== 1 || supply[0]!.length !== 8) fail('invalid NIA issued supply')
    issuedSupply = new StrictReader(supply[0]!).readU64()
    if (!issuedSupply) fail('NIA issued supply is zero')
  } else {
    const location = globals.states.get(3008)
    if (!location || location.length !== 1 || location[0]!.length !== 29 || location[0]![0] !== 0)
      fail('invalid EVM bridge location')
    const bridge = new StrictReader(location[0]!)
    bridge.readU8()
    chainId = bridge.readU64()
    address = `0x${hex(bridge.readFixedBytes(20))}`
    const rejectList = globals.states.get(3010)
    if (rejectList) {
      if (rejectList.length !== 1 || rejectList[0]!.length !== 29 || rejectList[0]![0] !== 1)
        fail('unsupported BFA reject list location')
      const location = new StrictReader(rejectList[0]!)
      location.readU8()
      if (location.readU64() !== chainId) fail('BFA reject list is on another EVM chain')
      rejectListAddress = `0x${hex(location.readFixedBytes(20))}`
    }
  }
  const spec = new StrictReader(globals.states.get(2000)![0]!)
  const ticker = new TextDecoder('utf-8', { fatal: true }).decode(spec.readConfinedBytes(8))
  const name = new TextDecoder('utf-8', { fatal: true }).decode(spec.readConfinedBytes(40))
  if (spec.readU8() !== 0) fail('asset details profile is unsupported')
  const precision = spec.readU8()
  if (!ticker || !name || precision > 18 || spec.remaining) fail('invalid asset specification')
  const assignments = readAssignments(reader, true, known, patches, schemaId)
  if (!assignments.length) fail('Genesis has no assignments')
  if (nia && assignments.reduce((sum, item) => sum + item.amount, 0n) !== issuedSupply)
    fail('NIA Genesis allocations do not match issued supply')
  const kind = concat(Uint8Array.from([0]), schema, new StrictWriter().writeU64(timestamp).toBytes(), issuerHash, Uint8Array.from([chainNet, 0]))
  const id = operationId({
    nonce: 0xffff_ffff_ffff_ffffn, kind, metadata: metadata.hash,
    globals: globals.root, inputs: merkle([]), assignments: assignmentsRoot(assignments),
  })
  const contractMetadata: RgbContractMetadata = {
    ticker, name, precision, schema: nia ? 'NIA' : 'BFA', issuedSupply: issuedSupply.toString(), timestamp: Number(timestamp),
  }
  return { id, strict: reader.slice(start), assignments, chainId, address, rejectListAddress, metadata: contractMetadata }
}
function readTransition(reader: StrictReader, contractId: string, known: Map<string, RgbBlindSeal>, patches: SealPatch[], nia: boolean): Operation {
  if (reader.readU16() !== 0 || hex(reader.readFixedBytes(32)) !== contractId) fail('transition contract mismatch')
  const nonce = reader.readU64()
  const type = reader.readU16()
  if (type !== TS_TRANSFER && (nia || (type !== TS_MINT && type !== TS_BURN))) fail('unsupported transition type')
  const metadata = readMetadata(reader)
  const globals = readGlobals(reader)
  const afterRaw = metadata.values.get(1003)
  let afterBlock: bigint | undefined
  let amount = 0n
  if (type === TS_MINT) {
    const supply = globals.states.get(2010)
    if (metadata.values.size !== 1 || !afterRaw || afterRaw.length !== 8 || globals.states.size !== 1 || !supply || supply.length !== 1 || supply[0]!.length !== 8)
      fail('invalid mint metadata or issued supply')
    afterBlock = new StrictReader(afterRaw).readU64()
    amount = new StrictReader(supply[0]!).readU64()
    if (!amount) fail('zero-value mint')
  } else if (type === TS_BURN) {
    const burned = globals.states.get(2015)
    const reason = globals.states.get(3009)
    if (metadata.values.size || !burned || burned.length !== 1 || burned[0]!.length !== 8 ||
      (reason && (reason.length !== 1 || reason[0]!.length !== 32)) ||
      globals.states.size !== (reason ? 2 : 1)) fail('invalid BFA burn global state')
    amount = new StrictReader(burned[0]!).readU64()
    if (!amount) fail('zero-value BFA burn')
  } else if (metadata.values.size || globals.states.size) fail('transfer has unsupported metadata or global state')
  const inputCount = reader.readU16()
  if (!inputCount) fail('transition has no inputs')
  const inputs: Input[] = []
  const inputLeaves: Uint8Array[] = []
  let previous = ''
  for (let index = 0; index < inputCount; index++) {
    const raw = reader.readFixedBytes(36)
    const encoded = hex(raw)
    if (previous && encoded <= previous) fail('unordered or duplicate transition input')
    previous = encoded
    const input = new StrictReader(raw)
    inputs.push({ opId: hex(input.readFixedBytes(32)), type: input.readU16(), index: input.readU16() })
    inputLeaves.push(hash(TAG_NODE, raw))
  }
  const assignments = readAssignments(reader, false, known, patches)
  if (reader.readU8() !== 0) fail('signed transition profile is unsupported')
  const id = operationId({
    nonce, kind: concat(Uint8Array.from([1]), bytes(contractId), new StrictWriter().writeU16(type).toBytes()),
    metadata: metadata.hash, globals: globals.root, inputs: merkle(inputLeaves), assignments: assignmentsRoot(assignments),
  })
  return { id, type, inputs, assignments, amount, ...(afterBlock === undefined ? {} : { afterBlock }) }
}
function readBitcoinTx(reader: StrictReader): Transaction {
  const tx = new Transaction()
  const version = reader.readU32()
  tx.version = version > 0x7fff_ffff ? version - 0x1_0000_0000 : version
  const inputs = reader.readU32()
  if (!inputs || inputs > 100000) fail('invalid Bitcoin witness input count')
  for (let index = 0; index < inputs; index++) {
    const hash = reader.readFixedBytes(32)
    const vout = reader.readU32()
    const script = reader.readConfinedBytes(0xffff_ffff)
    const sequence = reader.readU32()
    const stack = reader.readU32()
    if (stack > 100000) fail('invalid Bitcoin witness stack')
    const witness = Array.from({ length: stack }, () => Buffer.from(reader.readConfinedBytes(0xffff_ffff)))
    tx.addInput(Buffer.from(hash), vout, sequence, Buffer.from(script))
    tx.setWitness(index, witness)
  }
  const outputs = reader.readU32()
  if (!outputs || outputs > 100000) fail('invalid Bitcoin witness output count')
  for (let index = 0; index < outputs; index++) {
    const value = reader.readU64()
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail('unsafe Bitcoin output value')
    tx.addOutput(Buffer.from(reader.readConfinedBytes(0xffff_ffff)), Number(value))
  }
  tx.locktime = reader.readU32()
  return tx
}
function readBundle(reader: StrictReader, contractId: string, known: Map<string, RgbBlindSeal>, patches: SealPatch[], nia: boolean): Bundle {
  const start = reader.position
  const tx = readBitcoinTx(reader)
  const spvProof = reader.readU8()
  if (spvProof === 1) {
    // The chain status provider verifies the witness against the active chain;
    // the optional sender proof is parsed for framing, never trusted alone.
    reader.readU32() // block height
    reader.readU32() // transaction position
    const siblings = reader.readU8()
    if (siblings > 32) fail('SPV proof has too many siblings')
    reader.readFixedBytes(siblings * 32)
  } else if (spvProof !== 0) fail('SPV proof option is invalid')
  const proofStart = reader.position
  reader.readU32()
  reader.readU16()
  reader.readFixedBytes(reader.readU8() * 32)
  const proof = reader.slice(proofStart)
  if (reader.readU8() !== 2) fail('non-OP_RETURN DBC proof is unsupported')
  const count = reader.readU16()
  if (!count) fail('empty witness bundle')
  const bundleInputs: Array<{ opId: string; assignmentType: number; assignmentIndex: number; transitionId: Uint8Array }> = []
  for (let index = 0; index < count; index++) bundleInputs.push({
    opId: hex(reader.readFixedBytes(32)), assignmentType: reader.readU16(), assignmentIndex: reader.readU16(), transitionId: reader.readFixedBytes(32),
  })
  const transitionCount = reader.readU16()
  if (!transitionCount) fail('witness bundle has no disclosed transitions')
  const operations: Operation[] = []
  for (let index = 0; index < transitionCount; index++) {
    const claimedId = hex(reader.readFixedBytes(32))
    const operation = readTransition(reader, contractId, known, patches, nia)
    if (operation.id !== claimedId) fail('transition operation ID mismatch')
    operations.push(operation)
  }
  for (const operation of operations) {
    for (const input of operation.inputs) {
      if (!bundleInputs.some(item => item.opId === input.opId && item.assignmentType === input.type && item.assignmentIndex === input.index && hex(item.transitionId) === operation.id))
        fail('bundle input map omits a transition input')
    }
  }
  if (bundleInputs.length !== operations.reduce((sum, operation) => sum + operation.inputs.length, 0))
    fail('bundle input map contains an extra entry')
  const id = hex(transitionBundleId(bundleInputs))
  const commitment = verifyMpcMerkleProof({ protocolId: bytes(contractId), message: bytes(id), proof })
  if (!tx.outs[0]?.script.equals(Buffer.from([0x6a, 0x20, ...commitment]))) fail('witness OP_RETURN commitment mismatch')
  return { strict: reader.slice(start), txid: tx.getId(), tx, id, operations }
}
function parseConsignment(value: Uint8Array, network: number, known = new Map<string, RgbBlindSeal>()) {
  const body = unwrapRgbTransferConsignment(value)
  const reader = new StrictReader(body)
  const patches: SealPatch[] = []
  if (reader.readU8() !== 1 || reader.readU8() !== 1) fail('expected a v1 transfer consignment')
  const terminalCount = reader.readU16()
  const terminals: Array<{ bundleId: string; secrets: string[] }> = []
  for (let index = 0; index < terminalCount; index++) {
    const bundleId = hex(reader.readFixedBytes(32))
    const count = reader.readU16()
    if (!count) fail('empty terminal')
    const secrets = []
    for (let seal = 0; seal < count; seal++) {
      const terminalSeal = sealed(reader, false, new Map(), [])
      if (!terminalSeal) fail('invalid terminal seal')
      secrets.push(terminalSeal.secret)
    }
    terminals.push({ bundleId, secrets })
  }
  const genesis = readGenesis(reader, network, known, patches)
  const count = reader.readU32()
  if (!count || count > 100000) fail('invalid witness bundle count')
  const bundles: Bundle[] = []
  for (let index = 0; index < count; index++) bundles.push(readBundle(reader, genesis.id, known, patches, genesis.metadata.schema === 'NIA'))
  if (reader.remaining) fail('consignment has trailing bytes')
  for (const terminal of terminals) {
    const bundle = bundles.find(candidate => candidate.id === terminal.bundleId)
    if (!bundle) fail('terminal references an unknown bundle')
    const known = new Set(bundle.operations.flatMap(op => op.assignments.map(item => item.seal!.secret)))
    if (terminal.secrets.some(secret => !known.has(secret))) fail('terminal seal is not in its bundle')
  }
  return { genesis, bundles, terminals, body, patches }
}

/** Cheap local hint for repairing a previously validated wallet allocation. */
export function bfaConsignmentWitnessTxids(
  value: Uint8Array,
  network: BfaValidationOptions['network']
): string[] {
  return parseConsignment(value, network).bundles.map(bundle => bundle.txid)
}
function applyPatches(body: Uint8Array, patches: SealPatch[]): Uint8Array {
  if (!patches.length) return body
  const parts: Uint8Array[] = []
  let offset = 0
  for (const patch of patches) {
    if (patch.start < offset) fail('overlapping seal disclosures')
    parts.push(body.slice(offset, patch.start), patch.replacement)
    offset = patch.end
  }
  parts.push(body.slice(offset))
  return concat(...parts)
}

/** Disclose locally owned blind seals before keeping or forwarding a BFA history. */
export function revealBfaConsignmentBlindSeals(value: Uint8Array, network: BfaValidationOptions['network'], seals: RgbBlindSeal[]): Uint8Array {
  if (!seals.length) return value
  const known = new Map(seals.map(seal => [hex(concealBlindSeal(seal)), seal]))
  const parsed = parseConsignment(value, network, known)
  return parsed.patches.length ? wrapRgbTransferConsignment(applyPatches(parsed.body, parsed.patches)) : value
}

function buildValidatedConsignment(
  parsed: ReturnType<typeof parseConsignment>, consumed: Set<string>
): ValidatedBfaConsignment {
  const { genesis, bundles, terminals } = parsed
  const nia = genesis.metadata.schema === 'NIA'
  const allocations: ValidatedBfaTransferHistory['allocations'] = []
  const terminalAssignments: ValidatedBfaConsignment['terminalAssignments'] = []
  if (nia) for (const item of genesis.assignments) {
    if (item.type !== OS_ASSET || consumed.has(`${genesis.id}:${item.type}:${item.index}`) ||
      !item.seal || !item.seal.txid || item.seal.vout < 0) continue
    allocations.push({ txid: item.seal.txid, vout: item.seal.vout, opId: genesis.id,
      assignmentIndex: item.index, amount: item.amount.toString() })
  }
  const operations = new Map<string, { operation: Operation; bundle: Bundle }>()
  for (const bundle of bundles) for (const operation of bundle.operations)
    operations.set(operation.id, { operation, bundle })
  for (const { operation, bundle } of operations.values()) for (const item of operation.assignments) {
    if (item.type !== OS_ASSET || consumed.has(`${operation.id}:${item.type}:${item.index}`) || !item.seal) continue
    const output = item.seal.vout >= 0 && (item.seal.txid === null || item.seal.txid === bundle.txid)
      ? bundle.tx.outs[item.seal.vout] : undefined
    if (item.seal.vout >= 0) allocations.push({
      txid: item.seal.txid ?? bundle.txid, vout: item.seal.vout,
      opId: operation.id, assignmentIndex: item.index, amount: item.amount.toString(),
      ...(output ? { scriptPubKey: output.script.toString('hex') } : {}),
    })
    terminalAssignments.push({
      opId: operation.id, assignmentIndex: item.index, amount: item.amount.toString(),
      bundleId: bundle.id, txid: bundle.txid, vout: item.seal.vout, secretSeal: item.seal.secret,
      ...(output ? { output: { scriptPubKey: output.script.toString('hex'), satoshis: output.value } } : {}),
    })
  }
  const issuedSupply = nia ? BigInt(genesis.metadata.issuedSupply) :
    [...operations.values()].filter(item => item.operation.type === TS_MINT)
      .reduce((sum, item) => sum + item.operation.amount, 0n)
  return {
    assetId: encodeRgbContractId(bytes(genesis.id)), genesis: genesis.strict,
    witnessBundles: bundles.map(bundle => bundle.strict), allocations,
    hasDynamicRejectList: Boolean(genesis.rejectListAddress),
    metadata: { ...genesis.metadata, issuedSupply: issuedSupply.toString() },
    witnessOutputScripts: bundles.at(-1)!.tx.outs.filter(output => output.script[0] !== 0x6a)
      .map(output => output.script.toString('hex')),
    terminals: terminals.map(item => ({ bundleId: item.bundleId, secretSeals: item.secrets })),
    terminalAssignments,
    bundles: bundles.map(bundle => ({ id: bundle.id, txid: bundle.txid, strict: bundle.strict,
      operationIds: bundle.operations.map(operation => operation.id),
      parentOpIds: bundle.operations.flatMap(operation => operation.inputs.map(input => input.opId)) })),
  }
}

/** Reparse an attested payload with wallet-private seals while reusing public-history validation. */
export function restoreAttestedBfaHistory(
  value: Uint8Array, network: BfaValidationOptions['network'], knownBlindSeals: RgbBlindSeal[],
  attestation: BfaValidationAttestationPayload, now = Date.now()
): ValidatedBfaConsignment | undefined {
  return restoreBfaValidationSnapshot(value, network, knownBlindSeals, attestation, now, false)
}

function restoreBfaValidationSnapshot(
  value: Uint8Array, network: BfaValidationOptions['network'], knownBlindSeals: RgbBlindSeal[],
  attestation: BfaValidationAttestationPayload, now: number, allowExpired: boolean
): ValidatedBfaConsignment | undefined {
  if (attestation?.version !== 1 || attestation.validatorVersion !== BFA_VALIDATOR_VERSION ||
    attestation.network !== network || (!allowExpired && attestation.expiresAt <= now) ||
    attestation.payloadHash !== hex(sha256(value)) || attestation.hasDynamicRejectList ||
    !Array.isArray(attestation.bundles)) return undefined
  const disclosed = revealBfaConsignmentBlindSeals(value, network, knownBlindSeals)
  const parsed = parseConsignment(disclosed, network)
  const assetId = encodeRgbContractId(bytes(parsed.genesis.id))
  if (assetId !== attestation.assetId || hex(sha256(parsed.genesis.strict)) !== attestation.genesisHash ||
    parsed.bundles.length !== attestation.bundles.length || parsed.genesis.rejectListAddress) return undefined
  for (let index = 0; index < parsed.bundles.length; index++) {
    const bundle = parsed.bundles[index]!
    const saved = attestation.bundles[index]
    if (!saved || saved.id !== bundle.id || saved.txid !== bundle.txid ||
      saved.operationIds.join(',') !== bundle.operations.map(operation => operation.id).join(',') ||
      saved.parentOpIds.join(',') !== bundle.operations.flatMap(operation => operation.inputs.map(input => input.opId)).join(','))
      return undefined
  }
  const consumed = new Set(parsed.bundles.flatMap(bundle => bundle.operations)
    .flatMap(operation => operation.inputs.map(input => `${input.opId}:${input.type}:${input.index}`)))
  return buildValidatedConsignment(parsed, consumed)
}

/**
 * Reuse a persisted deterministic validation snapshot after refreshing the
 * mutable Bitcoin witness facts. Finalized EVM mint proofs are immutable;
 * assets with a dynamic reject list are deliberately ineligible for reuse.
 */
export async function refreshPersistedBfaValidation(
  value: Uint8Array,
  options: BfaValidationOptions,
  snapshot: BfaValidationAttestationPayload
): Promise<ValidatedBfaConsignment | undefined> {
  const history = restoreBfaValidationSnapshot(
    value, options.network, options.knownBlindSeals || [], snapshot, Date.now(), true
  )
  if (!history) return undefined
  const pendingTxid = options.pendingWitnessTxid ??
    (options.allowPendingLastWitness ? history.bundles.at(-1)?.txid : undefined)
  for (const txid of new Set(history.bundles.map(bundle => bundle.txid))) {
    if (txid !== pendingTxid && !await options.isBitcoinTxConfirmed(txid))
      throw new RgbBfaValidationUnavailableError(
        `${history.metadata.schema === 'NIA' ? 'NIA' : 'BFA'} Bitcoin witness is not confirmed: ${txid}`
      )
  }
  return history
}
function hexQuantity(value: unknown, name: string): bigint {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)) fail(`invalid ${name}`)
  return BigInt(value)
}
async function verifyMintEvent(
  operation: Operation, chainId: bigint, address: string, options: BfaValidationOptions
) {
  const rpc = options.getEvmRpc?.(chainId) ?? options.evmRpc
  if (!rpc) throw new RgbBfaValidationUnavailableError('BFA EVM RPC is not configured')
  const rpcChain = hexQuantity(await rpc('eth_chainId', []), 'EVM chain ID')
  if (rpcChain !== chainId) fail('EVM RPC is connected to another chain')
  const finalized = await rpc('eth_getBlockByNumber', ['finalized', false]) as { number?: unknown } | null
  if (!finalized) throw new RgbBfaValidationUnavailableError('BFA EVM RPC has no finalized head')
  const end = hexQuantity(finalized.number, 'finalized block number')
  const start = operation.afterBlock! + 1n
  let range = options.evmLogRange ?? 1000
  if (!Number.isSafeInteger(range) || range < 1 || range > 100000) fail('invalid EVM log range')
  for (let from = start; from <= end;) {
    const to = from + BigInt(range - 1) < end ? from + BigInt(range - 1) : end
    let logs: unknown
    try {
      logs = await rpc('eth_getLogs', [{
        address, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`,
        topics: [FUNDS_IN_TOPIC, null, `0x${operation.id}`],
      }])
    } catch (error) {
      if (to > from && range > 1) { range = Math.max(1, Math.floor(range / 2)); continue }
      throw error
    }
    if (!Array.isArray(logs)) fail('EVM RPC returned invalid logs')
    for (const log of logs) {
      if (!log || typeof log !== 'object') fail('EVM RPC returned an invalid log')
      const item = log as Record<string, unknown>
      if (typeof item['address'] !== 'string' || item['address'].toLowerCase() !== address.toLowerCase() ||
        !Array.isArray(item['topics']) || item['topics'].length !== 3 ||
        typeof item['topics'][0] !== 'string' || item['topics'][0].toLowerCase() !== FUNDS_IN_TOPIC ||
        typeof item['topics'][1] !== 'string' || !/^0x[0-9a-f]{64}$/i.test(item['topics'][1]) ||
        typeof item['topics'][2] !== 'string' || item['topics'][2].toLowerCase() !== `0x${operation.id}` ||
        typeof item['data'] !== 'string' || !/^0x[0-9a-f]{64}$/i.test(item['data'])) fail('malformed FundsIn log')
      const block = hexQuantity(item['blockNumber'], 'FundsIn block')
      if (item['removed'] === true || block < from || block > to) fail('invalid FundsIn inclusion')
      const encoded = BigInt(item['data'])
      if (encoded === operation.amount) return
    }
    from = to + 1n
  }
  throw new RgbBfaValidationUnavailableError(`Finalized BFA FundsIn event is missing for mint ${operation.id}`)
}

/**
 * Validate supported BFA and NIA v1 transfers locally. Reject unsupported
 * schema features and incomplete ancestry before granting a balance.
 */
export async function validateBfaTransferConsignment(
  value: Uint8Array, options: BfaValidationOptions
): Promise<ValidatedBfaConsignment> {
  const disclosed = revealBfaConsignmentBlindSeals(value, options.network, options.knownBlindSeals || [])
  const parsed = parseConsignment(disclosed, options.network)
  const { genesis, bundles, terminals } = parsed
  const nia = genesis.metadata.schema === 'NIA'
  const pendingTxid = options.pendingWitnessTxid ??
    (options.allowPendingLastWitness ? bundles.at(-1)?.txid : undefined)
  const operations = new Map<string, { operation: Operation; bundle: Bundle }>()
  for (const bundle of bundles) {
    for (const operation of bundle.operations) {
      if (operations.has(operation.id)) fail('duplicate transition')
      operations.set(operation.id, { operation, bundle })
    }
  }
  // A wallet may hold independent allocations of the same asset. A pending
  // transfer on one branch must not block spending another confirmed branch.
  // The full DAG is still validated below; only its mutable chain-status
  // lookup is scoped to the ancestry of the allocations selected for spend.
  let requiredBundles: Set<Bundle> | undefined
  if (options.requiredOperationIds) {
    requiredBundles = new Set()
    const visited = new Set<string>()
    const include = (opId: string) => {
      if (opId === genesis.id || visited.has(opId)) return
      const current = operations.get(opId)
      // A merged validation may inspect an independently transported branch
      // that does not contain the selected operation. The final merged DAG
      // and selectBfaSpendHistory enforce that it exists.
      if (!current) return
      visited.add(opId)
      requiredBundles!.add(current.bundle)
      for (const input of current.operation.inputs) include(input.opId)
    }
    for (const opId of options.requiredOperationIds) include(opId)
  }
  for (const bundle of bundles) {
    if ((!requiredBundles || requiredBundles.has(bundle)) &&
      bundle.txid !== pendingTxid && !await options.isBitcoinTxConfirmed(bundle.txid))
      throw new RgbBfaValidationUnavailableError(`${nia ? 'NIA' : 'BFA'} Bitcoin witness is not confirmed: ${bundle.txid}`)
  }
  // Every disclosed transition must trace back to the authenticated Genesis.
  // Conservation alone would also accept a closed cycle of fabricated NIA
  // assignments with no issued asset behind it.
  const indegrees = new Map<string, number>()
  const children = new Map<string, string[]>()
  for (const [id, { operation }] of operations) {
    let degree = 0
    for (const input of operation.inputs) {
      if (input.opId === genesis.id) continue
      if (!operations.has(input.opId)) fail('missing parent transition')
      degree++
      const dependents = children.get(input.opId) || []
      dependents.push(id)
      children.set(input.opId, dependents)
    }
    indegrees.set(id, degree)
  }
  const ready = [...indegrees].filter(([, degree]) => degree === 0).map(([id]) => id)
  let reachable = 0
  while (ready.length) {
    const id = ready.pop()!
    reachable++
    for (const child of children.get(id) || []) {
      const degree = indegrees.get(child)! - 1
      indegrees.set(child, degree)
      if (degree === 0) ready.push(child)
    }
  }
  if (reachable !== operations.size) fail('transition history is cyclic')
  const consumed = new Set<string>()
  for (const { operation, bundle } of operations.values()) {
    let inputAmount = 0n
    let mintInputs = 0
    let assetInputs = 0
    for (const input of operation.inputs) {
      const key = `${input.opId}:${input.type}:${input.index}`
      if (consumed.has(key)) fail('assignment spent more than once')
      consumed.add(key)
      const parent = input.opId === genesis.id ? undefined : operations.get(input.opId)
      if (input.opId !== genesis.id && !parent) fail('missing parent transition')
      const assignment = (parent?.operation.assignments ?? genesis.assignments).find(item => item.type === input.type && item.index === input.index)
      if (!assignment) fail('missing parent assignment')
      if (!assignment.seal || assignment.seal.vout < 0) fail('parent seal is concealed')
      const txid = assignment.seal.txid ?? parent?.bundle.txid
      if (!txid || !bundle.tx.ins.some(txInput => Buffer.from(txInput.hash).reverse().toString('hex') === txid && txInput.index === assignment.seal!.vout))
        fail('witness does not spend the parent seal')
      if (input.type === OS_MINT) mintInputs++
      else if (input.type === OS_ASSET) { assetInputs++; inputAmount += assignment.amount }
      else fail('unsupported input assignment')
    }
    const outputAmount = operation.assignments.filter(item => item.type === OS_ASSET).reduce((sum, item) => sum + item.amount, 0n)
    const outputMintRights = operation.assignments.filter(item => item.type === OS_MINT).length
    if (operation.type === TS_MINT) {
      if (mintInputs !== 1 || assetInputs || outputAmount !== operation.amount || outputMintRights > 1) fail('invalid mint conservation')
      await verifyMintEvent(operation, genesis.chainId, genesis.address, options)
    } else if (operation.type === TS_BURN) {
      if (mintInputs || !assetInputs || outputMintRights || outputAmount + operation.amount !== inputAmount)
        fail('invalid burn conservation')
    } else if ((nia && (mintInputs !== 0 || outputMintRights !== 0)) ||
      (mintInputs === 0 && outputMintRights !== 0) ||
      (mintInputs > 0 && outputMintRights < mintInputs) ||
      outputAmount !== inputAmount) fail('invalid transfer conservation')
  }
  if (genesis.rejectListAddress) {
    const rpc = options.getEvmRpc?.(genesis.chainId) ?? options.evmRpc
    if (!rpc) throw new RgbBfaValidationUnavailableError('BFA reject list EVM RPC is not configured')
    const terminalSecrets = new Map<string, Set<string>>()
    for (const terminal of terminals) {
      const bundle = bundles.find(item => item.id === terminal.bundleId)!
      for (const operation of bundle.operations) {
        const secrets = new Set(terminal.secrets.filter(secret => operation.assignments.some(item => item.seal?.secret === secret)))
        if (secrets.size) terminalSecrets.set(operation.id, secrets)
      }
    }
    await verifyBfaRejectList({
      chainId: genesis.chainId, address: genesis.rejectListAddress, rpc,
      operations: [...operations.values()].map(({ operation }) => ({
        id: operation.id, inputs: operation.inputs,
        assignments: operation.assignments.map(item => ({ type: item.type, index: item.index, secret: item.seal!.secret })),
      })),
      terminalSecrets,
    })
  }
  return buildValidatedConsignment(parsed, consumed)
}

/** Combine independently validated branches into one portable local history. */
export function mergeBfaValidatedHistories(histories: ValidatedBfaConsignment[]): Uint8Array {
  if (!histories.length) fail('no histories to merge')
  const first = histories[0]!
  const genesisHex = hex(first.genesis)
  const bundles = new Map<string, ValidatedBfaConsignment['bundles'][number]>()
  for (const history of histories) {
    if (history.assetId !== first.assetId || hex(history.genesis) !== genesisHex)
      fail('histories disagree on Genesis')
    for (const bundle of history.bundles) {
      const existing = bundles.get(bundle.id)
      if (existing && (existing.operationIds.join(',') !== bundle.operationIds.join(',') ||
        existing.parentOpIds.join(',') !== bundle.parentOpIds.join(','))) fail('conflicting witness bundle')
      if (!existing || bundle.strict.length > existing.strict.length) bundles.set(bundle.id, bundle)
    }
  }
  const bundleForOp = new Map<string, string>()
  for (const bundle of bundles.values()) for (const opId of bundle.operationIds) {
    const previous = bundleForOp.get(opId)
    if (previous && previous !== bundle.id) fail('operation appears in multiple bundles')
    bundleForOp.set(opId, bundle.id)
  }
  const rootId = rgbContractIdHex(first.assetId)
  const pending = new Map([...bundles.values()].map(bundle => {
    const parents = new Set<string>()
    for (const opId of bundle.parentOpIds) {
      if (opId === rootId) continue
      const id = bundleForOp.get(opId)
      if (!id) fail('merged history is missing an ancestor')
      if (id !== bundle.id) parents.add(id)
    }
    return [bundle.id, parents] as const
  }))
  const ordered: Uint8Array[] = []
  while (pending.size) {
    const ready = [...pending.entries()].filter(([, parents]) => parents.size === 0)
      .map(([id]) => id).sort()
    if (!ready.length) fail('cyclic witness history')
    for (const id of ready) {
      ordered.push(bundles.get(id)!.strict)
      pending.delete(id)
      for (const parents of pending.values()) parents.delete(id)
    }
  }
  return encodeBfaTransferConsignment({
    genesis: first.genesis, validatedWitnessBundles: ordered.slice(0, -1),
    witnessBundle: ordered.at(-1)!, terminals: [],
  })
}
