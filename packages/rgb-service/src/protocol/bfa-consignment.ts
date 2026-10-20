import { RgbServiceError } from '../errors'
import { unwrapRgbTransferConsignment, wrapRgbTransferConsignment, type RgbTransferTerminal } from './consignment'
import { StrictReader, StrictWriter } from './strict'

// rgb-schemas 0.11.2-rc.1, BridgedFungibleAsset::schema_id(). The byte order
// here is the strict-encoded SchemaId in Genesis, not the baid64 display form.
export const BFA_SCHEMA_ID = '472979790677207ad4d397b7016750649478141e46bf164fcbde9cc212620297'

function hex(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('hex')
}

function compare(left: Uint8Array, right: Uint8Array) {
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    if (left[index] !== right[index]) return left[index]! - right[index]!
  }
  return left.length - right.length
}

function concat(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

/**
 * Read only the schema discriminator of a v1 transfer. Use
 * validateBfaTransferConsignment for local validation before accepting funds.
 */
export function isBfaTransferConsignment(value: Uint8Array): boolean {
  const reader = new StrictReader(unwrapRgbTransferConsignment(value))
  if (reader.readU8() !== 1 || reader.readU8() !== 1) return false
  const terminalCount = reader.readU16()
  for (let index = 0; index < terminalCount; index++) {
    reader.readFixedBytes(32)
    const sealCount = reader.readU16()
    if (!sealCount) throw new RgbServiceError('BFA transfer has an empty terminal')
    for (let seal = 0; seal < sealCount; seal++) {
      const kind = reader.readU8()
      if (kind === 1) reader.readFixedBytes(32)
      else if (kind === 0) {
        const txPtr = reader.readU8()
        if (txPtr === 1) reader.readFixedBytes(32)
        else if (txPtr !== 0) throw new RgbServiceError('BFA terminal has an invalid tx pointer')
        reader.readU32()
        reader.readU64()
      } else throw new RgbServiceError('BFA transfer has an invalid terminal seal')
    }
  }
  if (reader.readU16() !== 0) throw new RgbServiceError('BFA Genesis version is unsupported')
  return hex(reader.readFixedBytes(32)) === BFA_SCHEMA_ID
}

/** Recognize the v1 BFA Genesis-only contract container in imported history. */
export function isBfaContractConsignment(value: Uint8Array): boolean {
  const reader = new StrictReader(unwrapRgbTransferConsignment(value))
  if (reader.readU8() !== 1 || reader.readU8() !== 0 || reader.readU16() !== 0) return false
  if (reader.readU16() !== 0) return false
  return hex(reader.readFixedBytes(32)) === BFA_SCHEMA_ID
}

/** Strict-encode v1 transfer terminals; blind seals use BuilderSeal::Concealed. */
function encodeTerminals(terminals: RgbTransferTerminal[]): Uint8Array {
  if (terminals.length > 0xffff) throw new RgbServiceError('BFA has too many terminal bundles')
  const ordered = terminals.map(terminal => {
    if (terminal.bundleId.length !== 32 || !terminal.secretSeals.length || terminal.secretSeals.length > 0xffff)
      throw new RgbServiceError('BFA terminal is invalid')
    const seals = [...terminal.secretSeals].sort(compare)
    if (seals.some(seal => seal.length !== 32))
      throw new RgbServiceError('BFA terminal seal must be 32 bytes')
    return { bundleId: terminal.bundleId, seals }
  }).sort((left, right) => compare(left.bundleId, right.bundleId))
  if (ordered.some((item, index) => index > 0 && compare(item.bundleId, ordered[index - 1]!.bundleId) === 0))
    throw new RgbServiceError('BFA transfer has duplicate terminal bundles')
  const writer = new StrictWriter().writeU8(1).writeU8(1).writeU16(ordered.length)
  for (const terminal of ordered) {
    writer.writeFixedBytes(terminal.bundleId, 32).writeU16(terminal.seals.length)
    for (const seal of terminal.seals) writer.writeU8(1).writeFixedBytes(seal, 32)
  }
  return writer.toBytes()
}

/**
 * Locally construct a BFA transfer consignment from a locally validated contract
 * history. The caller supplies exact Genesis and ancestor v1 witness bytes;
 * the wallet constructs and signs the new transfer witness on this device.
 */
export function encodeBfaTransferConsignment(input: {
  genesis: Uint8Array
  validatedWitnessBundles: Uint8Array[]
  witnessBundle: Uint8Array
  terminals: RgbTransferTerminal[]
}): Uint8Array {
  if (input.genesis.length < 34 || hex(input.genesis.slice(2, 34)) !== BFA_SCHEMA_ID)
    throw new RgbServiceError('BFA transfer requires a BFA Genesis')
  if (input.genesis[0] !== 0 || input.genesis[1] !== 0)
    throw new RgbServiceError('BFA Genesis version is unsupported')
  const bundles = [...input.validatedWitnessBundles, input.witnessBundle]
  if (!input.witnessBundle.length || bundles.some(bundle => !bundle.length) || bundles.length > 0xffff_ffff)
    throw new RgbServiceError('BFA transfer has invalid witness history')
  const body = concat([
    encodeTerminals(input.terminals),
    input.genesis,
    new StrictWriter().writeU32(bundles.length).toBytes(),
    ...bundles,
  ])
  const result = wrapRgbTransferConsignment(body)
  if (!isBfaTransferConsignment(result))
    throw new RgbServiceError('Locally encoded BFA consignment failed its schema check')
  return result
}

/** Export only the validated v1 BFA Genesis, without ownership history. */
export function encodeBfaContractConsignment(genesis: Uint8Array): Uint8Array {
  if (genesis.length < 34 || genesis[0] !== 0 || genesis[1] !== 0 ||
    hex(genesis.slice(2, 34)) !== BFA_SCHEMA_ID)
    throw new RgbServiceError('BFA contract export requires a BFA Genesis')
  return concat([
    new StrictWriter().writeU8(1).writeU8(0).writeU16(0).toBytes(),
    genesis,
    new StrictWriter().writeU32(0).toBytes(),
  ])
}
