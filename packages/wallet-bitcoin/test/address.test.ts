import { describe, it, expect, beforeAll } from 'vitest'
import { AddressType, NetworkType } from '@unisat/wallet-types'
import { decodeAddress, getAddressType, isValidAddress, publicKeyToAddress } from '../src/address'

const p2wpkh_data = {
  pubkey: '02b602ad190efb7b4f520068e3f8ecf573823d9e2557c5229231b4e14b79bbc0d8',
  mainnet_address: 'bc1qq2z2wssazy76tfpucdd32r78xe7urcj2rtlnkw',
  testnet_address: 'tb1qq2z2wssazy76tfpucdd32r78xe7urcj2fdyqda',
}

const p2sh_data = {
  pubkey: '020690457248a4f4f3ba2568b88a252af0d9dcfd9e0394690cbb0d45f72c574ee6',
  mainnet_address: '3ESTprj6AdpfGEFgDMri4f2iSf9YutNjXP',
  testnet_address: '2N5zftbf7n6L1U1tDtVUagc1yf1Mig123D2',
}

const p2tr_data = {
  pubkey: '0333bc88101f32b7ba799504d9340e77aedcf0ea3a047131737e5eb4e5bee23406',
  mainnet_address: 'bc1p8wat4p7077p3k6waauz0pjryywfxly35uz74ve9usp4jp6mk04uqd2mk58',
  testnet_address: 'tb1p8wat4p7077p3k6waauz0pjryywfxly35uz74ve9usp4jp6mk04uq6zdewg',
}

const p2pkh_data = {
  pubkey: '025e8ae8f7d9891dc0e24a4c1e74b58570281d4d3da8a3240268e00f0faa5d74b9',
  mainnet_address: '1JRtSjhQqt2qCRYN7jtqNUwTgn7uwagUpc',
  testnet_address: 'mxwqjnnPeuU5yY1yqJsDCQ9nYmicmGTBns',
}

const invalid_data = {
  pubkey: '',
  mainnet_address: '',
  testnet_address: '',
}

describe('address', () => {
  describe('publicKeyToAddress', () => {
    beforeAll(async () => {})
    it('should generate P2WPKH addresses correctly', () => {
      expect(publicKeyToAddress(p2wpkh_data.pubkey, AddressType.P2WPKH, NetworkType.MAINNET)).toBe(
        p2wpkh_data.mainnet_address
      )

      expect(publicKeyToAddress(p2wpkh_data.pubkey, AddressType.P2WPKH, NetworkType.TESTNET)).toBe(
        p2wpkh_data.testnet_address
      )
    })

    it('should generate P2SH-P2WPKH addresses correctly', () => {
      expect(
        publicKeyToAddress(p2sh_data.pubkey, AddressType.P2SH_P2WPKH, NetworkType.MAINNET)
      ).toBe(p2sh_data.mainnet_address)

      expect(
        publicKeyToAddress(p2sh_data.pubkey, AddressType.P2SH_P2WPKH, NetworkType.TESTNET)
      ).toBe(p2sh_data.testnet_address)
    })

    it('should generate P2TR addresses correctly', () => {
      expect(publicKeyToAddress(p2tr_data.pubkey, AddressType.P2TR, NetworkType.MAINNET)).toBe(
        p2tr_data.mainnet_address
      )

      expect(publicKeyToAddress(p2tr_data.pubkey, AddressType.P2TR, NetworkType.TESTNET)).toBe(
        p2tr_data.testnet_address
      )
    })

    it('should generate P2PKH addresses correctly', () => {
      expect(publicKeyToAddress(p2pkh_data.pubkey, AddressType.P2PKH, NetworkType.MAINNET)).toBe(
        p2pkh_data.mainnet_address
      )

      expect(publicKeyToAddress(p2pkh_data.pubkey, AddressType.P2PKH, NetworkType.TESTNET)).toBe(
        p2pkh_data.testnet_address
      )
    })
  })

  describe('isValidAddress', () => {
    it('should validate P2WPKH addresses correctly', () => {
      expect(isValidAddress(p2wpkh_data.mainnet_address, NetworkType.MAINNET)).toBe(true)
      expect(isValidAddress(p2wpkh_data.testnet_address, NetworkType.TESTNET)).toBe(true)
    })

    it('should validate P2SH addresses correctly', () => {
      expect(isValidAddress(p2sh_data.mainnet_address, NetworkType.MAINNET)).toBe(true)
      expect(isValidAddress(p2sh_data.testnet_address, NetworkType.TESTNET)).toBe(true)
    })

    it('should validate P2TR addresses correctly', () => {
      expect(isValidAddress(p2tr_data.mainnet_address, NetworkType.MAINNET)).toBe(true)
      expect(isValidAddress(p2tr_data.testnet_address, NetworkType.TESTNET)).toBe(true)
    })

    it('should validate P2PKH addresses correctly', () => {
      expect(isValidAddress(p2pkh_data.mainnet_address, NetworkType.MAINNET)).toBe(true)
      expect(isValidAddress(p2pkh_data.testnet_address, NetworkType.TESTNET)).toBe(true)
    })

    it('should detect cross-network invalid addresses', () => {
      expect(isValidAddress(p2pkh_data.mainnet_address, NetworkType.TESTNET)).toBe(false)
      expect(isValidAddress(p2pkh_data.testnet_address, NetworkType.MAINNET)).toBe(false)
    })

    it('should detect invalid addresses', () => {
      expect(isValidAddress(invalid_data.mainnet_address, NetworkType.MAINNET)).toBe(false)
      expect(isValidAddress('invalid', NetworkType.MAINNET)).toBe(false)
      expect(isValidAddress('', NetworkType.MAINNET)).toBe(false)
    })
  })

  describe('getAddressType', () => {
    it('should detect P2WPKH address type', () => {
      expect(getAddressType(p2wpkh_data.mainnet_address, NetworkType.MAINNET)).toBe(
        AddressType.P2WPKH
      )
      expect(getAddressType(p2wpkh_data.testnet_address, NetworkType.TESTNET)).toBe(
        AddressType.P2WPKH
      )
    })

    it('should detect P2PKH address type', () => {
      expect(getAddressType(p2pkh_data.mainnet_address, NetworkType.MAINNET)).toBe(
        AddressType.P2PKH
      )
      expect(getAddressType(p2pkh_data.testnet_address, NetworkType.TESTNET)).toBe(
        AddressType.P2PKH
      )
    })

    it('should detect P2TR address type', () => {
      expect(getAddressType(p2tr_data.mainnet_address, NetworkType.MAINNET)).toBe(AddressType.P2TR)
      expect(getAddressType(p2tr_data.testnet_address, NetworkType.TESTNET)).toBe(AddressType.P2TR)
    })

    it('should detect P2SH address type', () => {
      expect(getAddressType(p2sh_data.mainnet_address, NetworkType.MAINNET)).toBe(
        AddressType.P2SH_P2WPKH
      )
      expect(getAddressType(p2sh_data.testnet_address, NetworkType.TESTNET)).toBe(
        AddressType.P2SH_P2WPKH
      )
    })
  })

  describe('decodeAddress', () => {
    const networks = [NetworkType.MAINNET, NetworkType.TESTNET]
    const networkNames = ['MAINNET', 'TESTNET']

    it('should handle unknown addresses', () => {
      expect(decodeAddress('invalid address').addressType).toBe(AddressType.UNKNOWN)
      expect(decodeAddress('bc1qxxx').addressType).toBe(AddressType.UNKNOWN)
      expect(decodeAddress('').addressType).toBe(AddressType.UNKNOWN)
    })
  })
})
