import { createSlice, Slice } from '@reduxjs/toolkit'
import { Inscription } from '@unisat/wallet-shared'

import { updateVersion } from '../actions/global'
import {
  AlkanesAssetTabKey,
  AssetTabKey,
  CATAssetTabKey,
  MoreAssetTabKey,
  NavigationSource,
  OrdinalsAssetTabKey,
} from '../types'

export enum WallettopTabScreenTabKey {
  Ordinals,
  Atomicals,
  Runes,
  CAT20,
  Alkanes,
}

export interface UIState {
  assetTabKey: AssetTabKey
  ordinalsAssetTabKey: OrdinalsAssetTabKey
  catAssetTabKey: CATAssetTabKey
  alkanesAssetTabKey: AlkanesAssetTabKey
  moreAssetTabKey: MoreAssetTabKey
  uiTxCreateScreen: {
    toInfo: {
      address: string
      domain: string
      inscription?: Inscription
    }
    inputAmount: string
  }
  addressInput: {
    address: string
    domain: string
    inscription?: Inscription
  }
  amountInput: {
    amount: string
  }
  feeRateBar: {
    feeRate: number
    feeRateInputVal: string
    enableLowFeeRate: boolean
    feeOptionIndex: number
    showCustomInput: boolean
  }
  babylonSendScreen: {
    inputAmount: string
    memo: string
  }
  navigationSource: NavigationSource
  isBalanceHidden: boolean
  balanceDetailExpanded: boolean

  walletTopTabScreen: {
    toptabKey: WallettopTabScreenTabKey
  }
}

export const initialState: UIState = {
  assetTabKey: AssetTabKey.ORDINALS,
  ordinalsAssetTabKey: OrdinalsAssetTabKey.ALL,
  catAssetTabKey: CATAssetTabKey.CAT20,
  alkanesAssetTabKey: AlkanesAssetTabKey.TOKEN,
  moreAssetTabKey: MoreAssetTabKey.ALKANES_TOKEN,
  uiTxCreateScreen: {
    toInfo: {
      address: '',
      domain: '',
    },
    inputAmount: '',
  },
  addressInput: {
    address: '',
    domain: '',
  },
  amountInput: {
    amount: '',
  },
  feeRateBar: {
    feeRate: 1,
    feeRateInputVal: '',
    enableLowFeeRate: false,
    feeOptionIndex: 1, // Default to AVG
    showCustomInput: false,
  },
  babylonSendScreen: {
    inputAmount: '',
    memo: '',
  },
  navigationSource: NavigationSource.NORMAL,
  isBalanceHidden: false,
  balanceDetailExpanded: true,

  walletTopTabScreen: {
    toptabKey: WallettopTabScreenTabKey.Ordinals,
  },
}

const slice: Slice<UIState> = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    reset(state) {
      return initialState
    },
    updateAssetTabScreen(
      state,
      action: {
        payload: {
          assetTabKey?: AssetTabKey
          ordinalsAssetTabKey?: OrdinalsAssetTabKey
          catAssetTabKey?: CATAssetTabKey
          alkanesAssetTabKey?: AlkanesAssetTabKey
          moreAssetTabKey?: MoreAssetTabKey
        }
      }
    ) {
      const { payload } = action
      if (payload.assetTabKey !== undefined) {
        state.assetTabKey = payload.assetTabKey
      }
      if (payload.ordinalsAssetTabKey !== undefined) {
        state.ordinalsAssetTabKey = payload.ordinalsAssetTabKey
      }

      if (payload.catAssetTabKey !== undefined) {
        state.catAssetTabKey = payload.catAssetTabKey
      }
      if (payload.alkanesAssetTabKey !== undefined) {
        state.alkanesAssetTabKey = payload.alkanesAssetTabKey
      }
      if (payload.moreAssetTabKey !== undefined) {
        state.moreAssetTabKey = payload.moreAssetTabKey
      }
      return state
    },
    updateTxCreateScreen(
      state,
      action: {
        payload: {
          toInfo?: {
            address: string
            domain: string
            inscription?: Inscription
          }
          inputAmount?: string
        }
      }
    ) {
      if (action.payload.toInfo !== undefined) {
        state.uiTxCreateScreen.toInfo = action.payload.toInfo
      }
      if (action.payload.inputAmount !== undefined) {
        state.uiTxCreateScreen.inputAmount = action.payload.inputAmount
      }

      state.uiTxCreateScreen = { ...state.uiTxCreateScreen }
    },
    updateFeeRateBar(
      state,
      action: {
        payload: {
          feeRate?: number
          feeRateInputVal?: string
          enableLowFeeRate?: boolean
          feeOptionIndex?: number
          showCustomInput?: boolean
        }
      }
    ) {
      if (action.payload.feeRate !== undefined) {
        state.feeRateBar.feeRate = action.payload.feeRate
      }
      if (action.payload.feeRateInputVal !== undefined) {
        state.feeRateBar.feeRateInputVal = action.payload.feeRateInputVal
      }
      if (action.payload.enableLowFeeRate !== undefined) {
        state.feeRateBar.enableLowFeeRate = action.payload.enableLowFeeRate
      }
      if (action.payload.feeOptionIndex !== undefined) {
        state.feeRateBar.feeOptionIndex = action.payload.feeOptionIndex
      }
      if (action.payload.showCustomInput !== undefined) {
        state.feeRateBar.showCustomInput = action.payload.showCustomInput
      }
      state.feeRateBar = { ...state.feeRateBar }
    },
    resetFeeRateBar(state) {
      state.feeRateBar = initialState.feeRateBar
    },

    updateAddressInput(
      state,
      action: {
        payload: {
          address?: string
          domain?: string
        }
      }
    ) {
      if (action.payload.address !== undefined) {
        state.addressInput.address = action.payload.address
      }
      if (action.payload.domain !== undefined) {
        state.addressInput.domain = action.payload.domain
      }
      state.addressInput = { ...state.addressInput }
    },

    resetAddressInput(state) {
      state.addressInput = initialState.addressInput
    },

    updateAmountInput(
      state,
      action: {
        payload: {
          amount?: string
        }
      }
    ) {
      if (action.payload.amount !== undefined) {
        state.amountInput.amount = action.payload.amount
      }
      state.amountInput = { ...state.amountInput }
    },

    resetAmountInput(state) {
      state.amountInput = initialState.amountInput
    },

    resetTxCreateScreen(state) {
      state.uiTxCreateScreen = initialState.uiTxCreateScreen
    },
    updateBabylonSendScreen(
      state,
      action: {
        payload: {
          inputAmount?: string
          memo?: string
        }
      }
    ) {
      if (action.payload.inputAmount !== undefined) {
        state.babylonSendScreen.inputAmount = action.payload.inputAmount
      }
      if (action.payload.memo !== undefined) {
        state.babylonSendScreen.memo = action.payload.memo
      }
    },
    resetBabylonSendScreen(state) {
      state.babylonSendScreen = initialState.babylonSendScreen
    },
    setNavigationSource(state, action: { payload: NavigationSource }) {
      state.navigationSource = action.payload
    },
    setBalanceHidden(state, action: { payload: boolean }) {
      state.isBalanceHidden = action.payload
    },
    setBalanceDetailExpanded(state, action: { payload: boolean }) {
      state.balanceDetailExpanded = action.payload
    },
  },
  extraReducers: builder => {
    builder.addCase(updateVersion, state => {
      // todo
      if (!state.assetTabKey) {
        state.assetTabKey = AssetTabKey.ORDINALS
      }
      if (!state.ordinalsAssetTabKey) {
        state.ordinalsAssetTabKey = OrdinalsAssetTabKey.ALL
      }
      if (!state.catAssetTabKey) {
        state.catAssetTabKey = CATAssetTabKey.CAT20
      }
      if (!state.alkanesAssetTabKey) {
        state.alkanesAssetTabKey = AlkanesAssetTabKey.TOKEN
      }
      if (state.moreAssetTabKey === undefined) {
        state.moreAssetTabKey = MoreAssetTabKey.ALKANES_TOKEN
      }
      if (state.assetTabKey === (4 as AssetTabKey)) {
        state.assetTabKey = AssetTabKey.MORE
      }
      if (!state.uiTxCreateScreen) {
        state.uiTxCreateScreen = initialState.uiTxCreateScreen
      }
      if (!state.feeRateBar) {
        state.feeRateBar = initialState.feeRateBar
      }
      if (!state.babylonSendScreen) {
        state.babylonSendScreen = initialState.babylonSendScreen
      }
      if (state.isBalanceHidden === undefined) {
        state.isBalanceHidden = false
      }
      if (state.balanceDetailExpanded === undefined) {
        state.balanceDetailExpanded = true
      }
    })
  },
})

export const uiActions = slice.actions
export default slice.reducer
