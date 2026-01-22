import { Inscription, SignedData, SignPsbtParams, ToSignData } from '@unisat/wallet-shared'
import { useEffect, useRef, useState } from 'react'
import { useI18n, useNavigation, useTools } from 'src/context'
import {
  useCurrentAccount,
  useFeeRateBar,
  usePrepareSendAlkanesCallback,
  usePushBitcoinTxCallback,
} from 'src/hooks'
import { isValidAddress } from 'src/utils/bitcoin-utils'

export enum SendAlkanesNFTScreenStep {
  CREATE_TX = 0,
  SIGN_TX = 1,
}
export function useSendAlkanesNFTScreenLogic() {
  const nav = useNavigation()
  const props = nav.getRouteState<'SendAlkanesNFTScreen'>()

  const { t } = useI18n()

  const alkanesInfo = props.alkanesInfo

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

  const [error, setError] = useState('')

  const currentAccount = useCurrentAccount()

  const tools = useTools()

  const { feeRate } = useFeeRateBar()

  useEffect(() => {
    setError('')
    setDisabled(true)

    if (!isValidAddress(toInfo.address)) {
      return
    }

    if (feeRate <= 0) {
      return
    }

    setDisabled(false)
  }, [toInfo, feeRate])

  const transferData = useRef<{
    id: string
    toSignData: ToSignData
  }>({
    id: '',
    toSignData: null,
  })

  const [step, setStep] = useState(0)

  const prepareSendAlkanes = usePrepareSendAlkanesCallback()
  const pushBitcoinTx = usePushBitcoinTxCallback()

  const onCreateTxHandleConfirm = async () => {
    tools.showLoading(true)
    try {
      const toSignData = await prepareSendAlkanes(toInfo, alkanesInfo.alkaneid, '1', feeRate)
      if (toSignData) {
        transferData.current.toSignData = toSignData
        setStep(1)
      }
    } catch (e) {
      const msg = (e as any).message
      setError((e as any).message)
    } finally {
      tools.showLoading(false)
    }
  }

  const onCreateTxHandleBack = () => {
    nav.goBack()
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
    setStep(SendAlkanesNFTScreenStep.CREATE_TX)
  }

  const onSignPsbtHandleBack = () => {
    setStep(SendAlkanesNFTScreenStep.CREATE_TX)
  }

  const signPsbtParams: SignPsbtParams = {
    data: {
      toSignDatas: [transferData.current.toSignData],
    },
  }

  return {
    step,
    t,
    alkanesInfo,
    toInfo,
    disabled,
    error,
    setToInfo,

    onCreateTxHandleConfirm,
    onCreateTxHandleBack,

    onSignPsbtHandleConfirm,
    onSignPsbtHandleCancel,
    onSignPsbtHandleBack,
    signPsbtParams,
  }
}
