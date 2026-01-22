import { useEffect, useMemo, useState } from 'react'

import { AddressAlkanesTokenSummary } from '@unisat/wallet-shared'
import {
  useAlkanesIconInfo,
  useCurrentAccount,
  useI18n,
  useNavigation,
  useResetTxState,
  useTools,
  useWallet,
} from '..'

export function useAlkanesTokenScreenLogic() {
  const nav = useNavigation()
  const { alkaneid } = nav.getRouteState<'AlkanesTokenScreen'>()
  const [tokenSummary, setTokenSummary] = useState<AddressAlkanesTokenSummary>({
    tokenBalance: {
      alkaneid: '',
      name: '',
      amount: '',
      symbol: '',
      divisibility: 0,
      available: '',
    },
    tokenInfo: {
      alkaneid: '',
      name: '',
      symbol: '',
      totalSupply: '10000000000000',
      maxSupply: '10000000000000',
      cap: 0,
      mintable: false,
      perMint: '0',
      minted: 0,
      holders: 0,
      aligned: true,
      nftData: {
        collectionId: '',
      },
      logo: '',
    },
    tradeUrl: '',
    mintUrl: '',
  })

  const wallet = useWallet()

  const account = useCurrentAccount()

  const [loading, setLoading] = useState(true)

  const [warning, setWarning] = useState(false)

  const { t } = useI18n()

  useEffect(() => {
    wallet.getAddressAlkanesTokenSummary(account.address, alkaneid, false).then(tokenSummary => {
      setTokenSummary(tokenSummary)
      setLoading(false)
    })
  }, [])

  const resetTxState = useResetTxState()

  const enableMint = useMemo(() => {
    return tokenSummary.mintUrl && tokenSummary.mintUrl.trim() !== ''
  }, [tokenSummary.mintUrl])

  const enableTransfer = useMemo(() => {
    let enable = false
    if (tokenSummary.tokenBalance.amount !== '0') {
      enable = true
    }
    return enable
  }, [tokenSummary])

  const tools = useTools()

  const enableTrade = useMemo(() => {
    return tokenSummary.tradeUrl && tokenSummary.tradeUrl.trim() !== ''
  }, [tokenSummary.tradeUrl])

  const onClickMint = () => {
    if (tokenSummary.mintUrl) {
      nav.navToUrl(tokenSummary.mintUrl)
    }
  }

  const onClickSend = () => {
    if (tokenSummary.tokenInfo?.aligned === false) {
      // tools.toastError(t('important_to_not_transfer_this_token'));
      setWarning(true)
      return
    }

    resetTxState()
    nav.navigate('SendAlkanesScreen', {
      tokenBalance: tokenSummary.tokenBalance,
      tokenInfo: tokenSummary.tokenInfo,
    })
  }

  const onClickTrade = () => {
    if (tokenSummary.tradeUrl) {
      nav.navToUrl(tokenSummary.tradeUrl)
    }
  }

  const iconInfo = useAlkanesIconInfo(
    tokenSummary.tokenBalance.name,
    tokenSummary.tokenBalance.alkaneid
  )

  return {
    tokenSummary,
    loading,
    enableMint,
    enableTransfer,
    enableTrade,
    warning,
    setWarning,
    t,
    tools,
    onClickMint,
    onClickSend,
    onClickTrade,
    iconInfo,
  }
}
