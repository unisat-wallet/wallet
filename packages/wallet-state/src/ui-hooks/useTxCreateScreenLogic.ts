import { useEffect, useMemo, useState } from 'react'

import { numUtils } from '@unisat/base-utils'
import { COIN_DUST } from '@unisat/wallet-shared'
import {
  useAccountBalance,
  useBTCUnit,
  useChain,
  useFeeRateBar,
  useFetchUtxosCallback,
  useI18n,
  useNavigation,
  usePrepareSendBTCCallback,
  useTools,
  useUiTxCreateScreen,
  useUpdateUiTxCreateScreen,
  useWalletConfig,
} from '..'
import { isValidAddress } from '../utils/bitcoin-utils'

export function useTxCreateScreenLogic() {
  const { t, isSpecialLocale } = useI18n()
  const accountBalance = useAccountBalance()
  const nav = useNavigation()
  const btcUnit = useBTCUnit()

  const [disabled, setDisabled] = useState(true)

  const setUiState = useUpdateUiTxCreateScreen()
  const uiState = useUiTxCreateScreen()
  const feeRateBarState = useFeeRateBar()

  const toInfo = uiState.toInfo
  const inputAmount = uiState.inputAmount
  const feeRate = feeRateBarState.feeRate

  const [error, setError] = useState('')

  const [autoAdjust, setAutoAdjust] = useState(false)
  const fetchUtxos = useFetchUtxosCallback()

  const tools = useTools()
  useEffect(() => {
    tools.showLoading(true)
    fetchUtxos().finally(() => {
      tools.showLoading(false)
    })
  }, [])

  const prepareSendBTC = usePrepareSendBTCCallback()

  const toSatoshis = useMemo(() => {
    if (!inputAmount) return 0
    return numUtils.amountToSatoshis(inputAmount)
  }, [inputAmount])

  const dustAmount = useMemo(() => numUtils.satoshisToAmount(COIN_DUST), [COIN_DUST])

  const availableAmount = numUtils.satoshisToAmount(accountBalance.availableBalance)
  const unavailableAmount = numUtils.satoshisToAmount(accountBalance.unavailableBalance)

  const showUnavailable = accountBalance.unavailableBalance > 0

  const chain = useChain()
  useEffect(() => {
    setError('')
    setDisabled(true)
    if (!isValidAddress(toInfo.address)) {
      return
    }
    if (!toSatoshis) {
      return
    }
    if (toSatoshis < COIN_DUST) {
      setError(`${t('amount_must_be_at_least')} ${dustAmount} ${btcUnit}`)
      return
    }

    if (toSatoshis > accountBalance.availableBalance) {
      setError(t('amount_exceeds_your_available_balance'))
      return
    }

    if (feeRate <= 0) {
      return
    }

    setDisabled(false)
  }, [toInfo, inputAmount, feeRate])

  const walletConfig = useWalletConfig()

  const unavailableTipText = useMemo(() => {
    let tipText = ''
    tipText += t('unavailable_tooltip')

    if (walletConfig.disableUtxoTools) {
      tipText += t('future_versions_will_support_spending_these_assets')
    } else {
      tipText += t('you_can_unlock_these_assets_by_using_the_utxos_tools')
    }
    return tipText
  }, [chain.enum])

  const headerTitle = `${t('send')} ${btcUnit}`

  const onAddressInputChange = val => setUiState({ toInfo: val })

  const onAmountInputChange = amount => {
    if (autoAdjust == true) {
      setAutoAdjust(false)
    }
    setUiState({ inputAmount: amount })
  }

  const onAmountMaxClick = () => {
    setAutoAdjust(true)
    setUiState({ inputAmount: availableAmount.toString() })
  }

  const onClickNext = () => {
    prepareSendBTC({ toAddressInfo: toInfo, toAmount: toSatoshis, feeRate })
      .then(toSignData => {
        nav.navigate('TxConfirmScreen', {
          toSignData,
        })
      })
      .catch(e => {
        console.log(e)
        setError(e.message)
      })
  }

  return {
    headerTitle,
    chain,

    toInfo,
    onAddressInputChange,

    toSatoshis,
    inputAmount,
    onAmountInputChange,
    onAmountMaxClick,

    showUnavailable,
    availableAmount,
    unavailableAmount,
    unavailableTipText,
    btcUnit,
    t,

    walletConfig,
    isSpecialLocale,

    error,
    disabled,

    onClickNext,
  }
}
