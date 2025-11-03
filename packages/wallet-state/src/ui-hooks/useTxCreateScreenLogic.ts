import { useEffect, useMemo, useState } from 'react'

import {
  getSpecialLocale,
  useAccountBalance,
  useBitcoinTx,
  useBTCUnit,
  useChain,
  useFetchUtxosCallback,
  useI18n,
  usePrepareSendBTCCallback,
  useUiTxCreateScreen,
  useUpdateUiTxCreateScreen,
  useWalletConfig,
} from '..'
import { useNavigation, useTools } from '..'
import { COIN_DUST, RawTxInfo } from '@unisat/wallet-shared'
import { numUtils } from '@unisat/base-utils'
import { isValidAddress } from '../utils/bitcoin-utils'

export function useTxCreateScreenLogic() {
  const { t } = useI18n()
  const accountBalance = useAccountBalance()
  const nav = useNavigation()
  const bitcoinTx = useBitcoinTx()
  const btcUnit = useBTCUnit()
  const [isSpecialLocale, setIsSpecialLocale] = useState(false)
  useEffect(() => {
    getSpecialLocale().then(({ isSpecialLocale }) => {
      setIsSpecialLocale(isSpecialLocale)
    })
  }, [])
  const [disabled, setDisabled] = useState(true)

  const setUiState = useUpdateUiTxCreateScreen()
  const uiState = useUiTxCreateScreen()

  const toInfo = uiState.toInfo
  const inputAmount = uiState.inputAmount
  const enableRBF = uiState.enableRBF
  const feeRate = uiState.feeRate

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

  const [rawTxInfo, setRawTxInfo] = useState<RawTxInfo>()

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

    if (
      toInfo.address == bitcoinTx.toAddress &&
      toSatoshis == bitcoinTx.toSatoshis &&
      feeRate == bitcoinTx.feeRate &&
      enableRBF == bitcoinTx.enableRBF
    ) {
      //Prevent repeated triggering caused by setAmount
      setDisabled(false)
      return
    }

    prepareSendBTC({ toAddressInfo: toInfo, toAmount: toSatoshis, feeRate, enableRBF })
      .then(data => {
        // if (data.fee < data.estimateFee) {
        //   setError(`Network fee must be at leat ${data.estimateFee}`);
        //   return;
        // }
        setRawTxInfo(data)
        setDisabled(false)
      })
      .catch(e => {
        console.log(e)
        setError(e.message)
      })
  }, [toInfo, inputAmount, feeRate, enableRBF])

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

  const onFeeRateChange = (newFeeRate: number) => {
    setUiState({ feeRate: newFeeRate })
  }

  const onRBFChange = (enable: boolean) => {
    setUiState({ enableRBF: enable })
  }

  const onClickNext = () => {
    nav.navigate('TxConfirmScreen', { rawTxInfo })
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

    onFeeRateChange,

    enableRBF,
    onRBFChange,

    showUnavailable,
    availableAmount,
    unavailableAmount,
    unavailableTipText,
    btcUnit,
    t,

    walletConfig,
    isSpecialLocale,

    error,
    rawTxInfo,
    disabled,

    onClickNext,
  }
}
