import { numUtils } from '@unisat/base-utils'
import BigNumber from 'bignumber.js'
import { useCallback, useMemo, useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'

import { AppState, uiActions } from '..'
import { useI18n } from '../context'
import { useChain } from '../hooks'
import { useWalletConfig } from '../hooks/settings'
import type { RgbBalance } from '../types'
import { getRgbTokenPrecision, toRgbDisplayAmount } from '../utils/rgb-amount-utils'
import { isSameRgbAssetId } from '../utils/rgb-usdt'

const DEBOUNCE_DELAY = 1000

function findUsdtToken(items: RgbBalance[], configuredAssetId: string) {
  if (!configuredAssetId) return undefined
  return items.find(item => isSameRgbAssetId(item.assetId, configuredAssetId))
}

function splitAmountParts(amount: string) {
  const normalized = amount === '--' ? '0' : amount
  if (!normalized.includes('.')) {
    return { mainPart: normalized, subPart: '' }
  }

  const [integerPart, decimalPart = ''] = normalized.split('.')
  if (decimalPart.length <= 4) {
    return { mainPart: `${integerPart}.${decimalPart}`, subPart: '' }
  }

  return {
    mainPart: `${integerPart}.${decimalPart.slice(0, 4)}`,
    subPart: decimalPart.slice(4),
  }
}

type RgbListSource = {
  items: RgbBalance[]
  onRefresh: () => void
}

export function useRGBUsdtBalanceCardLogic({ items, onRefresh }: RgbListSource) {
  const { t } = useI18n()
  const chain = useChain()
  const configuredUsdtAssetId = useWalletConfig().rgbUsdtAssetId?.trim() || ''
  const dispatch = useDispatch()
  const usdtToken = useMemo(
    () => findUsdtToken(items, configuredUsdtAssetId),
    [items, configuredUsdtAssetId]
  )
  const balanceValue = toRgbDisplayAmount(
    usdtToken?.spendable,
    getRgbTokenPrecision(usdtToken)
  ) || '0'
  const balance = new BigNumber(balanceValue || 0)
  const balanceAmount =
    balance.lt(0.0001) && balance.gt(0) ? '<0.0001' : numUtils.showLongNumber(balance.toString())
  const { mainPart, subPart } = splitAmountParts(balanceAmount)

  const usdValue = useMemo(() => {
    if (!chain.showPrice || balanceAmount === '--') {
      return '--'
    }
    if (balance.lte(0)) {
      return '0.00'
    }
    if (balance.lt(0.01)) {
      return '<0.01'
    }
    return balance.toFixed(2)
  }, [balance, balanceAmount, chain.showPrice])

  const isBalanceHidden = useSelector((state: AppState) => state.ui.isBalanceHidden)
  const handleHiddenToggle = (event?: { stopPropagation: () => void }) => {
    event?.stopPropagation()
    dispatch(uiActions['setBalanceHidden'](!isBalanceHidden))
  }

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const refreshBalance = useCallback(
    (event?: { stopPropagation: () => void }) => {
      event?.stopPropagation()

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }

      debounceTimerRef.current = setTimeout(() => {
        onRefresh()
        debounceTimerRef.current = null
      }, DEBOUNCE_DELAY)
    },
    [onRefresh]
  )

  return {
    usdtToken,
    assetCount: items.length,
    balanceAmount,
    mainPart,
    subPart,
    usdValue,
    isBalanceHidden,
    handleHiddenToggle,
    refreshBalance,
    t,
    chain,
  }
}
