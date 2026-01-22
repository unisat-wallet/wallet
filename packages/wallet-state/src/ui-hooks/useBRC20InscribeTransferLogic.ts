import { numUtils } from '@unisat/base-utils'
import {
  InscribeOrder,
  SignedData,
  SignPsbtParams,
  TokenBalance,
  TokenInfo,
  ToSignData,
} from '@unisat/wallet-shared'
import BigNumber from 'bignumber.js'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApproval, useI18n, useNavigation, useTools, useWallet } from 'src/context'
import {
  useBTCUnit,
  useCurrentAccount,
  useFeeRateBar,
  useFetchUtxosCallback,
  usePrepareSendBypassHeadOffsetsCallback,
  usePushBitcoinTxCallback,
  useUpdateFeeRateBar,
} from 'src/hooks'
import { getAddressUtxoDust } from 'src/utils/bitcoin-utils'

enum Step {
  STEP1,
  STEP2,
  STEP3,
  STEP4,
}

interface ContextData {
  step: Step
  ticker: string
  session?: any
  tokenBalance?: TokenBalance
  order?: InscribeOrder
  toSignData?: ToSignData
  amount?: string
  isApproval: boolean
  tokenInfo?: TokenInfo
  amountEditable?: boolean
}

interface UpdateContextDataParams {
  step?: Step
  ticket?: string
  session?: any
  tokenBalance?: TokenBalance
  order?: InscribeOrder
  toSignData?: ToSignData
  amount?: string
  tokenInfo?: TokenInfo
  amountEditable?: boolean
}

export interface BRC20InscribeTransferParams {
  contextData: ContextData
  updateContextData: (params: UpdateContextDataParams) => void
}

export function useBRC20InscribeTransferLogic() {
  const nav = useNavigation()
  const { ticker } = nav.getRouteState<'BRC20InscribeTransfer'>()

  const [contextData, setContextData] = useState<ContextData>({
    step: Step.STEP1,
    ticker: ticker,
    isApproval: false,
  })
  const updateContextData = useCallback(
    (params: UpdateContextDataParams) => {
      setContextData(Object.assign({}, contextData, params))
    },
    [contextData, setContextData]
  )
  return {
    contextData,
    updateContextData,
  }
}

export function useBRC20InscribeTransferLogicStep1(params: BRC20InscribeTransferParams) {
  const { contextData, updateContextData } = params
  const { t } = useI18n()
  const nav = useNavigation()

  const { rejectApproval } = useApproval()

  const handleCancel = () => {
    rejectApproval(t('user_rejected_the_request'))
  }

  const wallet = useWallet()
  const account = useCurrentAccount()
  const feeRateBarState = useFeeRateBar()
  const updateFeeRateBar = useUpdateFeeRateBar()
  const [inputAmount, setInputAmount] = useState('')

  const tools = useTools()
  const prepareSendBypassHeadOffsets = usePrepareSendBypassHeadOffsetsCallback()

  const fetchUtxos = useFetchUtxosCallback()

  const [loading, setLoading] = useState(true)
  const [loadingOnly, setLoadingOnly] = useState(false)
  const [inputError, setInputError] = useState('')
  const [inputErrorAvailable, setInputErrorAvailable] = useState('')

  const [disabled, setDisabled] = useState(true)

  const [inputDisabled, setInputDisabled] = useState(false)

  const defaultOutputValue = 546
  // const defaultOutputValue = getAddressUtxoDust(account.address);

  const [outputValue, setOutputValue] = useState<number>(defaultOutputValue)

  useEffect(() => {
    if (contextData.amount) {
      setInputAmount(contextData.amount.toString())
      setInputDisabled(true)
    }
  }, [])

  useEffect(() => {
    setInputError('')
    setInputErrorAvailable('')
    setDisabled(true)
    if (!inputAmount) {
      return
    }

    if (inputAmount.split('.').length > 1) {
      const decimal = inputAmount.split('.')[1].length
      const token_decimal = contextData.tokenInfo?.decimal || 0
      if (decimal > token_decimal) {
        setInputError(
          `${t('this_token_only_supports_up_to')} ${token_decimal} ${t('decimal_places')}`
        )
        return
      }
    }

    const amount = new BigNumber(inputAmount)
    if (!amount) {
      return
    }

    if (!contextData.tokenBalance) {
      return
    }

    if (amount.lte(0)) {
      return
    }

    if (amount.gt(contextData.tokenBalance.availableBalanceSafe)) {
      setInputErrorAvailable(t('insufficient_balance'))
      return
    }

    if (feeRateBarState.feeRate <= 0) {
      return
    }

    const dust = getAddressUtxoDust(account.address)
    if (outputValue < dust) {
      setInputError(`${t('output_value_must_be_at_least')} ${dust}`)
      return
    }

    if (!outputValue) {
      return
    }

    setDisabled(false)
  }, [inputAmount, feeRateBarState.feeRate, outputValue, contextData.tokenBalance])

  useEffect(() => {
    fetchUtxos()

    wallet
      .getBRC20Summary(account.address, contextData.ticker)
      .then(v => {
        updateContextData({ tokenBalance: v.tokenBalance, tokenInfo: v.tokenInfo })
        setTimeout(() => {
          setLoading(false)
        }, 100)
      })
      .catch(e => {
        tools.toastError(e.message)
      })
  }, [])

  const onClickInscribe = async () => {
    try {
      tools.showLoading(true)
      const amount = inputAmount
      const order = await wallet.inscribeBRC20Transfer(
        account.address,
        contextData.ticker,
        amount,
        feeRateBarState.feeRate,
        outputValue
      )

      const toSignData = await prepareSendBypassHeadOffsets({
        toAddressInfo: { address: order.payAddress, domain: '' },
        toAmount: order.totalFee,
        feeRate: feeRateBarState.feeRate,
      })
      updateContextData({ order, amount, toSignData, step: Step.STEP2 })
    } catch (e) {
      tools.toastError((e as Error).message.replace('Error:', ''))
    } finally {
      tools.showLoading(false)
    }
  }

  return {
    onClickInscribe,
    loading,
    t,
    nav,
    inputAmount,
    inputError,
    setInputAmount,
    inputDisabled,
    inputErrorAvailable,
    defaultOutputValue,
    setOutputValue,
    disabled,
    loadingOnly,
    handleCancel,
  }
}

export function useBRC20InscribeTransferLogicStep2(params: BRC20InscribeTransferParams) {
  const { contextData } = params
  const { order, tokenBalance, amount, toSignData, session } = contextData
  const btcUnit = useBTCUnit()
  const { t } = useI18n()

  if (!order || !tokenBalance || !toSignData) {
    return {
      isEmpty: true,
      networkFee: '0',
      outputValue: '0',
      minerFee: '0',
      originServiceFee: '0',
      serviceFee: '0',
      totalFee: '0',
      btcUnit,
      t,
      session,
      amount,
      tokenBalance,
    }
  }

  const fee = toSignData.estimatedFee || 0
  const networkFee = useMemo(() => numUtils.satoshisToAmount(fee), [fee])
  const outputValue = useMemo(
    () => numUtils.satoshisToAmount(order.outputValue),
    [order.outputValue]
  )
  const minerFee = useMemo(() => numUtils.satoshisToAmount(order.minerFee + fee), [order.minerFee])
  const originServiceFee = useMemo(
    () => numUtils.satoshisToAmount(order.originServiceFee),
    [order.originServiceFee]
  )
  const serviceFee = useMemo(() => numUtils.satoshisToAmount(order.serviceFee), [order.serviceFee])
  const totalFee = useMemo(() => numUtils.satoshisToAmount(order.totalFee + fee), [order.totalFee])

  return {
    networkFee,
    outputValue,
    minerFee,
    originServiceFee,
    serviceFee,
    totalFee,
    btcUnit,
    t,
    session,
    amount,
    tokenBalance,
    order,
    toSignData,
  }
}

export function useBRC20InscribeTransferLogicStep3(params: BRC20InscribeTransferParams) {
  const { contextData, updateContextData } = params

  const pushBitcoinTx = usePushBitcoinTxCallback()
  const nav = useNavigation()

  const onHeaderBack = () => {
    updateContextData({
      step: Step.STEP2,
    })
  }

  const onSignPsbtHandleCancel = () => {
    updateContextData({
      step: Step.STEP2,
    })
  }
  const signPsbtParams: SignPsbtParams = {
    data: {
      toSignDatas: [contextData.toSignData!],
    },
  }

  const tools = useTools()
  const onSignPsbtHandleConfirm = async (signedDatas: SignedData[]) => {
    tools.showLoading(true)
    try {
      const { success, txid, error } = await pushBitcoinTx(signedDatas[0].psbtHex)
      if (success) {
        nav.navigate('TxSuccessScreen', { txid })
      } else {
        throw new Error(error)
      }
      return
    } catch (e) {
      nav.navigate('TxFailScreen', { error: (e as any).message })
    } finally {
      tools.showLoading(false)
    }
  }

  return {
    signPsbtParams,
    onSignPsbtHandleConfirm,
    onSignPsbtHandleCancel,
    onHeaderBack,
  }
}

export function useBRC20InscribeTransferLogicStep4(params: BRC20InscribeTransferParams) {
  const { contextData } = params
  const { tokenBalance, order } = contextData
  const tools = useTools()
  const wallet = useWallet()
  const currentAccount = useCurrentAccount()
  const { resolveApproval, rejectApproval } = useApproval()
  const nav = useNavigation()
  const [result, setResult] = useState<any>()
  const { t } = useI18n()
  const checkResult = async () => {
    const result = await wallet.getInscribeResult(order.orderId)
    if (!result) {
      setTimeout(() => {
        checkResult()
      }, 2000)
      return
    }
    tools.showLoading(false)
    setResult(result)
  }

  useEffect(() => {
    checkResult()
  }, [])

  const onClickConfirm = () => {
    tools.showLoading(true)
    wallet
      .getBRC20Summary(currentAccount.address, tokenBalance.ticker)
      .then(v => {
        if (contextData.isApproval) {
          resolveApproval({
            inscriptionId: result.inscriptionId,
            inscriptionNumber: result.inscriptionNumber,
            ticker: tokenBalance.ticker,
            amount: result.amount,
          })
        } else {
          nav.navigate('BRC20SendScreen', {
            tokenBalance: v.tokenBalance,
            selectedInscriptionIds: [result.inscriptionId],
            selectedAmount: result.amount,
            tokenInfo: v.tokenInfo,
          })
        }
      })
      .finally(() => {
        tools.showLoading(false)
      })
  }

  return {
    t,
    result,
    onClickConfirm,
  }
}
