import { useI18n, useNavigation } from 'src/context'

export function useTxFailScreenLogic() {
  const nav = useNavigation()
  const { error } = nav.getRouteState<'TxFailScreen'>()
  const { t } = useI18n()

  const onClickBack = () => {
    nav.goBack()
  }

  const onClickDone = () => {
    nav.navigate('TabMainScreen')
  }
  return {
    // info
    error,

    // actions
    onClickBack,
    onClickDone,

    // tools
    t,
  }
}
