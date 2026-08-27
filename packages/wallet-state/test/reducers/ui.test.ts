import { describe, expect, it } from 'vitest'

import { updateVersion } from '../../src/actions/global'
import ui, { initialState } from '../../src/reducers/ui'
import { AssetTabKey, MoreAssetTabKey, WalletView } from '../../src/types/ui'

describe('ui reducer', () => {
  it('migrates the legacy More > RGB selection back to Alkanes', () => {
    const state = ui(
      {
        ...initialState,
        assetTabKey: AssetTabKey.MORE,
        moreAssetTabKey: MoreAssetTabKey.RGB_TOKEN_LIST,
      },
      updateVersion()
    )

    expect(state.assetTabKey).toBe(AssetTabKey.MORE)
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
