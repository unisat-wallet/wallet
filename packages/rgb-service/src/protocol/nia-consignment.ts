import { Transaction } from 'bitcoinjs-lib'
import { RgbServiceError } from '../errors'
import type { RgbContractMetadata } from '../types'
import { transitionBundleId } from './bundle'
import { unwrapRgbTransferConsignment } from './consignment'
import { encodeRgbContractId, rgbContractIdHex } from './contract-id'
import { verifyMpcMerkleProof } from './mpc'
import { encodeNiaTransition, type NiaFungibleAssignment, type NiaOutpoint } from './nia'
import { niaConsignmentTail } from './nia-contract'
import { encodeNiaGenesis, type EncodedNiaGenesis, type NiaGenesis } from './nia-genesis'
import { concealBlindSeal, type RgbBlindSeal } from './receive'
import { StrictReader, StrictWriter } from './strict'

const NIA_SCHEMA_ID = '45687051f4cca6e3f665fc75fe3e27b30080346789ad83aa0dc29e95a315e335'
const NIA_ASSET_OWNER = 4000
const NIA_TRANSFER = 10000
const OPRET_PROOF_TAG = 2

type DecodedNiaTransition = {
  opId: string
  contractId: string
  nonce: bigint
  parentOpIds: string[]
  inputs: NiaOutpoint[]
  strict: Uint8Array
  assignments: NiaFungibleAssignment[]
}

type DecodedNiaWitnessBundle = {
  strict: Uint8Array
  witnessTxStrict: Uint8Array
  proof: Uint8Array
  txid: string
  inputs: Array<{ txid: string; vout: number }>
  outputs: Array<{ vout: number; scriptPubKey: string; satoshis: number }>
  bundleId: string
  bundleInputs: Array<{
    opId: string
    assignmentType: number
    assignmentIndex: number
    transitionId: string
  }>
  transitions: DecodedNiaTransition[]
}

function hex(value: Uint8Array): string {
  return Buffer.from(value).toString('hex')
}

function same(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function utf8(value: Uint8Array, name: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(value)
  } catch {
    throw new RgbServiceError(`${name} is not valid UTF-8`)
  }
}

function network(value: number): NiaGenesis['network'] {
  if (value === 0) return 'mainnet'
  if (value === 1) return 'testnet'
  if (value === 2) return 'testnet4'
  if (value === 3) return 'signet'
  throw new RgbServiceError('NIA Genesis has an unsupported network')
}

function readNiaGenesis(reader: StrictReader): {
  encoded: EncodedNiaGenesis
  allocations: NiaGenesis['allocations']
  metadata: RgbContractMetadata
} {
  const start = reader.position
  if (reader.readU16() !== 0) throw new RgbServiceError('NIA Genesis version is unsupported')
  if (hex(reader.readFixedBytes(32)) !== NIA_SCHEMA_ID)
    throw new RgbServiceError('Consignment is not an NIA contract')
  const timestamp = Number(reader.readU64())
  const issuer = utf8(reader.readConfinedBytes(4096), 'NIA issuer')
  if (issuer !== 'ssi:anonymous') throw new RgbServiceError('NIA issuer is unsupported')
  const genesisNetwork = network(reader.readU8())
  if (reader.readU8() !== 0 || reader.readU8() !== 0)
    throw new RgbServiceError('NIA Genesis extension is unsupported')

  let ticker: string | undefined
  let name: string | undefined
  let precision: number | undefined
  let supply: bigint | undefined
  const globals = reader.readU8()
  for (let index = 0; index < globals; index++) {
    const type = reader.readU16()
    if (reader.readU16() !== 1) throw new RgbServiceError('NIA Genesis global state is unsupported')
    const state = new StrictReader(reader.readConfinedBytes(65535))
    if (type === 2000) {
      ticker = utf8(state.readConfinedBytes(8), 'NIA ticker')
      name = utf8(state.readConfinedBytes(40), 'NIA name')
      if (state.readU8() !== 0) throw new RgbServiceError('NIA asset terms are unsupported')
      precision = state.readU8()
    } else if (type === 2001) {
      if (state.readConfinedBytes(65535).length || state.readU8() !== 0) {
        throw new RgbServiceError('NIA contract terms are unsupported')
      }
    } else if (type === 2010) {
      supply = state.readU64()
    } else {
      throw new RgbServiceError('NIA Genesis has an unsupported global state')
    }
    if (state.remaining) throw new RgbServiceError('NIA Genesis global state has trailing bytes')
  }
  if (!ticker || !name || precision === undefined || supply === undefined) {
    throw new RgbServiceError('NIA Genesis is missing required global state')
  }

  if (reader.readU16() !== 1 || reader.readU16() !== NIA_ASSET_OWNER || reader.readU8() !== 1) {
    throw new RgbServiceError('NIA Genesis assignment type is unsupported')
  }
  const count = reader.readU16()
  if (!count) throw new RgbServiceError('NIA Genesis has no allocations')
  const allocations: NiaGenesis['allocations'] = []
  for (let index = 0; index < count; index++) {
    if (reader.readU8() !== 0)
      throw new RgbServiceError('NIA Genesis confidential allocations are unsupported')
    const txid = hex(reader.readFixedBytes(32).reverse())
    const vout = reader.readU32()
    const blinding = reader.readU64()
    if (reader.readU8() !== 8)
      throw new RgbServiceError('NIA Genesis allocation state is unsupported')
    allocations.push({ txid, vout, blinding, amount: reader.readU64() })
  }
  if (allocations.reduce((total, allocation) => total + allocation.amount, 0n) !== supply) {
    throw new RgbServiceError('NIA Genesis supply does not match allocations')
  }
  const strict = reader.slice(start)
  const encoded = encodeNiaGenesis({
    ticker,
    name,
    precision,
    timestamp,
    network: genesisNetwork,
    allocations,
  })
  if (!same(encoded.strict, strict))
    throw new RgbServiceError('NIA Genesis strict encoding is unsupported')
  return {
    encoded,
    allocations,
    metadata: {
      ticker,
      name,
      precision,
      schema: 'NIA',
      issuedSupply: supply.toString(),
      timestamp,
    },
  }
}

function readStrictBitcoinTransaction(reader: StrictReader): Transaction {
  const transaction = new Transaction()
  const version = reader.readU32()
  transaction.version = version > 0x7fff_ffff ? version - 0x1_0000_0000 : version
  const inputs = reader.readU32()
  for (let index = 0; index < inputs; index++) {
    const hash = reader.readFixedBytes(32)
    const vout = reader.readU32()
    const script = reader.readConfinedBytes(0xffff_ffff)
    const sequence = reader.readU32()
    const witness = reader.readU32()
    const stack = Array.from({ length: witness }, () =>
      Buffer.from(reader.readConfinedBytes(0xffff_ffff))
    )
    transaction.addInput(Buffer.from(hash), vout, sequence, Buffer.from(script))
    transaction.setWitness(index, stack)
  }
  const outputs = reader.readU32()
  for (let index = 0; index < outputs; index++) {
    const value = reader.readU64()
    if (value > BigInt(Number.MAX_SAFE_INTEGER))
      throw new RgbServiceError('RGB witness transaction output value is unsafe')
    transaction.addOutput(Buffer.from(reader.readConfinedBytes(0xffff_ffff)), Number(value))
  }
  transaction.locktime = reader.readU32()
  return transaction
}

function readTransition(reader: StrictReader): DecodedNiaTransition {
  const start = reader.position
  if (reader.readU16() !== 0) throw new RgbServiceError('NIA Transition version is unsupported')
  const contractId = hex(reader.readFixedBytes(32))
  const nonce = reader.readU64()
  if (reader.readU16() !== NIA_TRANSFER || reader.readU8() !== 0 || reader.readU8() !== 0) {
    throw new RgbServiceError('Consignment transition is not a standard NIA transfer')
  }
  const inputs = reader.readU16()
  const parentOpIds: string[] = []
  const transitionInputs: NiaOutpoint[] = []
  for (let index = 0; index < inputs; index++) {
    const opId = hex(reader.readFixedBytes(32))
    parentOpIds.push(opId)
    if (reader.readU16() !== NIA_ASSET_OWNER)
      throw new RgbServiceError('NIA transition input assignment is unsupported')
    transitionInputs.push({ opId, assignmentIndex: reader.readU16() })
  }
  if (reader.readU16() !== 1 || reader.readU16() !== NIA_ASSET_OWNER || reader.readU8() !== 1) {
    throw new RgbServiceError('NIA transition assignment is unsupported')
  }
  const assignments = reader.readU16()
  const transitionAssignments: NiaFungibleAssignment[] = []
  for (let index = 0; index < assignments; index++) {
    const sealKind = reader.readU8()
    let seal: NiaFungibleAssignment['seal']
    if (sealKind === 0) {
      const txPtr = reader.readU8()
      let txid: string | null
      if (txPtr === 0) {
        txid = null
      } else if (txPtr === 1) {
        txid = hex(reader.readFixedBytes(32).reverse())
      } else throw new RgbServiceError('NIA transition seal is unsupported')
      seal = { txid, vout: reader.readU32(), blinding: reader.readU64() }
    } else if (sealKind === 1) {
      seal = { secretSeal: hex(reader.readFixedBytes(32)) }
    } else {
      throw new RgbServiceError('NIA transition seal is unsupported')
    }
    if (reader.readU8() !== 8) throw new RgbServiceError('NIA transition state is unsupported')
    transitionAssignments.push({ seal, amount: reader.readU64() })
  }
  if (reader.readU8() !== 0) throw new RgbServiceError('NIA transition valencies are unsupported')
  const strict = reader.slice(start)
  const encoded = encodeNiaTransition({
    contractId,
    nonce,
    inputs: transitionInputs,
    assignments: transitionAssignments,
  })
  // External RGB wallets may serialize semantically unordered transition
  // collections in a different (but commitment-equivalent) strict order.
  // Do not require the bytes to match our encoder: readWitnessBundle still
  // verifies the supplied Transition ID against the canonical operation
  // commitment, and later validates its MPC anchor, parent states, blind seal,
  // asset and amount. Those are the security boundaries for a receive.
  return {
    contractId,
    nonce,
    parentOpIds,
    inputs: transitionInputs,
    strict,
    opId: hex(encoded.opId),
    assignments: transitionAssignments,
  }
}

function readWitnessBundle(reader: StrictReader): DecodedNiaWitnessBundle {
  const start = reader.position
  if (reader.readU8() !== 1) throw new RgbServiceError('Consignment public witness is unsupported')
  const witnessTxStart = reader.position
  const witnessTx = readStrictBitcoinTransaction(reader)
  const witnessTxStrict = reader.slice(witnessTxStart)
  const proofStart = reader.position
  reader.readU32()
  reader.readU16()
  reader.readFixedBytes(reader.readU8() * 32)
  const proof = reader.slice(proofStart)
  if (reader.readU8() !== OPRET_PROOF_TAG) {
    throw new RgbServiceError('RGB WitnessBundle proof type is unsupported')
  }
  const inputs = reader.readU16()
  const bundleInputs = []
  for (let index = 0; index < inputs; index++) {
    bundleInputs.push({
      opId: hex(reader.readFixedBytes(32)),
      assignmentType: reader.readU16(),
      assignmentIndex: reader.readU16(),
      transitionId: reader.readFixedBytes(32),
    })
  }
  const transitions = reader.readU16()
  const result = []
  for (let index = 0; index < transitions; index++) {
    const opId = hex(reader.readFixedBytes(32))
    const transition = readTransition(reader)
    if (transition.opId !== opId)
      throw new RgbServiceError('NIA transition ID does not match its strict encoding')
    result.push({ opId, ...transition })
  }
  const [firstTransition] = result
  if (
    !firstTransition ||
    result.some(transition => transition.contractId !== firstTransition.contractId)
  ) {
    throw new RgbServiceError('NIA WitnessBundle contains unsupported contracts')
  }
  for (const input of bundleInputs) {
    const transitionId = hex(input.transitionId)
    const transition = result.find(candidate => candidate.opId === transitionId)
    if (
      !transition ||
      input.assignmentType !== NIA_ASSET_OWNER ||
      !transition.inputs.some(
        parent => parent.opId === input.opId && parent.assignmentIndex === input.assignmentIndex
      )
    ) {
      throw new RgbServiceError('NIA WitnessBundle input does not match its referenced Transition')
    }
  }
  for (const transition of result) {
    for (const parent of transition.inputs) {
      if (
        !bundleInputs.some(
          input =>
            hex(input.transitionId) === transition.opId &&
            input.opId === parent.opId &&
            input.assignmentType === NIA_ASSET_OWNER &&
            input.assignmentIndex === parent.assignmentIndex
        )
      ) {
        throw new RgbServiceError('NIA Transition input is missing from its WitnessBundle')
      }
    }
  }
  const bundleId = transitionBundleId(bundleInputs)
  const commitment = verifyMpcMerkleProof({
    protocolId: Uint8Array.from(Buffer.from(firstTransition.contractId, 'hex')),
    message: bundleId,
    proof,
  })
  const host = witnessTx.outs[0]
  if (!host || !host.script.equals(Buffer.from([0x6a, 0x20, ...commitment]))) {
    throw new RgbServiceError('RGB WitnessBundle OP_RETURN does not match its MPC commitment')
  }
  return {
    strict: reader.slice(start),
    witnessTxStrict,
    proof,
    txid: witnessTx.getId(),
    inputs: witnessTx.ins.map(input => ({
      txid: Buffer.from(input.hash).reverse().toString('hex'),
      vout: input.index,
    })),
    outputs: witnessTx.outs.map((output, vout) => ({
      vout,
      scriptPubKey: output.script.toString('hex'),
      satoshis: output.value,
    })),
    bundleId: hex(bundleId),
    bundleInputs: bundleInputs.map(input => ({ ...input, transitionId: hex(input.transitionId) })),
    transitions: result,
  }
}

function reencodeWitnessBundle(
  bundle: DecodedNiaWitnessBundle,
  transitions: DecodedNiaTransition[]
): Uint8Array {
  const writer = new StrictWriter()
    .writeU8(1)
    .writeFixedBytes(bundle.witnessTxStrict, bundle.witnessTxStrict.length)
    .writeFixedBytes(bundle.proof, bundle.proof.length)
    .writeU8(OPRET_PROOF_TAG)
    .writeU16(bundle.bundleInputs.length)
  for (const input of bundle.bundleInputs) {
    writer
      .writeFixedBytes(Uint8Array.from(Buffer.from(input.opId, 'hex')), 32)
      .writeU16(input.assignmentType)
      .writeU16(input.assignmentIndex)
      .writeFixedBytes(Uint8Array.from(Buffer.from(input.transitionId, 'hex')), 32)
  }
  writer.writeU16(transitions.length)
  for (const transition of transitions) {
    writer
      .writeFixedBytes(Uint8Array.from(Buffer.from(transition.opId, 'hex')), 32)
      .writeFixedBytes(transition.strict, transition.strict.length)
  }
  return writer.toBytes()
}

/**
 * Reveal assignments whose confidential seals are owned locally. RGB commits
 * the concealed seal, so replacing it with its matching revealed seal keeps
 * the operation ID and witness commitment intact while producing a standard
 * Consignment that downstream recipients can validate.
 */
export function revealNiaConsignmentBlindSeals(
  consignment: DecodedNiaConsignment,
  knownBlindSeals: RgbBlindSeal[] = []
): DecodedNiaConsignment {
  if (!knownBlindSeals.length) return consignment
  const seals = new Map(
    knownBlindSeals.map(seal => [Buffer.from(concealBlindSeal(seal)).toString('hex'), seal])
  )
  let changed = false
  const witnessBundles = consignment.witnessBundles.map(bundle => {
    let bundleChanged = false
    const transitions = bundle.transitions.map(transition => {
      const assignments = transition.assignments.map(assignment => {
        if (!('secretSeal' in assignment.seal)) return assignment
        const seal = seals.get(assignment.seal.secretSeal)
        if (!seal) return assignment
        bundleChanged = true
        return { ...assignment, seal: { ...seal } }
      })
      if (!bundleChanged) return transition
      const encoded = encodeNiaTransition({
        contractId: transition.contractId,
        nonce: transition.nonce,
        inputs: transition.inputs,
        assignments,
      })
      if (hex(encoded.opId) !== transition.opId) {
        throw new RgbServiceError('NIA revealed confidential seal changed its operation ID')
      }
      return { ...transition, strict: encoded.strict, assignments }
    })
    if (!bundleChanged) return bundle
    changed = true
    return { ...bundle, transitions, strict: reencodeWitnessBundle(bundle, transitions) }
  })
  return changed
    ? { ...consignment, witnessBundles, transitions: witnessBundles.flatMap(bundle => bundle.transitions) }
    : consignment
}

function validateTransitionGraph(
  genesisId: string,
  genesisAllocations: NiaGenesis['allocations'],
  witnessBundles: DecodedNiaWitnessBundle[],
  requireCompleteParents = false,
  requireParentSealSpends = false
): void {
  const transitions = new Map<string, DecodedNiaTransition>()
  const transitionWitnesses = new Map<string, DecodedNiaWitnessBundle>()
  for (const bundle of witnessBundles) {
    for (const transition of bundle.transitions) {
      if (transitions.has(transition.opId))
        throw new RgbServiceError('NIA Consignment contains a duplicate Transition')
      transitions.set(transition.opId, transition)
      transitionWitnesses.set(transition.opId, bundle)
    }
  }
  const consumed = new Set<string>()
  for (const transition of transitions.values()) {
    let inputAmount = 0n
    for (const input of transition.inputs) {
      const outpoint = `${input.opId}:${input.assignmentIndex}`
      if (consumed.has(outpoint))
        throw new RgbServiceError(
          'NIA Consignment spends the same parent assignment more than once'
        )
      consumed.add(outpoint)
      if (input.opId === genesisId) {
        const allocation = genesisAllocations[input.assignmentIndex]
        if (!allocation)
          throw new RgbServiceError('NIA Transition references an unknown Genesis assignment')
        inputAmount += allocation.amount
        if (requireParentSealSpends) {
          assertParentSealSpent(transition, transitionWitnesses, allocation.txid, allocation.vout)
        }
        continue
      }
      const parent = transitions.get(input.opId)
      if (!parent) {
        if (requireCompleteParents)
          throw new RgbServiceError('NIA Transition references an unavailable parent assignment')
        continue
      }
      const assignment = parent.assignments[input.assignmentIndex]
      if (!assignment)
        throw new RgbServiceError('NIA Transition references an unavailable parent assignment')
      inputAmount += assignment.amount
      if (requireParentSealSpends) {
        if ('secretSeal' in assignment.seal) {
          throw new RgbServiceError(
            'NIA Transition spends an unrevealed confidential parent seal'
          )
        }
        const parentWitness = transitionWitnesses.get(parent.opId)
        if (!parentWitness)
          throw new RgbServiceError('NIA Transition parent witness is unavailable')
        assertParentSealSpent(
          transition,
          transitionWitnesses,
          assignment.seal.txid ?? parentWitness.txid,
          assignment.seal.vout
        )
      }
    }
    if (
      requireCompleteParents &&
      transition.assignments.reduce((total, assignment) => total + assignment.amount, 0n) >
        inputAmount
    ) {
      throw new RgbServiceError('NIA Transition creates more value than its consumed assignments')
    }
  }
  if (!requireCompleteParents) return
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (transition: DecodedNiaTransition): void => {
    if (visited.has(transition.opId)) return
    if (visiting.has(transition.opId))
      throw new RgbServiceError('NIA Consignment contains a cyclic Transition dependency')
    visiting.add(transition.opId)
    for (const input of transition.inputs) {
      if (input.opId === genesisId) continue
      const parent = transitions.get(input.opId)
      if (!parent)
        throw new RgbServiceError('NIA Transition references an unavailable parent assignment')
      visit(parent)
    }
    visiting.delete(transition.opId)
    visited.add(transition.opId)
  }
  for (const transition of transitions.values()) visit(transition)
}

function assertParentSealSpent(
  transition: DecodedNiaTransition,
  transitionWitnesses: Map<string, DecodedNiaWitnessBundle>,
  txid: string,
  vout: number
): void {
  const witness = transitionWitnesses.get(transition.opId)
  if (!witness) throw new RgbServiceError('NIA Transition witness is unavailable')
  if (
    !witness.inputs.some(
      input => input.txid.toLowerCase() === txid.toLowerCase() && input.vout === vout
    )
  ) {
    throw new RgbServiceError('NIA Transition witness does not spend its parent seal')
  }
}

export interface DecodedNiaConsignment {
  assetId: string
  metadata: RgbContractMetadata
  transfer: boolean
  genesis: EncodedNiaGenesis
  genesisAllocations: NiaGenesis['allocations']
  terminals: Array<{ bundleId: string; secretSeals: string[] }>
  transitions: DecodedNiaTransition[]
  witnessBundles: DecodedNiaWitnessBundle[]
}

/** Require a complete, acyclic parent-state graph before crediting a decoded transfer. */
export function validateNiaConsignmentParentState(consignment: DecodedNiaConsignment): void {
  validateTransitionGraph(
    rgbContractIdHex(consignment.assetId),
    consignment.genesisAllocations,
    consignment.witnessBundles,
    true
  )
}

/**
 * Before accepting an untrusted transfer, bind each parent seal to an actual
 * input of the witness transaction that commits its child transition.
 */
export function validateNiaConsignmentParentSpends(consignment: DecodedNiaConsignment): void {
  validateTransitionGraph(
    rgbContractIdHex(consignment.assetId),
    consignment.genesisAllocations,
    consignment.witnessBundles,
    true,
    true
  )
}

/** Decode and strictly constrain the standard NIA consignment profile we emit locally. */
export function decodeNiaConsignment(value: Uint8Array): DecodedNiaConsignment {
  const reader = new StrictReader(unwrapRgbTransferConsignment(value))
  if (reader.readU8() !== 0) throw new RgbServiceError('RGB Consignment version is unsupported')
  const transferTag = reader.readU8()
  if (transferTag !== 0 && transferTag !== 1)
    throw new RgbServiceError('RGB Consignment transfer tag is invalid')
  const terminals = []
  const terminalCount = reader.readU16()
  for (let index = 0; index < terminalCount; index++) {
    const bundleId = hex(reader.readFixedBytes(32))
    const seals = reader.readU16()
    if (!seals) throw new RgbServiceError('RGB Consignment terminal has no secret seals')
    terminals.push({
      bundleId,
      secretSeals: Array.from({ length: seals }, () => hex(reader.readFixedBytes(32))),
    })
  }
  const parsedGenesis = readNiaGenesis(reader)
  const genesis = parsedGenesis.encoded
  const witnesses = reader.readU32()
  const witnessBundles = []
  for (let index = 0; index < witnesses; index++) witnessBundles.push(readWitnessBundle(reader))
  const transitions = witnessBundles.flatMap(bundle => bundle.transitions)
  const tail = niaConsignmentTail()
  if (!same(reader.readFixedBytes(tail.length), tail)) {
    throw new RgbServiceError('RGB Consignment has an unknown NIA schema tail')
  }
  if (reader.remaining) throw new RgbServiceError('RGB Consignment has trailing data')
  const id = hex(genesis.assetId)
  if (transitions.some(transition => transition.contractId !== id)) {
    throw new RgbServiceError('RGB Consignment transition contract does not match Genesis')
  }
  if ((transferTag === 0 && witnesses !== 0) || (transferTag === 1 && witnesses === 0)) {
    throw new RgbServiceError('RGB Consignment transfer state is inconsistent')
  }
  if (transferTag === 0 && terminals.length)
    throw new RgbServiceError('RGB Genesis consignment must not contain transfer terminals')
  if (transferTag === 1) {
    for (const terminal of terminals) {
      const bundle = witnessBundles.find(candidate => candidate.bundleId === terminal.bundleId)
      if (!bundle)
        throw new RgbServiceError('RGB Consignment terminal does not match its WitnessBundle')
      const seals = new Set(
        bundle.transitions.flatMap(transition =>
          transition.assignments.flatMap(assignment =>
            'secretSeal' in assignment.seal ? [assignment.seal.secretSeal] : []
          )
        )
      )
      if (terminal.secretSeals.some(secretSeal => !seals.has(secretSeal))) {
        throw new RgbServiceError('RGB Consignment terminal does not match its WitnessBundle')
      }
    }
    validateTransitionGraph(id, parsedGenesis.allocations, witnessBundles)
  }
  return {
    assetId: encodeRgbContractId(genesis.assetId),
    metadata: parsedGenesis.metadata,
    transfer: transferTag === 1,
    genesis,
    genesisAllocations: parsedGenesis.allocations,
    terminals,
    transitions,
    witnessBundles,
  }
}

/** Non-OP_RETURN witness output scripts from a base64 NIA consignment payload. */
export function niaConsignmentSpendableOutputScripts(payload: string): string[] {
  try {
    const decoded = decodeNiaConsignment(Uint8Array.from(Buffer.from(payload, 'base64')))
    const scripts: string[] = []
    for (const bundle of decoded.witnessBundles) {
      for (const output of bundle.outputs) {
        if (!output.scriptPubKey || output.scriptPubKey.startsWith('6a')) continue
        scripts.push(output.scriptPubKey)
      }
    }
    return scripts
  } catch {
    return []
  }
}
