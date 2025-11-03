import { useEffect, useState } from 'react'

import { AlkanesBalance, TickPriceItem } from '@unisat/wallet-shared'
import { useChainType, useCurrentAccount, useI18n, useWallet, useTools, useNavigation } from '..'

export function useAlkanesListLogic() {
  const wallet = useWallet()
  const currentAccount = useCurrentAccount()
  const chainType = useChainType()
  const { t } = useI18n()

  const nav = useNavigation()

  const [tokens, setTokens] = useState<AlkanesBalance[]>([])
  const [total, setTotal] = useState(-1)
  const [pagination, setPagination] = useState({ currentPage: 1, pageSize: 100 })
  const [priceMap, setPriceMap] = useState<{ [key: string]: TickPriceItem }>()

  const tools = useTools()
  const fetchData = async () => {
    try {
      const { list, total } = await wallet.getAlkanesList(
        currentAccount.address,
        pagination.currentPage,
        pagination.pageSize
      )
      setTokens(list)
      setTotal(total)
      if (list.length > 0) {
        wallet.getAlkanesPrice(list.map(item => item.alkaneid)).then(setPriceMap)
      }
    } catch (e) {
      tools.toastError((e as Error).message)
    } finally {
      // tools.showLoading(false);
    }
  }

  useEffect(() => {
    fetchData()
  }, [pagination, currentAccount.address, chainType])

  const onPaginationChange = pagination => {
    setPagination(pagination)
  }

  return {
    total,
    tokens,
    priceMap,

    pagination,
    onPaginationChange,

    t,
    nav,
  }
}
