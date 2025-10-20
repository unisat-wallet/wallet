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
  enableSignData: boolean
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
  openInSidePanel?: boolean
  developerMode?: boolean

  // Mobile-specific fields (optional)
  guideReaded?: boolean
  addressSummary?: {
    [address: string]: AddressSummary
  }
}

// Extension-specific additions
export interface ExtensionPreferenceStore extends BasePreferenceStore {
  autoLockTimeId: number
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

// Storage adapter interface
export interface StorageAdapter {
  get(key: string): Promise<any>
  set(key: string, value: any): Promise<void>
  createPersistentProxy<T extends object>(name: string, template: T): Promise<T>
}

// Service configuration
export interface PreferenceServiceConfig {
  storage: StorageAdapter
  logger?: any
  t?: any
  eventBus?: EventEmitter
  template: BasePreferenceStore
  supportedLocales?: string[]
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
