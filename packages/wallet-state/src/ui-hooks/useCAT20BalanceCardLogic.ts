import { bnUtils } from '@unisat/base-utils'
import { CAT20Balance, TickPriceItem } from '@unisat/wallet-shared'
import { useCAT20IconInfo } from 'src/hooks'

export interface CAT20BalanceCardProps {
  tokenBalance: CAT20Balance
  onClick?: () => void
  showPrice?: boolean
  price?: TickPriceItem
}

export function useCAT20BalanceCardLogic(props: CAT20BalanceCardProps) {
  const { tokenBalance, onClick, showPrice, price } = props
  const balance = bnUtils.toDecimalNumber(tokenBalance.amount, tokenBalance.decimals)
  const balanceStr = balance.toString()

  const iconInfo = useCAT20IconInfo(tokenBalance.name, tokenBalance.tokenId)

  return {
    // balance
    tokenBalance,
    balance,
    balanceStr,

    // price
    price,
    showPrice,

    // icon
    iconInfo,

    // click
    onClick,
  }
}
