export function numberWithCommas(value: string, maxFixed: number, isFixed = false) {
  const [integerPart, decimalPart] = value.toString().split('.')
  const integerPartWithCommas = integerPart!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  if (maxFixed === 0) {
    // no decimal
    return integerPartWithCommas
  } else if (maxFixed > 0) {
    if (isFixed) {
      // fixed
      return `${integerPartWithCommas}.${(decimalPart || '')
        .substring(0, maxFixed)
        .padEnd(maxFixed, '0')}`
    } else {
      return decimalPart
        ? `${integerPartWithCommas}.${decimalPart.substring(
            0,
            Math.min(maxFixed, decimalPart.length)
          )}`
        : integerPartWithCommas
    }
  } else {
    // fixed <0 show all decimal
    return decimalPart ? `${integerPartWithCommas}.${decimalPart}` : integerPartWithCommas
  }
}

export function showLongNumber(num: string | number | undefined, maxFixed = 8, isFixed = false) {
  if (!num || new BigNumber(num).isZero()) return '0'
  if (Math.abs(num as number) < 0.000001 && maxFixed <= 6) {
    let temp = '0.'
    for (let i = 0; i < maxFixed; i += 1) {
      temp += '0'
    }
    return temp
  }
  return numberWithCommas(num.toString(), maxFixed, isFixed)
}

BigNumber.config({ EXPONENTIAL_AT: 1e9, DECIMAL_PLACES: 38 })

export function satoshisToAmount(val: number) {
  const num = new BigNumber(val)
  return num.dividedBy(100000000).toFixed(8)
}

export function amountToSatoshis(val: any) {
  const num = new BigNumber(val)
  return num.multipliedBy(100000000).toNumber()
}

export const numUtils = {
  numberWithCommas,
  showLongNumber,
  satoshisToAmount,
  amountToSatoshis,
}
