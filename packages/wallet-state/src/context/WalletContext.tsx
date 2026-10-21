import React, { ReactNode, useContext } from 'react'

import { BabylonConfigV2 } from '@unisat/babylon-service/types'

import {
  Account,
  AddressHistorySummaryPage,
  AddressHistoryTxDetail,
  AddressAlkanesTokenSummary,
  AddressAssetSummary,
  AddressAssetOverviewItem,
  AddressFlagType,
  AddressRunesTokenSummary,
  AddressSummary,
  AddressTokenSummary,
  AlkanesBalance,
  AlkanesCollection,
  AlkanesInfo,
  Announcement,
  AppExtra,
  AppInfo,
  AppSummary,
  BRC20HistoryItem,
  Brc20TickFilter,
  BabylonAddressSummary,
  BitcoinBalance,
  BitcoinBalanceV2,
  BtcChannelItem,
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
  LocalPsbtSummary,
  RateUsStatus,
  RuneBalance,
  SignPsbtOptions,
  SignedData,
  SignedMessage,
  StoredNotification,
  TickPriceItem,
  ToSignData,
  ToSignInput,
  ToSignMessage,
  TokenBalance,
  TokenTransfer,
  TxHistoryItem,
  UTXO,
  UTXO_Detail,
  UnspentOutput,
  VersionDetail,
  WalletConfig,
  WalletKeyring,
  WebsiteResult,
} from '@unisat/wallet-shared'
import { AddressType, ChainType, NetworkType } from '@unisat/wallet-types'
import type {
  RgbActivityItem,
  RgbActivityType,
  RgbAssetDetail,
  RgbBalance,
  RgbTransferItem,
} from '../types'

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
  resolveUnlockApproval(): Promise<boolean>
  resolveConnectApproval(origin: string): Promise<boolean>
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
  }) => Promise<AddressHistorySummaryPage>
  getAddressHistoryDetail: (params: { address: string; txid: string }) => Promise<AddressHistoryTxDetail>
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
    alianName?: string,
    compressed?: boolean
  ): Promise<Account[]>
  generatePreMnemonic(strength?: 128 | 256): Promise<string>
  removePreMnemonics(): void
  createKeyringWithMnemonics(
    mnemonic: string,
    hdPath: string,
    passphrase: string,
    addressType: AddressType,
    accountCount: number,
    accountIndexDerivation?: boolean
  ): Promise<{ address: string; type: string }[]>
  createKeyringWithPreMnemonic(
    hdPath: string,
    passphrase: string,
    addressType: AddressType,
    accountCount: number,
    accountIndexDerivation?: boolean
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
    addressType: AddressType,
    compressed?: boolean
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
    accountCount?: number,
    accountIndexDerivation?: boolean
  ): Promise<WalletKeyring>
  createTmpKeyringWithPreMnemonic(
    hdPath: string,
    passphrase: string,
    addressType: AddressType,
    accountCount?: number,
    accountIndexDerivation?: boolean
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
    accountCount: number,
    accountIndexDerivation?: boolean
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
    enableRBF?: boolean
    memo?: string
    memos?: string[]
  }): Promise<ToSignData>

  createSendAllBTCPsbt(data: {
    to: string
    btcUtxos: UnspentOutput[]
    feeRate: number
    enableRBF?: boolean
  }): Promise<ToSignData>

  createSendInscriptionPsbt(data: {
    to: string
    inscriptionId: string
    feeRate: number
    outputValue?: number
    btcUtxos: UnspentOutput[]
    enableRBF?: boolean
  }): Promise<ToSignData>

  createSendMultipleInscriptionsPsbt(data: {
    to: string
    inscriptionIds: string[]
    feeRate: number
    btcUtxos: UnspentOutput[]
    enableRBF?: boolean
  }): Promise<ToSignData>

  createSplitInscriptionPsbt(data: {
    inscriptionId: string
    feeRate: number
    outputValue: number
    btcUtxos: UnspentOutput[]
    enableRBF?: boolean
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
  updateConnectSite(origin: string, data: Partial<ConnectedSite>): Promise<void>

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
  analyzeLocalPsbts(toSignDatas: ToSignData[]): Promise<LocalPsbtSummary>

  decodeContracts(contracts: any[], account: any): Promise<any[]>

  getAllInscriptionList(
    address: string,
    currentPage: number,
    pageSize: number
  ): Promise<{ currentPage: number; pageSize: number; total: number; list: Inscription[] }>

  getBRC20List({
    address,
    currentPage,
    pageSize,
    tickFilter,
  }: {
    address: string
    currentPage: number
    pageSize: number
    tickFilter?: Brc20TickFilter.TICK_BYTES_4_5_6
  }): Promise<{ currentPage: number; pageSize: number; total: number; list: TokenBalance[] }>

  getBRC20ProgList({
    address,
    currentPage,
    pageSize,
  }: {
    address: string
    currentPage: number
    pageSize: number
  }): Promise<{ currentPage: number; pageSize: number; total: number; list: TokenBalance[] }>

  getBRC20TransferableList({
    address,
    ticker,
    tickerHex,
    currentPage,
    pageSize,
  }: {
    address: string
    ticker: string
    tickerHex: string
    currentPage: number
    pageSize: number
  }): Promise<{ currentPage: number; pageSize: number; total: number; list: TokenTransfer[] }>

  getOrdinalsInscriptions(
    address: string,
    currentPage: number,
    pageSize: number
  ): Promise<{ currentPage: number; pageSize: number; total: number; list: Inscription[] }>

  getBRC20Summary({
    address,
    ticker,
  }: {
    address: string
    ticker: string
  }): Promise<AddressTokenSummary>

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
  getAddressAssetSummary(address: string): Promise<AddressAssetSummary>
  getAddressAssetOverview(address: string): Promise<{ list: AddressAssetOverviewItem[] }>

  getShowSafeNotice(): Promise<boolean>
  setShowSafeNotice(show: boolean): Promise<void>
  getAssetsNewBadgeDismissed(address: string): Promise<boolean>
  setAssetsNewBadgeDismissed(address: string, dismissed?: boolean): Promise<void>

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
    enableRBF?: boolean
  }): Promise<ToSignData>

  setAutoLockTimeId(timeId: number): Promise<void>
  getAutoLockTimeId(): Promise<number>
  setRgbInvoiceExpirySeconds(seconds: number): Promise<void>
  getRgbInvoiceExpirySeconds(): Promise<number>

  getDeveloperMode(): Promise<boolean>
  setDeveloperMode(developerMode: boolean): Promise<void>

  getAppList(): Promise<{ tab: string; items: AppInfo[] }[]>
  getAppExtra(id: string | number, locale?: string): Promise<AppExtra>
  getBannerList(): Promise<{ id: string; img: string; link: string }[]>
  getBlockActiveInfo(): Promise<{ allTransactions: number; allAddrs: number }>

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
    feeRate: number,
    enableRBF?: boolean
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

  getRGBList(
    address: string,
    currentPage: number,
    pageSize: number,
    options?: { skipSync?: boolean }
  ): Promise<{ currentPage: number; pageSize: number; total: number; list: RgbBalance[] }>

  /** RGB is opt-in per local installation and HD wallet. */
  getRgbFeatureStatus(): Promise<{ enabled: boolean; supported: boolean; remoteRecoveryAvailable: boolean }>
  enableRgbFeature(): Promise<{ enabled: true }>

  getRGBAssetBalance(address: string, assetId: string): Promise<RgbBalance | undefined>

  getRGBAssetDetail(address: string, assetId: string): Promise<RgbAssetDetail>

  /** Base64 of a standard RGB\0CON contract file (NIA only). */
  exportRgbAssetContract(assetId: string): Promise<string>
  /** Base64 of a terminal-free RGB\0TFR BFA burn proof. */
  exportRgbBurnConsignment(txid: string): Promise<string>
  exportRgbBurnDestination(txid: string): Promise<{ version: 1; destinationChainId: number; dstEid: number; recipient: string; burnReason: string }>

  getRGBAssetActivity(
    address: string,
    assetId: string,
    currentPage: number,
    pageSize: number,
    type?: RgbActivityType
  ): Promise<{ currentPage: number; pageSize: number; total: number; list: RgbActivityItem[] }>

  getAddressRgbActivity(
    address: string,
    currentPage: number,
    pageSize: number,
    assetId?: string,
    type?: RgbActivityType
  ): Promise<{ currentPage: number; pageSize: number; total: number; list: RgbActivityItem[] }>

  getRgbTransfers(
    currentPage: number,
    pageSize: number,
    options?: { skipSync?: boolean }
  ): Promise<{ currentPage: number; pageSize: number; total: number; list: RgbTransferItem[] }>

  createRgbBlindReceive(params: {
    assetId?: string
    amount?: number | string
    durationSeconds?: number
    skipSync?: boolean
  }): Promise<any>

  createRgbWitnessReceive(params: {
    assetId?: string
    amount?: number | string
    durationSeconds?: number
    skipSync?: boolean
  }): Promise<any>

  checkRgbInvoiceAvailability(params: { invoice: string }): Promise<{ available: true }>

  getRgbPendingReceiveInvoices(params?: { skipSync?: boolean }): Promise<{
    list: Array<{
      invoice: string
      recipientId?: string
      assetId?: string | null
      amount?: number | string
      status?: string
      kind?: string
      transferKind?: string
      batchTransferIdx?: number
      expirationTimestamp?: number
      createdAt?: number
      [key: string]: any
    }>
    [key: string]: any
  }>

  getRgbRecoveryCheckpointStatus(): Promise<{
    dirty: boolean
    verified: boolean
    conflicted: boolean
    lastError?: string
  }>

  /** Discard local conflicted RGB state and reload the latest cloud checkpoint. */
  restoreLatestRgbRecoveryCheckpoint(): Promise<{ restored: true; updatedAt?: number }>

  /** Keep this device's conflicted state and explicitly replace the cloud checkpoint. */
  publishLocalRgbRecoveryConflictResolution(): Promise<{ published: true }>

  /** Creates a seed-bound, encrypted offline RGB recovery package. */
  exportRgbBackup(): Promise<string>

  /** Exports every created RGB account in the selected HD keyring. */
  getRgbHdBackupPlan(): Promise<{
    network: string
    walletScope: string
    accountIndexes: number[]
  }>

  exportRgbHdBackup(expected?: {
    network: string
    walletScope: string
    accountIndexes: number[]
  }): Promise<string>

  /** Authenticates a package and confirms it belongs to the current RGB wallet. */
  inspectRgbBackup(
    payload: string
  ): Promise<{ createdAt: number; wallet: { fundingAddress: string; network: string } }>

  /** Explicitly replaces local and remote RGB recovery state; no state merge is performed. */
  restoreRgbBackup(params: { payload: string; replaceRemote: boolean }): Promise<{
    restored: true
    createdAt: number
  }>

  inspectRgbBackupFile(payload: string): Promise<{
    kind: 'hd' | 'account'
    createdAt: number
    network: string
    accountIndexes: number[]
    missingAccountIndexes?: number[]
    accountsToCreateIndexes?: number[]
  }>

  restoreRgbBackupFile(params: { payload: string; replaceRemote: boolean; createMissingAccounts?: boolean; progressId?: string }): Promise<{
    restored: true
    createdAt: number
    accountIndexes: number[]
  }>

  getRgbWriteLeaseStatus(): Promise<{
    mode: 'writer' | 'available' | 'readonly'
    expiresAt?: number
  }>

  activateRgbWriteLease(params?: { takeover?: boolean }): Promise<{
    active: true
    expiresAt: number
  }>

  releaseRgbWriteLease(): Promise<{ released: boolean }>

  getRgbUtxoInspection(params?: { forceSync?: boolean }): Promise<{
    address: string
    derivationPath: string
    snapshot: {
      syncedAt: number
      utxos: Array<{
        outpoint: { txid: string; vout: number }
        satoshis: number
        chainStatus?: 'mempool' | 'confirmed' | 'pending_spend' | 'spent' | 'replaced' | 'unknown'
        confirmations?: number
        allocations: Array<{
          assetId: string
          amount: string
          settled: boolean
          spendable: boolean
        }>
      }>
    }
    assetMetadata: Record<string, { name?: string; ticker?: string; precision?: number }>
    invoiceReservations: Array<{
      invoice: string
      recipientId: string
      assetId?: string
      amount?: string
      expirationTimestamp?: number
      createdAt: number
      txid: string
      vout: number
    }>
  }>

  cancelRgbReceiveInvoice(params: { batchTransferIdx: number; skipSync?: boolean }): Promise<{
    changed: boolean
    [key: string]: any
  }>

  getRgbFundingAddress(): Promise<{ address: string }>

  createRgbIssueNia(params: {
    ticker: string
    name: string
    precision: number
    amounts: Array<number | string>
  }): Promise<any>

  createRgbUtxosBegin(params: {
    upTo?: boolean
    num?: number
    size?: number
    feeRate?: number
    skipSync?: boolean
    dryRun?: boolean
  }): Promise<any>

  createRgbUtxosEnd(params: { signedPsbt: string }): Promise<any>

  getRgbPendingVanillaTxs(): Promise<{
    list: Array<{
      txid: string
      type?: string
      [key: string]: any
    }>
    [key: string]: any
  }>

  abortRgbVanillaTx(params: { txid: string; discardUnsigned?: boolean }): Promise<{
    aborted: boolean
    [key: string]: any
  }>

  retryRgbBroadcast(params: { transferId: string }): Promise<{
    broadcast: boolean
    status: 'confirming' | 'broadcast_failed' | 'waiting_ack' | 'not_retryable' | 'canceled'
    error?: string
  }>

  acceptRgbReceive(params: { recipientId: string }): Promise<{
    accepted: boolean
    status: 'accepted' | 'canceled'
    [key: string]: any
  }>

  rejectRgbReceive(params: { recipientId: string }): Promise<{
    rejected: boolean
    [key: string]: any
  }>

  abandonRgbAcceptedReceive(params: { recipientId: string }): Promise<{
    abandoned: boolean
    [key: string]: any
  }>

  getRgbAllocationSummary(params?: { skipSync?: boolean }): Promise<{
    available?: boolean
    availableAllocationCount?: number
    freeAllocationCount?: number
    colorableUtxoCount?: number
    pendingConfirmation?: boolean
    pendingAllocationCount?: number
    [key: string]: any
  }>

  createRgbSendBegin(params: {
    invoice: string
    assetId: string
    amount?: number | string
    ticker?: string
    name?: string
    precision?: number
    feeRate?: number
    minConfirmations?: number
    donation?: boolean
    burn?: boolean
    burnReason?: string
    burnDestinationChainId?: number
    burnDestination?: { version: 1; destinationChainId: number; dstEid: number; recipient: string }
    witnessData?: {
      amountSat: number | string
      blinding?: number | string | null
    }
  }): Promise<any>

  getRgbFeePoolStatus(params?: { feeRate?: number }): Promise<{
    ready: boolean
    availableCount: number
    targetCount: number
    minimumSatoshis: number
    address: string
  }>

  getRgbFeePoolInspection(params?: { feeRate?: number }): Promise<{
    ready: boolean
    availableCount: number
    targetCount: number
    minimumSatoshis: number
    address: string
    derivationPath: string
    utxos: Array<{
      txid: string
      vout: number
      satoshis: number
      pending: boolean
      locked: boolean
      available: boolean
    }>
    withdrawals: Array<{
      txid: string
      amount: number
      destination: string
      createdAt: number
    }>
  }>

  createRgbFeePoolWithdrawBegin(params?: { feeRate?: number }): Promise<{
    toSignData: ToSignData
    amount?: number
  }>

  createRgbFeePoolWithdrawEnd(params: { signedPsbt: string }): Promise<{ txid: string }>

  createRgbFeePoolTopUpBegin(params?: { feeRate?: number }): Promise<any>

  createRgbFeePoolTopUpEnd(params: { signedPsbt: string }): Promise<any>

  createRgbSendEnd(params: {
    signedPsbt: string
    transferId?: string
    skipSync?: boolean
  }): Promise<any>

  createSendAlkanesPsbt(params: {
    to: string
    alkaneid: string
    amount: string
    feeRate: number
    type: 'ft' | 'nft'
    enableRBF?: boolean
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

  getNotifications(): Promise<StoredNotification[]>
  readNotification(id: string): Promise<void>
  readAllNotifications(): Promise<void>
  deleteNotification(id: string): Promise<void>
  getNotificationUnreadCount(): Promise<number>

  getAcceptLowFeeMode(): Promise<boolean>
  setAcceptLowFeeMode(accept: boolean): Promise<void>
  getEnableRBF(): Promise<boolean>
  setEnableRBF(enableRBF: boolean): Promise<void>

  createTmpKeyringWithPublicKey(publicKey: string, addressType: AddressType): Promise<WalletKeyring>

  createKeyringWithPublicKey(data: string, addressType: AddressType): Promise<void>

  createTmpKeyringWithAddress(address: string): Promise<WalletKeyring>

  createKeyringWithAddress(address: string): Promise<void>

  createDummyPsbt(params: { txType: DummyTxType }): Promise<ToSignData>
}

const WalletContext = React.createContext<{
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

export { WalletProvider, useWallet }
