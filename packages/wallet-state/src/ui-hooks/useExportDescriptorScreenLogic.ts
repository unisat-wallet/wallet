import { useCallback, useEffect, useState } from 'react'
import { useI18n, useNavigation, useTools, useWallet } from 'src/context'
import { useCurrentAccount } from 'src/hooks'

export function useExportDescriptorScreenLogic() {
  const { t } = useI18n()
  const nav = useNavigation()
  const wallet = useWallet()
  const tools = useTools()
  const currentAccount = useCurrentAccount()

  const [descriptor, setDescriptor] = useState('')
  const [changeDescriptor, setChangeDescriptor] = useState('')
  const [xpub, setXpub] = useState('')
  const [accountPath, setAccountPath] = useState('')
  const [fingerprint, setFingerprint] = useState('')
  const [policyLabel, setPolicyLabel] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await wallet.exportAccountDescriptor()
      setDescriptor(res.descriptor)
      setChangeDescriptor(res.changeDescriptor || '')
      setXpub(res.xpub || '')
      setAccountPath(res.accountPath || '')
      setFingerprint(res.fingerprint || '')
      setPolicyLabel(res.policy?.label || '')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [wallet, currentAccount?.key, currentAccount?.address])

  useEffect(() => {
    load()
  }, [load])

  const copy = (str: string) => {
    tools.copyToClipboard(str)
  }

  return {
    t,
    loading,
    descriptor,
    changeDescriptor,
    xpub,
    accountPath,
    fingerprint,
    policyLabel,
    error,
    copy,
    reload: load,
    onClickBack: () => nav.goBack(),
  }
}
