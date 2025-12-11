import { AlkanesCollection } from '@unisat/wallet-shared'

import { useEffect, useRef } from 'react'
import {
  AlkanesAssetTabKey,
  getSupportedAssets,
  useAlkanesAssetTabKey,
  useChainType,
  useCurrentAccount,
  useNavigation,
  useWallet,
  useWallTabFocusRefresh,
} from '..'
import { useInfiniteList } from './useInfiniteList'

export function useAlkanesCollectionListLogic() {
  const nav = useNavigation()
  const wallet = useWallet()
  const currentAccount = useCurrentAccount()
  const chainType = useChainType()

  const {
    data: items,
    total,
    loading,
    hasMore,
    onRefresh,
    onLoadMore,
  } = useInfiniteList<AlkanesCollection>({
    fetcher: async (page, pageSize) => {
      const supportedAssets = getSupportedAssets(chainType, currentAccount.address)
      if (!supportedAssets.assets.alkanes || currentAccount.address === '') {
        return { list: [], total: 0 }
      }
      const { list, total } = await wallet.getAlkanesCollectionList(
        currentAccount.address,
        page,
        pageSize
      )

      return { list, total }
    },
    dependencies: [currentAccount.address, chainType],
  })

  const tabKey = useAlkanesAssetTabKey()
  const isFocus = tabKey === AlkanesAssetTabKey.COLLECTION
  const lastRefreshTimeRef = useRef<number>(0)
  const walletTabFocusRefresh = useWallTabFocusRefresh()
  useEffect(() => {
    if (!isFocus) return

    // already refreshed → do nothing
    const alreadyRefreshed = lastRefreshTimeRef.current === walletTabFocusRefresh
    if (alreadyRefreshed) return

    onRefresh()

    // mark refreshed
    lastRefreshTimeRef.current = walletTabFocusRefresh
  }, [walletTabFocusRefresh, isFocus])

  const onClickItem = (item: AlkanesCollection) => {
    nav.navigate('AlkanesCollectionScreen', { collectionId: item.alkaneid })
  }

  return { items, total, loading, hasMore, onRefresh, onLoadMore, onClickItem }
}
