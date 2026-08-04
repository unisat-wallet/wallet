import { useEffect, useState } from 'react'
import { useI18n, useNavigation, useTools, useWallet } from 'src/context'

const GAP_OPTIONS = [20, 50, 100] as const

type Preview = {
  policyLabel: string
  previewAddresses: string[]
}

/**
 * Two-step import: preview derived addresses → user confirms → persist watch keyring.
 * Prevents silent switch to an attacker-supplied address set.
 */
export function useImportDescriptorScreenLogic() {
  const { t } = useI18n()
  const nav = useNavigation()
  const wallet = useWallet()
  const tools = useTools()

  const [raw, setRaw] = useState('')
  const [name, setName] = useState('')
  const [accountCount, setAccountCount] = useState<number>(20)
  const [error, setError] = useState('')
  const [disabled, setDisabled] = useState(true)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)

  // Enable button from input only — do NOT clear preview/error when `busy` flips
  // (that used to wipe successful preview / error right after Check addresses).
  useEffect(() => {
    setDisabled(!raw.trim() || busy)
  }, [raw, busy])

  useEffect(() => {
    setError('')
    setPreview(null)
  }, [raw, accountCount])

  const onPreview = async () => {
    if (!raw.trim() || busy) return
    setBusy(true)
    setError('')
    setPreview(null)
    try {
      if (typeof wallet.previewDescriptor !== 'function') {
        throw new Error(
          'previewDescriptor is unavailable — rebuild wallet-background and reload the extension'
        )
      }
      const res = await wallet.previewDescriptor(raw.trim(), accountCount)
      setPreview({
        policyLabel: res.policy?.label || '',
        previewAddresses: res.previewAddresses || [],
      })
    } catch (e) {
      const msg = (e as Error)?.message || String(e)
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  const onConfirmImport = async () => {
    if (!preview) return
    setBusy(true)
    setError('')
    try {
      await wallet.importDescriptor(raw.trim(), name.trim() || undefined, accountCount)
      tools.toastSuccess(t('success') || 'Success')
      nav.navigate('MainScreen')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const clearPreview = () => {
    setPreview(null)
    setError('')
  }

  return {
    t,
    raw,
    setRaw,
    name,
    setName,
    accountCount,
    setAccountCount,
    gapOptions: GAP_OPTIONS,
    error,
    disabled,
    busy,
    preview,
    onPreview,
    onConfirmImport,
    clearPreview,
    onClickBack: () => nav.goBack(),
  }
}
