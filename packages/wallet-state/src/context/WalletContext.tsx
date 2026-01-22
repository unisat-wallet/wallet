import { createContext, ReactNode, useContext } from 'react'

import { BabylonConfigV2 } from '@unisat/babylon-service/types'

import {
  Account,
  AddressAlkanesTokenSummary,
  AddressCAT20TokenSummary,
  AddressCAT20UtxoSummary,
  AddressCAT721CollectionSummary,
  AddressFlagType,
  AddressRunesTokenSummary,
  AddressSummary,
  AddressTokenSummary,
  AlkanesBalance,
  AlkanesCollection,
  AlkanesInfo,
  Announcement,
  AppInfo,
  AppSummary,
  BabylonAddressSummary,
  BitcoinBalance,
  BitcoinBalanceV2,
  BRC20HistoryItem,
  BtcChannelItem,
  CAT20Balance,
  CAT20MergeOrder,
  CAT721Balance,
  CoinPrice,
  ConnectedSite,
  CosmosBalance,
  CosmosSignDataType,
  DecodedPsbt,
  DummyTxType,
  FeeSummary,
  InscribeOrder,
  Inscription,
  InscriptionSummary,
  RateUsStatus,
  RuneBalance,
  SignedData,
  SignedMessage,
  SignPsbtOptions,
  TickPriceItem,
  TokenBalance,
  TokenTransfer,
  ToSignData,
  ToSignInput,
  ToSignMessage,
  TxHistoryItem,
  UnspentOutput,
  UTXO,
  UTXO_Detail,
  VersionDetail,
  WalletConfig,
  WalletKeyring,
  WebsiteResult,
} from '@unisat/wallet-shared'
import { AddressType, ChainType, NetworkType } from '@unisat/wallet-types'

interface ContactBookItem {
  name: string
  address: string
  chain: ChainType
  isAlias: boolean
  isContact: boolean
  sortIndex?: number
}
type ContactBookStore = Record<string, ContactBookItem | undefined>

export interface WalletController {
  openapi: {
    [key: string]: (...params: any) => Promise<any>
  }
  // for development use only
  requestMethod: (...params: any) => Promise<any>

  setBackgroundInited(value: boolean): Promise<void>
  getBackgroundInited(): Promise<boolean>

  getDesc: () => string
  boot(password: string): Promise<void>
  isBooted(): Promise<boolean>

  getApproval(): Promise<any>
  resolveApproval(data?: any, data2?: any): Promise<void>
  rejectApproval(data?: any, data2?: any, data3?: any): Promise<void>

  hasVault(): Promise<boolean>

  verifyPassword(password: string): Promise<boolean>
  changePassword: (password: string, newPassword: string) => Promise<void>

  unlock(password: string): Promise<void>
  isUnlocked(): Promise<boolean>

  lockWallet(): Promise<void>
  setPopupOpen(isOpen: boolean): void
  isReady(): Promise<boolean>

  getIsFirstOpen(): Promise<boolean>
  updateIsFirstOpen(): Promise<void>

  getAddressBalanceV2(address: string): Promise<BitcoinBalanceV2>
  getAddressBalance(address: string): Promise<BitcoinBalance>
  getAddressCacheBalance(address: string): Promise<BitcoinBalance>
  getMultiAddressAssets(addresses: string): Promise<AddressSummary[]>
  findGroupAssets(
    groups: { type: number; address_arr: string[]; pubkey_arr: string[] }[]
  ): Promise<
    { type: number; address_arr: string[]; pubkey_arr: string[]; satoshis_arr: number[] }[]
  >

  getAddressInscriptions(
    address: string,
    cursor: number,
    size: number
  ): Promise<{ list: Inscription[]; total: number }>

  getAddressHistory: (params: {
    address: string
    start: number
    limit: number
  }) => Promise<{ start: number; total: number; detail: TxHistoryItem[] }>
  getAddressCacheHistory: (address: string) => Promise<TxHistoryItem[]>

  getLocale(): Promise<string>
  setLocale(locale: string): Promise<void>

  getCurrency(): Promise<string>
  setCurrency(currency: string): Promise<void>

  clearKeyrings(): Promise<void>
  getPrivateKey(
    password: string,
    account: { address: string; type: string }
  ): Promise<{ hex: string; wif: string }>
  getMnemonics(
    password: string,
    keyring: WalletKeyring
  ): Promise<{
    hdPath: string
    mnemonic: string
    passphrase: string
  }>
  createKeyringWithPrivateKey(
    data: string,
    addressType: AddressType,
    alianName?: string
  ): Promise<Account[]>
  getPreMnemonics(): Promise<any>
  generatePreMnemonic(): Promise<string>
  removePreMnemonics(): void
  createKeyringWithMnemonics(
    mnemonic: string,
    hdPath: string,
    passphrase: string,
    addressType: AddressType,
    accountCount: number
  ): Promise<{ address: string; type: string }[]>
  createKeyringWithKeystone(
    urType: string,
    urCbor: string,
    addressType: AddressType,
    hdPath: string,
    accountCount: number,
    filterPubkey?: string[],
    connectionType?: 'USB' | 'QR'
  ): Promise<{ address: string; type: string }[]>
  createTmpKeyringWithPrivateKey(
    privateKey: string,
    addressType: AddressType
  ): Promise<WalletKeyring>
  createTmpKeyringWithKeystone(
    urType: string,
    urCbor: string,
    addressType: AddressType,
    hdPath: string,
    accountCount?: number
  ): Promise<WalletKeyring>

  createKeyringWithColdWallet(
    xpub: string,
    addressType: AddressType,
    alianName?: string,
    hdPath?: string,
    accountCount?: number
  ): Promise<WalletKeyring>

  deriveAccountsFromXpub(
    xpub: string,
    addressType: AddressType,
    hdPath?: string,
    accountCount?: number
  ): Promise<{ pubkey: string; address: string }[]>

  createTmpKeyringWithMnemonics(
    mnemonic: string,
    hdPath: string,
    passphrase: string,
    addressType: AddressType,
    accountCount?: number
  ): Promise<WalletKeyring>

  createTmpKeyringWithMnemonics2(
    mnemonic: string,
    passphrase: string,
    hdPaths: string[],
    addressTypes: AddressType[]
  ): Promise<WalletKeyring[]>

  createTmpKeyringWithMnemonicsScan(
    mnemonic: string,
    hdPath: string,
    passphrase: string,
    addressType: AddressType,
    accountCount: number
  ): Promise<WalletKeyring>

  removeKeyring(keyring: WalletKeyring): Promise<WalletKeyring>
  deriveNewAccountFromMnemonic(keyring: WalletKeyring, alianName?: string): Promise<string[]>
  getAccountsCount(): Promise<number>
  getAllAlianName: () => (ContactBookItem | undefined)[]
  getContactsByMap: () => ContactBookStore

  getCurrentAccount(): Promise<Account>
  getAccounts(): Promise<Account[]>
  getNextAlianName: (keyring: WalletKeyring) => Promise<string>

  getCurrentKeyringAccounts(): Promise<Account[]>

  signPsbtV2(toSignData: ToSignData): Promise<SignedData>

  signMessage(params: ToSignMessage): Promise<SignedMessage>

  createSendBTCPsbt(data: {
    to: string
    amount: number
    btcUtxos: UnspentOutput[]
    feeRate: number
    memo?: string
    memos?: string[]
  }): Promise<ToSignData>

  createSendAllBTCPsbt(data: {
    to: string
    btcUtxos: UnspentOutput[]
    feeRate: number
  }): Promise<ToSignData>

  createSendInscriptionPsbt(data: {
    to: string
    inscriptionId: string
    feeRate: number
    outputValue?: number
    btcUtxos: UnspentOutput[]
  }): Promise<ToSignData>

  createSendMultipleInscriptionsPsbt(data: {
    to: string
    inscriptionIds: string[]
    feeRate: number
    btcUtxos: UnspentOutput[]
  }): Promise<ToSignData>

  createSplitInscriptionPsbt(data: {
    inscriptionId: string
    feeRate: number
    outputValue: number
    btcUtxos: UnspentOutput[]
  }): Promise<ToSignData>

  pushTx(rawtx: string): Promise<string>

  queryDomainInfo(domain: string): Promise<Inscription>

  getInscriptionSummary(): Promise<InscriptionSummary>
  getAppSummary(): Promise<AppSummary>
  getBTCUtxos(): Promise<UnspentOutput[]>
  getAssetUtxosInscriptions(inscriptionId: string): Promise<UnspentOutput[]>

  getNetworkType(): Promise<NetworkType>
  setNetworkType(type: NetworkType): Promise<void>

  getChainType(): Promise<ChainType>
  setChainType(type: ChainType): Promise<void>

  getConnectedSites(): Promise<ConnectedSite[]>
  removeConnectedSite(origin: string): Promise<void>
  getCurrentConnectedSite(id: string): Promise<ConnectedSite>

  getCurrentKeyring(): Promise<WalletKeyring>
  getKeyrings(): Promise<WalletKeyring[]>
  getTotalKeyringCount(): Promise<number>
  changeKeyring(keyring: WalletKeyring, accountIndex?: number): Promise<void>
  getAllAddresses(keyring: WalletKeyring, index: number): Promise<string[]>

  setKeyringAlianName(keyring: WalletKeyring, name: string): Promise<WalletKeyring>
  changeAddressType(addressType: AddressType): Promise<void>

  setAccountAlianName(account: Account, name: string): Promise<Account>
  getFeeSummary(): Promise<FeeSummary>
  getLowFeeSummary(): Promise<FeeSummary>
  getCoinPrice(): Promise<CoinPrice>
  getBrc20sPrice(ticks: string[]): Promise<{ [tick: string]: TickPriceItem }>
  getRunesPrice(ticks: string[]): Promise<{ [tick: string]: TickPriceItem }>
  getCAT20sPrice(tokenIds: string[]): Promise<{ [tokenId: string]: TickPriceItem }>
  getAlkanesPrice(alkaneid: string[]): Promise<{ [tick: string]: TickPriceItem }>

  setEditingKeyring(keyringIndex: number): Promise<void>
  getEditingKeyring(): Promise<WalletKeyring>

  setEditingAccount(account: Account): Promise<void>
  getEditingAccount(): Promise<Account>

  inscribeBRC20Transfer(
    address: string,
    tick: string,
    amount: string,
    feeRate: number,
    outputValue: number
  ): Promise<InscribeOrder>
  getInscribeResult(orderId: string): Promise<TokenTransfer>

  decodePsbt(psbtHex: string, website: string): Promise<DecodedPsbt>

  decodeContracts(contracts: any[], account: any): Promise<any[]>

  getAllInscriptionList(
    address: string,
    currentPage: number,
    pageSize: number
  ): Promise<{ currentPage: number; pageSize: number; total: number; list: Inscription[] }>

  getBRC20List(
    address: string,
    currentPage: number,
    pageSize: number
  ): Promise<{ currentPage: number; pageSize: number; total: number; list: TokenBalance[] }>

  getBRC20ProgList(
    address: string,
    currentPage: number,
    pageSize: number
  ): Promise<{ currentPage: number; pageSize: number; total: number; list: TokenBalance[] }>

  getBRC20TransferableList(
    address: string,
    ticker: string,
    currentPage: number,
    pageSize: number
  ): Promise<{ currentPage: number; pageSize: number; total: number; list: TokenTransfer[] }>

  getOrdinalsInscriptions(
    address: string,
    currentPage: number,
    pageSize: number
  ): Promise<{ currentPage: number; pageSize: number; total: number; list: Inscription[] }>

  getBRC20Summary(address: string, ticker: string): Promise<AddressTokenSummary>

  expireUICachedData(address: string): Promise<void>

  getWalletConfig(): Promise<WalletConfig>

  getSkippedVersion(): Promise<string>
  setSkippedVersion(version: string): Promise<void>

  getInscriptionUtxoDetail(inscriptionId: string): Promise<UTXO_Detail>
  getUtxoByInscriptionId(inscriptionId: string): Promise<UTXO>
  getInscriptionInfo(inscriptionId: string): Promise<Inscription>

  checkWebsite(website: string): Promise<WebsiteResult>

  readTab(tabName: string): Promise<void>
  readApp(appid: number): Promise<void>

  formatOptionsToSignInputs(psbtHex: string, options?: SignPsbtOptions): Promise<ToSignInput[]>

  getAddressSummary(address: string): Promise<AddressSummary>

  getShowSafeNotice(): Promise<boolean>
  setShowSafeNotice(show: boolean): Promise<void>

  // address flag
  addAddressFlag(account: Account, flag: AddressFlagType): Promise<Account>
  removeAddressFlag(account: Account, flag: AddressFlagType): Promise<Account>

  getVersionDetail(version: string): Promise<VersionDetail>

  genSignPsbtUr(psbtHex: string): Promise<{ type: string; cbor: string }>
  parseSignPsbtUr(
    type: string,
    cbor: string,
    isFinalize?: boolean
  ): Promise<{ psbtHex: string; rawtx?: string }>
  genSignMsgUr(
    text: string,
    msgType?: string
  ): Promise<{ type: string; cbor: string; requestId: string }>
  parseSignMsgUr(type: string, cbor: string, msgType: string): Promise<{ signature: string }>
  getKeystoneConnectionType(): Promise<'USB' | 'QR'>
  genSignCosmosUr(cosmosSignRequest: {
    requestId?: string
    signData: string
    dataType: CosmosSignDataType
    path: string
    chainId?: string
    accountNumber?: string
    address?: string
  }): Promise<{ type: string; cbor: string; requestId: string }>
  parseCosmosSignUr(type: string, cbor: string): Promise<any>

  cosmosSignData(
    chainId: string,
    signBytesHex: string
  ): Promise<{
    publicKey: string
    signature: string
  }>

  getEnableSignData(): Promise<boolean>
  setEnableSignData(enable: boolean): Promise<void>

  getRunesList(
    address: string,
    currentPage: number,
    pageSize: number
  ): Promise<{ currentPage: number; pageSize: number; total: number; list: RuneBalance[] }>

  getAssetUtxosRunes(rune: string): Promise<UnspentOutput[]>

  getAddressRunesTokenSummary(address: string, runeid: string): Promise<AddressRunesTokenSummary>

  createSendRunesPsbt(data: {
    to: string
    runeid: string
    runeAmount: string
    feeRate: number
    btcUtxos?: UnspentOutput[]
    assetUtxos?: UnspentOutput[]
    outputValue?: number
  }): Promise<ToSignData>

  setAutoLockTimeId(timeId: number): Promise<void>
  getAutoLockTimeId(): Promise<number>

  getDeveloperMode(): Promise<boolean>
  setDeveloperMode(developerMode: boolean): Promise<void>

  getCAT20List(
    version: 'v1' | 'v2',
    address: string,
    currentPage: number,
    pageSize: number
  ): Promise<{ currentPage: number; pageSize: number; total: number; list: CAT20Balance[] }>

  getAddressCAT20TokenSummary(
    version: 'v1' | 'v2',
    address: string,
    tokenId: string
  ): Promise<AddressCAT20TokenSummary>

  getAddressCAT20UtxoSummary(
    version: 'v1' | 'v2',
    address: string,
    tokenId: string
  ): Promise<AddressCAT20UtxoSummary>

  transferCAT20Step1(
    version: 'v1' | 'v2',
    to: string,
    tokenId: string,
    tokenAmount: string,
    feeRate: number
  ): Promise<{ id: string; feeRate: number; toSignData: ToSignData }>
  transferCAT20Step2(
    version: 'v1' | 'v2',
    transferId: string,
    psbtHex: string
  ): Promise<{ toSignData: ToSignData }>
  transferCAT20Step3(
    version: 'v1' | 'v2',
    transferId: string,
    psbtHex: string
  ): Promise<{ txid: string }>

  mergeCAT20Prepare(
    version: 'v1' | 'v2',
    tokenId: string,
    utxoCount: number,
    feeRate: number
  ): Promise<CAT20MergeOrder>
  transferCAT20Step1ByMerge(
    version: 'v1' | 'v2',
    mergeId: string
  ): Promise<{ id: string; feeRate: number; toSignData: ToSignData }>
  getMergeCAT20Status(version: 'v1' | 'v2', mergeId: string): Promise<any>

  getAppList(): Promise<{ tab: string; items: AppInfo[] }[]>
  getBannerList(): Promise<{ id: string; img: string; link: string }[]>
  getBlockActiveInfo(): Promise<{ allTransactions: number; allAddrs: number }>

  getCAT721List(
    version: 'v1' | 'v2',
    address: string,
    currentPage: number,
    pageSize: number
  ): Promise<{ currentPage: number; pageSize: number; total: number; list: CAT721Balance[] }>

  getAddressCAT721CollectionSummary(
    version: 'v1' | 'v2',
    address: string,
    collectionId: string
  ): Promise<AddressCAT721CollectionSummary>

  transferCAT721Step1(
    version: 'v1' | 'v2',
    to: string,
    collectionId: string,
    localId: string,
    feeRate: number
  ): Promise<{ id: string; feeRate: number; toSignData: ToSignData }>
  transferCAT721Step2(
    version: 'v1' | 'v2',
    transferId: string,
    psbtHex: string
  ): Promise<{ toSignData: ToSignData }>
  transferCAT721Step3(
    version: 'v1' | 'v2',
    transferId: string,
    psbtHex: string
  ): Promise<{ txid: string }>

  getBuyCoinChannelList(coin: string): Promise<BtcChannelItem[]>
  createBuyCoinPaymentUrl(coin: string, address: string, channel: string): Promise<string>

  getBabylonAddress(address: string): Promise<string>

  getBabylonAddressSummary(
    chainId: string,
    babylonConfig?: BabylonConfigV2
  ): Promise<BabylonAddressSummary>

  createSendTokenStep1(
    chainId: string,
    tokenBalance: CosmosBalance,
    to: string,
    memo: string,
    {
      gasLimit,
      gasPrice,
      gasAdjustment,
    }: {
      gasLimit: number
      gasPrice: string
      gasAdjustment?: number
    }
  ): Promise<string>
  createSendTokenStep2(chainId: string, signature: string): Promise<string>

  simulateBabylonGas(
    chainId: string,
    recipient: string,
    amount: { denom: string; amount: string },
    memo: string
  ): Promise<number>

  getBabylonConfig(): Promise<BabylonConfigV2>

  getContactByAddress(address: string): Promise<ContactBookItem | undefined>
  getContactByAddressAndChain(
    address: string,
    chain: ChainType
  ): Promise<ContactBookItem | undefined>
  updateContact(data: ContactBookItem): Promise<void>
  removeContact(address: string, chain?: ChainType): Promise<void>
  listContacts(): Promise<ContactBookItem[]>
  saveContactsOrder(contacts: ContactBookItem[]): Promise<void>

  singleStepTransferBRC20Step1(params: {
    userAddress: string
    userPubkey: string
    receiver: string
    ticker: string
    amount: string
    feeRate: number
  }): Promise<{
    orderId: string
    toSignData: ToSignData
  }>

  singleStepTransferBRC20Step2(params: { orderId: string; commitTx: string }): Promise<{
    toSignData: ToSignData
  }>

  singleStepTransferBRC20Step3(params: {
    orderId: string
    revealTx: string
  }): Promise<{ txid: string }>

  setLastActiveTime(): void

  getOpenInSidePanel(): Promise<boolean>
  setOpenInSidePanel(openInSidePanel: boolean): Promise<void>

  createSendBTCOffsetPsbt(
    tos: { address: string; satoshis: number }[],
    feeRate: number
  ): Promise<ToSignData>

  getAlkanesList(
    address: string,
    currentPage: number,
    pageSize: number
  ): Promise<{ currentPage: number; pageSize: number; total: number; list: AlkanesBalance[] }>

  getAssetUtxosAlkanes(rune: string): Promise<UnspentOutput[]>

  getAddressAlkanesTokenSummary(
    address: string,
    alkaneid: string,
    fetchAvailable: boolean
  ): Promise<AddressAlkanesTokenSummary>

  createSendAlkanesPsbt(params: {
    to: string
    alkaneid: string
    amount: string
    feeRate: number
  }): Promise<ToSignData>

  getAlkanesCollectionList(
    address: string,
    currentPage: number,
    pageSize: number
  ): Promise<{ list: AlkanesCollection[]; total: number }>
  getAlkanesCollectionItems(
    address: string,
    collectionId: string,
    currentPage: number,
    pageSize: number
  ): Promise<{ currentPage: number; pageSize: number; list: AlkanesInfo[]; total: number }>

  getBRC20RecentHistory(address: string, ticker: string): Promise<BRC20HistoryItem[]>

  resetAllData(): Promise<void>

  getGuideReaded(): Promise<boolean>
  setGuideReaded(): Promise<void>

  getRateUsStatus(): Promise<RateUsStatus>

  setHasRated(hasRated: boolean): Promise<void>
  setRatePromptDismissedAt(timestamp: number | null): Promise<void>
  setHasShownSecondPrompt(hasShown: boolean): Promise<void>
  resetRateUsStatus(): Promise<void>
  getAnnouncements(
    cursor: number,
    size: number
  ): Promise<{
    hasMore: boolean
    list: Announcement[]
  }>

  getAcceptLowFeeMode(): Promise<boolean>
  setAcceptLowFeeMode(accept: boolean): Promise<void>

  createTmpKeyringWithPublicKey(publicKey: string, addressType: AddressType): Promise<WalletKeyring>

  createKeyringWithPublicKey(data: string, addressType: AddressType): Promise<void>

  createDummyPsbt(params: { txType: DummyTxType }): Promise<ToSignData>
}

const WalletContext = createContext<{
  wallet: WalletController
} | null>(null)

const WalletProvider = ({
  children,
  wallet,
}: {
  children?: ReactNode
  wallet: WalletController
}) => <WalletContext.Provider value={{ wallet }}>{children}</WalletContext.Provider>

const useWallet = () => {
  const { wallet } = useContext(WalletContext) as {
    wallet: WalletController
  }

  return wallet
}

export { useWallet, WalletProvider }
