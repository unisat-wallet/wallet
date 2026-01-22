import { SignPsbtParams, SignPsbtResult } from '@unisat/wallet-shared'
import { useI18n, useNavigation } from 'src/context'
import { usePushBitcoinTxCallback } from 'src/hooks'

export function useTxConfirmScreenLogic() {
  const { t } = useI18n()
  const nav = useNavigation()
  const { toSignData } = nav.getRouteState<'TxConfirmScreen'>()
  const pushBitcoinTx = usePushBitcoinTxCallback()

  const signPsbtParams: SignPsbtParams = {
    data: {
      toSignDatas: [toSignData],
    },
  }

  const onClickBack = () => {
    nav.goBack()
  }

  const onClickCancel = () => {
    nav.goBack()
  }

  const onClickConfirm = async (signedDatas: SignPsbtResult) => {
    try {
      const { success, txid, error } = await pushBitcoinTx(signedDatas[0].psbtHex)
      if (success) {
        nav.navigate('TxSuccessScreen', { txid })
      } else {
        throw new Error(error)
      }
    } catch (e) {
      nav.navigate('TxFailScreen', { error: (e as any).message })
    }
  }

  return {
    // data
    signPsbtParams,

    // actions
    onClickBack,
    onClickCancel,
    onClickConfirm,
  }
}
