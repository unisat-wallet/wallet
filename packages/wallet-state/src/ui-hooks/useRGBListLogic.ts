import { useEffect, useRef } from 'react'

import type { RgbBalance } from '..'
import {
  AssetTabKey,
  MoreAssetTabKey,
  getSupportedAssets,
  useAssetTabKey,
  useChainType,
  useCurrentAccount,
  useCurrentKeyring,
  useMoreAssetTabKey,
  useNavigation,
  useWallTabFocusRefresh,
  useWallet,
} from '..'
import { useInfiniteList } from './useInfiniteList'

export function useRGBListLogic() {
  const nav = useNavigation()
  const wallet = useWallet()
  const currentAccount = useCurrentAccount()
  const currentKeyring = useCurrentKeyring()
  const chainType = useChainType()

  const {
    data: items,
    total,
    loading,
    hasMore,
    onRefresh,
    onLoadMore,
  } = useInfiniteList<RgbBalance>({
    fetcher: async (page, pageSize) => {
      const supportedAssets = getSupportedAssets(chainType, currentAccount.address, {
        keyringType: currentKeyring?.type,
      })
      const enableRGBFetch = supportedAssets.assets.rgb && currentAccount.address !== ''

      if (!enableRGBFetch) {
        return { list: [], total: 0 }
      }
      const { list, total } = await wallet.getRGBList(currentAccount.address, page, pageSize)
      return { list, total }
    },
    dependencies: [currentAccount.address, chainType, currentKeyring?.type],
  })

  const assetTabKey = useAssetTabKey()
  const moreAssetTabKey = useMoreAssetTabKey()
  const isFocus =
    assetTabKey === AssetTabKey.MORE && moreAssetTabKey === MoreAssetTabKey.RGB_TOKEN_LIST
  const lastRefreshTimeRef = useRef<number>(0)
  const walletTabFocusRefresh = useWallTabFocusRefresh()

  useEffect(() => {
    if (!isFocus) return

    const alreadyRefreshed = lastRefreshTimeRef.current === walletTabFocusRefresh
    if (alreadyRefreshed) return

    onRefresh()
    lastRefreshTimeRef.current = walletTabFocusRefresh
  }, [walletTabFocusRefresh, isFocus])

  const onClickItem = (item: RgbBalance) => {
    const assetId = item.assetId
    if (!assetId) return

    nav.navigate('RGBTokenScreen', { assetId, tokenBalance: item })
  }

  return { items, total, loading, hasMore, onRefresh, onLoadMore, onClickItem }
}
