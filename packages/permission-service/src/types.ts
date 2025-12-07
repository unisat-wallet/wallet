import { ProxyStorageAdapter } from '@unisat/wallet-storage'
import { ChainType } from '@unisat/wallet-types'

// LRU Cache entry interface
export interface LRUEntry<K, V> {
  k: K
  v: V
  e: number
}

/**
 * Site connection information
 */
export interface ConnectedSite {
  origin: string
  icon: string
  name: string
  chain: ChainType
  e?: number
  isSigned: boolean
  isTop: boolean
  order?: number
  isConnected: boolean
}

/**
 * Permission storage structure
 */
export interface PermissionStore {
  dumpCache: ReadonlyArray<LRUEntry<string, ConnectedSite>>
}

/**
 * Storage adapter interface
 */
export interface StorageAdapter {
  get(key: string): Promise<any>
  set(key: string, value: any): Promise<void>
}

/**
 * Logger interface
 */
export interface Logger {
  log(...args: any[]): void
  warn(...args: any[]): void
  error(...args: any[]): void
  debug?(...args: any[]): void
}

/**
 * Permission service configuration
 */
export interface PermissionServiceConfig {
  storage: ProxyStorageAdapter
  storageKey?: string
  logger?: Logger
  autoSync?: boolean
  internalRequestOrigin?: string
}

/**
 * Default logger implementation
 */
export const defaultLogger: Logger = {
  log: (...args: any[]) => console.log('[PermissionService]', ...args),
  warn: (...args: any[]) => console.warn('[PermissionService]', ...args),
  error: (...args: any[]) => console.error('[PermissionService]', ...args),
  debug: (...args: any[]) => console.debug('[PermissionService]', ...args),
}
