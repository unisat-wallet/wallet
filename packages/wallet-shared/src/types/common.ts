import { ChainType } from '@unisat/wallet-types'

export enum PaymentChannelType {
  MoonPay = 'moonpay',
  AlchemyPay = 'alchemypay',
  Transak = 'transak',
}

export enum RestoreWalletType {
  UNISAT = 0,
  MAGIC_EDEN = 1,
  XVERSE = 2,
  SPARROW = 3,
  OW = 4,
  OTHERS = 5,
}

export interface Chain {
  name: string
  logo: string
  enum: ChainType
  network: string
}

export interface AppDisclaimerMeta {
  enabled: boolean
  version?: string
}

export interface AppExtraInfo {
  disclaimer?: AppDisclaimerMeta
}

export interface AppDisclaimer {
  title?: string
  content: string
  confirmText?: string
  cancelText?: string
}

export interface AppExtra {
  disclaimer?: AppDisclaimer
}

export interface AppInfo {
  logo: string
  title: string
  desc: string
  route?: string
  url: string
  time: number
  id: number
  tag?: string
  readtime?: number
  new?: boolean
  tagColor?: string
  extraInfo?: AppExtraInfo
}

export interface AppSummary {
  apps: AppInfo[]
  readTabTime?: number
}

export interface FeeSummary {
  list: {
    title: string
    desc: string
    feeRate: number
  }[]
}

export interface CoinPrice {
  btc: number
  fb: number
}

export interface WalletConfig {
  version: string
  moonPayEnabled: boolean
  statusMessage: string
  endpoint: string
  chainTip: string
  disableUtxoTools: boolean
  /** RGB USDT asset shown before it has a balance; '-' displays an inactive zero-balance item. */
  rgbUsdtAssetId?: string
}

export enum WebsiteState {
  CHECKING,
  SCAMMER,
  SAFE,
}

export interface VersionDetail {
  version: string
  title: string
  changelogs: string[]
  notice: string
}

export interface BtcChannelItem {
  channel: PaymentChannelType
  quote: number
  payType: string[]
}

export type TickPriceItem = {
  curPrice: number
  changePercent: number
}

export interface WebsiteResult {
  isScammer: boolean
  warning: string
  allowQuickMultiSign: boolean
}

export interface BitcoinBalanceV2 {
  availableBalance: number
  unavailableBalance: number
  totalBalance: number
  chainType: ChainType
}
