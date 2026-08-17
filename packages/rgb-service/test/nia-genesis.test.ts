import { describe, expect, it } from 'vitest'
import { encodeNiaGenesis } from '../src'

const toHex = (value: Uint8Array) =>
  [...value].map(byte => byte.toString(16).padStart(2, '0')).join('')

describe('encodeNiaGenesis', () => {
  it('matches the rgb-lib NIA Genesis and contract ID vector', () => {
    const encoded = encodeNiaGenesis({
      ticker: 'TEST',
      name: 'Test asset',
      precision: 2,
      timestamp: 1_700_000_000,
      network: 'testnet4',
      allocations: [
        { txid: '44'.repeat(32), vout: 2, blinding: 0x0102_0304_0506_0708n, amount: 1_000n },
      ],
    })
    expect(toHex(encoded.strict)).toBe(
      '000045687051f4cca6e3f665fc75fe3e27b30080346789ad83aa0dc29e95a315e33500f15365000000000d007373693a616e6f6e796d6f757302000003d0070100120004544553540a546573742061737365740002d10701000300000000da0701000800e8030000000000000100a00f01010000444444444444444444444444444444444444444444444444444444444444444402000000080706050403020108e803000000000000'
    )
    expect(toHex(encoded.opCommitment)).toBe(
      '0000ffffffffffffffff0045687051f4cca6e3f665fc75fe3e27b30080346789ad83aa0dc29e95a315e33500f153650000000032fc587774e1496a1162b7eb0abb8e5c825fcd232da4678777dc49eef65485a10200bd1380e8912f273087938a93b9ed8f497b5358187cb1b36d7f6f332015dd535391943c450714249aa21e11dfc444eb274af260e67df344d4f612be7ec834fb7c5442b1a1ae7badee5391857589104a594e466ffc6fd6484d2890b466537f7f7a5b9bdc067f142f34c06366c56de4b47adc589d11edaf300c0de5ddbfde32eb6e'
    )
    expect(toHex(encoded.assetId)).toBe(
      '148cfb9253b1136a25c9f2ef01dd774689f5555cf756a3de01a87d7a25532096'
    )
  })

  it('uses Bitcoin internal byte order for non-symmetric allocation txids', () => {
    const encoded = encodeNiaGenesis({
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

    expect(toHex(encoded.strict)).toBe(
      '000045687051f4cca6e3f665fc75fe3e27b30080346789ad83aa0dc29e95a315e335b04c1e66000000000d007373693a616e6f6e796d6f757302000003d00701000e00065449434b4552044e414d450002d10701000300000000da0701000800e7030000000000000100a00f0101000019bae3921d832f3406e7a6b68ea771a8f7f043f53506d94feca1294c8dc9548d00000000f1fb09000000000008e703000000000000'
    )
  })
})
