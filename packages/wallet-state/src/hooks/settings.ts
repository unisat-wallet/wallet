import compareVersions from 'compare-versions'
import { useCallback } from 'react'

import { BABYLON_CONFIG_MAP } from '@unisat/babylon-service/types'
import { CAT_VERSION, CHAINS_MAP, PlatformEnv } from '@unisat/wallet-shared'
import { AddressType, ChainType, NetworkType } from '@unisat/wallet-types'
import { useWallet } from '../context/WalletContext'
import { getAddressType } from '../utils/bitcoin-utils'

import { useI18n } from 'src/context/I18nContext'
import { AppState } from '..'
import { useCurrentAccount } from '../hooks/accounts'
import { settingsActions } from '../reducers/settings'
import { useAppDispatch, useAppSelector } from './base'

export function useSettingsState(): AppState['settings'] {
  return useAppSelector(state => state.settings)
}

export function useLocale() {
  const settings = useSettingsState()
  return settings.locale
}

export function useChangeLocaleCallback() {
  const dispatch = useAppDispatch()
  const wallet = useWallet()
  const i18n = useI18n()
  return useCallback(
    async (locale: string) => {
      await wallet.setLocale(locale)
      await i18n.addResourceBundle(locale)
      i18n.changeLocale(locale)
      dispatch(
        (settingsActions as any).updateSettings({
          locale,
        })
      )

      // @ts-ignore
      window.location.reload()
    },
    [dispatch, wallet]
  )
}

export function useNetworkType() {
  const accountsState = useSettingsState()
  const chain = CHAINS_MAP[accountsState.chainType]
  if (chain) {
    return chain.networkType
  } else {
    return NetworkType.TESTNET
  }
}

export function useChangeNetworkTypeCallback() {
  const dispatch = useAppDispatch()
  const wallet = useWallet()
  return useCallback(
    async (type: NetworkType) => {
      if (type === NetworkType.MAINNET) {
        await wallet.setChainType(ChainType.BITCOIN_MAINNET)
        dispatch(
          (settingsActions as any).updateSettings({
            chainType: ChainType.BITCOIN_MAINNET,
          })
        )
      } else if (type === NetworkType.TESTNET) {
        await wallet.setChainType(ChainType.BITCOIN_TESTNET)
        dispatch(
          (settingsActions as any).updateSettings({
            chainType: ChainType.BITCOIN_TESTNET,
          })
        )
      }
    },
    [dispatch]
  )
}

export function useChainType() {
  const accountsState = useSettingsState()
  return accountsState.chainType
}

export function useChain() {
  const accountsState = useSettingsState()
  return CHAINS_MAP[accountsState.chainType]
}

export function useChangeChainTypeCallback() {
  const dispatch = useAppDispatch()
  const wallet = useWallet()
  return useCallback(
    async (type: ChainType) => {
      await wallet.setChainType(type)
      dispatch(
        (settingsActions as any).updateSettings({
          chainType: type,
        })
      )
    },
    [dispatch]
  )
}

export function useBTCUnit() {
  const chainType = useChainType()
  return CHAINS_MAP[chainType]!.unit
}

export function useTxExplorerUrl(txid: string) {
  const chain = useChain()!
  if (chain.enum === ChainType.BITCOIN_MAINNET) {
    return `${chain.unisatExplorerUrl}/tx/${txid}`
  } else if (chain.defaultExplorer === 'mempool-space') {
    return `${chain.mempoolSpaceUrl}/tx/${txid}`
  } else {
    return `${chain.unisatExplorerUrl}/tx/${txid}`
  }
}

export function useGetTxExplorerUrlCallback() {
  const chain = useChain()!
  return useCallback(
    (txid: string) => {
      if (chain.enum === ChainType.BITCOIN_MAINNET) {
        return `${chain.unisatExplorerUrl}/tx/${txid}`
      } else if (chain.defaultExplorer === 'mempool-space') {
        return `${chain.mempoolSpaceUrl}/tx/${txid}`
      } else {
        return `${chain.unisatExplorerUrl}/tx/${txid}`
      }
    },
    [chain]
  )
}

export function useAddressExplorerUrl(address: string) {
  const chain = useChain()!
  if (chain.enum === ChainType.BITCOIN_MAINNET) {
    return `${chain.unisatExplorerUrl}/address/${address}`
  } else if (chain.defaultExplorer === 'mempool-space') {
    return `${chain.mempoolSpaceUrl}/address/${address}`
  } else {
    return `${chain.unisatExplorerUrl}/address/${address}`
  }
}

export function useCAT20TokenInfoExplorerUrl(version: CAT_VERSION, tokenId: string) {
  const chain = useChain()!
  if (version === CAT_VERSION.V1) {
    return `${chain.unisatExplorerUrl}/cat20/${tokenId}`
  } else {
    return `${chain.unisatExplorerUrl}/cat20-v2/${tokenId}`
  }
}

export function useBRC20TokenInfoExplorerUrl(ticker: string) {
  const chain = useChain()!
  return `${chain.unisatExplorerUrl}/brc20/${encodeURIComponent(ticker)}`
}

export function useUnisatWebsite() {
  const chainType = useChainType()
  return CHAINS_MAP[chainType]!.unisatUrl
}

export function useIconBaseUrl() {
  const chainType = useChainType()
  return CHAINS_MAP[chainType]!.iconBaseUrl
}

export function useOrdinalsWebsite() {
  const chainType = useChainType()
  return CHAINS_MAP[chainType]!.ordinalsUrl
}

export function useWalletConfig() {
  const accountsState = useSettingsState()
  return accountsState.walletConfig
}

export function useVersionInfo() {
  const accountsState = useSettingsState()
  const walletConfig = accountsState.walletConfig
  const newVersion = walletConfig.version
  const skippedVersion = accountsState.skippedVersion
  const currentVesion = PlatformEnv.VERSION
  let skipped = false
  let latestVersion = ''
  // skip if new version is empty
  if (!newVersion) {
    skipped = true
  }

  // skip if skipped
  if (newVersion == skippedVersion) {
    skipped = true
  }

  // skip if current version is greater or equal to new version
  if (currentVesion && newVersion) {
    if (compareVersions(currentVesion, newVersion) >= 0) {
      skipped = true
    } else {
      latestVersion = newVersion
    }
  }

  // skip if current version is 0.0.0
  if (currentVesion === '0.0.0') {
    skipped = true
  }
  return {
    currentVesion,
    newVersion,
    latestVersion,
    skipped,
    downloadUrl: '',
    isNewest: false,
  }
}

export function useSkipVersionCallback() {
  const wallet = useWallet()
  const dispatch = useAppDispatch()
  return useCallback((version: string) => {
    wallet.setSkippedVersion(version).then(v => {
      dispatch((settingsActions as any).updateSettings({ skippedVersion: version }))
    })
  }, [])
}

export function useAutoLockTimeId() {
  const state = useSettingsState()
  return state.autoLockTimeId
}

export function useAddressTips() {
  const chain = useChain()!
  const account = useCurrentAccount()
  const address = account.address
  const chanEnum = chain.enum
  const { t } = useI18n()
  let ret = {
    homeTip: '',
    sendTip: '',
  }
  try {
    const chain = CHAINS_MAP[chanEnum]!
    const addressType = getAddressType(address, chain.networkType)
    if (chain.isFractal && addressType === AddressType.P2PKH) {
      ret = {
        homeTip: t('legacy_address_warning_3'),
        sendTip: t('legacy_address_warning_4'),
      }
    }
  } catch (e) {
    console.log(e)
  }

  return ret
}

export function useCAT721NFTContentBaseUrl(version: CAT_VERSION) {
  const chainType = useChainType()
  if (chainType === ChainType.FRACTAL_BITCOIN_MAINNET) {
    if (version === CAT_VERSION.V1) {
      return 'https://tracker-fractal-mainnet.catprotocol.org'
    } else {
      return 'https://tracker2-fractal-mainnet.catprotocol.org'
    }
  } else if (chainType === ChainType.FRACTAL_BITCOIN_TESTNET) {
    return 'https://tracker-fractal-testnet.catprotocol.org'
  } else {
    return ''
  }
}

export function useBabylonConfig() {
  const chainType = useChainType()
  return BABYLON_CONFIG_MAP[chainType] || BABYLON_CONFIG_MAP[ChainType.BITCOIN_MAINNET]
}

export function useIsMainnetChain() {
  const chainType = useChainType()
  return chainType === ChainType.BITCOIN_MAINNET || chainType === ChainType.FRACTAL_BITCOIN_MAINNET
}

export function useDeveloperMode() {
  const settings = useSettingsState()
  return settings.developerMode
}

export function useSetDeveloperModeCallback() {
  const dispatch = useAppDispatch()
  const wallet = useWallet()
  return useCallback(
    async (developerMode: boolean) => {
      await wallet.setDeveloperMode(developerMode)
      dispatch(
        (settingsActions as any).updateSettings({
          developerMode,
        })
      )
    },
    [dispatch, wallet]
  )
}
