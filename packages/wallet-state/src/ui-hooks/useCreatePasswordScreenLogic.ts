import { useEffect, useMemo, useState } from 'react'
import { useI18n, useNavigation, useTools, useWallet } from 'src/context'
import { getPasswordStrengthWord, MIN_PASSWORD_LENGTH } from 'src/utils/password-utils'

export function useCreatePasswordScreenLogic() {
  const nav = useNavigation()
  const { isNewAccount, isKeystone, fromColdWallet } = nav.getRouteState<'CreatePasswordScreen'>()
  const [newPassword, setNewPassword] = useState('')
  const { t } = useI18n()

  const [confirmPassword, setConfirmPassword] = useState('')

  const [disabled, setDisabled] = useState(true)

  const wallet = useWallet()

  const tools = useTools()
  const bootWithPassword = (password: string) => {
    wallet
      .boot(password)
      .then(() => {
        if (fromColdWallet) {
          nav.navigate('CreateColdWalletScreen', { fromUnlock: true })
        } else if (isKeystone) {
          nav.navigate('CreateKeystoneWalletScreen', { fromUnlock: true })
        } else if (isNewAccount) {
          nav.navigate('CreateHDWalletScreen', { isImport: false, fromUnlock: true })
        } else {
          nav.navigate('CreateHDWalletScreen', { isImport: true, fromUnlock: true })
        }
      })
      .catch(err => {
        tools.toastError(err)
      })
  }

  useEffect(() => {
    setDisabled(true)

    if (
      newPassword &&
      newPassword.length >= MIN_PASSWORD_LENGTH &&
      newPassword === confirmPassword
    ) {
      setDisabled(false)
      return
    }
  }, [newPassword, confirmPassword])

  const strongTextRenderData = useMemo(() => {
    if (!newPassword) {
      return null
    }
    return getPasswordStrengthWord(newPassword, t)
  }, [newPassword, t])

  const matchTextRenderData = useMemo(() => {
    if (!confirmPassword) {
      return null
    }

    if (newPassword !== confirmPassword) {
      return {
        text: t('passwords_dont_match'),
      }
    }
    return null
  }, [newPassword, confirmPassword])

  const onClickConfirm = () => {
    bootWithPassword(newPassword)
  }

  const onPasswordChange = (e: string | { target: { value: string } }) => {
    const val = typeof e === 'string' ? e : e.target.value
    setNewPassword(val)
  }

  const onConfirmPasswordChange = (e: string | { target: { value: string } }) => {
    const val = typeof e === 'string' ? e : e.target.value
    setConfirmPassword(val)
  }

  return {
    disabled,
    strongTextRenderData,
    matchTextRenderData,
    onClickConfirm,
    onPasswordChange,
    onConfirmPasswordChange,
  }
}
