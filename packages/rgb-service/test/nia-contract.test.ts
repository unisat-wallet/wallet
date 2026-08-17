import { describe, expect, it } from 'vitest'
import { encodeNiaContract, encodeNiaGenesis, niaContractDigest } from '../src'

const toHex = (value: Uint8Array) =>
  [...value].map(byte => byte.toString(16).padStart(2, '0')).join('')

describe('encodeNiaContract', () => {
  it('matches the rgb-lib strict NIA contract container vector', () => {
    const genesis = encodeNiaGenesis({
      ticker: 'TICKER',
      name: 'NAME',
      precision: 2,
      timestamp: 1_713_261_744,
      network: 'testnet4',
      allocations: [
        {
          txid: '8d54c98d4c29a1ec4fd90635f543f0f7a871a78eb6a6e706342f831d92e3ba19',
          vout: 0,
          blinding: 654_321n,
          amount: 999n,
        },
      ],
    })
    const contract = encodeNiaContract(genesis)

    expect(contract.strict).toHaveLength(4526)
    expect(toHex(contract.assetId)).toBe(toHex(genesis.assetId))
    expect(toHex(niaContractDigest(contract.strict))).toBe(
      'fdd00436d27114f5d9fbb92d2c092208d7227916c93d73511ceb961dc04c00f3'
    )
  })
})
