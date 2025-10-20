import { useCallback, useEffect, useRef } from 'react'

import { Account } from '@unisat/wallet-shared'
import eventBus from '../utils/eventBus'

import { useIsUnlocked } from '../hooks/global'
import { globalActions } from '../reducers/global'
import { useAppDispatch } from '../hooks/base'
import { settingsActions } from '../reducers/settings'
import { useCurrentAccount, useFetchBalanceCallback, useReloadAccounts } from '../hooks/accounts'
import { accountActions } from '../reducers/accounts'
import { ChainType } from '@unisat/wallet-types'
import { useWallet } from '../context/WalletContext'

export function AccountUpdater() {
  const dispatch = useAppDispatch()
  const wallet = useWallet()
  const currentAccount = useCurrentAccount()
  const isUnlocked = useIsUnlocked()
  const selfRef = useRef({
    preAccountKey: '',
    loadingBalance: false,
    loadingHistory: false,
  })
  const self = selfRef.current

  const reloadAccounts = useReloadAccounts()
  const onCurrentChange = useCallback(async () => {
    if (isUnlocked && currentAccount && currentAccount.key != self.preAccountKey) {
      self.preAccountKey = currentAccount.key

      // setLoading(true);

      reloadAccounts()

      // setLoading(false);
    }
  }, [dispatch, currentAccount, wallet, isUnlocked])

  useEffect(() => {
    onCurrentChange()
  }, [currentAccount && currentAccount.key, isUnlocked])

  const fetchBalance = useFetchBalanceCallback()
  useEffect(() => {
    if (self.loadingBalance) {
      return
    }
    if (!isUnlocked) {
      return
    }
    self.loadingBalance = true
    fetchBalance().finally(() => {
      self.loadingBalance = false
    })
  }, [fetchBalance, wallet, isUnlocked, self])

  useEffect(() => {
    const accountChangeHandler = (account: Account) => {
      if (account && account.address) {
        dispatch((accountActions as any).setCurrent(account))
      }
    }
    eventBus.addEventListener('accountsChanged', accountChangeHandler)
    return () => {
      eventBus.removeEventListener('accountsChanged', accountChangeHandler)
    }
  }, [dispatch])

  useEffect(() => {
    const chaintChangeHandler = (params: { type: ChainType }) => {
      dispatch(
        (settingsActions as any).updateSettings({
          chainType: params.type,
        })
      )

      reloadAccounts()
    }
    eventBus.addEventListener('chainChanged', chaintChangeHandler)
    return () => {
      eventBus.removeEventListener('chainChanged', chaintChangeHandler)
    }
  }, [dispatch])

  useEffect(() => {
    const lockHandler = () => {
      dispatch(globalActions.update({ isUnlocked: false }))
    }
    eventBus.addEventListener('lock', lockHandler)
    return () => {
      eventBus.removeEventListener('lock', lockHandler)
    }
  }, [dispatch])

  useEffect(() => {
    const unlockHandler = () => {
      dispatch(globalActions.update({ isUnlocked: true }))
    }
    eventBus.addEventListener('unlock', unlockHandler)
    return () => {
      eventBus.removeEventListener('unlock', unlockHandler)
    }
  }, [dispatch])

  return null
}
