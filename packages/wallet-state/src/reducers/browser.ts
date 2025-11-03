import { createSlice, Slice } from '@reduxjs/toolkit'
import { AppInfo } from '@unisat/wallet-shared'
export enum WalletTabScreenTabKey {
  ALL,
  BRC20,
}

type suspensionType = {
  suspensionIf: boolean
  info: AppInfo | object | any
  web: any
}

type wcars = {
  if?: boolean
  url: string
}

type guideListsType = {
  id: number
  title: string
  content: string
  img: string
}

export interface setSessionDateProps {
  icon: string
  name: string
  origin: string
}

const wcarss: wcars = {
  if: false,
  url: '',
}
const riskIfs: boolean = false

const suspensions: suspensionType = {
  suspensionIf: false,
  info: {},
  web: '',
}

const collects: any = [
  {
    id: 4,
    name: 'My favorites',
    icon: 'collect_white',
    list: null,
  },
]

const yys: any = false

const riseHeights: number = 100

const ScanDatas: string = ''

const historyLists: any = []

const mnemonicAids: any = []

const amountValues: string = null

const guideLists: guideListsType[] = [
  {
    id: 1,
    title: 'Welcome to UniSat',
    content: 'Your trusted Bitcoin wallet with full support for Ordinals and Atomicals protocols.',
    img: 'guide1',
  },
  {
    id: 2,
    title: 'Effortless Bitcoin Asset Management',
    content: 'Easily switch between accounts and wallets for seamless asset management.',
    img: 'guide2',
  },
  {
    id: 3,
    title: 'Discover Web3 on Bitcoin',
    content: 'Let us guide you through the world of Bitcoin web3 with ease.',
    img: 'guide3',
  },
]

const popUps: boolean = false

const setStatusBars: boolean = false

const setSessionDates: setSessionDateProps = {
  icon: '',
  name: '',
  origin: '',
}

const i18Classs: string = 'ru'

const webViewLods: boolean = true

export interface BrowserState {
  walletTabScreen: {
    tabKey: wcars
    riskIf: boolean
    collect: any
    historyList: any
    suspension: suspensionType
    yy: any
    riseHeight: number
    ScanData: string
    amountValue: string
    guideList: guideListsType[]
    popUp: boolean
    setStatusBar: boolean
    i18Class: string
    setSessionDate: setSessionDateProps
    webViewLod: boolean
  }
}

export const initialState: BrowserState = {
  walletTabScreen: {
    tabKey: wcarss,
    riskIf: riskIfs,
    collect: collects,
    historyList: historyLists,
    suspension: suspensions,
    yy: yys,
    riseHeight: riseHeights,
    ScanData: ScanDatas,
    amountValue: amountValues,
    guideList: guideLists,
    popUp: popUps,
    setStatusBar: setStatusBars,
    i18Class: i18Classs,
    setSessionDate: setSessionDates,
    webViewLod: webViewLods,
  },
}
const slice: Slice<BrowserState> = createSlice({
  name: 'browser',
  initialState,
  reducers: {
    reset(state) {
      return initialState
    },
    updateWalletRisk(
      state,
      action: {
        payload: {
          tabKey: wcars
        }
      }
    ) {
      const { payload } = action
      state.walletTabScreen.tabKey = payload.tabKey
      return state
    },
    usedatariskIfs(state, action) {
      state.walletTabScreen.riskIf = action.payload
      return state
    },
    usedataricollect(state, action) {
      if (!action.payload) {
        state.walletTabScreen.collect[0].list = null
      } else {
        state.walletTabScreen.collect[0].list = action.payload
      }
      return state
    },
    usedatariInfo(state, action) {
      return state
    },
    usedatarihistoryList(state, action) {
      state.walletTabScreen.historyList = action.payload
      return state
    },
    usedatarisuspension(state, action) {
      state.walletTabScreen.suspension = action.payload
      return state
    },
    usedatarisyyn(state, action) {
      state.walletTabScreen.yy = action.payload
      return state
    },
    usedatarisriseHeight(state, action) {
      state.walletTabScreen.riseHeight = action.payload
      return state
    },
    usedataScanData(state, action) {
      state.walletTabScreen.ScanData = action.payload
      return state
    },
    usedatamnemonicAid(state, action) {
      return state
    },
    usedatamountValue(state, action) {
      state.walletTabScreen.amountValue = action.payload
      return state
    },
    usedatapopUp(state, action) {
      state.walletTabScreen.popUp = action.payload
      return state
    },
    usedatasetStatusBar(state, action) {
      state.walletTabScreen.setStatusBar = action.payload
      return state
    },
    usedatasetSessionDate(state, action) {
      state.walletTabScreen.setSessionDate = action.payload
      return state
    },
    usedatawebViewLod(state, action) {
      state.walletTabScreen.webViewLod = action.payload
      return state
    },
  },
  extraReducers: builder => {
    // todo
  },
})

export const browserActions = slice.actions
export default slice.reducer
