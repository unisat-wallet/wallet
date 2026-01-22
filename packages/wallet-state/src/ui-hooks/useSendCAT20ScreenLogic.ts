import { bnUtils } from '@unisat/base-utils'
import {
  AddressCAT20UtxoSummary,
  Inscription,
  SignedData,
  SignPsbtParams,
  ToSignData,
} from '@unisat/wallet-shared'
import { AddressType } from '@unisat/wallet-types'
import BigNumber from 'bignumber.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n, useNavigation, useTools, useWallet } from 'src/context'
import { useCurrentAccount, useFeeRateBar, useNetworkType } from 'src/hooks'
import { getAddressType, isValidAddress } from 'src/utils/bitcoin-utils'

const MAX_TOKEN_INPUT = 4

export enum SendCAT20ScreenStep {
  PREPARE = 0,
  SIGN_COMMIT = 1,
  WAITING = 2,
  SIGN_REVEAL = 3,
}

export function useSendCAT20ScreenLogic() {
  const nav = useNavigation()
  const props = nav.getRouteState<'SendCAT20Screen'>()

  const cat20Balance = props.cat20Balance

  const cat20Info = props.cat20Info

  const wallet = useWallet()

  const { t } = useI18n()
  const [inputAmount, setInputAmount] = useState('')
  const [disabled, setDisabled] = useState(false)
  const [toInfo, setToInfo] = useState<{
    address: string
    domain: string
    inscription?: Inscription
  }>({
    address: '',
    domain: '',
    inscription: undefined,
  })

  const [tokenUtxoSummary, setTokenUtxoSummary] = useState<AddressCAT20UtxoSummary>({
    totalUtxoCount: 0,
    availableUtxoCount: 0,
    availableTokenAmounts: [],
  })
  const [error, setError] = useState('')

  const account = useCurrentAccount()

  const networkType = useNetworkType()

  const [showMergeBTCUTXOPopover, setShowMergeBTCUTXOPopover] = useState(false)
  const tools = useTools()

  useEffect(() => {
    tools.showLoading(true)
    wallet
      .getAddressCAT20UtxoSummary(props.version, account.address, cat20Balance.tokenId)
      .then(data => {
        setTokenUtxoSummary(data)
      })
      .finally(() => {
        tools.showLoading(false)
      })
  }, [])

  const availableTokenAmount = useMemo(() => {
    let amount = new BigNumber(0)
    for (
      let i = 0;
      i < Math.min(tokenUtxoSummary.availableTokenAmounts.length, MAX_TOKEN_INPUT);
      i++
    ) {
      amount = amount.plus(BigNumber(tokenUtxoSummary.availableTokenAmounts[i]))
    }
    return amount.toString()
  }, [tokenUtxoSummary])

  const { feeRate } = useFeeRateBar()

  useEffect(() => {
    setError('')
    setDisabled(true)

    if (!isValidAddress(toInfo.address)) {
      return
    }

    const addressType = getAddressType(toInfo.address, networkType)
    if (addressType !== AddressType.P2TR && addressType !== AddressType.P2WPKH) {
      setError(t('the_recipient_must_be_p2tr_or_p2wpkh_address_type'))
      return
    }

    if (!inputAmount) {
      return
    }

    if (!feeRate) {
      return
    }

    const amt = bnUtils.fromDecimalAmount(inputAmount, cat20Balance.decimals)
    if (bnUtils.compareAmount(amt, '0') != 1) {
      return
    }

    if (bnUtils.compareAmount(amt, availableTokenAmount) > 0) {
      // insufficient balance
      setError(t('insufficient_balance'))
      return
    }

    setDisabled(false)
  }, [toInfo, inputAmount, feeRate, availableTokenAmount])

  const transferData = useRef<{
    id: string
    commitToSignData: ToSignData
    revealToSignData: ToSignData
  }>({
    id: '',
    commitToSignData: {
      psbtHex: '',
      toSignInputs: [],
      autoFinalized: false,
    },
    revealToSignData: {
      psbtHex: '',
      toSignInputs: [],
      autoFinalized: false,
    },
  })
  const [step, setStep] = useState<SendCAT20ScreenStep>(SendCAT20ScreenStep.PREPARE)
  const onClickNext = async () => {
    tools.showLoading(true)
    try {
      const cat20Amount = bnUtils.fromDecimalAmount(inputAmount, cat20Balance.decimals)
      const step1 = await wallet.transferCAT20Step1(
        props.version,
        toInfo.address,
        cat20Balance.tokenId,
        cat20Amount,
        feeRate
      )
      if (step1) {
        transferData.current.id = step1.id
        transferData.current.commitToSignData = step1.toSignData
        setStep(1)
      }
    } catch (e) {
      const msg = (e as any).message
      if (msg.includes('-307')) {
        setShowMergeBTCUTXOPopover(true)
        return
      }
      setError((e as any).message)
    } finally {
      tools.showLoading(false)
    }
  }

  const onClickBack = () => {
    if (step === SendCAT20ScreenStep.PREPARE) {
      nav.goBack()
      return
    } else {
      setStep(SendCAT20ScreenStep.PREPARE)
    }
  }

  // sign commit psbt
  const signCommitPsbtParams: SignPsbtParams = {
    data: {
      toSignDatas: [transferData.current.commitToSignData],
    },
  }

  const onSignCommitPsbtHandleConfirm = async (signedDatas: SignedData[]) => {
    try {
      tools.showLoading(true)
      const step2 = await wallet.transferCAT20Step2(
        props.version,
        transferData.current.id,
        signedDatas[0].psbtHex
      )

      transferData.current.revealToSignData = step2.toSignData

      setStep(SendCAT20ScreenStep.WAITING)
      setTimeout(() => {
        setStep(SendCAT20ScreenStep.SIGN_REVEAL)
      }, 100)
    } catch (e) {
      console.log(e)
    } finally {
      tools.showLoading(false)
    }
  }

  const onSignCommitPsbtHandleCancel = () => {
    setStep(SendCAT20ScreenStep.PREPARE)
  }

  const onSignCommitPsbtHandleBack = () => {
    setStep(SendCAT20ScreenStep.PREPARE)
  }

  // sign reveal psbt
  const signRevealPsbtParams: SignPsbtParams = {
    data: {
      toSignDatas: [transferData.current.revealToSignData],
    },
  }

  const onSignRevealPsbtHandleConfirm = async (signedDatas: SignedData[]) => {
    tools.showLoading(true)
    try {
      const step3 = await wallet.transferCAT20Step3(
        props.version,
        transferData.current.id,
        signedDatas[0].psbtHex
      )
      nav.navigate('TxSuccessScreen', { txid: step3.txid })
    } catch (e) {
      // tools.toastError((e as any).message);
      nav.navigate('TxFailScreen', { error: (e as any).message })
    } finally {
      tools.showLoading(false)
    }
  }

  const onSignRevealPsbtHandleCancel = () => {
    setStep(SendCAT20ScreenStep.PREPARE)
  }

  const onSignRevealPsbtHandleBack = () => {
    setStep(SendCAT20ScreenStep.PREPARE)
  }

  // merge UTXO
  const shouldShowMerge = availableTokenAmount !== cat20Balance.amount

  const onClickMergeUTXO = () => {
    nav.navigate('MergeCAT20Screen', {
      version: props.version,
      cat20Balance: cat20Balance,
      cat20Info: cat20Info,
    })
  }

  return {
    // info
    cat20Info,
    cat20Balance,
    availableTokenAmount,
    toInfo,
    setToInfo,
    inputAmount,
    setInputAmount,
    error,
    disabled,
    step,
    showMergeBTCUTXOPopover,
    setShowMergeBTCUTXOPopover,
    shouldShowMerge,

    // actions
    onClickNext,
    onClickBack,

    // sign commit psbt actions
    onSignCommitPsbtHandleConfirm,
    onSignCommitPsbtHandleCancel,
    onSignCommitPsbtHandleBack,
    signCommitPsbtParams,

    // sign reveal psbt actions
    onSignRevealPsbtHandleConfirm,
    onSignRevealPsbtHandleCancel,
    onSignRevealPsbtHandleBack,
    signRevealPsbtParams,

    // merge UTXO action
    onClickMergeUTXO,

    // tools
    t,
  }
}
