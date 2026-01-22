import { KeyringType } from '@unisat/keyring-service/types'
import { ADDRESS_TYPES, FEEDBACK_URL, PlatformEnv } from '@unisat/wallet-shared'
import { useMemo, useState } from 'react'
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
  const hasUpdate =
    versionInfo.latestVersion && versionInfo.latestVersion !== versionInfo.currentVesion
  const { t } = useI18n()

  const { isExtensionInExpandView } = useDevice()

  const isCustomHdPath = useMemo(() => {
    const item = ADDRESS_TYPES[currentKeyring.addressType]
    return currentKeyring.hdPath !== '' && item.hdPath !== currentKeyring.hdPath
  }, [currentKeyring])

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
    if (currentKeyring.type === KeyringType.SimpleKeyring) {
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
  }, [t, isCustomHdPath])

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
    settings_feedback,
    settings_rateus,
    settings_aboutus,
    settings_lockwallet,
    settings_expandview,
  }
}
