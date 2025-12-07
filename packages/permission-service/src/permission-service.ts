// @ts-ignore
import LRU from 'lru-cache'

import type {
  ConnectedSite,
  PermissionStore,
  PermissionServiceConfig,
  StorageAdapter,
  Logger,
  LRUEntry,
} from './types'
import { defaultLogger } from './types'
import { ChainType } from '@unisat/wallet-types'
import { ProxyStorageAdapter } from '@unisat/wallet-storage'

/**
 * Cross-platform permission service for managing dApp connections
 */
export class PermissionService {
  private store: PermissionStore = {
    dumpCache: [],
  }
  private lruCache: LRU<string, ConnectedSite> | undefined
  protected storage: ProxyStorageAdapter = undefined as any
  private storageKey: string = 'permission'
  private logger: Logger = defaultLogger
  private autoSync: boolean = false
  private internalRequestOrigin: string = 'https://unisat.io'

  constructor() {}

  /**
   * Initialize the permission service
   */
  async init(config: PermissionServiceConfig): Promise<void> {
    try {
      if (config.storage) {
        this.storage = config.storage
      }

      if (config.logger) {
        this.logger = config.logger
      }

      if (config.storageKey) {
        this.storageKey = config.storageKey
      }

      if (!this.storage) {
        throw new Error('PermissionService: Storage adapter is required')
      }

      const storedData = await this.storage.get(this.storageKey)
      this.store = storedData || { dumpCache: [] }

      this.lruCache = new LRU()
      const cache: ReadonlyArray<LRUEntry<string, ConnectedSite>> = (
        this.store.dumpCache || []
      ).map(item => ({
        k: item.k,
        v: item.v,
        e: 0,
      }))
      this.lruCache.load(cache)

      this.sync()

      this.logger.debug?.('PermissionService initialized with', cache.length, 'cached sites')
    } catch (error) {
      this.logger.error('Failed to initialize PermissionService:', error)
      throw error
    }
  }

  resetAllData = () => {
    this.storage.set(this.storageKey, { dumpCache: [] })

    this.store = {
      dumpCache: [],
    }

    this.lruCache.reset()
  }

  /**
   * Sync cache to storage
   */
  private async sync(): Promise<void> {
    if (!this.autoSync || !this.lruCache) return

    try {
      this.store.dumpCache = this.lruCache.dump()
      await this.storage.set(this.storageKey, this.store)
    } catch (error) {
      this.logger.error('Failed to sync permission data:', error)
    }
  }

  /**
   * Get site without updating LRU order
   */
  getWithoutUpdate(key: string): ConnectedSite | undefined {
    if (!this.lruCache) return
    return this.lruCache.peek(key)
  }

  /**
   * Get site information
   */
  getSite(origin: string): ConnectedSite | undefined {
    return this.lruCache?.get(origin)
  }

  /**
   * Set site information
   */
  async setSite(site: ConnectedSite): Promise<void> {
    if (!this.lruCache) return

    this.lruCache.set(site.origin, site)
    await this.sync()
  }

  /**
   * Add a new connected site
   */
  async addConnectedSite(
    origin: string,
    name: string,
    icon: string,
    defaultChain: ChainType,
    isSigned = false
  ): Promise<void> {
    if (!this.lruCache) return

    this.lruCache.set(origin, {
      origin,
      name,
      icon,
      chain: defaultChain,
      isSigned,
      isTop: false,
      isConnected: true,
    })

    await this.sync()
  }

  /**
   * Touch connected site (update LRU order)
   */
  async touchConnectedSite(origin: string): Promise<void> {
    if (!this.lruCache) return
    if (origin === this.internalRequestOrigin) return

    this.lruCache.get(origin)
    await this.sync()
  }

  /**
   * Update connected site
   */
  async updateConnectSite(
    origin: string,
    value: Partial<ConnectedSite>,
    partialUpdate?: boolean
  ): Promise<void> {
    if (!this.lruCache || !this.lruCache.has(origin)) return
    if (origin === this.internalRequestOrigin) return

    if (partialUpdate) {
      const existingValue = this.lruCache.get(origin)
      this.lruCache.set(origin, { ...existingValue, ...value } as ConnectedSite)
    } else {
      this.lruCache.set(origin, value as ConnectedSite)
    }

    await this.sync()
  }

  /**
   * Check if origin has permission
   */
  hasPermission(origin: string): boolean {
    if (!this.lruCache) return false
    if (origin === this.internalRequestOrigin) return true

    const site = this.lruCache.get(origin)
    return site ? site.isConnected : false
  }

  /**
   * Set recent connected sites order
   */
  async setRecentConnectedSites(sites: ConnectedSite[]): Promise<void> {
    if (!this.lruCache) return

    this.lruCache.load(
      sites
        .map((item: ConnectedSite) => ({
          e: 0,
          k: item.origin,
          v: item,
        }))
        .concat(
          (this.lruCache?.values() || [])
            .filter((item: ConnectedSite) => !item.isConnected)
            .map((item: ConnectedSite) => ({
              e: 0,
              k: item.origin,
              v: item,
            }))
        )
    )

    await this.sync()
  }

  /**
   * Get recent connected sites (ordered with pinned sites first)
   */
  getRecentConnectedSites(): ConnectedSite[] {
    const sites = (this.lruCache?.values() || []).filter((item: ConnectedSite) => item.isConnected)
    const pinnedSites = sites
      .filter((item: ConnectedSite) => item?.isTop)
      .sort((a: ConnectedSite, b: ConnectedSite) => (a.order || 0) - (b.order || 0))
    const recentSites = sites.filter((item: ConnectedSite) => !item.isTop)
    return [...pinnedSites, ...recentSites]
  }

  /**
   * Get all connected sites
   */
  getConnectedSites(): ConnectedSite[] {
    return (this.lruCache?.values() || []).filter((item: ConnectedSite) => item.isConnected)
  }

  /**
   * Get connected site by key
   */
  getConnectedSite(key: string): ConnectedSite | undefined {
    const site = this.lruCache?.get(key)
    if (site && site.isConnected) {
      return site
    }
    return undefined
  }

  /**
   * Pin a connected site to top
   */
  async topConnectedSite(origin: string, order?: number): Promise<void> {
    const site = this.getConnectedSite(origin)
    if (!site || !this.lruCache) return

    const maxOrder = Math.max(...this.getRecentConnectedSites().map(item => item.order || 0), 0)
    const finalOrder = order ?? maxOrder + 1

    await this.updateConnectSite(origin, {
      ...site,
      order: finalOrder,
      isTop: true,
    })
  }

  /**
   * Unpin a connected site
   */
  async unpinConnectedSite(origin: string): Promise<void> {
    const site = this.getConnectedSite(origin)
    if (!site || !this.lruCache) return

    await this.updateConnectSite(origin, {
      ...site,
      isTop: false,
    })
  }

  /**
   * Remove connected site
   */
  async removeConnectedSite(origin: string): Promise<void> {
    if (!this.lruCache) return

    const site = this.getConnectedSite(origin)
    if (!site) {
      return
    }

    await this.setSite({
      ...site,
      isConnected: false,
    })
  }

  /**
   * Get sites by default chain
   */
  getSitesByDefaultChain(chain: ChainType): ConnectedSite[] {
    if (!this.lruCache) return []
    return this.lruCache.values().filter((item: ConnectedSite) => item.chain === chain)
  }

  /**
   * Check if origin is internal
   */
  isInternalOrigin(origin: string): boolean {
    return origin === this.internalRequestOrigin
  }

  /**
   * Clear all permissions
   */
  async clearAllPermissions(): Promise<void> {
    if (!this.lruCache) return

    this.lruCache.reset()
    this.store = { dumpCache: [] }
    await this.storage.set(this.storageKey, this.store)
  }

  /**
   * Get permission statistics
   */
  getStats(): { total: number; connected: number; pinned: number } {
    if (!this.lruCache) return { total: 0, connected: 0, pinned: 0 }

    const sites = this.lruCache.values()
    const connectedSites = sites.filter((site: ConnectedSite) => site.isConnected)
    const pinnedSites = connectedSites.filter((site: ConnectedSite) => site.isTop)

    return {
      total: sites.length,
      connected: connectedSites.length,
      pinned: pinnedSites.length,
    }
  }
}
