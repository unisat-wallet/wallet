import { RgbServiceError } from '../errors'
import { encodeBfaContractConsignment, encodeBfaTransferConsignment } from './bfa-consignment'
import { decodeNiaConsignment, validateNiaConsignmentParentState } from './nia-consignment'

/** Old Rust exports may wrap a Genesis-only contract in RGB\0CON. */
export function unwrapNiaV0Contract(value: Uint8Array): Uint8Array {
  const header = [0x52, 0x47, 0x42, 0, 0x43, 0x4f, 0x4e]
  return header.every((byte, index) => value[index] === byte) ? value.slice(header.length) : value
}

/** Repackage a verified NIA v0 DAG as v1 without changing Genesis or transitions. */
export function convertNiaV0ConsignmentToV1(payload: Uint8Array): Uint8Array {
  const decoded = decodeNiaConsignment(unwrapNiaV0Contract(payload))
  validateNiaConsignmentParentState(decoded)
  if (!decoded.transfer) return encodeBfaContractConsignment(decoded.genesis.strict)

  const bundles = decoded.witnessBundles.map(bundle => {
    if (bundle.strict[0] !== 1 || !bundle.witnessTxStrict.length) {
      throw new RgbServiceError('NIA v0 witness cannot be converted to v1')
    }
    const suffix = bundle.strict.slice(1 + bundle.witnessTxStrict.length)
    const converted = new Uint8Array(bundle.witnessTxStrict.length + 1 + suffix.length)
    converted.set(bundle.witnessTxStrict)
    // Option<SpvProof>::None; chain state is checked by the v1 validator.
    converted.set(suffix, bundle.witnessTxStrict.length + 1)
    return converted
  })
  const last = bundles.at(-1)
  if (!last) throw new RgbServiceError('NIA v0 transfer has no witness history')
  return encodeBfaTransferConsignment({
    genesis: decoded.genesis.strict,
    validatedWitnessBundles: bundles.slice(0, -1),
    witnessBundle: last,
  })
}
