import { useMemo, useState } from 'react'

import { keyringsActions, useAppDispatch, useI18n, useNavigation, useWallet } from '..'
import { WalletKeyring } from '@unisat/wallet-shared'
export function useEditWalletNameScreenLogic() {
  const nav = useNavigation()
  const { keyring } = nav.getRouteState<{
    keyring: WalletKeyring
  }>()
  const { t } = useI18n()
  const wallet = useWallet()
  const [alianName, setAlianName] = useState(keyring.alianName || '')
  const dispatch = useAppDispatch()
  const handleOnClick = async () => {
    const newKeyring = await wallet.setKeyringAlianName(keyring, alianName || keyring.alianName)
    //@ts-ignore
    dispatch(keyringsActions.updateKeyringName(newKeyring))
    // window.history.go(-1);
  }

  const handleOnKeyUp = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if ('Enter' == e.key && e.ctrlKey) {
      handleOnClick()
    }
  }

  const isValidName = useMemo(() => {
    if (alianName.length == 0) {
      return false
    }
    return true
  }, [alianName])

  const truncatedTitle = useMemo(() => {
    if (keyring.alianName && keyring.alianName.length > 20) {
      return keyring.alianName.slice(0, 20) + '...'
    }
    return keyring.alianName || ''
  }, [keyring.alianName])

  const onInputChange = e => {
    if (e.target.value.length <= 20) {
      setAlianName(e.target.value)
    }
  }

  return {
    t,
    keyring,
    isValidName,
    truncatedTitle,
    handleOnClick,
    handleOnKeyUp,
    onInputChange,
  }
}
