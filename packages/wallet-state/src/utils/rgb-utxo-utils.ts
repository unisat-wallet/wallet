export const RGB_UTXO_CREATE_COUNT = 5
export const RGB_UTXO_DUST_SATS = 330
export const RGB_UTXO_RECOMMENDED_BALANCE_SATS = 3_000

/** Conservative vsize for a typical funding transaction with five RGB outputs and change. */
const RGB_UTXO_CREATE_VBYTES = 350

export function estimateRgbUtxoCreateMinSats(feeRate: number): number {
  const rate = Number.isFinite(feeRate) && feeRate > 0 ? feeRate : 1
  return RGB_UTXO_CREATE_COUNT * RGB_UTXO_DUST_SATS + Math.ceil(rate * RGB_UTXO_CREATE_VBYTES)
}
