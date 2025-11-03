import { useEffect, useMemo, useRef, useState } from 'react'

import { ADDRESS_TYPES, KeyringType } from '@unisat/keyring-service/types'
import {
  useAppDispatch,
  useCurrentAccount,
  useCurrentKeyring,
  useI18n,
  useReloadAccounts,
  useTools,
  useWallet,
} from '..'
import { numUtils } from '@unisat/base-utils'
import { AddressType } from '@unisat/wallet-types'

interface AddressTypeItem {
  address: string
  assets: { total_btc: string; satoshis: number; total_inscription: number }
  name: string
  value: AddressType
}

export function useAddressTypeScreenLogic() {
  //   const isInTab = useExtensionIsInTab()
  const { t } = useI18n()

  const wallet = useWallet()
  const currentKeyring = useCurrentKeyring()
  const account = useCurrentAccount()

  //   const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const reloadAccounts = useReloadAccounts()
  const [addresses, setAddresses] = useState<string[]>([])
  const [addressAssets, setAddressAssets] = useState<{
    [key: string]: { total_btc: string; satoshis: number; total_inscription: number }
  }>({})

  const selfRef = useRef<{
    addressAssets: {
      [key: string]: { total_btc: string; satoshis: number; total_inscription: number }
    }
  }>({
    addressAssets: {},
  })
  const self = selfRef.current

  const tools = useTools()
  const loadAddresses = async () => {
    try {
      tools.showLoading(true)
      const _res = await wallet.getAllAddresses(currentKeyring, account.index || 0)
      setAddresses(_res)
      const balances = await wallet.getMultiAddressAssets(_res.join(','))
      for (let i = 0; i < _res.length; i++) {
        const address = _res[i]
        const balance = balances[i]
        const satoshis = balance.totalSatoshis
        self.addressAssets[address] = {
          total_btc: numUtils.satoshisToAmount(balance.totalSatoshis),
          satoshis,
          total_inscription: balance.inscriptionCount,
        }
      }
      setAddressAssets(self.addressAssets)
    } catch (e) {
      console.error(e)
    } finally {
      tools.showLoading(false)
    }
  }

  useEffect(() => {
    loadAddresses()
  }, [])

  const addressTypes = useMemo(() => {
    // Cold wallets do not allow switching address types, only show the current type
    if (currentKeyring.type === KeyringType.ColdWalletKeyring) {
      return ADDRESS_TYPES.filter(v => v.value === currentKeyring.addressType)
    }

    if (currentKeyring.type === KeyringType.HdKeyring) {
      return ADDRESS_TYPES.filter(v => {
        if (v.displayIndex < 0) {
          return false
        }
        const address = addresses[v.value]
        const balance = addressAssets[address]
        if (v.isUnisatLegacy) {
          if (!balance || balance.satoshis == 0) {
            return false
          }
        }
        return true
      }).sort((a, b) => a.displayIndex - b.displayIndex)
    } else {
      return ADDRESS_TYPES.filter(v => v.displayIndex >= 0 && v.isUnisatLegacy != true).sort(
        (a, b) => a.displayIndex - b.displayIndex
      )
    }
  }, [currentKeyring.type, currentKeyring.addressType, addressAssets, addresses])

  const items: AddressTypeItem[] = useMemo(() => {
    return addressTypes.map(v => {
      const address = addresses[v.value]
      const assets = addressAssets[address] || {
        total_btc: '--',
        satoshis: 0,
        total_inscription: 0,
      }
      let name = `${v.name} (${v.hdPath}/${account.index})`
      if (currentKeyring.type === KeyringType.SimpleKeyring) {
        name = `${v.name}`
      } else if (currentKeyring.type === KeyringType.ColdWalletKeyring) {
        name = `❄️ ${v.name} (${v.hdPath}/${account.index}) - ${t('Fixed by cold wallet')}`
      }

      return {
        address,
        assets,
        name,
        value: v.value,
      }
    })
  }, [addressTypes])

  const onClickItem = async (item: AddressTypeItem) => {
    if (item.value == currentKeyring.addressType) {
      return
    }

    // Cold wallets do not allow switching address types
    if (currentKeyring.type === KeyringType.ColdWalletKeyring) {
      tools.toastError(t('Cold wallet address type cannot be changed'))
      return
    }

    await wallet.changeAddressType(item.value)
    reloadAccounts()
    // navigate('MainScreen')
    tools.toastSuccess(t('address_type_changed'))
  }

  return {
    currentKeyring,
    items,
    wallet,
    onClickItem,
  }
}
