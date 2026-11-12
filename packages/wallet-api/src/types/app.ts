/**
 * Application and configuration related type definitions
 */

import { NetworkType } from '@unisat/wallet-types'

// ========================================
// Application and configuration related
// ========================================

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

export interface WalletConfig {
  version: string
  endpoint: string
  endpoints: string[]
  chainType: NetworkType
  enabledFeatures: string[]
  /** '-' displays USDT without enabling receive or send. */
  rgbUsdtAssetId?: string
  rgbAssetPolicies?: Array<{
    assetId: string
    displayName?: string
    ticker?: string
    official?: boolean
    status?: 'active' | 'deprecated' | 'disabled'
    notice?: string
    showWhenZero?: boolean
    sortOrder?: number
  }>
  feeRates: {
    slow: number
    standard: number
    fast: number
  }
  limits: {
    maxTransactionSize: number
    maxFeeRate: number
    minFeeRate: number
    maxUtxos: number
  }
}

export interface VersionDetail {
  version: string
  title: string
  changelogs: string[]
  notice: string
}

// ========================================
// Babylon related (if needed)
// ========================================

export interface BabylonConfigV2 {
  [key: string]: any
}

export enum AnnouncementLinkType {
  EXTERNAL_LINK = 'EXTERNAL_LINK',
  INTERNAL_LINK = 'INTERNAL_LINK',
  INTERNAL_ROUTE = 'INTERNAL_ROUTE',
  NONE = 'NONE',
}

export interface Announcement {
  id: string
  title: string
  description: string
  startTime: number
  endTime: number
  link: string
  linkType: AnnouncementLinkType
}
