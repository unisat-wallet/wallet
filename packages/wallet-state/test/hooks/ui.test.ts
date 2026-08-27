import { describe, expect, it } from 'vitest'

import { KeyringType } from '@unisat/wallet-shared'
import { ChainType } from '@unisat/wallet-types'
import { getSupportedAssets } from '../../src/hooks/ui'
import { AssetTabKey } from '../../src/types/ui'

describe('getSupportedAssets', () => {
  it('enables the RGB view for an HD wallet regardless of the selected Bitcoin address type', () => {
    const p2wpkh = getSupportedAssets(
      ChainType.BITCOIN_MAINNET,
      'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      { keyringType: KeyringType.HdKeyring }
    )
    const p2tr = getSupportedAssets(
      ChainType.BITCOIN_MAINNET,
      'bc1p5cyxnuxmeuwuvkwfem96llyxf9xq9tm9s2h2zs',
      { keyringType: KeyringType.HdKeyring }
    )

    expect(p2wpkh.assets.rgb).toBe(true)
    expect(p2tr.assets.rgb).toBe(true)
    expect(p2wpkh.tabKeys).not.toContain(AssetTabKey.RGB)
    expect(p2tr.tabKeys).not.toContain(AssetTabKey.RGB)
  })

  it('does not expose RGB for keyrings without an HD root', () => {
    const assets = getSupportedAssets(
      ChainType.BITCOIN_MAINNET,
      'bc1p5cyxnuxmeuwuvkwfem96llyxf9xq9tm9s2h2zs',
      { keyringType: KeyringType.SimpleKeyring }
    )

    expect(assets.assets.rgb).toBe(false)
    expect(assets.assets.rgbCard).toBe(true)
  })

  it('hides the RGB card outside RGB-capable Bitcoin networks', () => {
    const assets = getSupportedAssets(
      ChainType.FRACTAL_BITCOIN_MAINNET,
      'bc1p5cyxnuxmeuwuvkwfem96llyxf9xq9tm9s2h2zs',
      { keyringType: KeyringType.SimpleKeyring }
    )

    expect(assets.assets.rgb).toBe(false)
    expect(assets.assets.rgbCard).toBe(false)
  })

  it.each([ChainType.BITCOIN_TESTNET, ChainType.BITCOIN_TESTNET4, ChainType.BITCOIN_SIGNET])(
    'hides RGB on unsupported Bitcoin network %s',
    chainType => {
      const assets = getSupportedAssets(chainType, 'tb1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', {
        keyringType: KeyringType.HdKeyring,
      })

      expect(assets.assets.rgb).toBe(false)
      expect(assets.assets.rgbCard).toBe(false)
    }
  )
})
