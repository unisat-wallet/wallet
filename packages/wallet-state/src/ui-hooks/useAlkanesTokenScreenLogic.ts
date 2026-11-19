import { useEffect, useMemo, useState } from 'react'

import { AddressAlkanesTokenSummary } from '@unisat/wallet-shared'
import {
  useAlkanesIconInfo,
  useAlkanesInscribeUrl,
  useAlkanesTokenInfoExplorerUrl,
  useCurrentAccount,
  useCurrentAccountCapabilities,
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
  const accountCapabilities = useCurrentAccountCapabilities()

  const [loading, setLoading] = useState(true)

  const [warning, setWarning] = useState(false)

  const { t } = useI18n()
  const defaultMintUrl = useAlkanesInscribeUrl(alkaneid)

  useEffect(() => {
    wallet.getAddressAlkanesTokenSummary(account.address, alkaneid, false).then(tokenSummary => {
      setTokenSummary(tokenSummary)
      setLoading(false)
    })
  }, [])

  const resetTxState = useResetTxState()

  const mintUrl = useMemo(() => {
    const configuredMintUrl = tokenSummary.mintUrl?.trim()
    if (configuredMintUrl) {
      return configuredMintUrl
    }
    return tokenSummary.tokenInfo.mintable ? defaultMintUrl : ''
  }, [defaultMintUrl, tokenSummary.mintUrl, tokenSummary.tokenInfo.mintable])

  const enableMint = mintUrl !== ''

  const enableTransfer = useMemo(() => {
    let enable = false
    if (accountCapabilities.canCreateSigningRequest && tokenSummary.tokenBalance.amount !== '0') {
      enable = true
    }
    return enable
  }, [accountCapabilities.canCreateSigningRequest, tokenSummary])

  const tools = useTools()

  const enableTrade = useMemo(() => {
    return tokenSummary.tradeUrl && tokenSummary.tradeUrl.trim() !== ''
  }, [tokenSummary.tradeUrl])

  const onClickMint = () => {
    if (mintUrl) {
      nav.navToUrl(mintUrl)
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

  const alkanesExplorerUrl = useAlkanesTokenInfoExplorerUrl(tokenSummary.tokenInfo.alkaneid)

  const onClickViewOnExplorer = () => {
    nav.navToUrl(alkanesExplorerUrl)
  }

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
    onClickViewOnExplorer,
    iconInfo,
  }
}
