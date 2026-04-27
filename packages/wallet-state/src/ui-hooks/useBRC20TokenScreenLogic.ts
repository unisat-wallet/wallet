import { AddressTokenSummary, BRC20HistoryItem, Inscription } from '@unisat/wallet-shared'
import { ChainType } from '@unisat/wallet-types'
import { useEffect, useMemo, useState } from 'react'
import {
  useBRC20IconInfo,
  useChain,
  useChainType,
  useCurrentAccount,
  useI18n,
  useNavigation,
  useResetTxState,
  useTools,
  useWallet,
} from '..'
import { shortAddress } from '../utils/ui-utils'

import BigNumber from 'bignumber.js'
const SWAP_MODULE_ADDRESS = '6a2095ee19329a210f8d5ded9b5cfa55b74fdd3b1e9af1e202072db6d1be82d45bfd'
const BRIDGE_BURN_ADDRESS = '6a20ada13e56859a2ab2eeb93cb4dc19c6e3f5e94d0ed38ed95a30ddc43711a0ff14'
const BRC20PROG_MODULE_ADDRESS = '6a09425243323050524f47'
export enum BRC20TokenScreenTabKey {
  DETAILS = 'details',
  HISTORY = 'history',
}

export interface BRC20OutWalletBalanceItem {
  key: 'wallet' | 'swap' | 'prog'
  label: string
  amount: string
}

const INSWAP_TICKER_WRAP_FB = 'sFB___000'
const INSWAP_TICKER_WRAP_BTC = 'sBTC___000'
const INSWAP_SWAP_ANCHOR = '#swap'

export function useBRC20TokenHistoryLogic(props: { ticker: string; displayName?: string }) {
  const wallet = useWallet()
  const { t } = useI18n()

  const account = useCurrentAccount()

  const nav = useNavigation()
  const { ticker, displayName } = props

  const [items, setItems] = useState<BRC20HistoryItem[]>([])

  const [loading, setLoading] = useState(true)

  const [failed, setFailed] = useState(false)

  useEffect(() => {
    wallet
      .getBRC20RecentHistory(account.address, ticker)
      .then(setItems)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }, [account.address, ticker])

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
    return groupedItems
      .map(({ date, items }) => ({
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
              icon = 'history_send'
              if (item.to === SWAP_MODULE_ADDRESS) {
                mainTitle = t('brc20_history_type_wrap')
                subTitle = t('brc20_history_to') + ' ' + 'InSwap'
                icon = 'history_wrap'
              } else if (item.to === BRC20PROG_MODULE_ADDRESS) {
                mainTitle = t('brc20_history_type_wrap')
                subTitle = t('brc20_history_to') + ' ' + 'brc2.0'
                icon = 'history_wrap'
              }
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
              mainTitle = t('brc20_history_type_unwrap')
              subTitle = t('brc20_history_from') + ' ' + 'InSwap'
              icon = 'history_unwrap'
            } else if (item.type === 'inscribe-transfer') {
              mainTitle = t('brc20_history_type_inscribe_transfer')
              icon = 'history_inscribe'
            } else if (item.type === 'inscribe-mint') {
              mainTitle = t('brc20_history_type_inscribe_mint')
              icon = 'history_inscribe'
            } else if (item.type === 'inscribe-deploy') {
              mainTitle = t('brc20_history_type_inscribe_deploy')
              icon = 'history_inscribe'
            } else if (item.type === 'brc20prog-withdraw-transfer') {
              mainTitle = t('brc20_history_type_unwrap')
              subTitle = t('brc20_history_from') + ' ' + 'brc2.0'
              icon = 'history_unwrap'
            } else if (item.type === 'brc20prog-withdraw-inscribe') {
              mainTitle = t('brc20_history_type_inscribe_transfer')
              subTitle = t('brc20_history_type_unwrap') + ' brc2.0'
              icon = 'history_inscribe'
            } else {
              const isSendLike = item.from === account.address
              mainTitle = isSendLike
                ? t('brc20_history_type_send')
                : t('brc20_history_type_receive')
              subTitle = isSendLike
                ? t('brc20_history_to') + ' ' + shortAddress(item.to)
                : t('brc20_history_from') + ' ' + shortAddress(item.from)
              icon = isSendLike ? 'history_send' : 'history_receive'
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
      .filter(group => group.items.length > 0)
  }, [account.address, t, groupedItems])

  return {
    displayItems,
    isFailed: failed,
    isEmpty: displayItems.length === 0,
    isLoading: loading,
  }
}

export function useBRC20TokenScreenLogic() {
  const nav = useNavigation()
  const { ticker } = nav.getRouteState<'BRC20TokenScreen'>()
  const { t } = useI18n()

  const [activeTab, setActiveTab] = useState<BRC20TokenScreenTabKey>(BRC20TokenScreenTabKey.HISTORY)

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

  const resetTxState = useResetTxState()
  useEffect(() => {
    wallet
      .getBRC20Summary(account.address, ticker)
      .then(tokenSummary => {
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
      .finally(() => {
        setLoading(false)
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
    if (
      chainType === ChainType.BITCOIN_MAINNET ||
      chainType === ChainType.FRACTAL_BITCOIN_MAINNET
    ) {
      return true
    } else {
      return false
    }
  }, [chainType])

  const enableHistory = true

  const tabItems = useMemo(() => {
    if (enableHistory) {
      const items = [
        {
          key: BRC20TokenScreenTabKey.HISTORY,
          label: t('history'),
        },
        {
          key: BRC20TokenScreenTabKey.DETAILS,
          label: t('details'),
        },
      ]
      return items
    } else {
      return [
        {
          key: BRC20TokenScreenTabKey.DETAILS,
          label: t('details'),
        },
      ]
    }
  }, [t, enableHistory])

  let showSwapBalance = false
  if (chain.isFractal) {
    showSwapBalance = true
  }

  let showProgBalance = false
  if (chain.enableBrc20Prog) {
    showProgBalance = true
  }

  const onSwapBalance = tokenSummary?.tokenBalance?.swapBalance
  const onProgBalance = tokenSummary?.tokenBalance?.progBalance

  const inWalletBalance = tokenSummary?.tokenBalance?.overallBalance
  const outWalletBalanceItems = useMemo<BRC20OutWalletBalanceItem[]>(() => {
    const items: BRC20OutWalletBalanceItem[] = [
      {
        key: 'wallet',
        label: t('brc20_in_wallet'),
        amount: inWalletBalance || '0',
      },
    ]

    if (showSwapBalance) {
      items.push({
        key: 'swap',
        label: t('brc20_on_swap'),
        amount: onSwapBalance,
      })
    }

    if (showProgBalance) {
      items.push({
        key: 'prog',
        label: t('brc20_on_prog'),
        amount: onProgBalance,
      })
    }

    return items
  }, [inWalletBalance, onProgBalance, onSwapBalance, t])
  const totalBalance = useMemo(() => {
    if (!inWalletBalance) {
      return '--'
    }
    return new BigNumber(inWalletBalance)
      .plus(new BigNumber(onSwapBalance || 0))
      .plus(new BigNumber(onProgBalance || 0))
      .toString()
  }, [onSwapBalance, onProgBalance, inWalletBalance])

  const brc20prog_ticker = encodeURIComponent(ticker)

  // brc20prog
  const onClickWrapBrc20Prog = () => {
    const url = `https://link.unisat.space/btc/wrap?tick=${brc20prog_ticker}`
    nav.navToUrl(url)
  }

  const onClickUnwrapBrc20Prog = () => {
    const url = `https://link.unisat.space/btc/wrap?action=unwrap&tick=${brc20prog_ticker}`
    nav.navToUrl(url)
  }

  const onClickSendBrc20Prog = () => {
    const url = `https://bestinslot.xyz/brc2.0/${brc20prog_ticker}/transfer`
    nav.navToUrl(url)
  }

  const inswap_ticker0 = encodeURIComponent(ticker)
  let inswap_ticker1 = INSWAP_TICKER_WRAP_FB
  if (inswap_ticker0 === INSWAP_TICKER_WRAP_FB) {
    inswap_ticker1 = INSWAP_TICKER_WRAP_BTC
  }

  // inswap
  const onClickSwapInSwap = () => {
    const url = `https://inswap.cc/swap/pools?q=${inswap_ticker0}`
    nav.navToUrl(url)
  }

  const onClickAddLiquidityInSwap = () => {
    const url = `https://inswap.cc/swap/pools?q=${inswap_ticker0}`
    nav.navToUrl(url)
  }

  const onClickWrapInSwap = () => {
    const url = `https://inswap.cc/swap?tab=deposit&t=${inswap_ticker0}${INSWAP_SWAP_ANCHOR}`
    nav.navToUrl(url)
  }

  const onClickUnwrapInSwap = () => {
    const url = `https://inswap.cc/swap?tab=withdraw&t=${inswap_ticker0}${INSWAP_SWAP_ANCHOR}`
    nav.navToUrl(url)
  }

  const onClickSendInSwap = () => {
    const url = `https://inswap.cc/swap/assets/account?tab=assets&t=${inswap_ticker0}&action=send`
    nav.navToUrl(url)
  }

  const onClickMint = () => {
    nav.navToInscribeBrc20(ticker)
  }

  const onClickSend = () => {
    resetTxState()
    nav.navigate('BRC20SendScreen', {
      tokenBalance: tokenSummary.tokenBalance,
      tokenInfo: tokenSummary.tokenInfo,
    })
  }

  const onClickTrade = () => {
    nav.navToMarketPlaceBrc20(ticker)
  }

  const onClickSingleStepSend = () => {
    resetTxState()
    nav.navigate('BRC20SingleStepScreen', {
      tokenBalance: tokenSummary.tokenBalance,
      tokenInfo: tokenSummary.tokenInfo,
    })
  }

  const iconInfo = useBRC20IconInfo(ticker)

  return {
    totalBalance,
    onSwapBalance,
    onProgBalance,
    inWalletBalance,
    outWalletBalanceItems,
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
    iconInfo,
    showProgBalance,
    showSwapBalance,
    onClickWrapBrc20Prog,
    onClickUnwrapBrc20Prog,
    onClickSendBrc20Prog,

    onClickSwapInSwap,
    onClickAddLiquidityInSwap,
    onClickWrapInSwap,
    onClickUnwrapInSwap,
    onClickSendInSwap,

    onClickMint,
    onClickSend,
    onClickTrade,
    onClickSingleStepSend,
  }
}
