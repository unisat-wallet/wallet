import { ChainType } from '@unisat/wallet-types'

export enum PaymentChannelType {
  MoonPay = 'moonpay',
  AlchemyPay = 'alchemypay',
  Transak = 'transak',
}

export enum RestoreWalletType {
  UNISAT,
  SPARROW,
  XVERSE,
  OW,
  OTHERS,
}

export interface Chain {
  name: string
  logo: string
  enum: ChainType
  network: string
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
}
