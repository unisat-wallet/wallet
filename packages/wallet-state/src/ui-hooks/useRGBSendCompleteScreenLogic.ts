import { useI18n, useNavigation } from 'src/context'

export function useRGBSendCompleteScreenLogic() {
  const nav = useNavigation()
  const { txid, assetId, tokenBalance } = nav.getRouteState<'RGBSendCompleteScreen'>()
  const { t } = useI18n()

  const onClickExploreTx = () => {
    if (txid) {
      nav.navToExplorerTx(txid)
    }
  }

  const onClickDone = () => {
    nav.navigate('MainScreen')
  }

  return {
    txid,
    assetId,
    tokenBalance,
    onClickExploreTx,
    onClickDone,
    t,
  }
}
