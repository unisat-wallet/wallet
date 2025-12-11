import { bnUtils, numUtils } from '@unisat/base-utils'
import { AlkanesBalance, TickPriceItem } from '@unisat/wallet-shared'
import { useAlkanesIconInfo, useChain } from 'src/hooks'

export interface AlkanesBalanceCardProps {
  tokenBalance: AlkanesBalance
  onClick?: () => void
  price?: TickPriceItem
}
export function useAlkanesBalanceCardLogic(props: AlkanesBalanceCardProps) {
  const { tokenBalance, onClick, price } = props

  const chain = useChain()
  const showPrice = chain.showPrice && price !== undefined

  const balance = bnUtils.toDecimalNumber(tokenBalance.amount, tokenBalance.divisibility)
  let balanceStr = balance.toString()
  if (balance.lt(0.0001)) {
    balanceStr = '<0.0001'
  } else {
    balanceStr = numUtils.showLongNumber(balance.toString())
  }

  const iconInfo = useAlkanesIconInfo(tokenBalance.name, tokenBalance.alkaneid)

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
