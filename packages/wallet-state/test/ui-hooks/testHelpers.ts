import { configureStore } from '@reduxjs/toolkit'
import { KeyringType } from '@unisat/wallet-shared'
import { AddressType } from '@unisat/wallet-types'
import React, { type ReactNode } from 'react'
import { Provider } from 'react-redux'
import { vi } from 'vitest'

import { ApprovalContext } from '../../src/context/ApprovalContext'
import { NavigationContext, type NavigationContextType } from '../../src/context/NavigationContext'
import { ToolsContext, type ToolsContextType } from '../../src/context/ToolsContext'
import { WalletProvider } from '../../src/context/WalletContext'
import accounts, { accountActions } from '../../src/reducers/accounts'
import browser from '../../src/reducers/browser'
import discovery from '../../src/reducers/discovery'
import global from '../../src/reducers/global'
import keyrings, { keyringsActions } from '../../src/reducers/keyrings'
import settings from '../../src/reducers/settings'
import transactions from '../../src/reducers/transactions'
import ui from '../../src/reducers/ui'

export function createTestStore() {
  const store = configureStore({
    reducer: {
      accounts,
      transactions,
      settings,
      global,
      keyrings,
      ui,
      discovery,
      browser,
    },
  })

  const currentAccount = {
    type: KeyringType.HdKeyring,
    address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    brandName: 'UniSat',
    alianName: 'Account 1',
    displayBrandName: 'UniSat',
    index: 0,
    balance: 0,
    pubkey: '02abc123',
    key: 'account-1',
    flag: 0,
  }

  store.dispatch(accountActions.setCurrent(currentAccount))
  store.dispatch(
    keyringsActions.setCurrent({
      key: 'keyring-1',
      index: 0,
      type: KeyringType.HdKeyring,
      addressType: AddressType.P2TR,
      accounts: [currentAccount],
      alianName: 'HD Wallet #1',
      hdPath: '',
    })
  )

  return store
}

export function createWalletMock() {
  const feeSummary = {
    list: [
      { title: 'slow', desc: 'slow', feeRate: 1 },
      { title: 'avg', desc: 'avg', feeRate: 5 },
      { title: 'fast', desc: 'fast', feeRate: 10 },
    ],
  }

  return {
    getEnableRBF: vi.fn().mockResolvedValue(false),
    setEnableRBF: vi.fn().mockResolvedValue(undefined),
    getBTCUtxos: vi.fn().mockResolvedValue([]),
    getAssetUtxosRunes: vi.fn().mockResolvedValue([]),
    getFeeSummary: vi.fn().mockResolvedValue(feeSummary),
    getLowFeeSummary: vi.fn().mockResolvedValue(feeSummary),
    getAcceptLowFeeMode: vi.fn().mockResolvedValue(true),
    getInscriptionUtxoDetail: vi.fn().mockResolvedValue({ inscriptions: [] }),
    getBRC20Summary: vi.fn().mockResolvedValue({
      tokenBalance: {
        ticker: 'ordi',
        overallBalance: '100',
        transferableBalance: '10',
        availableBalance: '90',
        availableBalanceSafe: '90',
        availableBalanceUnSafe: '0',
      },
      tokenInfo: {
        totalSupply: '21000000',
        totalMinted: '100',
        decimal: 18,
        holder: '1',
        inscriptionId: 'token-info-1',
        historyCount: 0,
        holdersCount: 1,
        logo: '',
      },
    }),
    createSendAllBTCPsbt: vi.fn(),
    createSendBTCPsbt: vi.fn(),
    createSendBTCOffsetPsbt: vi.fn(),
    createSendInscriptionPsbt: vi.fn(),
    createSendMultipleInscriptionsPsbt: vi.fn(),
    createSplitInscriptionPsbt: vi.fn(),
    createSendRunesPsbt: vi.fn(),
    getRGBAssetBalance: vi.fn(),
    getRGBAssetDetail: vi.fn(),
    getRGBAssetActivity: vi.fn(),
    getRGBList: vi.fn().mockResolvedValue({ list: [], total: 0 }),
    createRgbBlindReceive: vi.fn().mockResolvedValue({ invoice: 'rgb:invoice' }),
    getRgbPendingReceiveInvoices: vi.fn().mockResolvedValue({ list: [] }),
    getRgbAllocationSummary: vi.fn().mockResolvedValue({ available: true }),
    createRgbUtxosBegin: vi.fn(),
    createRgbUtxosEnd: vi.fn(),
    getRgbPendingVanillaTxs: vi.fn().mockResolvedValue({ list: [] }),
    abortRgbVanillaTx: vi.fn(),
    cancelRgbReceiveInvoice: vi.fn(),
  }
}

export function createToolsMock(): ToolsContextType {
  return {
    toast: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    toastWarning: vi.fn(),
    showLoading: vi.fn(),
    showTip: vi.fn(),
    copyToClipboard: vi.fn(),
    openUrl: vi.fn(),
  }
}

export function createNavigationMock(routeState: any = {}): NavigationContextType {
  return {
    navigate: vi.fn(),
    replace: vi.fn(),
    poptotop: vi.fn(),
    goBack: vi.fn(),
    navToTab: vi.fn(),
    navToTest: vi.fn(),
    navToLock: vi.fn(),
    navToWelcome: vi.fn(),
    getRouteState: vi.fn(() => routeState) as any,
    navToUtxoTools: vi.fn(),
    navToUrl: vi.fn(),
    navToExplorerTx: vi.fn(),
    navToExplorerAddress: vi.fn(),
    navToMarketPlace: vi.fn(),
    navToMarketPlaceBrc20: vi.fn(),
    navToInscribeBrc20: vi.fn(),
    openExtensionInTab: vi.fn(),
    navToRootHome: vi.fn(),
  }
}

export function createHookTestHarness({
  wallet = createWalletMock(),
  routeState = {},
  navigation = createNavigationMock(routeState),
  tools = createToolsMock(),
}: {
  wallet?: ReturnType<typeof createWalletMock>
  routeState?: any
  navigation?: NavigationContextType
  tools?: ToolsContextType
} = {}) {
  const store = createTestStore()
  const approval = {
    getApproval: vi.fn().mockResolvedValue(undefined),
    resolveApproval: vi.fn().mockResolvedValue(undefined),
    rejectApproval: vi.fn().mockResolvedValue(undefined),
  }

  const wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(
      Provider,
      { store },
      React.createElement(
        WalletProvider,
        { wallet: wallet as any },
        React.createElement(
          NavigationContext.Provider,
          { value: navigation },
          React.createElement(
            ToolsContext.Provider,
            { value: tools },
            React.createElement(ApprovalContext.Provider, { value: approval }, children)
          )
        )
      )
    )

  return { store, wrapper, wallet, navigation, tools, approval }
}

export const testInscription = {
  inscriptionId: 'inscription-1',
  inscriptionNumber: 1,
  address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
  outputValue: 10000,
  preview: '',
  content: '',
  contentType: 'text/plain',
  contentLength: 0,
  timestamp: 0,
  genesisTransaction: '',
  location: '',
  output: '',
  offset: 0,
  contentBody: '',
  utxoHeight: 0,
  utxoConfirmation: 0,
}
