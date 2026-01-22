import { Inscription } from '@unisat/wallet-shared'
import { useCallback, useEffect, useState } from 'react'
import { useI18n, useNavigation, useWallet } from 'src/context'
import { useCurrentAccount, useResetTxState } from 'src/hooks'

const HIGH_BALANCE = 10000

enum TabKey {
  DETAILS = 'DETAILS',
  PROVENANCE = 'PROVENANCE',
}
export function useOrdinalsInscriptionScreenLogic() {
  const nav = useNavigation()
  const props = nav.getRouteState<'OrdinalsInscriptionScreen'>()
  const inscriptionId = props.inscriptionId

  const [inscription, setInscription] = useState<Inscription>(props.inscription)
  const [isLoadingDetails, setIsLoadingDetails] = useState(false)
  const [isInitialLoading, setIsInitialLoading] = useState(!props.inscription)

  const currentAccount = useCurrentAccount()

  const resetTxState = useResetTxState()

  const { t } = useI18n()

  const [isNeedToSplit, setIsNeedToSplit] = useState(false)
  const [isMultiStuck, setIsMultiStuck] = useState(false)
  const wallet = useWallet()

  const [tabKey, setTabKey] = useState(TabKey.DETAILS)

  const resetState = useCallback(() => {
    setIsNeedToSplit(false)
    setIsMultiStuck(false)
    setIsLoadingDetails(false)
    setIsInitialLoading(!props?.inscription)
    setTabKey(TabKey.DETAILS)
  }, [props?.inscription])

  const fetchInscriptionData = async (id: string) => {
    if (!id) return

    // If we already have basic inscription data, show it immediately
    // and load details in the background
    const isBackgroundLoading = !!inscription

    if (isBackgroundLoading) {
      setIsLoadingDetails(true)
    } else {
      setIsInitialLoading(true)
    }

    try {
      const data = await wallet.getInscriptionInfo(id)
      setInscription(data)
      setTabKey(TabKey.DETAILS)

      if (data.multipleNFT) {
        setIsMultiStuck(true)

        if (data.sameOffset) {
          setIsNeedToSplit(false)
        } else {
          if (data.outputValue > HIGH_BALANCE) {
            setIsNeedToSplit(true)
          }
        }
      } else {
        if (data.outputValue > HIGH_BALANCE) {
          setIsNeedToSplit(true)
        }
      }
    } catch (e) {
      console.error('Failed to fetch inscription data:', e)
    } finally {
      setIsLoadingDetails(false)
      setIsInitialLoading(false)
    }
  }

  useEffect(() => {
    if (inscriptionId) {
      resetState()

      // Always fetch the latest data, but we'll show what we have immediately
      fetchInscriptionData(inscriptionId)
    }
  }, [inscriptionId])

  const onClickSplit = () => {
    resetTxState()
    nav.navigate('SplitOrdinalsInscriptionScreen', { inscription, inscriptionId })
  }

  const onClickSend = () => {
    resetTxState()
    nav.navigate('SendOrdinalsInscriptionScreen', { inscription, inscriptionId })
  }

  const isUnconfirmed = inscription ? inscription.timestamp == 0 : false

  const withSend = inscription ? currentAccount.address === inscription.address : false

  const children = inscription ? inscription.children || [] : []
  const parents = inscription ? inscription.parents || [] : []

  const hasProvenance = children.length > 0 || parents.length > 0
  const shouldShowTabs = hasProvenance === true

  return {
    inscription,
    isLoadingDetails,
    isInitialLoading,
    isNeedToSplit,
    isMultiStuck,
    tabKey,
    setTabKey,
    TabKey,
    resetState,
    t,
    inscriptionId,
    onClickSend,
    onClickSplit,
    isUnconfirmed,
    withSend,
    shouldShowTabs,
    nav,
  }
}
