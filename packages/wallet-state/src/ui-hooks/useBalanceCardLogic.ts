import { numUtils } from '@unisat/base-utils'
import { ChainType } from '@unisat/wallet-types'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { accountActions, AppState, uiActions } from 'src'
import { useI18n, useNavigation } from '../context'
import {
  useAccountBalance,
  useBalanceCardDetailExpanded,
  useBTCUnit,
  useChain,
  useFetchBalanceCallback,
  useToggleBalanceCardDetailExpanded,
  useWalletConfig,
} from '../hooks'

const DEBOUNCE_DELAY = 1000

export function useBalanceCardLogic() {
  const { t } = useI18n()

  const walletConfig = useWalletConfig()

  const accountBalance = useAccountBalance()
  const chain = useChain()
  const dispatch = useDispatch()

  const fetchBalance = useFetchBalanceCallback()

  const btcUnit = useBTCUnit()
  const nav = useNavigation()

  const isBtcMainnet = chain.enum === ChainType.BITCOIN_MAINNET

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Detail expand state
  const isDetailExpanded = useBalanceCardDetailExpanded()
  const toggleBalanceCardDetailExpanded = useToggleBalanceCardDetailExpanded()
  const handleExpandToggle = () => {
    toggleBalanceCardDetailExpanded()
  }

  // Balance visibility
  const isBalanceHidden = useSelector((state: AppState) => state.ui.isBalanceHidden)
  const handleHiddenToggle = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    dispatch(uiActions['setBalanceHidden'](!isBalanceHidden))
  }

  const isCurrentChainBalance = chain.enum == accountBalance.chainType
  const balanceValue = useMemo(() => {
    if (!isCurrentChainBalance) {
      return '--'
    }
    return numUtils.satoshisToAmount(accountBalance.totalBalance)
  }, [accountBalance.totalBalance, isCurrentChainBalance])

  const unavailableTipText = useMemo(() => {
    let tipText = ''
    tipText += t('unavailable_tooltip')

    if (walletConfig.disableUtxoTools) {
      tipText += t('future_versions_will_support_spending_these_assets')
    } else {
      tipText += t('you_can_unlock_these_assets_by_using_the_utxos_tools')
    }
    return tipText
  }, [t, walletConfig.disableUtxoTools])

  const showUtxoToolButton = walletConfig.disableUtxoTools
    ? false
    : isCurrentChainBalance && accountBalance.unavailableBalance > 0

  const totalBalance = accountBalance.totalBalance
  const availableBalance = accountBalance.availableBalance
  const unavailableBalance = accountBalance.unavailableBalance

  const totalAmount = numUtils.satoshisToAmount(accountBalance.totalBalance)
  const availableAmount = numUtils.satoshisToAmount(accountBalance.availableBalance)
  const unavailableAmount = numUtils.satoshisToAmount(accountBalance.unavailableBalance)

  const totalAmountMainPart = isBtcMainnet ? totalAmount.slice(0, -4) : totalAmount.slice(0, -8)
  const totalAmountSubPart = isBtcMainnet ? totalAmount.slice(-4) : totalAmount.slice(-8)

  // Passive refresh every 10 seconds
  useEffect(() => {
    const intervalId = setInterval(() => {
      dispatch(accountActions['expireBalance'](null))
      fetchBalance()
    }, 10000)

    return () => clearInterval(intervalId)
  }, [dispatch, fetchBalance])

  const refreshBalance = useCallback(
    (e?: React.MouseEvent) => {
      if (e) {
        e.stopPropagation()
      }

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }

      debounceTimerRef.current = setTimeout(() => {
        dispatch((accountActions as any).expireBalance(null))
        fetchBalance()
        debounceTimerRef.current = null
      }, DEBOUNCE_DELAY)
    },
    [dispatch, fetchBalance]
  )

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  const handleUnlock = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    if (walletConfig.disableUtxoTools) return

    nav.navToUtxoTools()
  }

  return {
    // state
    totalBalance,
    availableBalance,
    unavailableBalance,

    totalAmount,
    availableAmount,
    unavailableAmount,

    totalAmountMainPart,
    totalAmountSubPart,

    balanceValue,
    unavailableTipText,
    isCurrentChainBalance,
    showUtxoToolButton,

    // action
    handleUnlock,

    isDetailExpanded,
    handleExpandToggle,

    isBalanceHidden,
    handleHiddenToggle,

    refreshBalance,
    btcUnit,
    isBtcMainnet,

    chain,
    t,
  }
}
