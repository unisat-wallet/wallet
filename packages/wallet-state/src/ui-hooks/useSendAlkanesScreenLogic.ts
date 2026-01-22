import { bnUtils } from '@unisat/base-utils'
import { Inscription, SignedData, SignPsbtParams, ToSignData } from '@unisat/wallet-shared'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n, useNavigation, useTools, useWallet } from 'src/context'
import {
  useCurrentAccount,
  useFeeRateBar,
  usePrepareSendAlkanesCallback,
  usePushBitcoinTxCallback,
} from 'src/hooks'
import { isValidAddress } from 'src/utils/bitcoin-utils'

export enum SendAlkanesScreenStep {
  CREATE_TX = 0,
  SIGN_TX = 1,
}

export function useSendAlkanesScreenLogic() {
  const nav = useNavigation()
  const props = nav.getRouteState<'SendAlkanesScreen'>()

  const { t } = useI18n()

  const tokenBalance = props.tokenBalance

  const tokenInfo = props.tokenInfo

  const [inputAmount, setInputAmount] = useState('')
  const [disabled, setDisabled] = useState(true)
  const [toInfo, setToInfo] = useState<{
    address: string
    domain: string
    inscription?: Inscription
  }>({
    address: '',
    domain: '',
    inscription: undefined,
  })

  const [availableBalance, setAvailableBalance] = useState(tokenBalance.amount)
  const [error, setError] = useState('')

  const totalBalanceStr = useMemo(() => {
    return bnUtils.toDecimalAmount(tokenBalance.amount, tokenBalance.divisibility)
  }, [tokenBalance])
  const availableBalanceStr = useMemo(() => {
    return bnUtils.toDecimalAmount(availableBalance, tokenBalance?.divisibility)
  }, [availableBalance, tokenBalance])

  const currentAccount = useCurrentAccount()

  const tools = useTools()

  const { feeRate } = useFeeRateBar()

  useEffect(() => {
    const run = async () => {
      const tokenSummary = await wallet.getAddressAlkanesTokenSummary(
        currentAccount.address,
        tokenBalance.alkaneid,
        true
      )
      setAvailableBalance(tokenSummary.tokenBalance.available)
    }

    run()
  }, [])

  useEffect(() => {
    setError('')
    setDisabled(true)

    if (!isValidAddress(toInfo.address)) {
      return
    }
    if (!inputAmount) {
      return
    }

    if (feeRate <= 0) {
      return
    }

    const sendingAmount = bnUtils.fromDecimalAmount(inputAmount, tokenBalance.divisibility)

    if (bnUtils.compareAmount(sendingAmount, '0') <= 0) {
      return
    }

    if (bnUtils.compareAmount(sendingAmount, availableBalance)! > 0) {
      setError(t('insufficient_balance'))
      return
    }

    setDisabled(false)
  }, [toInfo, inputAmount, availableBalance, feeRate])

  const transferData = useRef<{
    id: string
    toSignData: ToSignData
  }>({
    id: '',
    toSignData: null,
  })

  const [step, setStep] = useState(SendAlkanesScreenStep.CREATE_TX)

  const wallet = useWallet()

  const prepareSendAlkanes = usePrepareSendAlkanesCallback()
  const pushBitcoinTx = usePushBitcoinTxCallback()

  const onClickBack = () => {
    nav.goBack()
  }

  const onClickNext = async () => {
    tools.showLoading(true)
    try {
      const toSignData = await prepareSendAlkanes(
        toInfo,
        tokenBalance.alkaneid,
        bnUtils.fromDecimalAmount(inputAmount, tokenBalance.divisibility),
        feeRate
      )
      if (toSignData) {
        transferData.current.toSignData = toSignData
        setStep(1)
      }
    } catch (e) {
      setError((e as any).message)
    } finally {
      tools.showLoading(false)
    }
  }

  const signPsbtParams: SignPsbtParams = {
    data: {
      toSignDatas: [transferData.current.toSignData],
    },
  }

  const onSignPsbtHandleConfirm = async (signedDatas: SignedData[]) => {
    tools.showLoading(true)
    try {
      const { success, txid, error } = await pushBitcoinTx(signedDatas[0].psbtHex)
      if (success) {
        nav.navigate('TxSuccessScreen', { txid })
      } else {
        throw new Error(error)
      }
    } catch (e) {
      nav.navigate('TxFailScreen', { error: (e as any).message })
    } finally {
      tools.showLoading(false)
    }
  }

  const onSignPsbtHandleCancel = () => {
    setStep(SendAlkanesScreenStep.CREATE_TX)
  }

  const onSignPsbtHandleBack = () => {
    setStep(SendAlkanesScreenStep.CREATE_TX)
  }
  return {
    step,
    t,
    tokenBalance,
    tokenInfo,
    toInfo,
    totalBalanceStr,
    availableBalanceStr,

    inputAmount,
    disabled,
    error,

    // actions
    setToInfo,
    setInputAmount,
    onClickBack,
    onClickNext,

    // sign psbt actions
    onSignPsbtHandleConfirm,
    onSignPsbtHandleCancel,
    onSignPsbtHandleBack,
    signPsbtParams,
  }
}
