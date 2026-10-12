import { describe, expect, it } from 'vitest'

import { updateVersion } from '../../src/actions/global'
import ui, { initialState } from '../../src/reducers/ui'
import { AssetTabKey, MoreAssetTabKey, WalletView } from '../../src/types/ui'

describe('ui reducer', () => {
  it('defaults to BRC20 and preserves a selected Ordinals tab on refresh', () => {
    expect(ui(undefined, { type: '@@INIT' }).assetTabKey).toBe(AssetTabKey.BRC20)
    const refreshed = ui({ ...initialState, assetTabKey: AssetTabKey.ORDINALS }, updateVersion())
    expect(refreshed.assetTabKey).toBe(AssetTabKey.ORDINALS)
  })

  it('migrates the legacy More > RGB selection back to Alkanes', () => {
    const state = ui(
      {
        ...initialState,
        assetTabKey: AssetTabKey.MORE,
        moreAssetTabKey: MoreAssetTabKey.RGB_TOKEN_LIST,
      },
      updateVersion()
    )

    expect(state.assetTabKey).toBe(AssetTabKey.ALKANES)
    expect(state.moreAssetTabKey).toBe(MoreAssetTabKey.ALKANES_TOKEN)
    expect(state.walletView).toBe(WalletView.BITCOIN)
  })

  it('keeps the carousel RGB wallet view on refresh', () => {
    const state = ui(
      {
        ...initialState,
        walletView: WalletView.RGB,
      },
      updateVersion()
    )

    expect(state.walletView).toBe(WalletView.RGB)
  })

  it('keeps the RGB asset tab selected on refresh', () => {
    const state = ui(
      {
        ...initialState,
        assetTabKey: AssetTabKey.RGB,
      },
      updateVersion()
    )

    expect(state.assetTabKey).toBe(AssetTabKey.RGB)
  })

  it('migrates the legacy More > Alkanes collection selection', () => {
    const state = ui(
      {
        ...initialState,
        moreAssetTabKey: 1 as unknown as MoreAssetTabKey,
      },
      updateVersion()
    )

    expect(state.moreAssetTabKey).toBe(MoreAssetTabKey.ALKANES_COLLECTION)
  })
})
