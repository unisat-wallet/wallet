import { useI18n, useNavigation, useTools } from 'src/context'

export function useTxSuccessScreenLogic() {
  const nav = useNavigation()
  const { txid } = nav.getRouteState<'TxSuccessScreen'>()
  const { t } = useI18n()
  const tools = useTools()

  const onClickExploreTx = () => {
    nav.navToExplorerTx(txid)
  }

  const onClickDone = () => {
    nav.navigate('MainScreen')
  }

  const onClickCopy = () => {
    tools.copyToClipboard(txid)
  }

  return {
    // data
    txid,

    // actions
    onClickExploreTx,
    onClickDone,
    onClickCopy,

    // tools
    t,
  }
}
