import { AddressTokenSummary, BRC20HistoryItem, Inscription } from '@unisat/wallet-shared'
import {
  useChain,
  useChainType,
  useCurrentAccount,
  useI18n,
  useNavigation,
  useTools,
  useWallet,
} from '..'
import { useEffect, useMemo, useState } from 'react'
import { shortAddress } from '../utils/ui-utils'
import { ChainType } from '@unisat/wallet-types'

import BigNumber from 'bignumber.js'
const PIZZASWAP_MODULE_ADDRESS =
  '6a2095ee19329a210f8d5ded9b5cfa55b74fdd3b1e9af1e202072db6d1be82d45bfd'
const BRIDGE_BURN_ADDRESS = '6a20ada13e56859a2ab2eeb93cb4dc19c6e3f5e94d0ed38ed95a30ddc43711a0ff14'

enum TabKey {
  DETAILS = 'details',
  HISTORY = 'history',
}

export function useBRC20TokenHistoryLogic(props: { ticker: string }) {
  const wallet = useWallet()
  const { t } = useI18n()

  const account = useCurrentAccount()

  const [items, setItems] = useState<BRC20HistoryItem[]>([])

  const [failed, setFailed] = useState(false)

  useEffect(() => {
    wallet
      .getBRC20RecentHistory(account.address, props.ticker)
      .then(setItems)
      .catch(() => setFailed(true))
  }, [account.address, props.ticker])

  const groupedItems = useMemo(() => {
    const groups: { [date: string]: BRC20HistoryItem[] } = {}
    items.forEach(item => {
      let time = item.blocktime
      if (item.blocktime == 0) {
        time = Date.now() / 1000
      }
      const date = new Date(time * 1000).toLocaleDateString()
      if (!groups[date]) {
        groups[date] = []
      }
      groups[date].push(item)
    })
    return Object.entries(groups).map(([date, items]) => ({ date, items }))
  }, [items])

  const displayItems = useMemo(() => {
    return groupedItems.map(({ date, items }) => ({
      date,
      items: items
        .map(item => {
          const key = item.txid + item.type

          let mainTitle = item.type
          let subTitle = ''
          let icon = ''
          let isPending = false
          if (item.blocktime == 0) {
            isPending = true
          }

          if (item.type === 'send') {
            mainTitle = t('brc20_history_type_send')
            subTitle = t('brc20_history_to') + ' ' + shortAddress(item.to)
            if (item.to === PIZZASWAP_MODULE_ADDRESS) {
              subTitle = t('brc20_history_to') + ' ' + 'PizzaSwap'
            }
            icon = 'history_send'
          } else if (item.type === 'single-step-transfer') {
            if (item.from === account.address) {
              mainTitle = t('brc20_history_type_send')
              subTitle = t('brc20_history_to') + ' ' + shortAddress(item.to)
              icon = 'history_send'
            } else {
              mainTitle = t('brc20_history_type_receive')
              subTitle = t('brc20_history_from') + ' ' + shortAddress(item.from)
              icon = 'history_receive'
            }
          } else if (item.type === 'receive') {
            mainTitle = t('brc20_history_type_receive')
            subTitle = t('brc20_history_from') + ' ' + shortAddress(item.from)
            icon = 'history_receive'
          } else if (item.type === 'withdraw') {
            mainTitle = t('brc20_history_type_withdraw')
            subTitle = t('brc20_history_from') + ' ' + 'PizzaSwap'
            icon = 'history_receive'
          } else if (item.type === 'inscribe-transfer') {
            mainTitle = t('brc20_history_type_inscribe_transfer')
            icon = 'history_inscribe'
          } else if (item.type === 'inscribe-mint') {
            mainTitle = t('brc20_history_type_inscribe_mint')
            icon = 'history_inscribe'
          } else {
            return null
          }

          const amount = item.amount

          return {
            key,
            icon,
            mainTitle,
            subTitle,
            amount,
            pending: isPending,
            txid: item.txid,
          }
        })
        .filter(v => v !== null),
    }))
  }, [t, groupedItems])

  return {
    displayItems,
    isFailed: failed,
    isEmpty: displayItems.length === 0,
  }
}

export function useBRC20TokenScreenLogic() {
  const nav = useNavigation()
  const { ticker } = nav.getRouteState<{
    ticker: string
  }>()
  const { t } = useI18n()

  const [activeTab, setActiveTab] = useState<TabKey>(TabKey.HISTORY)

  const [tokenSummary, setTokenSummary] = useState<AddressTokenSummary>({
    tokenBalance: {
      ticker,
      overallBalance: '',
      availableBalance: '',
      transferableBalance: '',
      availableBalanceSafe: '',
      availableBalanceUnSafe: '',
      selfMint: false,
    },
    tokenInfo: {
      totalSupply: '',
      totalMinted: '',
      decimal: 18,
      holder: '',
      inscriptionId: '',
      holdersCount: 0,
      historyCount: 0,
      logo: 'https://static.unisat.io/icon/brc20/unknown',
    },
    historyList: [],
    transferableList: [],
  })

  const wallet = useWallet()

  const account = useCurrentAccount()

  const [loading, setLoading] = useState(true)

  const [deployInscription, setDeployInscription] = useState<Inscription>()

  useEffect(() => {
    wallet.getBRC20Summary(account.address, ticker).then(tokenSummary => {
      if (tokenSummary.tokenInfo.holder == account.address) {
        wallet
          .getInscriptionInfo(tokenSummary.tokenInfo.inscriptionId)
          .then(data => {
            setDeployInscription(data)
          })
          .finally(() => {
            setTokenSummary(tokenSummary)
            setLoading(false)
          })
      } else {
        setTokenSummary(tokenSummary)
        setLoading(false)
      }
    })
  }, [])

  const enableMint = useMemo(() => {
    let enable = false
    if (tokenSummary.tokenBalance.selfMint) {
      if (tokenSummary.tokenInfo.holder == account.address) {
        if (tokenSummary.tokenInfo.totalMinted != tokenSummary.tokenInfo.totalSupply) {
          enable = true
        }
      }
    } else {
      if (tokenSummary.tokenInfo.totalMinted != tokenSummary.tokenInfo.totalSupply) {
        enable = true
      }
    }
    return enable
  }, [tokenSummary])

  const enableTransfer = useMemo(() => {
    let enable = false
    if (
      tokenSummary.tokenBalance.overallBalance !== '0' &&
      tokenSummary.tokenBalance.overallBalance !== ''
    ) {
      enable = true
    }
    return enable
  }, [tokenSummary])

  const tools = useTools()
  const chainType = useChainType()
  const chain = useChain()

  const isBrc20Prog = useMemo(() => {
    if (chainType === ChainType.BITCOIN_MAINNET || chainType === ChainType.BITCOIN_SIGNET) {
      if (ticker.length == 6) {
        return true
      }
    }
    return false
  }, [ticker, chainType])

  const enableTrade = useMemo(() => {
    if (isBrc20Prog && chainType === ChainType.BITCOIN_MAINNET) {
      return true
    }
    if (
      chainType === ChainType.BITCOIN_MAINNET ||
      chainType === ChainType.FRACTAL_BITCOIN_MAINNET
    ) {
      return true
    } else {
      return false
    }
  }, [chainType, isBrc20Prog])

  const enableHistory = isBrc20Prog ? false : true

  const tabItems = useMemo(() => {
    if (enableHistory) {
      const items = [
        {
          key: TabKey.HISTORY,
          label: t('history'),
        },
        {
          key: TabKey.DETAILS,
          label: t('details'),
        },
      ]
      return items
    } else {
      return [
        {
          key: TabKey.DETAILS,
          label: t('details'),
        },
      ]
    }
  }, [t, enableHistory])

  const onPizzaSwapBalance = tokenSummary?.tokenBalance?.swapBalance
  const onProgBalance = tokenSummary?.tokenBalance?.progBalance
  const inWalletBalance = tokenSummary?.tokenBalance?.overallBalance
  const totalBalance = useMemo(() => {
    if (!inWalletBalance) {
      return '--'
    }
    return new BigNumber(inWalletBalance)
      .plus(new BigNumber(onPizzaSwapBalance || 0))
      .plus(new BigNumber(onProgBalance || 0))
      .toString()
  }, [onPizzaSwapBalance, onProgBalance, inWalletBalance])

  const hasOutWalletBalance = (onPizzaSwapBalance || onProgBalance || '0')! !== '0'
  return {
    totalBalance,
    onPizzaSwapBalance,
    onProgBalance,
    inWalletBalance,
    hasOutWalletBalance,
    enableHistory,
    enableTrade,
    enableMint,
    enableTransfer,
    loading,
    tokenSummary,
    deployInscription,
    activeTab,
    setActiveTab,
    tabItems,
    t,
    ticker,
    chain,
    tools,
    isBrc20Prog,
  }
}
