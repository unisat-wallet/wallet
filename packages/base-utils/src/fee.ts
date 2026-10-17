export const MIN_FEE_RATE = 1
export const MIN_LOW_FEE_RATE = 0.1
export const MAX_FEE_RATE = 10_000

export function assertValidFeeRate(
  feeRate: unknown,
  options: { supportLowFeeMode?: boolean } = {}
): number {
  const minimum = options.supportLowFeeMode ? MIN_LOW_FEE_RATE : MIN_FEE_RATE
  if (
    typeof feeRate !== 'number' ||
    !Number.isFinite(feeRate) ||
    feeRate < minimum ||
    feeRate > MAX_FEE_RATE
  ) {
    throw new Error(`fee rate must be between ${minimum} and ${MAX_FEE_RATE} sat/vB`)
  }
  return feeRate
}
