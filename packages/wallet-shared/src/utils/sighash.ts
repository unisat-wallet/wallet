import type { DecodedPsbtInput, ToSignData } from '../types'

const SIGHASH_OUTPUT_MASK = 0x03
const SIGHASH_DEFAULT = 0x00
const SIGHASH_ALL = 0x01
const SIGHASH_NONE = 0x02
const SIGHASH_SINGLE = 0x03
const SIGHASH_ANYONECANPAY = 0x80

const DEFINED_SIGHASH_TYPES = new Set([
  SIGHASH_DEFAULT,
  SIGHASH_ALL,
  SIGHASH_NONE,
  SIGHASH_SINGLE,
  SIGHASH_ALL | SIGHASH_ANYONECANPAY,
  SIGHASH_NONE | SIGHASH_ANYONECANPAY,
  SIGHASH_SINGLE | SIGHASH_ANYONECANPAY,
])

export function isDefinedSighashType(sighashType: number): boolean {
  return Number.isInteger(sighashType) && DEFINED_SIGHASH_TYPES.has(sighashType)
}

export function getSighashTypeLabel(sighashType: number | undefined): string | undefined {
  switch (sighashType) {
    case SIGHASH_ALL | SIGHASH_ANYONECANPAY:
      return 'SIGHASH_ALL|ANYONECANPAY'
    case SIGHASH_NONE:
      return 'SIGHASH_NONE'
    case SIGHASH_NONE | SIGHASH_ANYONECANPAY:
      return 'SIGHASH_NONE|ANYONECANPAY'
    case SIGHASH_SINGLE:
      return 'SIGHASH_SINGLE'
    case SIGHASH_SINGLE | SIGHASH_ANYONECANPAY:
      return 'SIGHASH_SINGLE|ANYONECANPAY'
    default:
      return typeof sighashType === 'number' && !isDefinedSighashType(sighashType)
        ? `INVALID_SIGHASH(0x${sighashType.toString(16)})`
        : undefined
  }
}

function getInputIndexesBySighashOutputType(
  toSignData: ToSignData,
  inputInfos: Pick<DecodedPsbtInput, 'sighashType'>[],
  outputType: number
): number[] {
  const indexesToSign = new Set(toSignData.toSignInputs.map(input => input.index))
  return inputInfos.flatMap((input, index) => {
    // sighashTypes on ToSignInput is an allowlist; the PSBT input selects the actual type.
    if (!indexesToSign.has(index) || typeof input.sighashType !== 'number') return []
    if (!isDefinedSighashType(input.sighashType)) return []
    return (input.sighashType & SIGHASH_OUTPUT_MASK) === outputType ? [index] : []
  })
}

export function getSighashAllAnyoneCanPayInputIndexes(
  toSignData: ToSignData,
  inputInfos: Pick<DecodedPsbtInput, 'sighashType'>[]
): number[] {
  const indexesToSign = new Set(toSignData.toSignInputs.map(input => input.index))
  return inputInfos.flatMap((input, index) =>
    indexesToSign.has(index) &&
    input.sighashType === (SIGHASH_ALL | SIGHASH_ANYONECANPAY)
      ? [index]
      : []
  )
}

export function getInvalidSighashInputIndexes(
  toSignData: ToSignData,
  inputInfos: Pick<DecodedPsbtInput, 'sighashType'>[]
): number[] {
  const indexesToSign = new Set(toSignData.toSignInputs.map(input => input.index))
  return inputInfos.flatMap((input, index) =>
    indexesToSign.has(index) &&
    typeof input.sighashType === 'number' &&
    !isDefinedSighashType(input.sighashType)
      ? [index]
      : []
  )
}

export function getSighashSingleInputIndexes(
  toSignData: ToSignData,
  inputInfos: Pick<DecodedPsbtInput, 'sighashType'>[]
): number[] {
  return getInputIndexesBySighashOutputType(toSignData, inputInfos, SIGHASH_SINGLE)
}

export function getSighashNoneInputIndexes(
  toSignData: ToSignData,
  inputInfos: Pick<DecodedPsbtInput, 'sighashType'>[]
): number[] {
  return getInputIndexesBySighashOutputType(toSignData, inputInfos, SIGHASH_NONE)
}

export function getSighashSingleAnyoneCanPayInputIndexes(
  toSignData: ToSignData,
  inputInfos: Pick<DecodedPsbtInput, 'sighashType'>[]
): number[] {
  return getSighashSingleInputIndexes(toSignData, inputInfos).filter(
    index => ((inputInfos[index]?.sighashType ?? 0) & 0x80) !== 0
  )
}
