export { toRgbDisplayAmount } from '@unisat/wallet-shared'

export const MAX_RGB_ATOMIC_AMOUNT = 0xffff_ffff_ffff_ffffn

export function formatMaxRgbDisplayAmount(precision: number) {
  const atomic = MAX_RGB_ATOMIC_AMOUNT.toString()
  const padded = precision > 0 ? atomic.padStart(precision + 1, '0') : atomic
  const integerPart = precision > 0 ? padded.slice(0, -precision) : padded
  const decimalPart = precision > 0 ? padded.slice(-precision) : ''
  const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return decimalPart ? `${formattedInteger}.${decimalPart}` : formattedInteger
}

export function isValidRgbDecimalAmount(value: string, precision: number) {
  if (!value) return false
  const decimalPattern = precision > 0 ? `(?:\\.\\d{0,${precision}})?` : ''
  return new RegExp(`^(?:0|[1-9]\\d*)${decimalPattern}$`).test(value)
}

export function getRgbTokenPrecision(value: unknown) {
  if (!value || typeof value !== 'object') return 0

  const record = value as Record<string, unknown>
  const candidates = [
    record['precision'],
    (record['tokenInfo'] as Record<string, unknown> | undefined)?.['precision'],
    (record['assetInfo'] as Record<string, unknown> | undefined)?.['precision'],
    (record['rgbInfo'] as Record<string, unknown> | undefined)?.['precision'],
  ]
  const precision = Number(candidates.find(candidate => candidate !== undefined))
  return Number.isInteger(precision) && precision >= 0 && precision <= 18 ? precision : 0
}

export function getRgbTotalAtomicAmount(value: unknown) {
  if (!value || typeof value !== 'object') return undefined

  const balance = value as Record<string, unknown>
  const settled = balance['settled'] ?? balance['balance'] ?? balance['spendable']
  const pending = balance['pending']
  if (settled === undefined && pending === undefined) return undefined

  try {
    return (BigInt(String(settled ?? 0)) + BigInt(String(pending ?? 0))).toString()
  } catch {
    return settled === undefined ? undefined : String(settled)
  }
}

export function getRgbIconShortName(name?: string, ticker?: string) {
  const source = (name || ticker || 'RGB').trim()
  return Array.from(source).slice(0, 2).join('').toUpperCase() || 'RG'
}

export function normalizeRgbAmountInput(value: string, precision: number) {
  let nextValue = value.trim().replace(/,/g, '')
  if (!nextValue) return ''

  nextValue = nextValue.replace(/[^\d.]/g, '')
  const [integerPart = '', ...decimalParts] = nextValue.split('.')
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/, '') || '0'

  if (precision === 0) return normalizedInteger
  if (decimalParts.length === 0) return normalizedInteger

  return `${normalizedInteger}.${decimalParts.join('').slice(0, precision)}`
}

export function toRgbAtomicAmount(value: string, precision: number) {
  const [integerPart = '0', decimalPart = ''] = value.split('.')
  if (precision === 0) return integerPart

  const paddedDecimal = decimalPart.padEnd(precision, '0').slice(0, precision)
  const atomicAmount = `${integerPart}${paddedDecimal}`.replace(/^0+(?=\d)/, '')
  return atomicAmount || '0'
}
