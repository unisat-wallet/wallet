import { useCallback, useEffect, useState } from 'react'
import { BUS_METHODS } from '@unisat/wallet-shared'
import { useI18n, useNavigation, useTools, useWallet } from 'src/context'
import { uiEventBus } from 'src/utils/eventBus'

type Status = '' | 'error' | 'warning' | undefined
const PRIVATE_KEY_CLIPBOARD_CLEAR_DELAY_MS = 60_000

export function useExportPrivateKeyScreenLogic() {
  const { t } = useI18n()

  const nav = useNavigation()
  const { account } = nav.getRouteState<'ExportPrivateKeyScreen'>()

  const [password, setPassword] = useState('')
  const [disabled, setDisabled] = useState(true)

  const [privateKey, setPrivateKey] = useState({ hex: '', wif: '' })
  const [status, setStatus] = useState<Status>('')
  const [error, setError] = useState('')
  const wallet = useWallet()
  const tools = useTools()

  const btnClick = async () => {
    try {
      const _res = await wallet.getPrivateKey(password, account)
      setPrivateKey(_res)
    } catch (e) {
      setStatus('error')
      setError((e as any).message)
    }
  }

  const handleOnKeyUp = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ('Enter' == e.key) {
      btnClick()
    }
  }

  useEffect(() => {
    setDisabled(true)
    if (password) {
      setDisabled(false)
      setStatus('')
      setError('')
    }
  }, [password])

  const clearSensitiveState = useCallback(() => {
    setPassword('')
    setPrivateKey({ hex: '', wif: '' })
    setStatus('')
    setError('')
  }, [])

  useEffect(() => {
    const handleLocked = () => {
      clearSensitiveState()
      nav.navigate('UnlockScreen', { autoUnlockByFace: false })
    }

    uiEventBus.addEventListener(BUS_METHODS.LOCKED, handleLocked)
    return () => {
      uiEventBus.removeEventListener(BUS_METHODS.LOCKED, handleLocked)
    }
  }, [clearSensitiveState, nav])

  function copy(str: string) {
    tools.copyToClipboard(str, { clearAfterMs: PRIVATE_KEY_CLIPBOARD_CLEAR_DELAY_MS })
  }

  const onClickBack = () => {
    clearSensitiveState()
    nav.goBack()
  }

  return {
    t,
    password,
    setPassword,
    disabled,
    btnClick,
    handleOnKeyUp,
    privateKey,
    error,
    copy,
    onClickBack,
  }
}
