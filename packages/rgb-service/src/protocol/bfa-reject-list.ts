import { RgbBfaValidationUnavailableError, RgbServiceError } from '../errors'

type Opout = { opId: string; type: number; index: number }
export type BfaRejectListOperation = { id: string; inputs: Opout[]; assignments: Array<{ type: number; index: number; secret: string }> }

const LENGTH_SELECTOR = '0x1f7b6d32'
const ENTRIES_SELECTOR = '0x17b937e6'
const PAGE_SIZE = 1000
const MAX_ENTRIES = 100_000

function invalid(message: string): never { throw new RgbServiceError(`BFA reject list: ${message}`) }
function key(opout: Opout): string { return `${opout.opId}:${opout.type}:${opout.index}` }
function quantity(value: unknown, name: string): bigint {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)) invalid(`invalid ${name}`)
  return BigInt(value)
}
function word(value: unknown, index: number): string {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-f]{64})*$/i.test(value)) invalid('invalid ABI response')
  const start = 2 + index * 64
  if (value.length < start + 64) invalid('truncated ABI response')
  return value.slice(start, start + 64).toLowerCase()
}
function unsigned(value: unknown, index: number, max: bigint): number {
  const result = BigInt(`0x${word(value, index)}`)
  if (result > max) invalid('ABI integer is out of range')
  return Number(result)
}
function abi(value: number): string { return value.toString(16).padStart(64, '0') }

/** Validate the optional BFA Genesis rejectList against the selected EVM chain. */
export async function verifyBfaRejectList(input: {
  chainId: bigint
  address: string
  rpc: (method: string, params: unknown[]) => Promise<unknown>
  operations: BfaRejectListOperation[]
  terminalSecrets: Map<string, Set<string>>
}): Promise<void> {
  const { rpc, address } = input
  if (quantity(await rpc('eth_chainId', []), 'chain ID') !== input.chainId)
    invalid('EVM RPC is connected to another chain')
  const finalized = await rpc('eth_getBlockByNumber', ['finalized', false]) as { number?: unknown } | null
  if (!finalized) throw new RgbBfaValidationUnavailableError('BFA reject list has no finalized EVM head')
  const finalizedHeight = quantity(finalized.number, 'finalized block number')
  const latestHeight = quantity(await rpc('eth_blockNumber', []), 'latest block number')
  if (latestHeight < finalizedHeight) invalid('latest EVM head precedes finalized head')
  const blockTag = (height: bigint) => `0x${height.toString(16)}`
  const call = (data: string, height: bigint) => rpc('eth_call', [{ to: address, data }, blockTag(height)])
  const count = async (height: bigint, optional: boolean) => {
    const result = await call(LENGTH_SELECTOR, height)
    if (result === '0x' && optional) return 0
    if (result === '0x') throw new RgbBfaValidationUnavailableError('BFA reject list contract is unavailable')
    if (typeof result !== 'string' || result.length !== 66) invalid('invalid reject list length')
    return unsigned(result, 0, BigInt(MAX_ENTRIES))
  }
  const finalizedCount = await count(finalizedHeight, true)
  const total = await count(latestHeight, false)
  if (total < finalizedCount) invalid('reject list shortened after finalization')
  const finalizedDecisions = new Map<string, boolean>()
  const pendingRejects = new Set<string>()
  for (let start = 0; start < total; start += PAGE_SIZE) {
    const end = Math.min(start + PAGE_SIZE, total)
    const data = await call(`${ENTRIES_SELECTOR}${abi(start)}${abi(end)}`, latestHeight)
    if (unsigned(data, 0, BigInt(MAX_ENTRIES * 32)) !== 32 || unsigned(data, 1, BigInt(MAX_ENTRIES)) !== end - start)
      invalid('invalid reject list page')
    if ((data as string).length !== 2 + (2 + (end - start) * 4) * 64) invalid('invalid reject list page length')
    for (let index = start; index < end; index++) {
      const offset = 2 + (index - start) * 4
      const opout = {
        opId: word(data, offset),
        type: unsigned(data, offset + 1, 0xffffn),
        index: unsigned(data, offset + 2, 0xffffn),
      }
      const decision = unsigned(data, offset + 3, 1n) === 1
      const id = key(opout)
      if (index < finalizedCount) finalizedDecisions.set(id, decision)
      else if (decision) pendingRejects.add(id)
    }
  }
  const rejected = new Set<string>(pendingRejects)
  const allowed = new Set<string>()
  for (const [id, decision] of finalizedDecisions) {
    if (decision) rejected.add(id)
    else if (!pendingRejects.has(id)) allowed.add(id)
  }
  const operations = new Map(input.operations.map(operation => [operation.id, operation]))
  const hasRejectedAncestor = (initial: Opout): boolean => {
    const stack = [initial]
    const seen = new Set<string>()
    while (stack.length) {
      const current = stack.pop()!
      const id = key(current)
      if (seen.has(id)) continue
      seen.add(id)
      if (allowed.has(id)) continue
      if (rejected.has(id)) return true
      const operation = operations.get(current.opId)
      if (operation) stack.push(...operation.inputs)
    }
    return false
  }
  for (const operation of input.operations) {
    const secrets = input.terminalSecrets.get(operation.id)
    if (!secrets) continue
    for (const assignment of operation.assignments) {
      if (secrets.has(assignment.secret) && hasRejectedAncestor({ opId: operation.id, type: assignment.type, index: assignment.index }))
        invalid('recipient allocation or an ancestor is rejected')
    }
  }
}
