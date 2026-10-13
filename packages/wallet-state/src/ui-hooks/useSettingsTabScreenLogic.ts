import { KeyringType } from '@unisat/keyring-service/types'
import {
  ADDRESS_TYPES,
  AccountSignMethod,
  FEEDBACK_URL,
  PlatformEnv,
  getAccountCapabilities,
} from '@unisat/wallet-shared'
import { useEffect, useMemo, useState } from 'react'
import { useDevice, useI18n, useNavigation, useTools, useWallet } from 'src/context'
import { useChain, useCurrentAccount, useCurrentKeyring, useVersionInfo } from 'src/hooks'

export interface SettingsItemType {
  key: string
  label?: string
  value?: string
  desc?: string
  danger?: boolean
  right: boolean
  icon?: string
  badge?: string
  onClick?: () => void
}

export function useSettingsTabScreenLogic() {
  const nav = useNavigation()
  const currentKeyring = useCurrentKeyring()
  const currentAccount = useCurrentAccount()
  const chain = useChain()
  const wallet = useWallet()
  const tools = useTools()
  const [connected, setConnected] = useState(false)
  const versionInfo = useVersionInfo()
  const hasUpdate = versionInfo.hasUpdate
  const { t } = useI18n()
  const rgbContextKey = `${chain.enum}:${currentKeyring.key}:${currentAccount.key}`
  const [rgbFeatureStatus, setRgbFeatureStatus] = useState({ contextKey: '', enabled: false })

  useEffect(() => {
    let active = true
    const rgbSupported = Boolean(chain.rgbProxyEndpoints?.some(endpoint => endpoint.trim()))
    if (!rgbSupported || currentKeyring.type !== KeyringType.HdKeyring) {
      setRgbFeatureStatus({ contextKey: rgbContextKey, enabled: false })
      return () => {
        active = false
      }
    }
    void wallet
      .getRgbFeatureStatus()
      .then(status => {
        if (active) setRgbFeatureStatus({ contextKey: rgbContextKey, enabled: status.enabled && status.supported })
      })
      .catch(() => {
        if (active) setRgbFeatureStatus({ contextKey: rgbContextKey, enabled: false })
      })
    return () => {
      active = false
    }
  }, [rgbContextKey, chain.rgbProxyEndpoints, currentKeyring.type, wallet])

  const { isExtensionInExpandView } = useDevice()

  const isCustomHdPath = useMemo(() => {
    const item = ADDRESS_TYPES[currentKeyring.addressType]
    return currentKeyring.hdPath !== '' && item.hdPath !== currentKeyring.hdPath
  }, [currentKeyring])

  const currentKeyringCapabilities = useMemo(
    () => getAccountCapabilities({ type: currentKeyring.type }),
    [currentKeyring.type]
  )

  const settings_connectedSites: SettingsItemType = useMemo(() => {
    const value = connected ? t('connected') : t('not_connected')
    return {
      key: 'settings_connectedSites',
      label: t('connected_sites'),
      value,
      desc: '',
      right: true,
      icon: 'connectedSites',
      onClick: () => {
        nav.navigate('ConnectedSitesScreen')
      },
    }
  }, [t, connected])

  const settings_addressBook: SettingsItemType = useMemo(() => {
    return {
      key: 'settings_addressBook',
      label: t('address_book'),
      value: t('addressbook_desc'),
      desc: '',
      right: true,
      icon: 'addressBook',
      onClick: () => {
        // todo
        nav.navigate('ContactsScreen', {})
      },
    }
  }, [t])
  const settings_addressType: SettingsItemType = useMemo(() => {
    let value = ''
    const item = ADDRESS_TYPES[currentKeyring.addressType]
    const hdPath = currentKeyring.hdPath || item.hdPath
    if (
      currentKeyring.type === KeyringType.SimpleKeyring ||
      currentKeyringCapabilities.signMethod === AccountSignMethod.External ||
      !currentKeyringCapabilities.canChangeAddressType
    ) {
      value = `${item.name}`
    } else {
      value = `${item.name} (${hdPath}/${currentAccount.index})`
    }
    return {
      key: 'settings_addressType',
      label: t('address_type'),
      value,
      desc: '',
      right: true,
      icon: 'addressType',
      onClick: () => {
        if (isCustomHdPath) {
          tools.showTip(
            t(
              'the_wallet_currently_uses_a_custom_hd_path_and_does_not_support_switching_address_types'
            )
          )
          return
        }
        nav.navigate('AddressTypeScreen')
      },
    }
  }, [t, isCustomHdPath, currentKeyring, currentAccount.index, currentKeyringCapabilities])

  const settings_advanced = useMemo(() => {
    return {
      key: 'settings_advanced',
      label: t('settings'),
      value: t('advanced_settings'),
      desc: '',
      right: true,
      icon: 'advance',
      onClick: () => {
        nav.navigate('AdvancedScreen')
      },
    }
  }, [t])

  const settings_rgbSettings: SettingsItemType | null = useMemo(() => {
    const rgbEnabled = Boolean(chain.rgbProxyEndpoints?.some(endpoint => endpoint.trim()))
    if (!rgbEnabled || rgbFeatureStatus.contextKey !== rgbContextKey || !rgbFeatureStatus.enabled ||
        currentKeyring.type !== KeyringType.HdKeyring) return null
    return {
      key: 'settings_rgbSettings',
      label: t('rgb_settings'),
      value: t('rgb_settings_description'),
      desc: '',
      right: true,
      icon: 'rgb-settings',
      onClick: () => {
        nav.navigate('RgbSettingsScreen')
      },
    }
  }, [chain.rgbProxyEndpoints, currentKeyring.type, nav, rgbFeatureStatus, rgbContextKey, t])

  const settings_feedback = useMemo(() => {
    return {
      key: 'settings_feedback',
      label: t('feedback'),
      value: t('let_us_know_what_you_think'),
      desc: '',
      route: '',
      right: true,
      icon: 'feedback',
      onClick: () => {
        const addressParam = currentAccount.address

        let feedbackUrl = FEEDBACK_URL
        feedbackUrl += `?address=${addressParam}&category=wallet`

        nav.navToUrl(feedbackUrl)
      },
    }
  }, [t])

  const settings_rateus = useMemo(() => {
    return {
      key: 'settings_rateus',
      label: t('rate_us'),
      value: t('like_our_wallet_wed_love_your_rating'),
      desc: '',
      route: '',
      right: true,
      icon: 'rateUs',
      onClick: () => {
        nav.navToUrl(PlatformEnv.REVIEW_URL)
      },
    }
  }, [t])

  const settings_aboutus = useMemo(() => {
    return {
      key: 'settings_aboutus',
      label: t('about_us'),
      value: '',
      desc: '',
      right: true,
      icon: 'aboutUsLogo',
      badge: hasUpdate ? t('new_version') : undefined,
      onClick: () => {
        nav.navigate('AboutUsScreen')
      },
    }
  }, [t, hasUpdate])

  const settings_lockwallet = useMemo(() => {
    return {
      key: 'settings_lockwallet',
      label: '',
      value: '',
      desc: t('lock_immediately'),
      right: false,
      onClick: () => {
        wallet.lockWallet()

        // Add small delay to ensure lock state updates before navigation
        // Prevents race condition where unlock screen might redirect back to main
        setTimeout(() => {
          nav.navToLock({
            autoUnlockByFace: false,
          })
        }, 10)
        return
      },
    }
  }, [t])

  const settings_expandview = useMemo(() => {
    if (isExtensionInExpandView) {
      return null
    }
    return {
      key: 'settings_expandview',
      label: '',
      value: '',
      desc: t('expand_view'),
      right: false,
      onClick: () => {
        nav.openExtensionInTab()
      },
    }
  }, [t])

  return {
    settings_connectedSites,
    settings_addressBook,
    settings_addressType,
    settings_advanced,
    settings_rgbSettings,
    settings_feedback,
    settings_rateus,
    settings_aboutus,
    settings_lockwallet,
    settings_expandview,
  }
}
