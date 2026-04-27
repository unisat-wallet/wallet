import { KeyringType } from '@unisat/keyring-service/types'
import { AddressCAT20TokenSummary, CAT_VERSION } from '@unisat/wallet-shared'
import { ChainType } from '@unisat/wallet-types'
import { useEffect, useMemo, useState } from 'react'
import { useI18n, useNavigation, useTools, useWallet } from 'src/context'
import {
  useCAT20IconInfo,
  useCAT20MarketPlaceWebsite,
  useCAT20TokenInfoExplorerUrl,
  useChainType,
  useCurrentAccount,
  useCurrentKeyring,
  useResetTxState,
} from 'src/hooks'

export function useCAT20TokenScreenLogic() {
  const nav = useNavigation()
  const { tokenId, version } = nav.getRouteState<'CAT20TokenScreen'>()
  const { t } = useI18n()
  const [tokenSummary, setTokenSummary] = useState<AddressCAT20TokenSummary>({
    cat20Balance: {
      tokenId: '',
      amount: '0',
      decimals: 0,
      symbol: '',
      name: '',
    },
    cat20Info: {
      tokenId: '',
      name: '',
      symbol: '',
      max: '0',
      premine: '0',
      limit: 0,
    },
  })

  const wallet = useWallet()

  const account = useCurrentAccount()
  const keyring = useCurrentKeyring()
  const [loading, setLoading] = useState(true)
  const tools = useTools()
  useEffect(() => {
    wallet.getAddressCAT20TokenSummary(version, account.address, tokenId).then(tokenSummary => {
      setTokenSummary(tokenSummary)
      setLoading(false)
    })
  }, [])

  const tokenUrl = useCAT20TokenInfoExplorerUrl(version, tokenSummary.cat20Info.tokenId)

  const enableTransfer = useMemo(() => {
    let enable = false
    if (tokenSummary.cat20Balance && tokenSummary.cat20Balance.amount !== '0') {
      enable = true
    }
    return enable
  }, [tokenSummary])

  const chainType = useChainType()
  const enableTrade = useMemo(() => {
    if (chainType === ChainType.FRACTAL_BITCOIN_MAINNET && version === CAT_VERSION.V1) {
      return true
    } else {
      return false
    }
  }, [chainType])
  const marketPlaceUrl = useCAT20MarketPlaceWebsite(tokenId)

  const resetTxState = useResetTxState()

  const onClickBack = () => {
    nav.goBack()
  }

  const onClickMerge = e => {
    if (keyring.type === KeyringType.KeystoneKeyring) {
      tools.toastError(t('merge_utxos_is_not_supported_for_keystone_yet'))
      return
    }
    resetTxState()
    nav.navigate('MergeCAT20Screen', {
      version: version,
      cat20Balance: tokenSummary.cat20Balance,
      cat20Info: tokenSummary.cat20Info,
    })
  }

  const onClickSend = e => {
    if (keyring.type === KeyringType.KeystoneKeyring) {
      tools.toastError(t('send_cat20_is_not_supported_for_keystone_yet'))
      return
    }
    resetTxState()
    nav.navigate('SendCAT20Screen', {
      version: version,
      cat20Balance: tokenSummary.cat20Balance,
      cat20Info: tokenSummary.cat20Info,
    })
  }

  const onClickTrade = e => {
    nav.navToUrl(marketPlaceUrl)
  }

  const onClickViewOnExplorer = e => {
    nav.navToUrl(tokenUrl)
  }

  const iconInfo = useCAT20IconInfo(tokenSummary.cat20Info.name, tokenSummary.cat20Info.tokenId)

  return {
    tokenSummary,
    loading,
    tokenUrl,
    enableTransfer,
    enableTrade,
    iconInfo,
    onClickMerge,
    onClickSend,
    onClickTrade,
    onClickBack,
    onClickViewOnExplorer,
    t,
  }
}
