import { bnUtils } from './bn'

function formatAmount<T extends string | number>(val: T): T {
  if (!val) {
    throw new Error('Amount is required')
  }

  if (typeof val === 'string') {
    let stringValue = val as string
    if (stringValue && stringValue.endsWith('.')) {
      stringValue = stringValue.slice(0, -1)
    }

    const amount = bnUtils.toBigNumber(stringValue)
    if (!amount.isFinite() || !amount.isGreaterThan(0)) {
      throw new Error('Amount must be greater than 0')
    }

    return amount.toFixed() as T
  } else {
    const numberValue = val as number
    if (!Number.isFinite(numberValue) || numberValue <= 0) {
      throw new Error('Amount must be greater than 0')
    }
    return numberValue as T
  }
}

export const paramsUtils = {
  formatAmount,
}
