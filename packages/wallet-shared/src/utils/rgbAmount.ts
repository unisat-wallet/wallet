/** Formats an RGB atomic amount using the asset's declared precision. */
export function toRgbDisplayAmount(
  value: string | number | undefined | null,
  precision: number
): string {
  if (value === undefined || value === null || value === '') return ''

  const rawAmount = String(value).trim()
  if (!/^\d+$/.test(rawAmount)) return rawAmount

  const normalizedAmount = rawAmount.replace(/^0+(?=\d)/, '') || '0'
  const normalizedPrecision =
    Number.isInteger(precision) && precision > 0 && precision <= 18 ? precision : 0
  if (normalizedPrecision === 0) return normalizedAmount

  const paddedAmount = normalizedAmount.padStart(normalizedPrecision + 1, '0')
  const integerPart = paddedAmount.slice(0, -normalizedPrecision)
  const decimalPart = paddedAmount.slice(-normalizedPrecision).replace(/0+$/, '')
  return decimalPart ? `${integerPart}.${decimalPart}` : integerPart
}
