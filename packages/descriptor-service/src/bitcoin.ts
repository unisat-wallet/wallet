import * as ecc from '@bitcoinerlab/secp256k1'
import { BIP32Factory, BIP32Interface } from 'bip32'
import * as bitcoin from 'bitcoinjs-lib'

bitcoin.initEccLib(ecc)

export const bip32 = BIP32Factory(ecc)
export { bitcoin, BIP32Interface }

export function networkFromName(
  name: 'mainnet' | 'testnet' | 'signet' | 'regtest' = 'mainnet'
): bitcoin.Network {
  if (name === 'regtest') return bitcoin.networks.regtest
  if (name === 'testnet' || name === 'signet') return bitcoin.networks.testnet
  return bitcoin.networks.bitcoin
}
