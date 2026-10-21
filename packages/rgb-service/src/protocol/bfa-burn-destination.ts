import { RgbServiceError } from '../errors'

/** BFA commits either a V0 EVM address or a precomputed V1 destination hash as bytes32. */
export function normalizeBfaBurnDestination(destination: string | undefined): string {
  const value = destination?.trim().replace(/^0x/i, '').toLowerCase() || ''
  if (/^[0-9a-f]{40}$/.test(value) && !/^0+$/.test(value))
    return value.padStart(64, '0')
  if (/^[0-9a-f]{64}$/.test(value) && !/^0+$/.test(value))
    return value
  throw new RgbServiceError('BFA burn requires an EVM address or a 32-byte destination hash')
}
