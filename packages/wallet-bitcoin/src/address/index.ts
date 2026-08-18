import { AddressType, NetworkType } from '@unisat/wallet-types'
import { bitcoin } from '../bitcoin-core'
import { toPsbtNetwork } from '../network'

const PAY_TO_ANCHOR_PROGRAM = Buffer.from('4e73', 'hex')
const PAY_TO_ANCHOR_SCRIPT = Buffer.from('51024e73', 'hex')

export function isPayToAnchorAddress(address: string, networkType: NetworkType): boolean {
  try {
    const decoded = bitcoin.address.fromBech32(address)
    return (
      decoded.prefix === toPsbtNetwork(networkType).bech32 &&
      decoded.version === 1 &&
      decoded.data.equals(PAY_TO_ANCHOR_PROGRAM)
    )
  } catch {
    return false
  }
}

/**
 * Convert public key to bitcoin payment object.
 */
export function publicKeyToPayment(publicKey: string, type: AddressType, networkType: NetworkType) {
  const network = toPsbtNetwork(networkType)
  if (!publicKey) return null
  const pubkey = Buffer.from(publicKey, 'hex')
  if (type === AddressType.P2PKH) {
    return bitcoin.payments.p2pkh({
      pubkey,
      network,
    })
  } else if (type === AddressType.P2WPKH || type === AddressType.M44_P2WPKH) {
    return bitcoin.payments.p2wpkh({
      pubkey,
      network,
    })
  } else if (type === AddressType.P2TR || type === AddressType.M44_P2TR) {
    return bitcoin.payments.p2tr({
      internalPubkey: pubkey.slice(1, 33),
      network,
    })
  } else if (type === AddressType.P2SH_P2WPKH) {
    const data = bitcoin.payments.p2wpkh({
      pubkey,
      network,
    })
    return bitcoin.payments.p2sh({
      pubkey,
      network,
      redeem: data,
    })
  }
  return null
}

/**
 * Convert public key to bitcoin address.
 */
export function publicKeyToAddress(publicKey: string, type: AddressType, networkType: NetworkType) {
  const payment = publicKeyToPayment(publicKey, type, networkType)
  if (payment && payment.address) {
    return payment.address
  } else {
    return ''
  }
}

/**
 * Convert public key to bitcoin scriptPk.
 */
export function publicKeyToScriptPk(
  publicKey: string,
  type: AddressType,
  networkType: NetworkType
) {
  const payment = publicKeyToPayment(publicKey, type, networkType)
  if (!payment || !payment.output) {
    return ''
  }
  return payment.output.toString('hex')
}

export function decodeAddress(address: string) {
  const mainnet = bitcoin.networks.bitcoin
  const testnet = bitcoin.networks.testnet
  const regtest = bitcoin.networks.regtest
  let decodeBase58: bitcoin.address.Base58CheckResult
  let decodeBech32: bitcoin.address.Bech32Result
  let networkType: NetworkType = NetworkType.MAINNET
  let addressType: AddressType = AddressType.UNKNOWN
  if (address.startsWith('bc1') || address.startsWith('tb1') || address.startsWith('bcrt1')) {
    try {
      decodeBech32 = bitcoin.address.fromBech32(address)
      if (decodeBech32.prefix === mainnet.bech32) {
        networkType = NetworkType.MAINNET
      } else if (decodeBech32.prefix === testnet.bech32) {
        networkType = NetworkType.TESTNET
      } else if (decodeBech32.prefix === regtest.bech32) {
        networkType = NetworkType.REGTEST
      } else {
        networkType = NetworkType.MAINNET
      }
      if (decodeBech32.version === 0) {
        if (decodeBech32.data.length === 20) {
          addressType = AddressType.P2WPKH
        } else if (decodeBech32.data.length === 32) {
          addressType = AddressType.P2WSH
        }
      } else if (decodeBech32.version === 1) {
        if (decodeBech32.data.length === 32) {
          addressType = AddressType.P2TR
        }
      }
      return {
        networkType,
        addressType,
        dust: getAddressTypeDust(addressType),
      }
    } catch {
      // Not a valid Bech32 address.
    }
  } else {
    try {
      decodeBase58 = bitcoin.address.fromBase58Check(address)
      if (decodeBase58.version === mainnet.pubKeyHash) {
        networkType = NetworkType.MAINNET
        addressType = AddressType.P2PKH
      } else if (decodeBase58.version === testnet.pubKeyHash) {
        networkType = NetworkType.TESTNET
        addressType = AddressType.P2PKH
      } else if (decodeBase58.version === regtest.pubKeyHash) {
        // do not work
        networkType = NetworkType.REGTEST
        addressType = AddressType.P2PKH
      } else if (decodeBase58.version === mainnet.scriptHash) {
        networkType = NetworkType.MAINNET
        addressType = AddressType.P2SH_P2WPKH
      } else if (decodeBase58.version === testnet.scriptHash) {
        networkType = NetworkType.TESTNET
        addressType = AddressType.P2SH_P2WPKH
      } else if (decodeBase58.version === regtest.scriptHash) {
        // do not work
        networkType = NetworkType.REGTEST
        addressType = AddressType.P2SH_P2WPKH
      }
      return {
        networkType,
        addressType,
        dust: getAddressTypeDust(addressType),
      }
    } catch {
      // Not a valid Base58 address.
    }
  }

  return {
    networkType: NetworkType.MAINNET,
    addressType: AddressType.UNKNOWN,
    dust: 546,
  }
}

function getAddressTypeDust(addressType: AddressType) {
  if (addressType === AddressType.P2WPKH || addressType === AddressType.M44_P2WPKH) {
    return 294
  } else if (addressType === AddressType.P2TR || addressType === AddressType.M44_P2TR) {
    return 330
  } else {
    return 546
  }
}

/**
 * Get address type.
 */
export function getAddressType(
  address: string,
  _networkType: NetworkType = NetworkType.MAINNET
): AddressType {
  return decodeAddress(address).addressType
}

/**
 * Convert scriptPk to address.
 */
export function scriptPkToAddress(
  scriptPk: string | Buffer,
  networkType: NetworkType = NetworkType.MAINNET
) {
  const network = toPsbtNetwork(networkType)
  const script = typeof scriptPk === 'string' ? Buffer.from(scriptPk, 'hex') : scriptPk

  if (script.equals(PAY_TO_ANCHOR_SCRIPT)) {
    return bitcoin.address.toBech32(PAY_TO_ANCHOR_PROGRAM, 1, network.bech32)
  }

  try {
    const address = bitcoin.address.fromOutputScript(script, network)
    return address
  } catch (e) {
    return ''
  }
}

export function addressToScriptPk(address: string, networkType: NetworkType): Buffer {
  const network = toPsbtNetwork(networkType)

  if (isPayToAnchorAddress(address, networkType)) {
    return PAY_TO_ANCHOR_SCRIPT
  }

  try {
    return bitcoin.address.toOutputScript(address, network)
  } catch (error) {
    throw new Error(`Invalid address: ${address}`)
  }
}

export function isValidAddress(address: string, networkType: NetworkType): boolean {
  if (!address) return false

  if (isPayToAnchorAddress(address, networkType)) return true

  const network = toPsbtNetwork(networkType)

  try {
    bitcoin.address.toOutputScript(address, network)
    return true
  } catch (error) {
    return false
  }
}
