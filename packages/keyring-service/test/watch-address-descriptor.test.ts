import { describe, expect, it } from 'vitest'
import {
  DescriptorAddressType,
  deriveAddresses,
  hdAccountToDescriptor
} from '@unisat/descriptor-service'
import { WatchAddressKeyring } from '../src/keyrings/watch-address-keyring'

const FPR = '73c5da0a'
const WPKH_XPUB =
  'xpub6CatWdiZiodmUeTDp8LT5or8nmbKNcuyvz7WyksVFkKB4RHwCD3XyuvPEbvqAQY3rAPshWcMLoP2fMFMKHPJ4ZeZXYVUhLv1VMrjPC7PW6V'
const WPKH_ADDR0 = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'

describe('WatchAddressKeyring descriptor gap', () => {
  const descriptor = hdAccountToDescriptor({
    addressType: DescriptorAddressType.P2WPKH,
    origin: { fingerprint: FPR, path: "m/84'/0'/0'" },
    xpub: WPKH_XPUB,
    chain: 0
  })

  it('stores descriptor and expands gap via addAccounts', async () => {
    const initial = deriveAddresses(descriptor, { network: 'mainnet', start: 0, count: 3 })
    expect(initial[0]).toBe(WPKH_ADDR0)

    const keyring = new WatchAddressKeyring({
      addresses: initial,
      descriptor,
      network: 'mainnet'
    })

    expect(keyring.hasDescriptor()).toBe(true)
    expect(await keyring.getAccounts()).toHaveLength(3)

    const added = await keyring.addAccounts(2)
    expect(added).toHaveLength(2)
    const all = await keyring.getAccounts()
    expect(all).toHaveLength(5)

    const expected = deriveAddresses(descriptor, { network: 'mainnet', start: 0, count: 5 })
    expect(all).toEqual(expected)
  })

  it('round-trips JSON serialize with descriptor (not legacy CSV)', async () => {
    const initial = deriveAddresses(descriptor, { network: 'mainnet', start: 0, count: 2 })
    const keyring = new WatchAddressKeyring({
      addresses: initial,
      descriptor,
      network: 'mainnet'
    })
    const serialized = await keyring.serialize()
    expect(typeof serialized).toBe('object')

    const restored = new WatchAddressKeyring()
    await restored.deserialize(serialized as any)
    expect(restored.hasDescriptor()).toBe(true)
    expect(await restored.getAccounts()).toEqual(initial)
    await restored.addAccounts(1)
    expect(await restored.getAccounts()).toHaveLength(3)
  })

  it('keeps legacy CSV deserialize for plain address watches', async () => {
    const keyring = new WatchAddressKeyring()
    await keyring.deserialize(
      'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh,bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'
    )
    expect(keyring.hasDescriptor()).toBe(false)
    expect(await keyring.getAccounts()).toHaveLength(2)
    await expect(keyring.addAccounts(1)).rejects.toThrow(/no stored descriptor/i)
  })

  it('gap expansion uses receiveCount, not addresses.length', async () => {
    const initial = deriveAddresses(descriptor, { network: 'mainnet', start: 0, count: 2 })
    const keyring = new WatchAddressKeyring({
      addresses: [...initial, 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'],
      descriptor,
      network: 'mainnet',
      receiveCount: 2
    })
    const added = await keyring.addAccounts(1)
    const expected2 = deriveAddresses(descriptor, { network: 'mainnet', start: 2, count: 1 })[0]
    expect(added[0]).toBe(expected2)
    expect(keyring.receiveCount).toBe(3)
    expect(await keyring.getAccounts()).toHaveLength(4)
  })
})
