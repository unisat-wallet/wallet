import { CHAINS_MAP } from '@unisat/wallet-shared'
import { ChainType } from '@unisat/wallet-types'
import { useEffect, useState } from 'react'
import { useI18n, useNavigation, useWallet } from 'src/context'
import { isValidAddress } from 'src/utils/bitcoin-utils'

export function useEditContactScreenLogic() {
  const nav = useNavigation()

  // Required parameters
  const { address, chain, selectedNetworkFilter } = nav.getRouteState<'EditContactScreen'>()
  const wallet = useWallet()
  const [name, setName] = useState('')
  const [contactAddress, setContactAddress] = useState(address || '')
  const [originalAddress, setOriginalAddress] = useState('')
  const [originalChain, setOriginalChain] = useState<ChainType | undefined>()
  const [chainType, setChainType] = useState<ChainType>(ChainType.BITCOIN_MAINNET)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { t } = useI18n()

  useEffect(() => {
    if (address) {
      fetchContact()
    } else {
      const preselectedChainType = selectedNetworkFilter as ChainType

      if (preselectedChainType) {
        setChainType(preselectedChainType)
      }
    }
  }, [address, chain, selectedNetworkFilter])

  const fetchContact = async () => {
    if (!address || !chain) return

    try {
      const chainEnum = chain as ChainType
      const contact = await wallet.getContactByAddressAndChain(address, chainEnum)

      if (contact) {
        setName(contact.name)
        setContactAddress(contact.address)
        setOriginalAddress(contact.address)
        setOriginalChain(contact.chain)
        setChainType(contact.chain)
      } else {
        setError(t('contact_not_found'))
        setTimeout(() => {
          nav.navigate('ContactsScreen', {})
        }, 1500)
      }
    } catch (err) {
      console.error('Error fetching contact:', err)
      setError(t('failed_to_load_contact_information'))
    }
  }

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError(t('please_enter_name'))
      return
    }

    if (!contactAddress.trim()) {
      setError(t('please_enter_address'))
      return
    }

    const networkType = CHAINS_MAP[chainType].networkType

    if (!isValidAddress(contactAddress, networkType)) {
      setError(t('invalid_address_format_for_selected_network'))
      return
    }

    setError('')
    setLoading(true)

    try {
      if (
        originalAddress &&
        originalChain &&
        (originalAddress !== contactAddress.trim() || originalChain !== chainType)
      ) {
        await wallet.removeContact(originalAddress, originalChain)
      }

      await wallet.updateContact({
        name: name.trim(),
        address: contactAddress.trim(),
        chain: chainType,
        isContact: true,
        isAlias: false,
      })

      nav.goBack()
    } catch (err) {
      setError(t('failed_to_save_contact'))
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!address || !originalChain) return

    setLoading(true)
    try {
      await wallet.removeContact(address, originalChain)

      nav.navigate('ContactsScreen', {
        returnWithNetwork: chainType,
      })
    } catch (err) {
      setError(t('failed_to_delete_contact'))
    } finally {
      setLoading(false)
    }
  }

  const handleAddressChange = (e: { target: { value: string } } | string) => {
    const value = (typeof e === 'string' ? e : e.target.value).trim()
    setContactAddress(value)

    if (error.includes('Invalid address') || !value) {
      setError('')
    }

    if (value) {
      const networkType = CHAINS_MAP[chainType].networkType

      if (value.length > 15 && !isValidAddress(value, networkType)) {
        setError(t('invalid_address_format_for_selected_network'))
      }
    }
  }

  const handleNameChange = (e: { target: { value: string } } | string) => {
    const value = typeof e === 'string' ? e : e.target.value
    setName(value)
  }

  const onClickBack = () => {
    nav.goBack()
  }

  return {
    name,
    contactAddress,
    chainType,
    error,
    loading,
    handleNameChange,
    handleAddressChange,
    handleSubmit,
    handleDelete,
    onClickBack,
    address,
    t,
  }
}
