import { numUtils } from '@unisat/base-utils'
import { TickPriceItem } from '@unisat/wallet-shared'
import BigNumber from 'bignumber.js'
import { useChain } from 'src/hooks'
import type { RgbBalance } from 'src/types'

export interface RGBBalanceCardProps {
  tokenBalance?: RgbBalance
  onClick?: () => void
  price?: TickPriceItem
  'data-testid'?: string
}

export function useRGBBalanceCardLogic(props: RGBBalanceCardProps) {
  const { tokenBalance, onClick, price } = props
  const ticker = tokenBalance?.ticker || 'RGB'
  const name = tokenBalance?.name || ticker
  const balanceValue = tokenBalance?.spendable?.toString() || '0'
  const balance = new BigNumber(balanceValue || 0)
  const balanceStr =
    balance.lt(0.0001) && balance.gt(0) ? '<0.0001' : numUtils.showLongNumber(balance.toString())
  const iconInfo =
    tokenBalance?.['iconInfo'] && typeof tokenBalance['iconInfo'] === 'object'
      ? (tokenBalance['iconInfo'] as { iconUrl?: string; iconShortName?: string })
      : {
          iconUrl: typeof tokenBalance?.['iconUrl'] === 'string' ? tokenBalance['iconUrl'] : '',
          iconShortName: ticker.slice(0, 2).toUpperCase(),
        }

  const chain = useChain()
  const showPrice = chain.showPrice

  return {
    tokenBalance,
    onClick,
    ticker,
    name,
    balance,
    balanceStr,
    showPrice,
    price,
    iconInfo,
  }
}
