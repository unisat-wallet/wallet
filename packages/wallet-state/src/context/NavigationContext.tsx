import {
  Account,
  AlkanesBalance,
  AlkanesInfo,
  BabylonTxInfo,
  CAT20Balance,
  CAT20TokenInfo,
  CAT721CollectionInfo,
  CAT_VERSION,
  Inscription,
  RuneBalance,
  RuneInfo,
  TokenBalance,
  TokenInfo,
  ToSignData,
  WalletKeyring,
} from '@unisat/wallet-shared'
import { ChainType } from '@unisat/wallet-types'
import React, { useContext } from 'react'

export type RouteParamList = {
  WelcomeScreen: undefined
  UnlockScreen: {
    autoUnlockByFace: boolean
  }
  CreatePasswordScreen: {
    isNewAccount?: boolean
    isKeystone?: boolean
    fromColdWallet?: boolean
  }

  MainScreen: undefined

  // tabs
  WalletTabScreen: undefined
  AppTabScreen: undefined
  TabMainScreen: undefined
  DiscoverTabScreen: undefined
  SettingsTabScreen: undefined

  // WALLET
  CreateHDWalletScreen: {
    restoreTiTle?: boolean
    topTitle?: boolean
    finalButton?: string
    existingMnemonic?: string
    isBackupFlow?: boolean

    isImport?: boolean
    comeFrom?: string
    fromUnlock?: boolean
    goBack?: boolean
  }
  CreateSimpleWalletScreen: undefined
  CreateColdWalletScreen: {
    fromUnlock?: boolean
  }
  CreateKeystoneWalletScreen: {
    fromUnlock?: boolean
  }

  EditWalletNameScreen: {
    keyring: WalletKeyring
  }
  ExportMnemonicsScreen: { keyring: WalletKeyring }
  ExportPrivateKeyScreen: {
    account: Account
  }
  SwitchAccountScreen: undefined
  ReceiveScreen: undefined
  HistoryScreen: undefined
  KeyringOrAccountScreen: undefined
  AddKeyringScreen: undefined
  ImportHDWalletScreen: {
    comeFrom?: string
  }
  CreateAccountScreen: {
    keyringKey?: string
  }
  CreateKeystoneScreen: {
    comeFrom?: string
    goBack?: boolean
  }
  EditAccountNameScreen: {
    account: Account
  }
  KeyringDetailScreen: {
    keyringKey?: string
  }

  // Settings
  ConnectedSitesScreen: undefined
  AddressTypeScreen: undefined
  AdvancedScreen: undefined
  ContactsScreen: {
    returnWithNetwork?: ChainType
    lastEditedContactAddress?: string
  }
  EditContactScreen: {
    address?: string
    chain?: string
    selectedNetworkFilter: string
  }
  AboutUsScreen: undefined
  LanguageScreen: undefined
  ChangePasswordScreen: undefined
  ModuleAssets: undefined

  // Tools
  UtxoToolsMainScreen: undefined
  ScanScreen: {
    from?: string
  }
  BrowserScreen: {
    info: any
  }

  // BTC
  TxCreateScreen: undefined

  // INSCRIPTIONS
  OrdinalsInscriptionScreen: {
    inscription: Inscription
    inscriptionId?: string
    withSend?: boolean
  }
  SendOrdinalsInscriptionScreen: {
    inscription: Inscription
    inscriptionId?: string
  }
  SplitOrdinalsInscriptionScreen: {
    inscription: Inscription
    inscriptionId?: string
  }

  // BRC20
  BRC20TokenScreen: {
    ticker: string
    tokenBalance?: TokenBalance
  }
  BRC20SendScreen: {
    tokenBalance: TokenBalance
    tokenInfo: TokenInfo
    selectedInscriptionIds?: string[]
    selectedAmount?: string
  }
  BRC20InscribeTransfer: {
    ticker: string
  }
  BRC20SingleStepScreen: {
    tokenBalance: TokenBalance
    tokenInfo: TokenInfo
  }
  InscribeTransferScreen: {
    ticker: string
  }

  // RUNES
  RunesTokenScreen: {
    runeid: string
  }
  SendRunesScreen: {
    runeBalance: RuneBalance
    runeInfo: RuneInfo
  }

  // Alkanes
  AlkanesTokenScreen: {
    alkaneid: string
  }
  SendAlkanesScreen: {
    tokenBalance: AlkanesBalance
    tokenInfo: AlkanesInfo
  }
  AlkanesCollectionScreen: {
    collectionId: string
  }
  AlkanesNFTScreen: {
    alkanesInfo: AlkanesInfo
  }
  SendAlkanesNFTScreen: {
    alkanesInfo: AlkanesInfo
  }

  // CAT
  CAT20TokenScreen: {
    tokenId: string
    version: CAT_VERSION
  }
  SendCAT20Screen: {
    version: CAT_VERSION
    cat20Balance: CAT20Balance
    cat20Info: CAT20TokenInfo
  }
  MergeCAT20Screen: {
    version: CAT_VERSION
    cat20Balance: CAT20Balance
    cat20Info: CAT20TokenInfo
  }
  CAT721CollectionScreen: {
    collectionId: string
    version: CAT_VERSION
  }
  CAT721NFTScreen: {
    version: CAT_VERSION
    collectionInfo: CAT721CollectionInfo
    localId: string
  }
  SendCAT721Screen: {
    version: CAT_VERSION
    collectionInfo: CAT721CollectionInfo
    localId: string
  }

  // Babylon
  BabylonTxConfirmScreen: {
    txInfo: BabylonTxInfo
  }
  BabylonStakingScreen: undefined
  SendBabyScreen: undefined

  // TX
  TxConfirmScreen: {
    toSignData: ToSignData
  }
  TxSuccessScreen: {
    txid: string
  }
  TxFailScreen: {
    error: string
  }
}

export type RouteTypes = keyof RouteParamList

type NavigateArgs<T extends RouteTypes> = RouteParamList[T] extends undefined
  ? [screenName: T]
  : [screenName: T, params: RouteParamList[T]]

export interface NavigationContextType {
  navigate<T extends RouteTypes>(...args: NavigateArgs<T>): void

  replace<T extends RouteTypes>(...args: NavigateArgs<T>): void

  poptotop: () => void
  goBack: () => void
  navToTab: () => void
  navToTest: () => void
  navToLock: (params?: any) => void
  navToWelcome: () => void

  getRouteState<T extends RouteTypes>(): RouteParamList[T]

  navToUtxoTools: () => void
  navToUrl: (url: string) => void

  navToExplorerTx: (txid: string) => void
  navToExplorerAddress: (address: string) => void

  navToMarketPlaceBrc20: (ticker: string) => void
  navToInscribeBrc20: (ticker: string) => void

  openExtensionInTab?: () => void // in extension only
  navToRootHome: () => void // in extension only
}

const initContext = {
  navigate: () => {},
  poptotop: () => {},
  goBack: () => {},
  replace: () => {},
  navToTab: () => {},
  navToTest: () => {},
  navToLock: () => {},
  navToWelcome: () => {},

  getRouteState<T>(): T {
    // todo
    return undefined as T
  },

  navToUtxoTools: () => {},

  navToUrl: (url: string) => {},
  navToExplorerTx: (txid: string) => {},
  navToExplorerAddress: (address: string) => {},

  navToMarketPlaceBrc20: (ticker: string) => {},
  navToInscribeBrc20: (ticker: string) => {},

  // in extension only
  openExtensionInTab: () => {},
  navToRootHome: () => {},
}

export const NavigationContext = React.createContext<NavigationContextType>(initContext)

export function useNavigation() {
  const ctx = useContext(NavigationContext)
  return ctx
}
