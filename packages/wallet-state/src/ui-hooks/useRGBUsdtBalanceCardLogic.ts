import { numUtils } from '@unisat/base-utils'
import BigNumber from 'bignumber.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'

import { AppState, uiActions } from '..'
import { useI18n, useNavigation, useWallet } from '../context'
import { useChain } from '../hooks'
import { useWalletView } from '../hooks/ui'
import type { RgbBalance } from '../types'
import { WalletView } from '../types/ui'
import { getRgbTokenPrecision, toRgbDisplayAmount } from '../utils/rgb-amount-utils'

const DEBOUNCE_DELAY = 1000

function findUsdtToken(items: RgbBalance[]) {
  return items.find((item) => {
    const ticker = (item.ticker || '').toUpperCase()
    const name = (item.name || '').toUpperCase()
    return ticker === 'USDT' || name === 'USDT'
  })
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
  const wallet = useWallet()
  const chain = useChain()
  const nav = useNavigation()
  const dispatch = useDispatch()
  const walletView = useWalletView()
  const isRgbView = walletView === WalletView.RGB
  const usdtToken = useMemo(() => findUsdtToken(items), [items])
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
  const [pendingInvoiceCount, setPendingInvoiceCount] = useState(0)

  const refreshPendingInvoices = useCallback(async () => {
    try {
      const value = await wallet.getRgbPendingReceiveInvoices()
      const list = Array.isArray(value?.list) ? value.list : []
      setPendingInvoiceCount(list.length)
    } catch {
      setPendingInvoiceCount(0)
    }
  }, [wallet])

  const refreshBalance = useCallback(
    (event?: { stopPropagation: () => void }) => {
      event?.stopPropagation()

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }

      debounceTimerRef.current = setTimeout(() => {
        onRefresh()
        refreshPendingInvoices()
        debounceTimerRef.current = null
      }, DEBOUNCE_DELAY)
    },
    [onRefresh, refreshPendingInvoices]
  )

  useEffect(() => {
    if (!isRgbView) return undefined

    refreshPendingInvoices()

    const intervalId = setInterval(() => {
      refreshPendingInvoices()
    }, 10000)

    return () => {
      clearInterval(intervalId)
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [isRgbView, refreshPendingInvoices])

  const onViewPendingInvoices = (event?: { stopPropagation: () => void }) => {
    event?.stopPropagation()
    nav.navigate('RGBReceiveScreen', {
      assetId: usdtToken?.assetId,
      tokenBalance: usdtToken,
      initialStep: 'pending_invoices',
    })
  }

  return {
    usdtToken,
    balanceAmount,
    mainPart,
    subPart,
    usdValue,
    pendingInvoiceCount,
    isBalanceHidden,
    handleHiddenToggle,
    refreshBalance,
    onViewPendingInvoices,
    t,
    chain,
  }
}
