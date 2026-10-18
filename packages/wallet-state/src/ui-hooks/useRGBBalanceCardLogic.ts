import { numUtils } from '@unisat/base-utils'
import { TickPriceItem } from '@unisat/wallet-shared'
import BigNumber from 'bignumber.js'
import { useChain } from 'src/hooks'
import type { RgbBalance } from 'src/types'
import { getRgbIconShortName, getRgbTokenPrecision, toRgbDisplayAmount } from 'src/utils/rgb-amount-utils'

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
  const precision = getRgbTokenPrecision(tokenBalance)
  const balanceValue = toRgbDisplayAmount(tokenBalance?.spendable, precision) || '0'
  const balance = new BigNumber(balanceValue || 0)
  const balanceStr =
    balance.lt(0.0001) && balance.gt(0) ? '<0.0001' : numUtils.showLongNumber(balance.toString())
  const pendingValue = toRgbDisplayAmount(tokenBalance?.pending, precision) || '0'
  const pendingBalance = new BigNumber(pendingValue || 0)
  const pendingBalanceStr =
    pendingBalance.lt(0.0001) && pendingBalance.gt(0)
      ? '<0.0001'
      : numUtils.showLongNumber(pendingBalance.toString())
  const lockedValue = toRgbDisplayAmount(tokenBalance?.lockedAmount, precision) || '0'
  const lockedBalance = new BigNumber(lockedValue)
  const lockedBalanceStr =
    lockedBalance.lt(0.0001) && lockedBalance.gt(0)
      ? '<0.0001'
      : numUtils.showLongNumber(lockedBalance.toString())
  const existingIcon =
    tokenBalance?.['iconInfo'] && typeof tokenBalance['iconInfo'] === 'object'
      ? (tokenBalance['iconInfo'] as { iconUrl?: string })
      : undefined
  const iconInfo = {
    assetId: tokenBalance?.assetId,
    iconUrl:
      (typeof existingIcon?.iconUrl === 'string' && existingIcon.iconUrl) ||
      (typeof tokenBalance?.['iconUrl'] === 'string' ? tokenBalance['iconUrl'] : ''),
    iconShortName: getRgbIconShortName(name, ticker),
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
    pendingBalance,
    pendingBalanceStr,
    lockedBalance,
    lockedBalanceStr,
    showPrice,
    price,
    iconInfo,
  }
}
