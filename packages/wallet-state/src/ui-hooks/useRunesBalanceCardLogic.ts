import { bnUtils, numUtils } from '@unisat/base-utils'
import { RuneBalance, TickPriceItem } from '@unisat/wallet-shared'
import { useChain, useRunesIconInfo } from 'src/hooks'

export interface RunesBalanceCardProps {
  tokenBalance: RuneBalance
  onClick?: () => void
  price?: TickPriceItem
}
export function useRunesBalanceCardLogic(props: RunesBalanceCardProps) {
  const { tokenBalance, price, onClick } = props

  // balance
  const balance = bnUtils.toDecimalNumber(tokenBalance.amount, tokenBalance.divisibility)
  let balanceStr = balance.toString()
  if (balance.lt(0.0001)) {
    balanceStr = '<0.0001'
  } else {
    balanceStr = numUtils.showLongNumber(balance.toString())
  }

  // price
  const chain = useChain()
  const showPrice = chain.showPrice

  // icon
  const iconInfo = useRunesIconInfo(tokenBalance.spacedRune)

  return {
    // balance
    tokenBalance,
    balance,
    balanceStr,

    // price
    showPrice,
    price,

    // icon
    iconInfo,

    onClick,
  }
}
