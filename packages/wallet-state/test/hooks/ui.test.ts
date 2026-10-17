import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CHAINS_MAP, KeyringType } from '@unisat/wallet-shared'
import { ChainType, NetworkType } from '@unisat/wallet-types'
import { getSupportedAssets } from '../../src/hooks/ui'
import { AssetTabKey } from '../../src/types/ui'

describe('getSupportedAssets', () => {
  const configuredChains = new Map(
    [
      ChainType.BITCOIN_MAINNET,
      ChainType.BITCOIN_TESTNET,
      ChainType.BITCOIN_TESTNET4,
      ChainType.BITCOIN_SIGNET,
    ].map(chainType => [chainType, CHAINS_MAP[chainType]])
  )

  beforeEach(() => {
    const mainnet = CHAINS_MAP[ChainType.BITCOIN_MAINNET]!
    CHAINS_MAP[ChainType.BITCOIN_MAINNET] = { ...mainnet, rgbProxyEndpoints: undefined }
    CHAINS_MAP[ChainType.BITCOIN_TESTNET] = {
      ...mainnet,
      enum: ChainType.BITCOIN_TESTNET,
      networkType: NetworkType.TESTNET,
      rgbProxyEndpoints: undefined,
    }
    CHAINS_MAP[ChainType.BITCOIN_TESTNET4] = {
      ...mainnet,
      enum: ChainType.BITCOIN_TESTNET4,
      networkType: NetworkType.TESTNET,
      rgbProxyEndpoints: ['rpcs://rgb-test.example/json-rpc'],
    }
    CHAINS_MAP[ChainType.BITCOIN_SIGNET] = {
      ...mainnet,
      enum: ChainType.BITCOIN_SIGNET,
      networkType: NetworkType.TESTNET,
      rgbProxyEndpoints: undefined,
    }
  })

  afterEach(() => {
    for (const [chainType, chain] of configuredChains) {
      if (chain) CHAINS_MAP[chainType] = chain
      else delete CHAINS_MAP[chainType]
    }
  })

  it('shows the RGB asset tab for an HD wallet on an RGB-enabled network regardless of address type', () => {
    const p2wpkh = getSupportedAssets(
      ChainType.BITCOIN_TESTNET4,
      'tb1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      { keyringType: KeyringType.HdKeyring }
    )
    const p2tr = getSupportedAssets(
      ChainType.BITCOIN_TESTNET4,
      'tb1p5cyxnuxmeuwuvkwfem96llyxf9xq9tm9s2h2zs',
      { keyringType: KeyringType.HdKeyring }
    )

    expect(p2wpkh.assets.rgb).toBe(true)
    expect(p2tr.assets.rgb).toBe(true)
    expect(p2wpkh.tabKeys).toContain(AssetTabKey.RGB)
    expect(p2tr.tabKeys).toContain(AssetTabKey.RGB)
  })

  it.each([KeyringType.SimpleKeyring, KeyringType.KeystoneKeyring, KeyringType.ColdWalletKeyring])(
    'does not expose RGB or its asset card for unsupported keyring %s',
    keyringType => {
      const assets = getSupportedAssets(
        ChainType.BITCOIN_TESTNET4,
        'tb1p5cyxnuxmeuwuvkwfem96llyxf9xq9tm9s2h2zs',
        { keyringType }
      )

      expect(assets.assets.rgb).toBe(false)
      expect(assets.assets.rgbCard).toBe(false)
    }
  )

  it('hides RGB on Bitcoin Mainnet while its proxy is disabled', () => {
    const assets = getSupportedAssets(
      ChainType.BITCOIN_MAINNET,
      'bc1p5cyxnuxmeuwuvkwfem96llyxf9xq9tm9s2h2zs',
      { keyringType: KeyringType.HdKeyring }
    )

    expect(assets.assets.rgb).toBe(false)
    expect(assets.assets.rgbCard).toBe(false)
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

  it.each([ChainType.BITCOIN_TESTNET, ChainType.BITCOIN_SIGNET])(
    'hides RGB on unsupported Bitcoin network %s',
    chainType => {
      const assets = getSupportedAssets(chainType, 'tb1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', {
        keyringType: KeyringType.HdKeyring,
      })

      expect(assets.assets.rgb).toBe(false)
      expect(assets.assets.rgbCard).toBe(false)
    }
  )

  it('enables RGB on Bitcoin Testnet4 for HD wallets', () => {
    const assets = getSupportedAssets(
      ChainType.BITCOIN_TESTNET4,
      'tb1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      { keyringType: KeyringType.HdKeyring }
    )

    expect(assets.assets.rgb).toBe(true)
    expect(assets.assets.rgbCard).toBe(true)
  })
})
