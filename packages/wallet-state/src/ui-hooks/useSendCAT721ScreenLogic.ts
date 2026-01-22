import { Inscription, SignedData, SignPsbtParams, ToSignData } from '@unisat/wallet-shared'
import { AddressType } from '@unisat/wallet-types'
import { useEffect, useRef, useState } from 'react'
import { useI18n, useNavigation, useTools, useWallet } from 'src/context'
import { useFeeRateBar, useNetworkType } from 'src/hooks'
import { getAddressType, isValidAddress } from 'src/utils/bitcoin-utils'

export enum SendCAT721ScreenStep {
  PREPARE = 0,
  SIGN_COMMIT = 1,
  WAITING = 2,
  SIGN_REVEAL = 3,
}
export function useSendCAT721ScreenLogic() {
  const nav = useNavigation()
  const { version, localId, collectionInfo } = nav.getRouteState<'SendCAT721Screen'>()

  const wallet = useWallet()
  const { t } = useI18n()

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

  const [error, setError] = useState('')

  const networkType = useNetworkType()

  const [showMergeBTCUTXOPopover, setShowMergeBTCUTXOPopover] = useState(false)
  const tools = useTools()

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

    setDisabled(false)
  }, [toInfo])

  const transferData = useRef<{
    id: string
    commitToSignData: ToSignData
    revealToSignData: ToSignData
  }>({
    id: '',
    commitToSignData: {} as ToSignData,
    revealToSignData: {} as ToSignData,
  })
  const [step, setStep] = useState<SendCAT721ScreenStep>(SendCAT721ScreenStep.PREPARE)
  const onClickNext = async () => {
    tools.showLoading(true)
    try {
      const step1 = await wallet.transferCAT721Step1(
        version,
        toInfo.address,
        collectionInfo.collectionId,
        localId,
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
    if (step === SendCAT721ScreenStep.PREPARE) {
      nav.goBack()
      return
    } else {
      setStep(SendCAT721ScreenStep.PREPARE)
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
      const step2 = await wallet.transferCAT721Step2(
        version,
        transferData.current.id,
        signedDatas[0].psbtHex
      )

      transferData.current.revealToSignData = step2.toSignData

      setStep(SendCAT721ScreenStep.WAITING)
      setTimeout(() => {
        setStep(SendCAT721ScreenStep.SIGN_REVEAL)
      }, 100)
    } catch (e) {
      console.log(e)
    } finally {
      tools.showLoading(false)
    }
  }

  const onSignCommitPsbtHandleCancel = () => {
    setStep(SendCAT721ScreenStep.PREPARE)
  }

  const onSignCommitPsbtHandleBack = () => {
    setStep(SendCAT721ScreenStep.PREPARE)
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
      const step3 = await wallet.transferCAT721Step3(
        version,
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
    setStep(SendCAT721ScreenStep.PREPARE)
  }

  const onSignRevealPsbtHandleBack = () => {
    setStep(SendCAT721ScreenStep.PREPARE)
  }

  return {
    // info
    version,
    localId,
    collectionInfo,
    toInfo,
    setToInfo,
    error,
    disabled,
    step,
    showMergeBTCUTXOPopover,
    setShowMergeBTCUTXOPopover,

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

    // tools
    t,
  }
}
