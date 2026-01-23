import { bnUtils } from '@unisat/base-utils'
import { Inscription, SignPsbtParams, SignPsbtResult, ToSignData } from '@unisat/wallet-shared'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n, useNavigation, useTools, useWallet } from 'src/context'
import { useCurrentAccount, useFeeRateBar, useRunesTx } from 'src/hooks'
import { getAddressUtxoDust, isValidAddress } from 'src/utils/bitcoin-utils'

export enum BRC20SingleStepKey {
  STEP1 = 'STEP1',
  STEP2 = 'STEP2',
  STEP3 = 'STEP3',
}

export function useBRC20SingleStepScreenLogic() {
  const nav = useNavigation()
  const props = nav.getRouteState<'BRC20SingleStepScreen'>()
  const { t } = useI18n()

  const tokenBalance = props.tokenBalance
  const tokenInfo = props.tokenInfo

  const tools = useTools()

  const runesTx = useRunesTx()
  const [inputAmount, setInputAmount] = useState('')
  const [disabled, setDisabled] = useState(true)
  const [toInfo, setToInfo] = useState<{
    address: string
    domain: string
    inscription?: Inscription
  }>({
    address: runesTx.toAddress,
    domain: runesTx.toDomain,
    inscription: undefined,
  })

  const [availableBalance, setAvailableBalance] = useState(tokenBalance.overallBalance)
  const [error, setError] = useState('')

  const defaultOutputValue = 546

  const currentAccount = useCurrentAccount()
  const [outputValue, setOutputValue] = useState(defaultOutputValue)
  const minOutputValue = useMemo(() => {
    if (toInfo.address) {
      const dust1 = getAddressUtxoDust(currentAccount.address)
      const dust2 = getAddressUtxoDust(toInfo.address)
      return Math.max(dust1, dust2)
    } else {
      return 0
    }
  }, [toInfo.address, currentAccount.address])

  const { feeRate } = useFeeRateBar()

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

    if (bnUtils.compareAmount(inputAmount, availableBalance)! > 0) {
      setError(t('insufficient_balance'))
      return
    }

    setDisabled(false)
  }, [toInfo, inputAmount, feeRate, outputValue, minOutputValue, availableBalance])

  const wallet = useWallet()
  const transferData = useRef<{
    id: string
    commitToSignData: ToSignData
    revealToSignData: ToSignData
  }>({
    id: '',
    commitToSignData: {
      psbtHex: '',
      toSignInputs: [],
    },
    revealToSignData: {
      psbtHex: '',
      toSignInputs: [],
    },
  })
  const [step, setStep] = useState<BRC20SingleStepKey>(BRC20SingleStepKey.STEP1)

  const signPsbtParamsStep2: SignPsbtParams = {
    data: {
      toSignDatas: [transferData.current.commitToSignData],
    },
  }

  const signPsbtParamsStep3: SignPsbtParams = {
    data: {
      toSignDatas: [transferData.current.revealToSignData],
    },
  }

  const onClickBack = () => {
    if (step === BRC20SingleStepKey.STEP1) {
      nav.goBack()
    } else if (step === BRC20SingleStepKey.STEP2) {
      setStep(BRC20SingleStepKey.STEP1)
    } else if (step === BRC20SingleStepKey.STEP3) {
      setStep(BRC20SingleStepKey.STEP2)
    } else {
      nav.goBack()
    }
  }

  const onClickConfirmStep1 = async () => {
    tools.showLoading(true)
    try {
      const step1 = await wallet.singleStepTransferBRC20Step1({
        userAddress: currentAccount.address,
        userPubkey: currentAccount.pubkey,
        receiver: toInfo.address,
        ticker: tokenBalance.ticker,
        amount: inputAmount,
        feeRate,
      })
      if (step1) {
        transferData.current.id = step1.orderId
        transferData.current.commitToSignData = step1.toSignData
        setStep(BRC20SingleStepKey.STEP2)
      }
    } catch (e) {
      const msg = (e as any).message
      setError((e as any).message)
    } finally {
      tools.showLoading(false)
    }
  }

  const onClickConfirmStep2 = async (signPsbtResult: SignPsbtResult) => {
    try {
      tools.showLoading(true)

      const step2 = await wallet.singleStepTransferBRC20Step2({
        orderId: transferData.current.id,
        commitTx: signPsbtResult[0].psbtHex,
      })

      transferData.current.revealToSignData = step2.toSignData

      setStep(BRC20SingleStepKey.STEP3)
    } catch (e) {
      console.log(e)
    } finally {
      tools.showLoading(false)
    }
  }

  const onClickConfirmStep3 = async (signPsbtResult: SignPsbtResult) => {
    tools.showLoading(true)
    try {
      const step3 = await wallet.singleStepTransferBRC20Step3({
        orderId: transferData.current.id,
        revealTx: signPsbtResult[0].psbtHex,
      })
      nav.navigate('TxSuccessScreen', { txid: step3.txid })
    } catch (e) {
      nav.navigate('TxFailScreen', { error: (e as any).message })
    } finally {
      tools.showLoading(false)
    }
  }

  return {
    // data
    signPsbtParamsStep2,
    signPsbtParamsStep3,

    availableBalance,
    tokenBalance,
    tokenInfo,
    inputAmount,
    setInputAmount,
    disabled,
    error,
    toInfo,
    setToInfo,

    // state
    step,

    // actions
    onClickBack,

    onClickConfirmStep1,
    onClickConfirmStep2,
    onClickConfirmStep3,

    // utils
    t,
    tools,
  }
}
