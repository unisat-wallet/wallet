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

    const result = bnUtils.compareAmount(stringValue, '0')
    if (result && result <= 0) {
      throw new Error('Amount must be greater than 0')
    }

    return stringValue as T
  } else {
    const numberValue = val as number
    if (numberValue <= 0) {
      throw new Error('Amount must be greater than 0')
    }
    return numberValue as T
  }
}

export const paramsUtils = {
  formatAmount,
}
