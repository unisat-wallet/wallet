import { useEffect, useState } from 'react'
import { useI18n, useNavigation, useTools, useWallet } from 'src/context'

type Status = '' | 'error' | 'warning' | undefined
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

  function copy(str: string) {
    tools.copyToClipboard(str)
  }

  const onClickBack = () => {
    nav.goBack()
  }

  return {
    t,
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
