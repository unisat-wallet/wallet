import { CAT721CollectionInfo, CAT_VERSION } from '@unisat/wallet-shared'
import { useI18n, useNavigation } from 'src/context'
import { useResetTxState } from 'src/hooks'

export function useCAT721NFTScreenLogic() {
  const nav = useNavigation()
  const { collectionInfo, localId, version } = nav.getRouteState<{
    version: CAT_VERSION
    collectionInfo: CAT721CollectionInfo
    localId: string
  }>()

  const { t } = useI18n()

  const resetTxState = useResetTxState()

  const onClickBack = () => {
    nav.goBack()
  }

  const onClickSend = () => {
    resetTxState()
    nav.navigate('SendCAT721Screen', {
      version: version,
      collectionInfo: collectionInfo,
      localId: localId,
    })
  }

  return {
    // info
    collectionInfo,
    localId,
    version,
    // i18n
    t,

    // actions
    onClickBack,
    onClickSend,
  }
}
