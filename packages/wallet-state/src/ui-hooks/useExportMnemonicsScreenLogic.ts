import { ADDRESS_TYPES } from '@unisat/wallet-shared'
import { useEffect, useState } from 'react'
import { useI18n, useNavigation, useTools, useWallet } from 'src/context'
type Status = '' | 'error' | 'warning' | undefined

export function useExportMnemonicsScreenLogic() {
  const nav = useNavigation()
  const { keyring } = nav.getRouteState<'ExportMnemonicsScreen'>()

  const { t } = useI18n()

  const [password, setPassword] = useState('')
  const [disabled, setDisabled] = useState(true)

  const [mnemonic, setMnemonic] = useState('')
  const [status, setStatus] = useState<Status>('')
  const [error, setError] = useState('')
  const wallet = useWallet()
  const tools = useTools()

  const [passphrase, setPassphrase] = useState('')

  const btnClick = async () => {
    try {
      const { mnemonic, hdPath, passphrase } = await wallet.getMnemonics(password, keyring)
      setMnemonic(mnemonic)
      setPassphrase(passphrase)
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
  const words = mnemonic.split(' ')

  const pathName = ADDRESS_TYPES.find(v => v.hdPath === keyring.hdPath)?.name || 'custom'

  const onClickBack = () => {
    nav.goBack()
  }

  return {
    words,
    pathName,
    t,
    setPassword,
    disabled,
    btnClick,
    handleOnKeyUp,
    mnemonic,
    passphrase,
    error,
    copy,
    keyring,
    onClickBack,
  }
}
