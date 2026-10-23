import type { DecodedPsbtInput, ToSignData } from '../types'

const SIGHASH_OUTPUT_MASK = 0x03
const SIGHASH_SINGLE = 0x03

export function getSighashSingleInputIndexes(
  toSignData: ToSignData,
  inputInfos: Pick<DecodedPsbtInput, 'sighashType'>[]
): number[] {
  const indexesToSign = new Set(toSignData.toSignInputs.map(input => input.index))
  return inputInfos.flatMap((input, index) => {
    // sighashTypes on ToSignInput is an allowlist; the PSBT input selects the actual type.
    if (!indexesToSign.has(index) || typeof input.sighashType !== 'number') return []
    return (input.sighashType & SIGHASH_OUTPUT_MASK) === SIGHASH_SINGLE ? [index] : []
  })
}

export function getSighashSingleAnyoneCanPayInputIndexes(
  toSignData: ToSignData,
  inputInfos: Pick<DecodedPsbtInput, 'sighashType'>[]
): number[] {
  return getSighashSingleInputIndexes(toSignData, inputInfos).filter(
    index => ((inputInfos[index]?.sighashType ?? 0) & 0x80) !== 0
  )
}
