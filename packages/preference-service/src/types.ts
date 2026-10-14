/**
 * Cross-platform preference service types
 */

import { EventEmitter } from 'eventemitter3'
import { AddressType, ChainType, NetworkType } from '@unisat/wallet-types'
import {
  Account,
  AddressSummary,
  AddressTokenSummary,
  AppSummary,
  BitcoinBalance,
  Inscription,
  TokenBalance,
  TokenTransfer,
  TxHistoryItem,
} from '@unisat/wallet-shared'
import { ProxyStorageAdapter } from '@unisat/wallet-storage'

// Base preference store structure
export interface BasePreferenceStore {
  // Account management
  currentKeyringIndex: number
  currentAccount: Account | undefined | null
  editingKeyringIndex: number
  editingAccount: Account | undefined | null

  // User preferences
  locale: string
  currency: string
  externalLinkAck: boolean
  showSafeNotice: boolean

  // Network and address configuration
  chainType: ChainType
  networkType: NetworkType
  addressType: AddressType

  // Data maps
  balanceMap: {
    [address: string]: BitcoinBalance
  }
  historyMap: {
    [address: string]: TxHistoryItem[]
  }
  watchAddressPreference: Record<string, number>
  walletSavedList: any[]
  alianNames?: Record<string, string>
  keyringAlianNames: {
    [key: string]: string
  }
  accountAlianNames: {
    [key: string]: string
  }
  addressFlags: { [key: string]: number }

  // UI and app data
  uiCachedData: {
    [address: string]: {
      allInscriptionList: {
        currentPage: number
        pageSize: number
        total: number
        list: Inscription[]
      }[]
      brc20List: {
        currentPage: number
        pageSize: number
        total: number
        list: TokenBalance[]
      }[]
      brc20Summary: {
        [ticker: string]: AddressTokenSummary
      }
      brc20TransferableList: {
        [ticker: string]: {
          currentPage: number
          pageSize: number
          total: number
          list: TokenTransfer[]
        }[]
      }
    }
  }
  appTab: {
    summary: AppSummary
    readTabTime: number
    readAppTime: { [key: string]: number }
  }

  // Version management
  initAlianNames: boolean
  currentVersion: string
  firstOpen: boolean
  skippedVersion: string

  // Extension-specific fields (optional)
  autoLockTimeId?: number
  rgbInvoiceExpirySeconds?: number
  rgbInvoiceRecipientType?: 'blind' | 'witness'
  openInSidePanel?: boolean
  developerMode?: boolean

  // Mobile-specific fields (optional)
  guideReaded?: boolean
  addressSummary?: {
    [address: string]: AddressSummary
  }

  // Mobile-specific fields (optional)
  rateUsStatus: RateUsStatus

  acceptLowFeeMode: boolean
  enableRBF: boolean
}

export interface RateUsStatus {
  hasRated: boolean
  ratePromptDismissedAt: number | null
  hasShownSecondPrompt: boolean
}

// Extension-specific additions
export interface ExtensionPreferenceStore extends BasePreferenceStore {
  autoLockTimeId: number
  rgbInvoiceExpirySeconds: number
  rgbInvoiceRecipientType: 'blind' | 'witness'
  openInSidePanel: boolean
  developerMode: boolean
}

// Mobile-specific additions
export interface MobilePreferenceStore extends BasePreferenceStore {
  guideReaded: boolean
  addressSummary: {
    [address: string]: AddressSummary
  }
}

// Service configuration
export interface PreferenceServiceConfig {
  storage: ProxyStorageAdapter
  logger?: any
  t?: any
  eventBus?: EventEmitter
  platformDefaults?: Partial<BasePreferenceStore>
  getBrowserLanguages?: () => Promise<string[]>
}

// Service events
export interface PreferenceServiceEvents {
  'account:changed': (account: Account | null) => void
  'locale:changed': (locale: string) => void
  'currency:changed': (currency: string) => void
  'chain:changed': (chainType: ChainType) => void
  'preference:updated': (key: string, value: any) => void
  'preference:error': (error: Error) => void
}

// Migration interface
export interface MigrationHandler {
  fromVersion: string
  toVersion: string
  migrate: (data: any) => any
}
