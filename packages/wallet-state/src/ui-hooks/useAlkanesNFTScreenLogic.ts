import { useEffect, useState } from 'react'
import { useI18n, useNavigation, useWallet } from 'src/context'
import { useResetTxState } from 'src/hooks'

export function useAlkanesNFTScreenLogic() {
  const nav = useNavigation()
  const { alkanesInfo } = nav.getRouteState<'AlkanesNFTScreen'>()

  const { t } = useI18n()

  const resetTxState = useResetTxState()

  const [availableUtxo, setAvailableUtxo] = useState(0)
  const wallet = useWallet()

  useEffect(() => {
    const fetchData = async () => {
      const utxos = await wallet.getAssetUtxosAlkanes(alkanesInfo.alkaneid)
      setAvailableUtxo(utxos.length)
    }
    fetchData()
  }, [wallet])

  const onClickBack = () => {
    nav.goBack()
  }

  const onClickSend = () => {
    resetTxState()
    nav.navigate('SendAlkanesNFTScreen', {
      alkanesInfo,
    })
  }

  const disabledSend = availableUtxo <= 0

  return {
    alkanesInfo,
    t,
    availableUtxo,
    onClickBack,
    onClickSend,
    disabledSend,
  }
}
